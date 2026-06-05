/**
 * @file client.js
 *
 * 火山方舟 Bots Chat Completions HTTP 客户端。
 */
const { sanitizeMessagesForVolcApi } = require('./messages');

const ARK_BOTS_URL = 'https://ark.cn-beijing.volces.com/api/v3/bots/chat/completions';

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

module.exports = { ARK_BOTS_URL, postChatCompletion, parseApiError };
