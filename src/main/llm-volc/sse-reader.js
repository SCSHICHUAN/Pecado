/**
 * @file sse-reader.js
 *
 * 火山 SSE/NDJSON 解析 + delta 文本/错误提取。
 */

/** @param {unknown} json */
function extractDeltaText(json) {
  if (!json || typeof json !== 'object') return '';
  const c0 = /** @type {{ delta?: object, message?: object }} */ (json).choices?.[0];
  if (!c0) return '';
  const d = /** @type {{ content?: string | Array<{ type?: string, text?: string }> }} */ (c0.delta);
  if (d && typeof d.content === 'string') return d.content;
  if (d && Array.isArray(d.content)) {
    return d.content
      .map((p) => (p && p.type === 'text' && p.text ? String(p.text) : ''))
      .join('');
  }
  const msg = /** @type {{ content?: string }} */ (c0.message);
  if (msg && typeof msg.content === 'string') return msg.content;
  return '';
}

/** @param {unknown} json */
function streamJsonErrorMessage(json) {
  if (!json || typeof json !== 'object') return '';
  const err = /** @type {{ error?: string | { message?: string, msg?: string, code?: unknown } }} */ (
    json
  ).error;
  if (!err) return '';
  if (typeof err === 'string') return err;
  return err.message || err.msg || String(err.code || '') || '';
}

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

module.exports = { extractDeltaText, streamJsonErrorMessage, parseSseLine, parseSseJsonStream };
