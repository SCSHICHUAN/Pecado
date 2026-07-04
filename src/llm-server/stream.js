/**
 * @file stream.js
 *
 * 【功能】SSE 字节流解析 + 单轮对话事件聚合（llm-server 核心吞吐逻辑）。
 *   - parseSseJsonStream：按 data: 行切分 JSON chunk
 *   - createToolCallAccumulator：按 index 合并 delta.tool_calls 片段
 *   - extractDeltaText：从 choices[0].delta/message 提取文本（支持 string 或 content 数组）
 *   - streamChat 一轮结束 yield round_complete：{ finishReason, content, toolCalls }
 *
 * 【调用方】llm-server/index.js → 再导出 streamChat / collectPlainChat
 *
 * 【对外能力】
 *   - streamChat({ apiKey, model, messages, tools?, mcpTools? })
 *     事件：reasoning_delta { text } | text_delta { text } | tool_call_delta ...
 *           | round_complete { finishReason, content, toolCalls } | error { message }
 *   - collectPlainChat(opts, { onTextDelta? })：只消费 text_delta，忽略 tool_calls
 */
const { postChatCompletion, parseApiError } = require('./http');
const { resolveToolsForApi } = require('./format');

function extractReasoningDeltaText(json) {
  if (!json || typeof json !== 'object') return '';
  const c0 = /** @type {{ delta?: object, message?: object }} */ (json).choices?.[0];
  if (!c0) return '';
  const d = /** @type {{ reasoning_content?: string }} */ (c0.delta);
  if (d && typeof d.reasoning_content === 'string') return d.reasoning_content;
  const msg = /** @type {{ reasoning_content?: string }} */ (c0.message);
  if (msg && typeof msg.reasoning_content === 'string') return msg.reasoning_content;
  return '';
}

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
      const trimmed = line.trim();
      if (trimmed === 'data: [DONE]' || trimmed === '[DONE]') {
        yield '__SSE_DONE__';
        continue;
      }
      const json = parseSseLine(line);
      if (json != null) yield json;
    }
  }

  if (carry.trim()) {
    if (carry.trim() === 'data: [DONE]' || carry.trim() === '[DONE]') {
      yield '__SSE_DONE__';
    } else {
      const json = parseSseLine(carry);
      if (json != null) yield json;
    }
  }
}

function createToolCallAccumulator() {
  /** @type {Map<number, { id: string, type: string, function: { name: string, arguments: string } }>} */
  const byIndex = new Map();

  function merge(deltaToolCalls) {
    if (!Array.isArray(deltaToolCalls)) return;
    for (const tc of deltaToolCalls) {
      const idx = tc.index ?? 0;
      if (!byIndex.has(idx)) {
        byIndex.set(idx, {
          id: '',
          type: 'function',
          function: { name: '', arguments: '' },
        });
      }
      const acc = byIndex.get(idx);
      if (tc.id) acc.id += tc.id;
      if (tc.type) acc.type = tc.type;
      if (tc.function?.name) acc.function.name += tc.function.name;
      if (tc.function?.arguments != null) acc.function.arguments += tc.function.arguments;
    }
  }

  function getAt(index) {
    return byIndex.get(index) || null;
  }

  function toArray() {
    return [...byIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, v]) => ({
        index,
        id: v.id,
        type: v.type || 'function',
        function: { name: v.function.name, arguments: v.function.arguments },
      }));
  }

  return { merge, getAt, toArray };
}

/**
 * @param {{
 *   apiKey: string,
 *   model: string,
 *   messages: Array<Record<string, unknown>>,
 *   tools?: Array<object>,
 *   mcpTools?: Array<object>,
 * }} opts
 * @returns {AsyncGenerator<object, void, void>}
 */
async function* streamChat(opts) {
  const { mcpTools, ...rest } = opts;
  const tools = resolveToolsForApi(opts);
  let res;
  try {
    res = await postChatCompletion({ ...rest, tools, stream: true });
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
  let fullReasoning = '';
  let finishReason = null;
  let receivedDone = false;
  const toolAcc = createToolCallAccumulator();

  for await (const json of parseSseJsonStream(res.body)) {
    if (typeof json === 'string' && json === '__SSE_DONE__') {
      receivedDone = true;
      continue;
    }
    const errMsg = streamJsonErrorMessage(json);
    if (errMsg) {
      yield { type: 'error', message: errMsg };
      return;
    }

    const c0 = /** @type {{ finish_reason?: string, delta?: { tool_calls?: object[] } }} */ (
      json
    )?.choices?.[0];
    if (c0?.finish_reason) finishReason = c0.finish_reason;

    const reasoning = extractReasoningDeltaText(json);
    if (reasoning) {
      fullReasoning += reasoning;
      yield { type: 'reasoning_delta', text: reasoning };
    }

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
    reasoning: fullReasoning,
    toolCalls,
    doneReceived: receivedDone,
  };
}

/**
 * @param {Parameters<typeof streamChat>[0]} opts
 * @param {{ onTextDelta?: (piece: string) => void, onReasoningDelta?: (piece: string) => void }} [handlers]
 */
async function collectPlainChat(opts, handlers = {}) {
  let text = '';
  for await (const ev of streamChat(opts)) {
    if (ev.type === 'error') return { error: ev.message };
    if (ev.type === 'reasoning_delta') {
      handlers.onReasoningDelta?.(ev.text);
    }
    if (ev.type === 'text_delta') {
      text += ev.text;
      handlers.onTextDelta?.(ev.text);
    }
    if (ev.type === 'round_complete') {
      return { content: ev.content || text };
    }
  }
  return { error: '流式响应未正常结束' };
}

module.exports = { streamChat, collectPlainChat };
