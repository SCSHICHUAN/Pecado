/**
 * @file llm-infer-service.js
 * @module llm-server / LlmInferService (INFER)
 *
 * 【边界】llm-server 仅 Volc/SSE + 参数解析；副作用由 agent-loop/stream-hooks 注入。
 * 【入口】EXECUTE_call_llm(chatOpts, streamHooks?)
 * 【出口】FEED_infer_round(inferRaw)
 */
const { streamChat } = require('./stream');
const { createWriteFileArgsStreamer, createCodxEditArgsStreamer } = require('./command-parser');

/**
 * @typedef {object} LlmStreamHooks
 * @property {(text: string) => void} [onTextDelta]
 * @property {(text: string) => void} [onReasoningDelta]
 * @property {(info: { name: string, streaming?: boolean }) => void} [onTool]
 * @property {(index: number, relPath: string) => void} [onWriteFilePath]
 * @property {(index: number, relPath: string) => void} [onCodxEditPath]
 * @property {(index: number, delta: string, relPath: string) => void} [onCodxEditTextDelta]
 * @property {() => void | Promise<void>} [onRoundEnd]
 */

/**
 * @param {Parameters<typeof streamChat>[0]} chatOpts
 * @param {LlmStreamHooks} [streamHooks]
 */
async function EXECUTE_call_llm(chatOpts, streamHooks = {}) {
  /** @type {Map<number, ReturnType<typeof createWriteFileArgsStreamer>>} */
  const writeParsers = new Map();
  /** @type {Map<number, ReturnType<typeof createCodxEditArgsStreamer>>} */
  const codxEditParsers = new Map();
  /** @type {Set<number>} */
  const writeSeeded = new Set();
  /** @type {Set<number>} */
  const codxEditSeeded = new Set();

  function ensureWriteParser(index) {
    if (writeParsers.has(index)) return writeParsers.get(index);
    const parser = createWriteFileArgsStreamer({
      onPath: (relPath) => streamHooks.onWriteFilePath?.(index, relPath),
      onContentDelta: (delta, relPath) =>
        streamHooks.onWriteFileContentDelta?.(index, delta, relPath),
    });
    writeParsers.set(index, parser);
    return parser;
  }

  function ensureCodxEditParser(index) {
    if (codxEditParsers.has(index)) return codxEditParsers.get(index);
    const parser = createCodxEditArgsStreamer({
      onPath: (p) => streamHooks.onCodxEditPath?.(index, p),
      onTextDelta: (delta, relPath) => streamHooks.onCodxEditTextDelta?.(index, delta, relPath),
    });
    codxEditParsers.set(index, parser);
    return parser;
  }

  for await (const ev of streamChat(chatOpts)) {
    if (ev.type === 'error') {
      return { error: ev.message };
    }

    if (ev.type === 'reasoning_delta') {
      streamHooks.onReasoningDelta?.(ev.text);
    }

    if (ev.type === 'text_delta') {
      streamHooks.onTextDelta?.(ev.text);
    }

    if (ev.type === 'tool_call_delta') {
      const name = ev.accumulated?.function?.name || ev.name || '';
      if (name === 'write_file') {
        const parser = ensureWriteParser(ev.index);
        if (!writeSeeded.has(ev.index)) {
          const args = ev.accumulated?.function?.arguments;
          if (args) parser.push(args);
          writeSeeded.add(ev.index);
        } else if (ev.argumentsFragment) {
          parser.push(ev.argumentsFragment);
        }
      } else if (name === 'codx_edit') {
        const parser = ensureCodxEditParser(ev.index);
        if (!codxEditSeeded.has(ev.index)) {
          const args = ev.accumulated?.function?.arguments;
          if (args) parser.push(args);
          codxEditSeeded.add(ev.index);
        } else if (ev.argumentsFragment) {
          parser.push(ev.argumentsFragment);
        }
      } else if (name) {
        streamHooks.onTool?.({ name, streaming: true });
      }
    }

    if (ev.type === 'round_complete') {
      await streamHooks.onRoundEnd?.();
      return {
        finishReason: ev.finishReason,
        content: ev.content,
        toolCalls: ev.toolCalls,
        parseContext: { writeParsers, codxEditParsers },
      };
    }
  }

  return { error: 'INFER：流式响应未正常结束' };
}

/**
 * @param {object} inferRound
 * @param {{ writeTargets?: Map<number, object> }} [streamContext]
 */
function FEED_infer_round(inferRound, streamContext = {}) {
  if (!inferRound || inferRound.error) {
    return {
      ok: false,
      source: 'llm-server/infer',
      error: inferRound?.error || 'INFER：无有效结果',
    };
  }
  return {
    ok: true,
    source: 'llm-server/infer',
    data: {
      ...inferRound,
      parseContext: {
        writeParsers: inferRound.parseContext?.writeParsers || new Map(),
        codxEditParsers: inferRound.parseContext?.codxEditParsers || new Map(),
        writeTargets: streamContext.writeTargets || new Map(),
        codxEditTargets: streamContext.codxEditTargets || new Map(),
      },
    },
  };
}

const LlmInferService = { EXECUTE_call_llm, FEED_infer_round };

module.exports = { LlmInferService, EXECUTE_call_llm, FEED_infer_round };
