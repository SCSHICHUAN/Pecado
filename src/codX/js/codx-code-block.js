/**
 * @file codx-code-block.js
 * CodX 对话内代码流展示（纯展示）
 */
(function () {
  const STYLE_ID = 'codx-code-block-styles';
  const BODY_MAX_HEIGHT_PX = 260;
  const NO_CODE_OPS = new Set(['del_code', 'insert_blanks']);

  /** @type {HTMLElement | null} */
  let persistRow = null;
  /** @type {HTMLElement | null} */
  let turnEl = null;
  /** @type {HTMLElement | null} */
  let activeHost = null;
  /** @type {object | null} */
  let boundTurn = null;
  /** @type {Map<string, object>} */
  const fileStates = new Map();
  /** @type {string} */
  let lastPath = '';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.codx-cb-turn { margin: 8px 0 4px; }
.codx-cb-host { display: flex; flex-direction: column; gap: 8px; }
.codx-cb-block {
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  overflow: hidden;
  background: rgba(13,17,23,0.92);
}
.codx-cb-block.is-complete { border-color: rgba(255,255,255,0.14); }
.codx-cb-title {
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 600;
  color: #e6edf3;
  background: rgba(255,255,255,0.04);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  font-family: ui-monospace, Menlo, Monaco, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.codx-cb-body {
  max-height: ${BODY_MAX_HEIGHT_PX}px;
  overflow-x: hidden;
  overscroll-behavior: contain;
}
.codx-cb-body.is-editing { overflow-y: auto; pointer-events: none; }
.codx-cb-body:not(.is-editing) { overflow-y: auto; }
.codx-cb-msg-row { margin: 6px 0; }
.codx-cb-section + .codx-cb-section { border-top: 1px solid rgba(255,255,255,0.06); }
.codx-cb-section.is-active { background: rgba(121,192,255,0.05); }
.codx-cb-line { padding: 8px 12px 4px; font-size: 11px; line-height: 1.35; }
.codx-cb-line-num { font-weight: 600; color: #79c0ff; }
.codx-cb-line-sep { color: #6e7681; margin: 0 2px; }
.codx-cb-line-op { font-family: ui-monospace, Menlo, Monaco, Consolas, monospace; font-weight: 500; }
.codx-cb-line-op.op-delete { color: #f85149; }
.codx-cb-line-op.op-edit { color: #d2a8ff; }
.codx-cb-line-op.op-insert { color: #7ee787; }
.codx-cb-line-op.op-write { color: #ffa657; }
.codx-cb-line-val { font-weight: 600; color: #ffa657; }
.codx-cb-code {
  margin: 0;
  padding: 6px 12px 10px;
  font-size: 11px;
  line-height: 1.45;
  color: #e6edf3;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, Menlo, Monaco, Consolas, monospace;
}
.codx-cb-body::-webkit-scrollbar { width: 8px; }
.codx-cb-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 4px; }
`;
    document.head.appendChild(style);
  }

  function normalizePath(pathStr) {
    return String(pathStr || '')
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/^\/+/, '');
  }

  function basename(pathStr) {
    const parts = normalizePath(pathStr).split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : 'file';
  }

  function startLineOf(ed) {
    return Math.max(1, Math.floor(Number(ed?.startLine ?? ed?.line_start) || 1));
  }

  function planRangeDisplay(ed) {
    if (ed?.rangeText) return String(ed.rangeText);
    const start = startLineOf(ed);
    const endRaw = ed?.endLine ?? ed?.line_end;
    const end = endRaw != null ? Math.floor(Number(endRaw)) : start;
    return end > start ? `${start}-${end}` : String(start);
  }

  function opName(ed) {
    return String(ed?.op || ed?.streamOp || 'insert_code').toLowerCase();
  }

  function hasCodeBody(ed) {
    return !NO_CODE_OPS.has(opName(ed));
  }

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function appendSep(parent) {
    const sep = document.createElement('span');
    sep.className = 'codx-cb-line-sep';
    sep.textContent = '·';
    parent.appendChild(sep);
  }

  function createLineLabel(ed) {
    const line = document.createElement('div');
    line.className = 'codx-cb-line';
    const num = document.createElement('span');
    num.className = 'codx-cb-line-num';
    num.textContent = `L${startLineOf(ed)}`;
    const opEl = document.createElement('span');
    opEl.className = 'codx-cb-line-op';
    const op = opName(ed);

    line.appendChild(num);
    appendSep(line);
    line.appendChild(opEl);
    opEl.textContent = op;

    if (op === 'del_code') opEl.className += ' op-delete';
    else if (op === 'edit_code') opEl.className += ' op-edit';
    else if (op === 'write_file') opEl.className += ' op-write';
    else opEl.className += ' op-insert';

    if (op === 'del_code' || op === 'insert_blanks' || op === 'edit_code') {
      const val = document.createElement('span');
      val.className = 'codx-cb-line-val';
      val.textContent = planRangeDisplay(ed);
      appendSep(line);
      line.appendChild(val);
    }
    return line;
  }

  function notifyChatScroll() {
    const scroll = document.getElementById('codx-chat-scroll');
    if (!scroll) return;
    if (scroll.scrollTop + scroll.clientHeight + 100 >= scroll.scrollHeight) {
      scroll.scrollTop = scroll.scrollHeight;
    }
  }

  /** 将 section 顶对齐到 body 可视区顶部 */
  function scrollBodyToSection(state, sectionEl) {
    const body = state?.body;
    if (!body || !sectionEl) return;
    const bodyTop = body.getBoundingClientRect().top;
    const secTop = sectionEl.getBoundingClientRect().top;
    body.scrollTop += secTop - bodyTop;
  }

  /** 当前 section 内容超出可视区时，向下滚以露出最新内容 */
  function scrollBodyFollowSection(state, sec) {
    if (!state?.bodyFollow || !sec?.sectionEl) return;
    const body = state.body;
    const bodyRect = body.getBoundingClientRect();
    const secRect = sec.sectionEl.getBoundingClientRect();
    if (secRect.bottom > bodyRect.bottom - 4) {
      body.scrollTop += secRect.bottom - bodyRect.bottom + 4;
    }
  }

  function bindBodyScrollFollow(state) {
    if (!state?.body || state.body.dataset.scrollBound === '1') return;
    state.body.dataset.scrollBound = '1';
    state.bodyFollow = true;
    state.body.addEventListener(
      'scroll',
      function () {
        const b = state.body;
        if (!b) return;
        state.bodyFollow = b.scrollTop + b.clientHeight + 8 >= b.scrollHeight;
      },
      { passive: true }
    );
  }

  function resetTurnState() {
    persistRow = null;
    turnEl = null;
    activeHost = null;
    fileStates.clear();
  }

  function beginNewTurnIfNeeded() {
    const turn = window.__codxThinkingRow || window.__codxActiveChatTurn || null;
    if (turn === boundTurn) return;
    boundTurn = turn;
    resetTurnState();
  }

  /** 持久化消息行：插入对话 scroll，回合结束后仍保留 */
  function ensureTurnHost() {
    beginNewTurnIfNeeded();
    const scroll = document.getElementById('codx-chat-scroll');
    if (!scroll) return null;
    if (persistRow && scroll.contains(persistRow)) return activeHost;

    persistRow = document.createElement('div');
    persistRow.className = 'codx-chat-msg codx-chat-msg-assistant codx-cb-msg-row';
    const msgBody = document.createElement('div');
    msgBody.className = 'codx-chat-msg-body';
    turnEl = document.createElement('div');
    turnEl.className = 'codx-cb-turn';
    activeHost = document.createElement('div');
    activeHost.className = 'codx-cb-host';
    turnEl.appendChild(activeHost);
    msgBody.appendChild(turnEl);
    persistRow.appendChild(msgBody);

    const thinking = window.__codxThinkingRow;
    if (thinking?.parentNode === scroll) {
      scroll.insertBefore(persistRow, thinking);
    } else {
      scroll.appendChild(persistRow);
    }
    return activeHost;
  }

  function normalizePlanEdits(rawEdits) {
    return (rawEdits || []).map((ed) => ({
      ...ed,
      op: opName(ed),
      startLine: startLineOf(ed),
      line_start: startLineOf(ed),
      streamText: '',
      complete: false,
    }));
  }

  function getOrCreateFile(pathStr) {
    const host = ensureTurnHost();
    const key = normalizePath(pathStr);
    if (!host || !key) return null;
    if (fileStates.has(key)) return fileStates.get(key);

    const block = document.createElement('div');
    block.className = 'codx-cb-block';
    const title = document.createElement('div');
    title.className = 'codx-cb-title';
    title.textContent = basename(key);
    title.title = key;
    const body = document.createElement('div');
    body.className = 'codx-cb-body is-editing';
    const sectionsWrap = document.createElement('div');
    sectionsWrap.className = 'codx-cb-sections';
    body.appendChild(sectionsWrap);
    block.appendChild(title);
    block.appendChild(body);
    host.appendChild(block);

    const state = {
      key,
      block,
      body,
      sectionsWrap,
      edits: [],
      sections: [],
      streamBuffer: '',
      mode: 'codx',
      done: false,
      lastActiveIdx: -1,
      bodyFollow: true,
    };
    bindBodyScrollFollow(state);
    fileStates.set(key, state);
    notifyChatScroll();
    return state;
  }

  function renderSections(state, edits) {
    state.edits = edits;
    state.sectionsWrap.replaceChildren();
    state.sections = edits.map((ed) => {
      const section = document.createElement('div');
      section.className = 'codx-cb-section';
      const line = createLineLabel(ed);
      const pre = document.createElement('pre');
      pre.className = 'codx-cb-code';
      const code = document.createElement('code');
      pre.appendChild(code);
      if (!hasCodeBody(ed)) pre.hidden = true;
      section.appendChild(line);
      section.appendChild(pre);
      state.sectionsWrap.appendChild(section);
      return { ed, sectionEl: section, lineEl: line, codeEl: code, preEl: pre, text: '' };
    });
    if (state.sections.length) {
      state.sections[0].sectionEl.classList.add('is-active');
      state.lastActiveIdx = 0;
      state.bodyFollow = true;
      requestAnimationFrame(() => scrollBodyToSection(state, state.sections[0].sectionEl));
    }
  }

  function distributeStream(raw, planEdits) {
    const fn = window.CodXEditPlan?.distributeStream;
    if (fn) {
      const res = fn(raw, planEdits);
      return res?.edits || res || planEdits;
    }
    return planEdits;
  }

  function findActiveIndex(edits) {
    for (let i = 0; i < edits.length; i += 1) {
      if (!edits[i]?.complete) return i;
    }
    return edits.length ? edits.length - 1 : -1;
  }

  function applyStreamToSections(state) {
    if (!state.sections.length) return;
    const distributed =
      state.mode === 'write'
        ? [{ op: 'write_file', startLine: 1, streamText: state.streamBuffer, complete: state.done }]
        : distributeStream(state.streamBuffer, state.edits);

    distributed.forEach((ed, i) => {
      const sec = state.sections[i];
      if (!sec) return;
      const nextLine = createLineLabel(ed);
      sec.lineEl.replaceWith(nextLine);
      sec.lineEl = nextLine;
      if (!hasCodeBody(ed)) {
        sec.preEl.hidden = true;
        return;
      }
      sec.preEl.hidden = false;
      const text = String(ed.streamText ?? '');
      if (sec.text === text) return;
      sec.text = text;
      sec.codeEl.innerHTML = escapeHtml(text);
    });

    const activeIdx = findActiveIndex(distributed);
    const sectionChanged = activeIdx >= 0 && activeIdx !== state.lastActiveIdx;
    state.sections.forEach((sec, i) => {
      sec.sectionEl.classList.toggle('is-active', i === activeIdx);
    });

    if (sectionChanged) {
      state.lastActiveIdx = activeIdx;
      state.bodyFollow = true;
      const activeSec = state.sections[activeIdx];
      requestAnimationFrame(() => {
        scrollBodyToSection(state, activeSec.sectionEl);
        scrollBodyFollowSection(state, activeSec);
      });
    } else if (activeIdx >= 0) {
      scrollBodyFollowSection(state, state.sections[activeIdx]);
    }

    notifyChatScroll();
  }

  function onPlan(path, rawEdits) {
    if (!window.CodX?.isActive?.()) return;
    const key = normalizePath(path);
    if (!key || !rawEdits?.length) return;
    lastPath = key;
    const state = getOrCreateFile(key);
    if (!state) return;
    state.mode = 'codx';
    state.streamBuffer = '';
    state.done = false;
    state.block.classList.remove('is-complete');
    state.body.classList.add('is-editing');
    renderSections(state, normalizePlanEdits(rawEdits));
  }

  function onBegin(name, path) {
    if (!window.CodX?.isActive?.()) return;
    const key = normalizePath(path || lastPath);
    if (!key) return;
    lastPath = key;
    const state = getOrCreateFile(key);
    if (!state) return;
    if (name === 'write_file') {
      state.mode = 'write';
      state.streamBuffer = '';
      state.done = false;
      state.block.classList.remove('is-complete');
      state.body.classList.add('is-editing');
      renderSections(state, [{ op: 'write_file', startLine: 1 }]);
    }
  }

  function onStream(name, path, delta) {
    if (!window.CodX?.isActive?.()) return;
    if (name !== 'codx_edit' && name !== 'write_file') return;
    const key = normalizePath(path || lastPath);
    if (!key) return;
    lastPath = key;
    let state = fileStates.get(key);
    if (!state) {
      onBegin(name, key);
      state = fileStates.get(key);
    }
    if (!state) return;
    if (!state.sections.length && state.mode === 'codx') {
      renderSections(state, [{ op: 'insert_code', startLine: 1, line_start: 1 }]);
    }
    state.streamBuffer += String(delta ?? '');
    applyStreamToSections(state);
  }

  function onDone(name, path) {
    if (!window.CodX?.isActive?.()) return;
    if (name !== 'codx_edit' && name !== 'write_file') return;
    const state = fileStates.get(normalizePath(path || lastPath));
    if (!state) return;
    state.done = true;
    state.block.classList.add('is-complete');
    state.body.classList.remove('is-editing');
    applyStreamToSections(state);
    state.sections.forEach((sec) => sec.sectionEl?.classList.remove('is-active'));
  }

  function onPayload(payload) {
    if (!payload) return;
    const phase = String(payload.phase || '');
    if (phase === 'codx_edit_plan') {
      onPlan(payload.path, payload.edits);
      return;
    }
    if (phase === 'codx_edit_begin') {
      onBegin('codx_edit', payload.path);
      return;
    }
    if (phase === 'write_file_begin') {
      onBegin('write_file', payload.path);
      return;
    }
    if (phase === 'tool_stream') {
      const name = String(payload.name || '');
      if (name === 'codx_edit' || name === 'write_file') {
        onStream(name, payload.path, payload.text);
      }
      return;
    }
    if (phase === 'tool') {
      const name = String(payload.name || '');
      if (name === 'codx_edit' || name === 'write_file') {
        onDone(name, payload.arguments?.path || payload.path);
      }
    }
  }

  function bind() {
    injectStyles();
    const api = window.electronAPI;
    if (!api?.onVolcArkStreamEvent) return;
    api.onVolcArkStreamEvent(onPayload);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
