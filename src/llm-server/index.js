/**
 * @file index.js
 * @module llm-server
 *
 * 【职责】OpenAI 兼容 Chat Completions：HTTP/SSE、消息格式化、单轮/多轮流式聚合。
 *   · streamChat / collectPlainChat — 底层流（plain 模式直接用 collectPlainChat）
 *   · EXECUTE_call_llm / FEED_infer_round — INFER 节点（agent-loop 调用）
 *   · EXECUTE_parse_command / FEED_parsed_command — PARSE 节点（agent-loop 调用）
 *
 * 【边界】不 require pecado、agent-loop、mcp、xcode；副作用仅通过 streamHooks 回调注入。
 */
const { streamChat, collectPlainChat } = require('./stream');
const {
  EXECUTE_call_llm,
  FEED_infer_round,
  LlmInferService,
} = require('./llm-infer-service');
const {
  EXECUTE_parse_command,
  FEED_parsed_command,
  CommandParser,
} = require('./command-parser');

module.exports = {
  streamChat,
  collectPlainChat,
  EXECUTE_call_llm,
  FEED_infer_round,
  LlmInferService,
  EXECUTE_parse_command,
  FEED_parsed_command,
  CommandParser,
};
