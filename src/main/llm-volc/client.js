/**
 * @file client.js
 * @domain volc
 * @protocol volc-sse
 *
 * 火山方舟 Bots Chat Completions HTTP 客户端（无 Electron / 业务副作用）。
 */
const { ARK_BOTS_URL } = require('./constants');
const { extractDeltaText, streamJsonErrorMessage } = require('./delta');
const { sanitizeMessagesForVolcApi } = require('./messages');
const { parseSseJsonStream } = require('./sse-reader');

/**
 * @param {Response} res
 * @returns {Promise<string>}
 */
async function parseApiError(res) {
  let msg = `HTTP ${res.status}`;
  const errText = await res.text();
  try {
    const j = JSON.parse(errText);
    msg = j.error?.message || j.message || msg;
  } catch (_) {
    if (errText && errText.length < 500) msg = errText;
  }
  return msg;
}

/**
 * @param {{
 *   apiKey: string,
 *   model: string,
 *   messages: Array<Record<string, unknown>>,
 *   stream?: boolean,
 *   tools?: Array<object>,
 * }} opts
 */
async function postChatCompletion(opts) {
  const body = {
    model: opts.model,
    messages: sanitizeMessagesForVolcApi(opts.messages),
    stream: !!opts.stream,
  };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = 'auto';
  }
  if (opts.stream) {
    body.stream_options = { include_usage: true };
  }

  return fetch(ARK_BOTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
      Accept: opts.stream ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * 纯文本 SSE：聚合全文，可选每片 delta 回调。
 * @param {ReadableStream<Uint8Array>} body
 * @param {{ onTextDelta?: (piece: string) => void }} [handlers]
 * @returns {Promise<{ ok: true, text: string } | { error: string }>}
 */
async function collectPlainTextStream(body, handlers = {}) {
  let full = '';
  for await (const json of parseSseJsonStream(body)) {
    const errMsg = streamJsonErrorMessage(json);
    if (errMsg) return { error: errMsg };

    const piece = extractDeltaText(json);
    if (piece) {
      full += piece;
      if (handlers.onTextDelta) handlers.onTextDelta(piece);
    }
  }
  return { ok: true, text: full };
}

module.exports = {
  ARK_BOTS_URL,
  postChatCompletion,
  parseApiError,
  collectPlainTextStream,
  parseSseJsonStream,
  extractDeltaText,
  streamJsonErrorMessage,
  sanitizeMessagesForVolcApi,
};
