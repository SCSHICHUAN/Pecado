/**
 * @file ark-chat.js
 *
 * 火山对话 IPC 入口（薄层）：校验 payload、解析密钥、按 mode 路由到 chat session。
 */
const { loadEnvFromSearchRoots, getDefaultSearchRoots } = require('../load-env');
const { VOLC_ARK } = require('../../shared/ipc-channels');
const { normalizeChatMode, isAgentMode } = require('../../shared/chat-modes');
const { resolveVolcCredentials, MISSING_KEY_ERROR } = require('../llm-volc');
const { createUiStreamSink } = require('../features/chat/ui-stream-sink');
const { runPlainSession } = require('../features/chat/plain-session');
const { runAgentChat } = require('../features/chat/agent-integration');
const { resolveXcodeStreamAbsPath } = require('../mcp/xcode-stream-target');

function register(ipcMain) {
  ipcMain.handle(VOLC_ARK.BOTS_CHAT_COMPLETION, async (event, payload) => {
    const roots = getDefaultSearchRoots();
    try {
      const { app } = require('electron');
      if (app && app.isReady && app.isReady()) roots.push(app.getAppPath());
    } catch (_) {}
    loadEnvFromSearchRoots(roots);

    const { messages, streamId, xcodeStreamPath } = payload || {};
    if (!streamId || typeof streamId !== 'string') {
      return { error: '缺少 streamId（流式对话需要）' };
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return { error: 'messages 必须为非空数组' };
    }

    const { apiKey, model } = resolveVolcCredentials();
    if (!apiKey) {
      return { error: MISSING_KEY_ERROR };
    }

    const mode = normalizeChatMode(payload);
    const sender = event.sender;

    if (isAgentMode(mode)) {
      return runAgentChat(sender, streamId, apiKey, model, messages, {
        xcodeStreamPath,
      });
    }

    const xcodeAbsPath = resolveXcodeStreamAbsPath(xcodeStreamPath);
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

module.exports = { register };
