/**
 * @file sse-reader.js
 * @domain volc
 * @protocol volc-sse
 *
 * 读取 text/event-stream（SSE）或 NDJSON 行，逐条 yield 解析后的 JSON。
 */

/**
 * @param {string} line
 * @returns {unknown | null}
 */
function parseSseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) return null;
  let data = '';
  if (trimmed.startsWith('data:')) {
    data = trimmed.slice(5).trim();
  } else if (trimmed.startsWith('{')) {
    data = trimmed;
  } else {
    return null;
  }
  if (!data || data === '[DONE]') return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * @param {ReadableStream<Uint8Array>} body
 * @returns {AsyncGenerator<unknown, void, void>}
 */
async function* parseSseJsonStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let carry = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    const lines = carry.split(/\r?\n/);
    carry = lines.pop() ?? '';

    for (const line of lines) {
      const json = parseSseLine(line);
      if (json != null) yield json;
    }
  }

  if (carry.trim()) {
    const json = parseSseLine(carry);
    if (json != null) yield json;
  }
}

module.exports = { parseSseLine, parseSseJsonStream };
