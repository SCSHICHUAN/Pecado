/**
 * @file codx-disk-sync.js
 * Agent codx_edit 落盘：xcode_run 编译前须与磁盘一致。
 */
const projectIo = require('../mcp-filesystem');
const { applyCodxEditOp } = require('../shared/codx-edit-ops');
const { distributeStream, sortPlanEditsDesc } = require('../shared/codx-edit-plan');

/** @type {Map<string, { edits: Array<object> }>} */
const pendingByPath = new Map();

function registerPlan(relPath, edits) {
  const p = String(relPath || '').trim();
  if (!p || !Array.isArray(edits) || !edits.length) return;
  pendingByPath.set(p, { edits: [...edits] });
}

/**
 * @param {string} relPath
 * @param {string} rawStream
 */
async function flushCodxEditToDisk(relPath, rawStream) {
  const p = String(relPath || '').trim();
  const pending = pendingByPath.get(p);
  if (!pending?.edits?.length) return { ok: false, reason: 'no-plan' };

  const stream = String(rawStream ?? '');
  if (!stream.trim()) return { ok: false, reason: 'empty-stream' };

  let content;
  try {
    content = await projectIo.readText(p);
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
  }

  const { edits } = distributeStream(stream, pending.edits);
  const sorted = sortPlanEditsDesc(edits);
  for (const ed of sorted) {
    content = applyCodxEditOp(content, ed);
  }

  try {
    await projectIo.writeText(p, content);
    pendingByPath.delete(p);
    return { ok: true, path: p };
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
  }
}

/**
 * @param {string} relPath
 * @param {import('../llm-server/command-parser').createCodxEditArgsStreamer} [parser]
 * @param {object} [args]
 */
async function flushFromParser(relPath, parser, args) {
  const finalArgs = parser?.getFinalArgs?.() || args || {};
  const text = finalArgs.text != null ? String(finalArgs.text) : '';
  return flushCodxEditToDisk(relPath, text);
}

async function flushAllPending() {
  const results = [];
  for (const [relPath] of [...pendingByPath.entries()]) {
    results.push({ path: relPath, ok: false, reason: 'stream-not-flushed' });
  }
  return results;
}

function hasPending() {
  return pendingByPath.size > 0;
}

function clear() {
  pendingByPath.clear();
}

module.exports = {
  registerPlan,
  flushCodxEditToDisk,
  flushFromParser,
  flushAllPending,
  hasPending,
  clear,
};
