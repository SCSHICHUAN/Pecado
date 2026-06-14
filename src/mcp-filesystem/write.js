/**
 * @file write.js
 *
 * 【功能】工程写：MCP 工具写 + 本地 fs 流式增量落盘（供 Xcode 实时刷新）。
 *   MCP：writeText → write_file；createDirectory → create_directory
 *   流式会话（Map sessions + pending 链）：
 *     - beginWriteSession(absPath)：preserveExisting 时按 position 覆盖写入，否则 truncate/append
 *     - scheduleWriteDelta：串行 chainPending，每 chunk fsync
 *     - closeCodeFile / closeAllCodeFiles：finalize（preserve 模式 ftruncate）并清 pending
 *   writeWholeFileStreaming：非流式一次性写整文件（tool-executor macOS 分支）
 *
 * 【调用方】mcp-filesystem/index.js；xcode/stream.js；mcp-filesystem/tool-executor.js
 *
 * 【对外能力】
 *   writeText / createDirectory / beginWriteSession / scheduleWriteDelta /
 *   awaitWritePending / closeWriteFile / closeAllWriteFiles / writeWholeFileToDisk
 */
const fs = require('fs');
const path = require('path');
const transport = require('./mcp-transport');

/** @type {Map<string, { started: boolean, position: number, preserveExisting: boolean }>} */
const sessions = new Map();
/** @type {Map<string, Promise<void>>} */
const pending = new Map();

async function writeText(relPath, content) {
  return transport.callToolText('write_file', {
    path: String(relPath),
    content: content == null ? '' : String(content),
  });
}

async function createDirectory(relPath) {
  return transport.callTool('create_directory', { path: String(relPath) });
}

function ensureParentDir(fileAbsPath) {
  fs.mkdirSync(path.dirname(fileAbsPath), { recursive: true });
}

function beginWriteSession(fileAbsPath, opts = {}) {
  sessions.set(fileAbsPath, {
    started: false,
    position: 0,
    preserveExisting: !!opts.preserveExisting,
  });
}

function ensureSession(fileAbsPath, opts = {}) {
  let session = sessions.get(fileAbsPath);
  if (session) return session;

  const exists = fs.existsSync(fileAbsPath);
  session = {
    started: false,
    position: 0,
    preserveExisting: exists && !opts.truncate,
  };
  sessions.set(fileAbsPath, session);
  return session;
}

function writeLiveChunk(fileAbsPath, chunk, opts = {}) {
  if (chunk == null || chunk === '') return;
  ensureParentDir(fileAbsPath);

  const text = String(chunk);
  const buf = Buffer.from(text, 'utf8');
  if (!buf.length) return;

  const session = ensureSession(fileAbsPath, opts);

  if (session.preserveExisting && fs.existsSync(fileAbsPath)) {
    const fd = fs.openSync(fileAbsPath, 'r+');
    try {
      fs.writeSync(fd, buf, 0, buf.length, session.position);
      session.position += buf.length;
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } else {
    session.preserveExisting = false;
    const truncate = !!opts.truncate || !session.started;
    const fd = fs.openSync(fileAbsPath, truncate ? 'w' : 'a');
    try {
      fs.writeSync(fd, buf);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  session.started = true;
  sessions.set(fileAbsPath, session);
}

function finalizeLiveFileSync(fileAbsPath) {
  const session = sessions.get(fileAbsPath);
  if (session?.preserveExisting && session.started && fs.existsSync(fileAbsPath)) {
    const fd = fs.openSync(fileAbsPath, 'r+');
    try {
      fs.ftruncateSync(fd, session.position);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
  sessions.delete(fileAbsPath);
}

function closeLiveFile(fileAbsPath) {
  finalizeLiveFileSync(fileAbsPath);
  return Promise.resolve();
}

function chainPending(fileAbsPath, task) {
  const prev = pending.get(fileAbsPath) || Promise.resolve();
  const next = prev.then(task).catch((e) => {
    console.warn('[xcode-stream]', e.message || e);
  });
  pending.set(fileAbsPath, next);
  return next;
}

async function awaitPending(fileAbsPath) {
  const p = pending.get(fileAbsPath);
  if (p) await p;
}

async function writeLiveDeltaImmediate(fileAbsPath, delta, opts = {}) {
  const text = String(delta ?? '');
  if (!text) return;
  writeLiveChunk(fileAbsPath, text, opts);
}

function scheduleLiveDelta(fileAbsPath, delta, opts = {}) {
  return chainPending(fileAbsPath, () => writeLiveDeltaImmediate(fileAbsPath, delta, opts));
}

async function writeWholeFileStreaming(absPath, content) {
  beginWriteSession(absPath, { preserveExisting: false });
  writeLiveChunk(absPath, String(content ?? ''), { truncate: true });
  finalizeLiveFileSync(absPath);
}

async function closeAllCodeFiles() {
  await Promise.all([...pending.values()]);
  for (const absPath of [...sessions.keys()]) {
    finalizeLiveFileSync(absPath);
  }
  pending.clear();
}

async function closeCodeFile(fileAbsPath) {
  await awaitPending(fileAbsPath);
  return closeLiveFile(fileAbsPath);
}

module.exports = {
  writeText,
  createDirectory,
  beginWriteSession,
  scheduleLiveDelta,
  awaitPending,
  closeCodeFile,
  closeAllCodeFiles,
  writeWholeFileStreaming,
};
