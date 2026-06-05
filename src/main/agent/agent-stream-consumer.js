/**
 * @file agent-stream-consumer.js
 *
 * 【功能】消费 llm-server 单轮 streamChat 事件，桥接 UI 与 Xcode 流式写盘。
 *   - text_delta → uiSink.onTextDelta + textXcodeWriter（assistant 正文流式写 @ 目标文件）
 *   - tool_call_delta（write_file）→ createWriteFileArgsStreamer 增量解析 JSON arguments：
 *       先提取 path → registerWriteFileStreamTarget → content 字段 delta → writeDeltaToTarget + onToolStream
 *   - 其它 tool → uiSink.onTool({ name, streaming: true })
 *   - round_complete → 返回 finishReason、content、toolCalls、writeParsers/Targets 供 agent-loop 执行
 *
 * 【调用方】agent/agent-loop.js → consumeAgentStream(uiSink, chatOpts, ctx)
 *
 * 【对外能力】
 *   consumeAgentStream(uiSink, chatOpts, { projectRoot, xcodeAbsPath })
 *   → { finishReason, content, toolCalls, writeParsers: Map, writeTargets: Map }
 *     | { error }
 *   内部工具：createWriteFileArgsStreamer（部分 JSON 字符串解码、getFinalArgs 容错）
 */
const llm = require('../llm-server');
const {
  IS_DARWIN,
  createLiveWriter,
  registerWriteFileStreamTarget,
  writeDeltaToTarget,
} = require('../xcode/live-stream');

function tryExtractJsonStringField(argsAcc, field) {
  const re = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const m = argsAcc.match(re);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
  }
}

function decodePartialJsonString(raw) {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (c === '"') break;
    if (c === '\\') {
      if (i + 1 >= raw.length) break;
      const n = raw[i + 1];
      if (n === 'n') {
        out += '\n';
        i += 2;
        continue;
      }
      if (n === 't') {
        out += '\t';
        i += 2;
        continue;
      }
      if (n === 'r') {
        out += '\r';
        i += 2;
        continue;
      }
      if (n === '"') {
        out += '"';
        i += 2;
        continue;
      }
      if (n === '\\') {
        out += '\\';
        i += 2;
        continue;
      }
      if (n === 'u' && i + 5 < raw.length) {
        const hex = raw.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
      }
      break;
    }
    out += c;
    i += 1;
  }
  return out;
}

function createWriteFileArgsStreamer(hooks) {
  let argsAcc = '';
  let relPath = null;
  let contentStart = -1;
  let emittedLen = 0;

  function push(fragment) {
    if (!fragment) return;
    argsAcc += fragment;

    if (!relPath) {
      const p = tryExtractJsonStringField(argsAcc, 'path');
      if (p) {
        relPath = p;
        hooks.onPath?.(relPath);
      }
    }

    if (contentStart < 0) {
      const m = argsAcc.match(/"content"\s*:\s*"/);
      if (m) contentStart = m.index + m[0].length;
    }

    if (contentStart >= 0 && relPath) {
      const decoded = decodePartialJsonString(argsAcc.slice(contentStart));
      if (decoded.length > emittedLen) {
        const delta = decoded.slice(emittedLen);
        emittedLen = decoded.length;
        hooks.onContentDelta?.(delta, relPath);
      }
    }
  }

  function getFinalArgs() {
    try {
      return JSON.parse(argsAcc);
    } catch {
      return { path: relPath, content: decodePartialJsonString(argsAcc.slice(contentStart)) };
    }
  }

  return {
    push,
    getFinalArgs,
    get relPath() {
      return relPath;
    },
    get streamedContentLen() {
      return emittedLen;
    },
  };
}

async function consumeAgentStream(uiSink, chatOpts, ctx) {
  /** @type {Map<number, ReturnType<typeof createWriteFileArgsStreamer>>} */
  const writeParsers = new Map();
  /** @type {Map<number, object>} */
  const writeTargets = new Map();
  /** @type {Set<number>} */
  const writeSeeded = new Set();

  const projectRoot = ctx.projectRoot;
  const textXcodeWriter = createLiveWriter(ctx.xcodeAbsPath);
  if (ctx.xcodeAbsPath && IS_DARWIN) textXcodeWriter.start();

  function ensureWriteParser(index) {
    if (writeParsers.has(index)) return writeParsers.get(index);
    const parser = createWriteFileArgsStreamer({
      onPath: (relPath) => {
        const target = registerWriteFileStreamTarget(projectRoot, relPath);
        if (target) writeTargets.set(index, target);
      },
      onContentDelta: (delta, relPath) => {
        const target = writeTargets.get(index);
        writeDeltaToTarget(target, delta);
        if (delta) {
          uiSink.onToolStream({ name: 'write_file', path: relPath, text: delta });
        }
      },
    });
    writeParsers.set(index, parser);
    return parser;
  }

  for await (const ev of llm.streamChat(chatOpts)) {
    if (ev.type === 'error') return { error: ev.message };

    if (ev.type === 'text_delta') {
      uiSink.onTextDelta(ev.text);
      textXcodeWriter.writeDelta(ev.text);
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
      } else if (name) {
        uiSink.onTool({ name, streaming: true });
      }
    }

    if (ev.type === 'round_complete') {
      await textXcodeWriter.finish();

      return {
        finishReason: ev.finishReason,
        content: ev.content,
        toolCalls: ev.toolCalls,
        writeParsers,
        writeTargets,
      };
    }
  }

  return { error: '流式响应未正常结束' };
}

module.exports = { consumeAgentStream };
