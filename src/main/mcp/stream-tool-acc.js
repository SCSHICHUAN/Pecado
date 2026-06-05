/**
 * @file stream-tool-acc.js
 *
 * write_file arguments 增量解析（边收边写 Xcode / UI）。
 * tool_calls 聚合见 `llm-volc/tool-call-acc.js`。
 */
const { createToolCallAccumulator } = require('../llm-volc/tool-call-acc');

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

/** 从不完整的 JSON 字符串字面量中解码已到达的 content 前缀 */
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

/**
 * write_file 的 function.arguments 流式片段 → 解析 path + content 增量
 * @param {{ onPath?: (relPath: string) => void, onContentDelta?: (delta: string, relPath: string) => void }} hooks
 */
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

module.exports = {
  createToolCallAccumulator,
  createWriteFileArgsStreamer,
  decodePartialJsonString,
};
