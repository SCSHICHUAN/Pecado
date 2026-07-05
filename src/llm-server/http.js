/**
 * @file http.js
 *
 * 【功能】火山方舟 Bots Chat Completions HTTP 传输层（不含 SSE 解析、不含 tools schema 转换）。
 *   - Bots：POST …/api/v3/bots/chat/completions
 *   - Coding Plan：POST …/api/coding/v3/chat/completions
 *   - 请求体：model、messages（经 format.sanitizeMessagesForVolcApi）、stream、tools + tool_choice=auto
 *   - 流式时附加 stream_options.include_usage；Accept 为 text/event-stream 或 application/json
 *   - Authorization: Bearer {apiKey}
 *
 * 【调用方】llm-server/stream.js  exclusively
 *
 * 【对外能力】（内部模块，经 stream.js 间接使用）
 *   - postChatCompletion({ apiKey, model, messages, stream?, tools? }) → fetch Response
 *   - parseApiError(res)：解析 JSON/text 错误体为可读 message
 */
const { sanitizeMessagesForVolcApi } = require('./format');
const { resolveVolcApiEndpoint, VOLC_API_MODES } = require('../settings/js/volc-user-config');

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
 *   endpoint?: string,
 *   messages: Array<Record<string, unknown>>,
 *   stream?: boolean,
 *   tools?: Array<object>,
 * }} opts
 */
async function postChatCompletion(opts) {
  const url =
    opts.endpoint ||
    resolveVolcApiEndpoint(opts.apiMode || VOLC_API_MODES.BOTS);
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
