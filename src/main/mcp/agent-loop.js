/**
 * @file agent-loop.js
 *
 * @deprecated 请 require `features/chat/agent-session`；此文件保留兼容 re-export。
 */
const { runAgentSession, mcpToolsToFunctionTools } = require('../features/chat/agent-session');

module.exports = {
  runMcpAgentLoop: runAgentSession,
  mcpToolsToFunctionTools,
};
