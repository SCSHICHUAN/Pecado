/**
 * @file tool-result.js
 *
 * 将 MCP callTool 返回值格式化为 role:tool 消息 content 字符串。
 */

function formatToolResultForMessage(result) {
  if (!result || typeof result !== 'object') return String(result ?? '');
  const parts = Array.isArray(result.content) ? result.content : [];
  const texts = parts
    .filter((p) => p && p.type === 'text' && p.text != null)
    .map((p) => String(p.text));
  const joined = texts.join('\n');
  if (joined) return joined;
  if (result.isError) return 'MCP tool error (no text payload)';
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

module.exports = { formatToolResultForMessage };
