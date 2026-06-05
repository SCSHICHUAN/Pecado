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
 * 【调用方】main.js → register(ipcMain)
 *
 * 【依赖】load-env、volc-user-config、mcp-filesystem、project-context、prompts、plain-stream、agent-loop、stream-ui、live-stream
 *
 * 【对外能力】
 *   - register(ipcMain)：绑定 invoke 处理器，返回 { content } | { error }
 *   - selectChatMode({ userText, history, legacyMessages, payloadMode, payloadXcodeStreamPath })
 *   - buildChatMessages(mode, userText, history, contextBlock)
 *   - CHAT_MODES：plain | context | agent
 */
const { loadEnvFromSearchRoots, getDefaultSearchRoots } = require('../bootstrap/load-env');
const { VOLC_ARK } = require('../../shared/ipc-channels');
const { resolveVolcCredentials, MISSING_KEY_ERROR } = require('../config/volc-user-config');
const projectIo = require('../mcp-filesystem');
const projectContext = require('../mcp-filesystem/project-context');
const { createUiStreamSink } = require('./stream-ui');
const { resolveOpenProjectPath } = require('../xcode/live-stream');
const { runPlainSession } = require('./plain-stream');
const { runAgentChat } = require('./agent-loop');
const { SYSTEM_PROMPT } = require('../prompts/default');
const { AGENT_SYSTEM_PROMPT } = require('../prompts/agent');

const CHAT_MODES = Object.freeze({
  PLAIN: 'plain',
  CONTEXT: 'context',
  AGENT: 'agent',
});

/** @param {string} mode */
function isAgentMode(mode) {
  return mode === CHAT_MODES.AGENT;
}

/**
 * @param {string} mode
 * @param {string} userText
 * @param {Array<{ role: string, content: string }>} history
 * @param {string} [contextBlock]
 */
function buildChatMessages(mode, userText, history, contextBlock = '') {
  let systemContent = isAgentMode(mode) ? AGENT_SYSTEM_PROMPT : SYSTEM_PROMPT;
  if (!isAgentMode(mode) && contextBlock.trim()) {
    systemContent += `\n\n${contextBlock.trim()}`;
  }
  const hist = Array.isArray(history) ? history : [];
  return [
    { role: 'system', content: systemContent },
    ...hist.map((m) => ({
      role: m.role,
      content: m.content == null ? '' : String(m.content),
    })),
    { role: 'user', content: userText },
  ];
}

/**
 * @param {{
 *   userText?: string | null,
 *   history?: Array<{ role: string, content: string }>,
 *   legacyMessages?: Array<{ role: string, content: string }>,
 *   payloadMode?: string,
 *   payloadXcodeStreamPath?: string | null,
 * }} input
 * @returns {Promise<{ mode: string, messages: Array<object>, xcodeStreamPath: string | null } | { error: string }>}
 */
async function selectChatMode(input = {}) {
  const { userText, history, legacyMessages, payloadMode, payloadXcodeStreamPath } = input;

  if (userText != null && String(userText).trim()) {
    const text = String(userText);
    let contextBlock = '';
    let mode;
    let xcodeStreamPath = null;

    if (projectIo.getStatus().connected) {
      mode = CHAT_MODES.AGENT;
      xcodeStreamPath = projectContext.pickXcodeStreamTarget(text);
    } else {
      contextBlock = await projectContext.buildProjectContextForAi(text);
      mode = contextBlock.trim() ? CHAT_MODES.CONTEXT : CHAT_MODES.PLAIN;
    }

    return {
      mode,
      messages: buildChatMessages(mode, text, history, contextBlock),
      xcodeStreamPath,
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
    const roots = getDefaultSearchRoots();
    try {
      const { app } = require('electron');
      if (app && app.isReady && app.isReady()) roots.push(app.getAppPath());
    } catch (_) {}
    loadEnvFromSearchRoots(roots);

    const { streamId, userText, history, messages: legacyMessages } = payload || {};
    if (!streamId || typeof streamId !== 'string') {
      return { error: '缺少 streamId（流式对话需要）' };
    }

    const selected = await selectChatMode({
      userText,
      history,
      legacyMessages,
      payloadMode: payload?.mode,
      payloadXcodeStreamPath: payload?.xcodeStreamPath,
    });
    if (selected.error) return { error: selected.error };

    const { mode, messages, xcodeStreamPath } = selected;

    const { apiKey, model } = resolveVolcCredentials();
    if (!apiKey) {
      return { error: MISSING_KEY_ERROR };
    }

    const sender = event.sender;

    if (isAgentMode(mode)) {
      return runAgentChat(sender, streamId, apiKey, model, messages, {
        xcodeStreamPath: xcodeStreamPath || undefined,
      });
    }

    const xcodeAbsPath = resolveOpenProjectPath(xcodeStreamPath);
    const uiSink = createUiStreamSink(sender, streamId);
    return runPlainSession({
      apiKey,
      model,
      messages,
      uiSink,
      xcodeAbsPath,
    });
  });
}

module.exports = { register, selectChatMode, buildChatMessages };
