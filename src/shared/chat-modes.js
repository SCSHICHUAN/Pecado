/**
 * @file chat-modes.js
 *
 * 对话模式常量（主进程 / 渲染进程共用）。
 *
 * - plain：纯 SSE，无工程 tools
 * - context：SSE + system 里拼工程上下文（无 Function Calling）
 * - agent：SSE + MCP tools 多轮 Function Calling
 */

const CHAT_MODES = Object.freeze({
  PLAIN: 'plain',
  CONTEXT: 'context',
  AGENT: 'agent',
});

/**
 * @param {{ mode?: string, useMcpTools?: boolean } | null | undefined} payload
 * @returns {'plain' | 'context' | 'agent'}
 */
function normalizeChatMode(payload) {
  const mode = payload?.mode;
  if (mode === CHAT_MODES.AGENT || mode === 'agent') return CHAT_MODES.AGENT;
  if (mode === CHAT_MODES.CONTEXT || mode === 'context') return CHAT_MODES.CONTEXT;
  if (payload?.useMcpTools) return CHAT_MODES.AGENT;
  return CHAT_MODES.PLAIN;
}

/** @param {string} mode */
function isAgentMode(mode) {
  return mode === CHAT_MODES.AGENT;
}

module.exports = { CHAT_MODES, normalizeChatMode, isAgentMode };
