/**
 * @file agent-integration.js
 * @domain chat
 *
 * Agent 模式 IPC 桥：创建 uiSink 并启动 agent session。
 */
const { createUiStreamSink } = require('./ui-stream-sink');
const { runAgentSession } = require('./agent-session');

/**
 * @param {import('electron').WebContents} sender
 * @param {string} streamId
 * @param {string} apiKey
 * @param {string} model
 * @param {Array<{ role: string, content: string }>} messages
 * @param {{ xcodeStreamPath?: string }} [loopOpts]
 */
async function runAgentChat(sender, streamId, apiKey, model, messages, loopOpts = {}) {
  const uiSink = createUiStreamSink(sender, streamId);
  try {
    return await runAgentSession(uiSink, streamId, apiKey, model, messages, loopOpts);
  } catch (e) {
    const msg = e.message || String(e);
    uiSink.onError(msg);
    return { error: msg };
  }
}

module.exports = { runAgentChat };
