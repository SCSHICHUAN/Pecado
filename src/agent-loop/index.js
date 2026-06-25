/**
 * @file index.js
 * @module agent-loop
 */
const { runAppAgentLoop, MAX_TOOL_ROUNDS } = require('./app-agent-loop');
const { TaskDispatcher, route_task } = require('./task-dispatcher');
const { ContextFeeder, feed_observation, feed_assistant_tool_calls } = require('./context-feeder');
const { createAgentStreamHooks } = require('./stream-hooks');
const { buildCapabilityAgentPrompt } = require('./capability-prompt');
const {
  getFinishTaskTool,
  isFinishTaskName,
  extractFinishSummary,
  FINISH_NUDGE,
} = require('./finish-tool');

module.exports = {
  runAppAgentLoop,
  MAX_TOOL_ROUNDS,
  TaskDispatcher,
  route_task,
  ContextFeeder,
  feed_observation,
  feed_assistant_tool_calls,
  createAgentStreamHooks,
  buildCapabilityAgentPrompt,
  getFinishTaskTool,
  isFinishTaskName,
  extractFinishSummary,
  FINISH_NUDGE,
};
