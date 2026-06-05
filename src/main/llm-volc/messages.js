/**
 * @file messages.js
 * @domain volc
 * @protocol volc-sse
 *
 * 发送前规范化 messages / tool_calls，避免火山 API 400。
 */

/** @param {unknown} content */
function normalizeMessageContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && p.type === 'text' && p.text != null ? String(p.text) : ''))
      .join('');
  }
  return String(content);
}

/** @param {unknown} toolCalls */
function sanitizeToolCallsForApi(toolCalls) {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.map((tc) => ({
    id: tc.id || '',
    type: tc.type || 'function',
    function: {
      name: tc.function?.name || '',
      arguments: tc.function?.arguments ?? '{}',
    },
  }));
}

/** @param {Array<Record<string, unknown>>} messages */
function sanitizeMessagesForVolcApi(messages) {
  return messages.map((m) => {
    const role = m.role;
    if (role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      return {
        role: 'assistant',
        content: normalizeMessageContent(m.content),
        tool_calls: sanitizeToolCallsForApi(m.tool_calls),
      };
    }
    if (role === 'tool') {
      const text = normalizeMessageContent(m.content);
      return {
        role: 'tool',
        tool_call_id: m.tool_call_id,
        content: text || '(empty tool result)',
      };
    }
    return {
      role,
      content: normalizeMessageContent(m.content),
    };
  });
}

module.exports = {
  normalizeMessageContent,
  sanitizeToolCallsForApi,
  sanitizeMessagesForVolcApi,
};
