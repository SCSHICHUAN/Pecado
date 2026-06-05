/**
 * @file index.js
 * @domain llm-volc
 *
 * 火山方舟 LLM 适配器唯一对外入口（`src/main/llm-volc/`）。
 *
 * 外部（chat / ipc）只应 require 本文件：
 *   - 入：apiKey、model、messages、tools
 *   - 出：VolcStreamEvent 流，或 collectPlainChat 聚合结果
 *
 * 内部实现：HTTP、SSE 解析、message 规范化、tool_calls 聚合 — 均不泄漏。
 */
const { ARK_BOTS_URL } = require('./constants');
const { streamChat, collectPlainChat } = require('./stream-chat');
const { resolveVolcCredentials, MISSING_KEY_ERROR } = require('./credentials');
const { sanitizeMessagesForVolcApi, sanitizeToolCallsForApi } = require('./messages');

module.exports = {
  ARK_BOTS_URL,
  /** 流式一轮：yield text_delta | tool_call_delta | round_complete | error */
  streamChat,
  /** 纯文本一轮：{ content } | { error } */
  collectPlainChat,
  resolveVolcCredentials,
  MISSING_KEY_ERROR,
  sanitizeMessagesForVolcApi,
  sanitizeToolCallsForApi,
};
