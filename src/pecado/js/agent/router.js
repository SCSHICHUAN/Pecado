/**
 * @file router.js
 *
 * 【功能】对话总路由：模式选择、messages 组装、VOLC_ARK IPC 注册与分发。
 *   模式决策（selectChatMode）：
 *     - MCP 已连接 → agent（Function Calling + tools）
 *     - 未连接但有工程上下文（@path / 目录树可读）→ context（system 附加 project-context）
 *     - 否则 → plain（纯对话）
 *   agent 模式额外：pickXcodeStreamTarget 从用户输入提取 .swift/.m 等路径供 Xcode 流式写
 *   IPC：VOLC_ARK.BOTS_CHAT_COMPLETION，payload 含 streamId、userText、history
 *
 * 【调用方】pecado/register.js → register(ipcMain)
 *
 * 【依赖】settings、mcp-filesystem、prompts、plain-stream、agent-loop、stream-ui、xcode
 *
 * 【对外能力】
 *   - register(ipcMain)：绑定 invoke 处理器，返回 { content } | { error }
 *   - selectChatMode({ userText, history, legacyMessages, payloadMode, payloadXcodeStreamPath })
 *   - buildChatMessages(mode, userText, history, contextBlock)
 *   - CHAT_MODES：plain | context | agent
 */
const { VOLC_ARK } = require('../../../shared/ipc-channels');
const { resolveVolcCredentials, MISSING_KEY_ERROR } = require('../../../settings/js/volc-user-config');
const projectIo = require('../../../mcp-filesystem');
const { buildProjectContextForAi, buildAtMentionContextForAi } = require('../../../mcp-filesystem/project-context');
const { pickXcodeStreamTarget } = require('../../../xcode/paths');
const { createUiStreamSink } = require('./stream-ui');
const { resolveOpenProjectPath } = require('../../../xcode/stream');
const { runPlainSession } = require('./plain-stream');
const { runAppAgentLoop } = require('../../../agent-loop');
const { bindAgentLogSender, unbindAgentLogSender } = require('../../../shared/agent-log');
const { SYSTEM_PROMPT } = require('../prompts/default');
const { AGENT_SYSTEM_PROMPT } = require('../prompts/agent');
const { GIT_CHAT_SYSTEM_PROMPT } = require('../prompts/git-chat');
const { buildDevDocsContextForAi } = require('../../../workflow/skill/agent/context');
const { buildCodxEditorContextForAi, buildCodxChatLanguageBlockForAi } = require('../../../codX/agent/context');
const { wrapCodxUserTextForAi } = require('../../../shared/prompt-language');

const CHAT_MODES = Object.freeze({
  PLAIN: 'plain',
  CONTEXT: 'context',
  AGENT: 'agent',
  GIT: 'git',
});

/** @param {string} mode */
function isAgentMode(mode) {
  return mode === CHAT_MODES.AGENT;
}

function isGitChatMode(mode) {
  return mode === CHAT_MODES.GIT;
}

/**
 * @param {string} mode
 * @param {string} userText
 * @param {Array<{ role: string, content: string }>} history
 * @param {string} [contextBlock]
 * @param {Array<{base64: string, mimeType: string}>} [images]
 * @param {Array<string>} [svgs]
 */
function buildChatMessages(mode, userText, history, contextBlock = '', images, svgs) {
  let systemContent = AGENT_SYSTEM_PROMPT;
  if (isGitChatMode(mode)) {
    systemContent = GIT_CHAT_SYSTEM_PROMPT;
  } else if (!isAgentMode(mode)) {
    systemContent = SYSTEM_PROMPT;
  }
  const devDocsBlock = buildDevDocsContextForAi();
  if (devDocsBlock.trim()) {
    systemContent += `\n\n${devDocsBlock.trim()}`;
  }
  if (!isAgentMode(mode) && !isGitChatMode(mode) && contextBlock.trim()) {
    systemContent += `\n\n${contextBlock.trim()}`;
  }
  if (isGitChatMode(mode) && contextBlock.trim()) {
    systemContent += `\n\n【当前仓库】\n${contextBlock.trim()}`;
  }
  if (isAgentMode(mode) && contextBlock.trim()) {
    systemContent += `\n\n${contextBlock.trim()}`;
  }

  const hasImages = Array.isArray(images) && images.length;
  const hasSvgs = Array.isArray(svgs) && svgs.length;

  let userContent;
  if (hasImages || hasSvgs) {
    const parts = [{ type: 'text', text: userText }];
    if (hasSvgs) {
      svgs.forEach((svg) => parts.push({ type: 'text', text: svg }));
    }
    if (hasImages) {
      images.forEach((img) => {
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
        });
      });
    }
    userContent = parts;
  } else {
    userContent = userText;
  }

  const hist = Array.isArray(history) ? history : [];
  return [
    { role: 'system', content: systemContent },
    ...hist.map((m) => {
      const c = m.content;
      if (Array.isArray(c)) return { role: m.role, content: c };
      return { role: m.role, content: c == null ? '' : String(c) };
    }),
    { role: 'user', content: userContent },
  ];
}

