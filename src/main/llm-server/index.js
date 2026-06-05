/**
 * @file index.js
 *
 * 【功能】llm-server 模块对外唯一入口：火山方舟 Bots Chat Completions 的 HTTP/SSE 适配层。
 *   - 职责边界：吞吐（请求/流解析）+ 格式化（messages/tools 在内部 format.js 完成）
 *   - agent 侧只传原始 messages、mcpTools，不直接调用 sanitize / schema 转换
 *   - 凭证 resolveVolcCredentials 自 config 再导出，供 router 校验
 *
 * 【调用方】
 *   - agent/plain-stream.js → collectPlainChat
 *   - agent/agent-stream-consumer.js → streamChat
 *   - agent/agent-loop.js → 经 streamChat 间接使用（chatOpts 含 mcpTools）
 *
 * 【对外能力】
 *   - streamChat(opts)：AsyncGenerator，见 stream.js 事件类型
 *   - collectPlainChat(opts, { onTextDelta })：单轮纯文本，{ content } | { error }
 *   - resolveVolcCredentials() / MISSING_KEY_ERROR
 */
const { streamChat, collectPlainChat } = require('./stream');
const { resolveVolcCredentials, MISSING_KEY_ERROR } = require('../config/volc-user-config');

module.exports = {
  streamChat,
  collectPlainChat,
  resolveVolcCredentials,
  MISSING_KEY_ERROR,
};
