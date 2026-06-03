/**
 * @file xcode-write-stream.js
 *
 * Mac + Xcode 实时预览：每片 delta 立即 open → writeSync → fsync → close。
 * 已有文件：从 offset 0 覆盖写入，结束时 ftruncate，流式过程中不 truncate 清空。
 */
const fs = require('fs');
const path = require('path');

/**
 * @type {Map<string, { started: boolean, position: number, preserveExisting: boolean }>}
 */
const sessions = new Map();
/** @type {Map<string, Promise<void>>} */
const pending = new Map();

function ensureParentDir(fileAbsPath) {
  fs.mkdirSync(path.dirname(fileAbsPath), { recursive: true });
}

/**
 * 开始一次 write_file / SSE 流式写入会话。
 * @param {string} fileAbsPath
 * @param {{ preserveExisting?: boolean }} [opts] true = 已有文件从头部覆盖，不先清空
 */
function beginWriteSession(fileAbsPath, opts = {}) {
  sessions.set(fileAbsPath, {
    started: false,
    position: 0,
    preserveExisting: !!opts.preserveExisting,
  });
}

/** @deprecated 使用 beginWriteSession；等价于新建文件会话 */
function prepareNewFile(fileAbsPath) {
  beginWriteSession(fileAbsPath, { preserveExisting: false });
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

/**
 * 写入一片并立即 fsync + close
 * @param {{ truncate?: boolean }} [opts]
 */
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

async function awaitAllPending() {
  await Promise.all([...pending.values()]);
}

async function writeLiveDeltaImmediate(fileAbsPath, delta, opts = {}) {
  const text = String(delta ?? '');
  if (!text) return;
  writeLiveChunk(fileAbsPath, text, opts);
}

function scheduleLiveDelta(fileAbsPath, delta, opts = {}) {
  return chainPending(fileAbsPath, () => writeLiveDeltaImmediate(fileAbsPath, delta, opts));
}

/** 非流式兜底：整文件一次写入，已有文件同样不先 truncate 清空 */
async function writeWholeFileStreaming(absPath, content) {
  const exists = fs.existsSync(absPath);
  beginWriteSession(absPath, { preserveExisting: exists });
  writeLiveChunk(absPath, String(content ?? ''));
  finalizeLiveFileSync(absPath);
}

async function closeAllCodeFiles() {
  await awaitAllPending();
  for (const absPath of [...sessions.keys()]) {
    finalizeLiveFileSync(absPath);
  }
  pending.clear();
}

function writeXcodeFile(fileAbsPath, chunk, opts = {}) {
  scheduleLiveDelta(fileAbsPath, chunk, opts);
}

function flushXcodeFile(fileAbsPath) {
  return awaitPending(fileAbsPath);
}

async function closeCodeFile(fileAbsPath) {
  await awaitPending(fileAbsPath);
  return closeLiveFile(fileAbsPath);
}

module.exports = {
  beginWriteSession,
  prepareNewFile,
  writeLiveChunk,
  writeLiveDeltaPaced: writeLiveDeltaImmediate,
  scheduleLiveDelta,
  awaitPending,
  awaitAllPending,
  writeXcodeFile,
  flushXcodeFile,
  closeCodeFile,
  closeAllCodeFiles,
  writeWholeFileStreaming,
};
