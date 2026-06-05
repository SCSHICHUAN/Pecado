/**
 * @file chat-integration.js
 *
 * @deprecated 请 require `features/chat/agent-integration`；此文件保留兼容 re-export。
 */
const { runAgentChat } = require('../features/chat/agent-integration');

module.exports = { handleMcpToolsChat: runAgentChat };
