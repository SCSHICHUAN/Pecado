/**
 * @file command-parser.js
 * @module llm-server / CommandParser (PARSE)
 *
 * 【节点】parse_command
 * 【入口】EXECUTE_parse_command — Loop 调用本模块时使用的执行方法
 * 【职责】INFER 原始 tool_calls → 结构化任务（mcp_tool / xcode_tool）
 */
const { isXcodeToolName } = require('../xcode/tools');

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

/** 供 LlmInferService.EXECUTE_call_llm 在流式 write_file 参数阶段使用 */
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

function parseToolArguments(name, rawArguments, streamParser) {
  let args = {};
  try {
    args = JSON.parse(rawArguments || '{}');
  } catch {
    if (streamParser) {
      args = streamParser.getFinalArgs();
    }
  }
  if (!args || typeof args !== 'object') args = {};
  return args;
}

/**
 * @param {object} inferRound FEED_infer_round.data
 */
function EXECUTE_parse_command(inferRound) {
  if (inferRound.error) return { error: inferRound.error };

  const { finishReason, content, toolCalls, parseContext = {} } = inferRound;
  const { writeParsers = new Map() } = parseContext;

  if (finishReason !== 'tool_calls' || !toolCalls?.length) {
    return {
      tasks: [],
      assistantMessage: null,
      finishReason,
      content: content || '',
    };
  }

  /** @type {Array<object>} */
  const tasks = [];

  for (const tc of toolCalls) {
    const idx = tc.index ?? 0;
    const name = tc.function?.name;
    if (!name) continue;

    const streamParser = writeParsers.get(idx);
    const args = parseToolArguments(name, tc.function?.arguments, streamParser);

    tasks.push({
      id: tc.id,
      index: idx,
      type: isXcodeToolName(name) ? 'xcode_tool' : 'mcp_tool',
      name,
      args,
    });
  }

  if (!tasks.length) {
    return { error: 'PARSE：tool_calls 中无有效任务' };
  }

  return {
    tasks,
    assistantMessage: {
      role: 'assistant',
      content: content ? String(content) : '',
      tool_calls: toolCalls,
    },
    finishReason,
    content: content || '',
  };
}

/**
 * @param {ReturnType<typeof EXECUTE_parse_command>} parsedRaw
 * @returns {{ ok: boolean, source: string, error?: string, data?: object }}
 */
function FEED_parsed_command(parsedRaw) {
  if (!parsedRaw || parsedRaw.error) {
    return {
      ok: false,
      source: 'llm-server/parse',
      error: parsedRaw?.error || 'PARSE：无有效结果',
    };
  }
  return {
    ok: true,
    source: 'llm-server/parse',
    data: parsedRaw,
  };
}

const CommandParser = {
  EXECUTE_parse_command,
  FEED_parsed_command,
  createWriteFileArgsStreamer,
};

module.exports = {
  CommandParser,
  EXECUTE_parse_command,
  FEED_parsed_command,
  createWriteFileArgsStreamer,
};
