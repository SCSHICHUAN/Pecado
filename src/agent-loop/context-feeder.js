/**
 * @file context-feeder.js
 * @module agent-loop / ContextFeeder
 *
 * Loop 内部：把各模块 FEED_* 产出写入多轮 conv（非业务模块出口）
 */
function feed_assistant_tool_calls(conv, assistantMessage) {
  if (!assistantMessage) return conv;
  conv.push({ ...assistantMessage });
  return conv;
}

/**
 * @param {Array<object>} conv
 * @param {{ id: string }} parsedTask
 * @param {{ observation: string }} toolFeed FEED_tool_result 产出
 */
function feed_observation(conv, parsedTask, toolFeed) {
  conv.push({
    role: 'tool',
    tool_call_id: parsedTask.id,
    content: toolFeed?.observation ?? '',
  });
  return conv;
}

const ContextFeeder = { feed_observation, feed_assistant_tool_calls };

module.exports = { ContextFeeder, feed_observation, feed_assistant_tool_calls };