/**
 * @param {{
 *   userText?: string | null,
 *   history?: Array<{ role: string, content: string }>,
 *   legacyMessages?: Array<{ role: string, content: string }>,
 *   payloadMode?: string,
 *   payloadXcodeStreamPath?: string | null,
 *   payloadGitContext?: string | null,
 *   payloadCodxActiveFile?: string | null,
 *   payloadCodxChat?: boolean,
 *   payloadImages?: Array<{base64: string, mimeType: string}>,
 *   payloadSvgs?: Array<string>,
 * }} input
 * @returns {Promise<{ mode: string, messages: Array<object>, xcodeStreamPath: string | null } | { error: string }>}
 */
async function selectChatMode(input = {}) {
  const {
    userText,
    history,
    legacyMessages,
    payloadMode,
    payloadXcodeStreamPath,
    payloadGitContext,
    payloadCodxActiveFile,
    payloadCodxChat,
    payloadImages,
    payloadSvgs,
  } = input;

  if (userText != null && String(userText).trim()) {
    const text = String(userText);
    let contextBlock = '';
    let mode;
    let xcodeStreamPath = null;

    if (payloadMode === CHAT_MODES.GIT) {
      mode = CHAT_MODES.GIT;
      contextBlock = payloadGitContext || '';
    } else if (projectIo.getStatus().connected) {
      mode = CHAT_MODES.AGENT;
      const codxActiveFile = String(payloadCodxActiveFile || '').trim();
      xcodeStreamPath = pickXcodeStreamTarget(text, codxActiveFile);
      const anchorBlock = await buildProjectContextForAi('', { agentAnchorOnly: true });
      contextBlock = await buildAtMentionContextForAi(text);
      const codxBlock = buildCodxEditorContextForAi(codxActiveFile);
      const parts = [anchorBlock, contextBlock, codxBlock].map((s) => String(s || '').trim()).filter(Boolean);
      contextBlock = parts.join('\n\n');
      if (payloadCodxChat) {
        contextBlock = [contextBlock, buildCodxChatLanguageBlockForAi()]
          .map((s) => String(s || '').trim())
          .filter(Boolean)
          .join('\n\n');
      }
    } else {
      contextBlock = await buildProjectContextForAi(text);
      mode = contextBlock.trim() ? CHAT_MODES.CONTEXT : CHAT_MODES.PLAIN;
    }

    return {
      mode,
      messages: buildChatMessages(
        mode,
        payloadCodxChat ? wrapCodxUserTextForAi(text) : text,
        history,
        contextBlock,
        payloadImages,
        payloadSvgs
      ),
      xcodeStreamPath,
      codxChat: Boolean(payloadCodxChat),
    };
  }

  if (Array.isArray(legacyMessages) && legacyMessages.length) {
    return {
      mode: payloadMode || CHAT_MODES.PLAIN,
      messages: legacyMessages,
      xcodeStreamPath: payloadXcodeStreamPath || null,
    };
  }

  return { error: '缺少 userText 或 messages' };
}

function register(ipcMain) {
  ipcMain.handle(VOLC_ARK.BOTS_CHAT_COMPLETION, async (event, payload) => {
    const { streamId, userText, history, images, svgs, messages: legacyMessages } = payload || {};
    if (!streamId || typeof streamId !== 'string') {
      return { error: '缺少 streamId（流式对话需要）' };
    }

    const selected = await selectChatMode({
      userText,
      history,
      legacyMessages,
      payloadMode: payload?.mode,
      payloadXcodeStreamPath: payload?.xcodeStreamPath,
      payloadGitContext: payload?.gitContext,
      payloadCodxActiveFile: payload?.codxActiveFile,
      payloadCodxChat: Boolean(payload?.codxChat),
      payloadImages: images,
      payloadSvgs: svgs,
    });
    if (selected.error) return { error: selected.error };

    const { mode, messages, xcodeStreamPath, codxChat } = selected;

    const { apiKey, model, apiMode, endpoint } = resolveVolcCredentials();
    if (!apiKey) {
      return { error: MISSING_KEY_ERROR };
    }

    const sender = event.sender;
    const llmOpts = { apiKey, model, apiMode, endpoint };

    if (isAgentMode(mode)) {
      const uiSink = createUiStreamSink(sender, streamId);
      bindAgentLogSender(sender);
      try {
        return await runAppAgentLoop(uiSink, llmOpts, messages, {
          xcodeStreamPath: xcodeStreamPath || undefined,
          userText: String(userText || ''),
          codxChat: Boolean(codxChat),
          sender,
        });
      } finally {
        unbindAgentLogSender();
      }
    }

    const xcodeAbsPath = resolveOpenProjectPath(xcodeStreamPath);
    const uiSink = createUiStreamSink(sender, streamId);
    return runPlainSession({
      ...llmOpts,
      messages,
      uiSink,
      xcodeAbsPath,
    });
  });
}

module.exports = { register, selectChatMode, buildChatMessages };
