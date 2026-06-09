/**
 * @file index.js
 * @module agent-loop
 *
 * 【职责】App Agent 多轮编排（LangGraph 风格五节点），不含 LLM HTTP 与 tool 沙箱实现。
 *   · runAppAgentLoop — 入口（由 pecado/router 调用）
 *   · route_task — DISPATCH（Loop 内部）
 *   · feed_observation / feed_assistant_tool_calls — conv 写入（Loop 内部）
 *   · createAgentStreamHooks — INFER 期间 UI + xcode 旁路
 *
 * 【依赖】llm-server（INFER/PARSE EXECUTE_*）、mcp-filesystem（EXEC EXECUTE_*）
 * 【不依赖】pecado（单向：pecado → agent-loop）
 *
 * 【说明】src/agent-loop/README.md
 */
const { runAppAgentLoop, MAX_TOOL_ROUNDS } = require('./app-agent-loop');
const { TaskDispatcher, route_task } = require('./task-dispatcher');
const { ContextFeeder, feed_observation, feed_assistant_tool_calls } = require('./context-feeder');
const { createAgentStreamHooks } = require('./stream-hooks');

module.exports = {
  runAppAgentLoop,
  MAX_TOOL_ROUNDS,
  TaskDispatcher,
  route_task,
  ContextFeeder,
  feed_observation,
  feed_assistant_tool_calls,
  createAgentStreamHooks,
};
