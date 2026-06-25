/**
 * @file stream-bridge.js
 * Agent write_file / codx_edit 流式 → CodX Monaco
 */
(function () {
  /** @type {Map<string, string>} */
  const streamBuffers = new Map();
  /** @type {Map<string, string>} relPath → 第二轮 content 流缓冲 */
  const codxContentBuffers = new Map();

  function normalizeRelPath(pathStr) {
    return String(pathStr || '')
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/^\/+/, '');
  }

  /** @type {string} */
  let lastStreamRelPath = '';

  function onWriteFileBegin(payload) {
    if (!window.CodX?.isActive?.()) return;
    const relPath = window.CodXEditor?.resolveRelPath?.(normalizeRelPath(payload.path))
      || normalizeRelPath(payload.path);
    if (!relPath || payload.name !== 'write_file') return;
    lastStreamRelPath = relPath;
    streamBuffers.set(relPath, '');
    const begin = window.CodXEditor?.beginAiStream?.(relPath, {
      live: !!payload.xcodeLiveStream,
      deferred: !!payload.codxDeferred,
    });
    if (begin?.then) begin.catch(console.error);
  }

  /** 第二轮 content 流开始：path 已知，plan 已在 codx_edit_plan 登记 */
  function onCodxEditBegin(payload) {
    if (!window.CodX?.isActive?.()) return;
    const relPath = window.CodXEditor?.resolveRelPath?.(normalizeRelPath(payload.path))
      || normalizeRelPath(payload.path);
    if (!relPath || payload.name !== 'codx_edit') return;

    lastStreamRelPath = relPath;
    codxContentBuffers.set(relPath, '');

    const init = window.CodXEditor?.initCodxLineEditSession?.(relPath);
    if (init?.then) init.catch(console.error);
  }

  function onCodxEditPlan(payload) {
    if (!window.CodX?.isActive?.()) return;
    const relPath = window.CodXEditor?.resolveRelPath?.(normalizeRelPath(payload.path))
      || normalizeRelPath(payload.path);
    if (!relPath || !payload.edits?.length) return;
    lastStreamRelPath = relPath;
    window.CodXEditor?.applyCodxEditPlan?.(relPath, payload.edits);
    scheduleTreeRefreshForPath(relPath);
  }

  function onToolStream(payload) {
    if (!window.CodX?.isActive?.()) return;
    if (payload?.phase !== 'tool_stream') return;
    const name = String(payload.name || '');
    if (name !== 'codx_edit' && name !== 'write_file') return;

    if (name === 'codx_edit') {
      const relPath = window.CodXEditor?.resolveRelPath?.(
        normalizeRelPath(payload.path || lastStreamRelPath)
      ) || normalizeRelPath(payload.path || lastStreamRelPath);
      if (!relPath) return;
      lastStreamRelPath = relPath;

      const delta = String(payload.text || '');
      const prev = codxContentBuffers.get(relPath) || '';
      const full = `${prev}${delta}`;
      codxContentBuffers.set(relPath, full);
      window.CodXEditor?.appendCodxContentStream?.(relPath, full);
      return;
    }

    const relPath = window.CodXEditor?.resolveRelPath?.(normalizeRelPath(payload.path))
      || normalizeRelPath(payload.path);
    if (!relPath) return;
    lastStreamRelPath = relPath;
    const delta = String(payload.text || '');
    const prev = streamBuffers.get(relPath) || '';
    const full = `${prev}${delta}`;
    streamBuffers.set(relPath, full);
    window.CodXEditor?.appendStreamDelta?.(relPath, delta, full);
  }

  /** LLM / 磁盘写入后刷新左侧目录 */
  function scheduleTreeRefreshForPath(relPath) {
    const norm = normalizeRelPath(relPath);
    window.CodX?.scheduleTreeRefresh?.(norm ? { revealPath: norm } : {});
  }

  function onToolDone(payload) {
    if (!window.CodX?.isActive?.()) return;
    if (payload?.phase !== 'tool') return;
    const name = String(payload.name || '');

    if (name === 'codx_edit') {
      const relPath = window.CodXEditor?.resolveRelPath?.(
        normalizeRelPath(payload.arguments?.path || payload.path || lastStreamRelPath || '')
      ) || normalizeRelPath(payload.arguments?.path || payload.path || lastStreamRelPath || '');
      if (relPath) {
        window.CodXEditor?.finishCodxContentStream?.(relPath);
        codxContentBuffers.delete(relPath);
      }
      return;
    }

    if (name === 'create_directory') {
      const relPath = normalizeRelPath(payload.arguments?.path || payload.path || '');
      scheduleTreeRefreshForPath(relPath);
      return;
    }

    if (name !== 'write_file') return;
    const relPath = window.CodXEditor?.resolveRelPath?.(
      normalizeRelPath(payload.arguments?.path || payload.path || lastStreamRelPath || '')
    ) || normalizeRelPath(payload.arguments?.path || payload.path || lastStreamRelPath || '');
    if (!relPath) return;
    window.CodXEditor?.finishAiStream?.(relPath);
    streamBuffers.delete(relPath);
    lastStreamRelPath = '';
    scheduleTreeRefreshForPath(relPath);
  }

  function reset() {
    streamBuffers.clear();
    codxContentBuffers.clear();
    lastStreamRelPath = '';
  }

  function bind() {
    const api = window.electronAPI;
    if (!api?.onVolcArkStreamEvent) return;
    api.onVolcArkStreamEvent((payload) => {
      if (!payload) return;
      if (payload.phase === 'write_file_begin') onWriteFileBegin(payload);
      if (payload.phase === 'codx_edit_begin') onCodxEditBegin(payload);
      if (payload.phase === 'codx_edit_plan') onCodxEditPlan(payload);
      if (payload.phase === 'tool_stream') onToolStream(payload);
      if (payload.phase === 'tool') onToolDone(payload);
    });
  }

  window.CodXStreamBridge = { bind, reset };
})();
