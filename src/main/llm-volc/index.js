/**
 * @file index.js
 *
 * 火山方舟 LLM 适配器对外入口。
 */
const { ARK_BOTS_URL } = require('./client');
const { streamChat, collectPlainChat } = require('./stream-chat');
const { resolveVolcCredentials, MISSING_KEY_ERROR } = require('../config/volc-user-config');
const { sanitizeMessagesForVolcApi, sanitizeToolCallsForApi } = require('./messages');
const { mcpToolsToFunctionTools } = require('./tools-bridge');

module.exports = {
  ARK_BOTS_URL,
  streamChat,
  collectPlainChat,
  resolveVolcCredentials,
  MISSING_KEY_ERROR,
  sanitizeMessagesForVolcApi,
  sanitizeToolCallsForApi,
  mcpToolsToFunctionTools,
};
