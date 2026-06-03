/**
 * @file chat-integration.js
 *
 * 方舟对话与 MCP 的集成：Function Calling agent 循环入口。
 */
const { VOLC_ARK } = require('../../shared/ipc-channels');
const { runMcpAgentLoop } = require('./agent-loop');

function safeSend(sender, payload) {
  try {
    if (sender && !sender.isDestroyed()) {
      sender.send(VOLC_ARK.BOTS_STREAM_EVENT, payload);
    }
  } catch (_) {}
}

/**
 * @param {import('electron').WebContents} sender
 * @param {string} streamId
 * @param {string} apiKey
 * @param {string} model
 * @param {Array<{ role: string, content: string }>} messages
 * @param {{ xcodeStreamPath?: string }} [loopOpts]
 */
async function handleMcpToolsChat(sender, streamId, apiKey, model, messages, loopOpts = {}) {
  try {
    return await runMcpAgentLoop(sender, streamId, apiKey, model, messages, loopOpts);
  } catch (e) {
    const msg = e.message || String(e);
    safeSend(sender, { streamId, phase: 'error', error: msg });
    return { error: msg };
  }
}

module.exports = { handleMcpToolsChat };
