/**
 * @file stream-chat.js
 * @domain volc
 *
 * 一次火山 stream 请求 → 对外 AsyncGenerator<VolcStreamEvent>。
 */
const { postChatCompletion, parseApiError } = require('./client');
const { extractDeltaText, streamJsonErrorMessage, parseSseJsonStream } = require('./sse-reader');
const { createToolCallAccumulator } = require('./tool-call-acc');

/**
 * @param {{
 *   apiKey: string,
 *   model: string,
 *   messages: Array<Record<string, unknown>>,
 *   tools?: Array<object>,
 * }} opts
 * @returns {AsyncGenerator<object, void, void>}
 */
async function* streamChat(opts) {
  let res;
  try {
    res = await postChatCompletion({ ...opts, stream: true });
  } catch (e) {
    yield { type: 'error', message: e.message || String(e) };
    return;
  }

  if (!res.ok) {
    yield { type: 'error', message: await parseApiError(res) };
    return;
  }
  if (!res.body) {
    yield { type: 'error', message: '流式响应无 body' };
    return;
  }

  let fullContent = '';
  let finishReason = null;
  const toolAcc = createToolCallAccumulator();

  for await (const json of parseSseJsonStream(res.body)) {
    const errMsg = streamJsonErrorMessage(json);
    if (errMsg) {
      yield { type: 'error', message: errMsg };
      return;
    }

    const c0 = /** @type {{ finish_reason?: string, delta?: { tool_calls?: object[] } }} */ (
      json
    )?.choices?.[0];
    if (c0?.finish_reason) finishReason = c0.finish_reason;

    const text = extractDeltaText(json);
    if (text) {
      fullContent += text;
      yield { type: 'text_delta', text };
    }

    const deltaToolCalls = c0?.delta?.tool_calls;
    if (Array.isArray(deltaToolCalls) && deltaToolCalls.length) {
      toolAcc.merge(deltaToolCalls);
      for (const tc of deltaToolCalls) {
        const idx = tc.index ?? 0;
        yield {
          type: 'tool_call_delta',
          index: idx,
          id: tc.id,
          name: tc.function?.name,
          argumentsFragment: tc.function?.arguments,
          accumulated: toolAcc.getAt(idx),
        };
      }
    }
  }

  const toolCalls = toolAcc.toArray();
  if (!finishReason && toolCalls.length) finishReason = 'tool_calls';

  yield {
    type: 'round_complete',
    finishReason,
    content: fullContent,
    toolCalls,
  };
}

/**
 * 纯文本一轮：消费 streamChat，聚合全文。
 * @param {Parameters<typeof streamChat>[0]} opts
 * @param {{ onTextDelta?: (piece: string) => void }} [handlers]
 */
async function collectPlainChat(opts, handlers = {}) {
  let text = '';
  for await (const ev of streamChat(opts)) {
    if (ev.type === 'error') return { error: ev.message };
    if (ev.type === 'text_delta') {
      text += ev.text;
      handlers.onTextDelta?.(ev.text);
    }
    if (ev.type === 'round_complete') {
      const content = ev.content || text;
      return { content };
    }
  }
  return { error: '流式响应未正常结束' };
}

module.exports = { streamChat, collectPlainChat };
