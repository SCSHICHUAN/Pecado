/**
 * @file http.js
 *
 * OpenAI 兼容 Chat Completions 传输：POST `{baseUrl}{path}`，Bearer apiKey。
 * 由 llm-server/stream.js 调用。
 */
const { sanitizeMessagesForVolcApi } = require('./format');
const {
  resolveVolcApiEndpoint,
  resolveChatCompletionsUrl,
  VOLC_API_MODES,
} = require('../settings/js/volc-user-config');

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
 *   apiMode?: string,
 *   baseUrl?: string,
 *   endpoint?: string,
 *   messages: Array<Record<string, unknown>>,
 *   stream?: boolean,
 *   tools?: Array<object>,
 * }} opts
 */
async function postChatCompletion(opts) {
  const url =
    opts.endpoint ||
    (opts.baseUrl || opts.path
      ? resolveChatCompletionsUrl(opts.baseUrl || '', opts.path || '')
      : '') ||
    resolveVolcApiEndpoint(opts.apiMode || VOLC_API_MODES.CHAT);
  if (!url) {
    throw new Error('未配置 LLM Base URL / endpoint');
  }
  const body = {
    model: opts.model,
    messages: sanitizeMessagesForVolcApi(opts.messages),
    stream: !!opts.stream,
    max_tokens: opts.maxTokens || 8192,
  };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = 'auto';
  }
  if (opts.stream) {
    body.stream_options = { include_usage: true };
  }

  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
      Accept: opts.stream ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(body),
  });
}

module.exports = { postChatCompletion, parseApiError };
