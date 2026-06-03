/**
 * @file xcode-write-stream.js
 *
 * Mac + Xcode 实时预览：每片 delta 立即 open → writeSync → fsync → close。
 * Xcode 对已打开文件对外部 fd 长持有时刷新不及时；每次写完关 fd 更易触发 FSEvents 重载。
 */
const fs = require('fs');
const path = require('path');

/** @type {Map<string, { started: boolean }>} 是否已开始写入（首片 truncate，后续 append） */
const sessions = new Map();
/** @type {Map<string, Promise<void>>} */
const pending = new Map();

function ensureParentDir(fileAbsPath) {
  fs.mkdirSync(path.dirname(fileAbsPath), { recursive: true });
}

/** 新 write_file 会话开始前调用，下次写入 truncate */
function prepareNewFile(fileAbsPath) {
  sessions.delete(fileAbsPath);
}

/**
 * 写入一片并立即 fsync + close（与对话框 tool_stream 同节奏，不再按字符 sleep）
 * @param {{ truncate?: boolean }} [opts]
 */
function writeLiveChunk(fileAbsPath, chunk, opts = {}) {
  if (chunk == null || chunk === '') return;
  ensureParentDir(fileAbsPath);

  const session = sessions.get(fileAbsPath);
  const truncate = !!opts.truncate || !session?.started;
  const fd = fs.openSync(fileAbsPath, truncate ? 'w' : 'a');
  try {
    fs.writeSync(fd, Buffer.from(String(chunk), 'utf8'));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  sessions.set(fileAbsPath, { started: true });
}

function closeLiveFileSync(fileAbsPath) {
  sessions.delete(fileAbsPath);
}

function closeLiveFile(fileAbsPath) {
  closeLiveFileSync(fileAbsPath);
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

/** 整片 delta 一次落盘，无 80 字/16ms 节流 */
async function writeLiveDeltaImmediate(fileAbsPath, delta, opts = {}) {
  const text = String(delta ?? '');
  if (!text) return;
  writeLiveChunk(fileAbsPath, text, opts);
}

function scheduleLiveDelta(fileAbsPath, delta, opts = {}) {
  return chainPending(fileAbsPath, () => writeLiveDeltaImmediate(fileAbsPath, delta, opts));
}

async function writeWholeFileStreaming(absPath, content) {
  prepareNewFile(absPath);
  writeLiveChunk(absPath, String(content ?? ''), { truncate: true });
  sessions.delete(absPath);
}

async function closeAllCodeFiles() {
  await awaitAllPending();
  sessions.clear();
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
