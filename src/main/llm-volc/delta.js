/**
 * @file delta.js
 * @domain volc
 * @protocol volc-sse
 *
 * 从火山 SSE JSON 块提取 delta 文本与错误信息。
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

module.exports = { extractDeltaText, streamJsonErrorMessage };
