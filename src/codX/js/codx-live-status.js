/**
 * @file codx-live-status.js
 * CodX 底栏：上行历史详情（无流光），下行当前步骤（流光覆盖）
 */
(function () {
  const PHASE_LINES = {
    FEED: '投喂',
    INFER: '思考',
    PARSE: '解析',
    DISPATCH: '分发',
    EXEC: '执行',
  };

  const PHASE_DONE = {
    FEED: '投喂完成',
    INFER: '思考完成',
    PARSE: '解析完成',
    DISPATCH: '分发完成',
    EXEC: '执行完成',
  };

  const PHASE_ACTIVE_HINT = {
    FEED: '加载上下文',
    INFER: '等待模型响应',
    PARSE: '解析 tool 调用',
    DISPATCH: '准备分发',
    EXEC: '执行 tools',
  };

  function phaseRoundPrefix(entry) {
    const round = Number(entry?.round) > 0 ? Number(entry.round) : 0;
    return round > 1 ? `第 ${round} 轮 · ` : '';
  }

  function defaultDetailForPhase(phaseName, entry) {
    const p = String(phaseName || '').trim();
    const key = Object.entries(PHASE_LINES).find(([, v]) => v === p)?.[0];
    const hint = (key && PHASE_ACTIVE_HINT[key]) || '处理中';
    const prefix = entry ? phaseRoundPrefix(entry) : '';
    return `${prefix}${hint}…`;
  }

  function lastSeg(raw) {
    const s = String(raw || '')
      .trim()
      .replace(/\\/g, '/');
    if (!s) return '';
    const parts = s.split(/[·/]/).map((p) => p.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  function pickPath(entry) {
    return (
      entry?.relPath ||
      entry?.sourceLabel ||
      entry?.path ||
      entry?.previewResourcePath ||
      entry?.sourcePath ||
      entry?.arguments?.path ||
      ''
    );
  }

  function moduleLabel(entry) {
    const method = String(entry?.method || entry?.name || '').trim();
    const mod = String(entry?.module || entry?.moduleLabel || '')
      .trim()
      .toLowerCase();
    if (mod === 'xcode' || /^xcode_/.test(method)) return 'Xcode';
    if (mod === 'skill' || /^read_skill|^run_skill|^read_dev_doc/.test(method)) return 'Skill';
    if (mod === 'codx' || /^codx_/.test(method)) return 'CodX';
    if (mod === 'agent-loop' || mod === 'agent') return 'Agent';
    return 'MCP';
  }

  function isAgentPhaseStart(entry) {
    return entry?.logKind === 'agent-phase' && String(entry.phaseStatus || '') === 'start';
  }

  function isAgentPhaseDone(entry) {
    return entry?.logKind === 'agent-phase' && String(entry.phaseStatus || '') === 'done';
  }

  function briefOutput(entry) {
    const raw = String(entry?.output || entry?.body || entry?.command || '').trim();
    if (!raw) return '';
    const line = raw.split('\n').find((l) => l.trim()) || '';
    const t = line.trim();
    if (!t || t.length > 100) return t.slice(0, 100) + (t.length > 100 ? '…' : '');
    return t;
  }

  function formatSnapshot(phase, detail) {
    const p = String(phase || '').trim();
    const d = String(detail ?? '').trim();
    if (p && d) return `${p} · ${d}`;
    return d || p;
  }

  /** @returns {string|null} */
  function formatPhaseLine(entry) {
    if (!entry || typeof entry !== 'object') return null;

    if (entry.logKind === 'agent-phase') {
      const phase = String(entry.phase || '').trim().toUpperCase();
      if (isAgentPhaseDone(entry)) return PHASE_LINES[phase] || null;
      return PHASE_LINES[phase] || String(entry.phaseLabel || phase).trim() || null;
    }

    if (entry.logKind === 'xcode-progress' || entry.logKind === 'skill-progress') {
      return moduleLabel(entry);
    }

    const method = String(entry.method || entry.name || '').trim();
    if (method === 'finish_task') return 'Agent';
    if (!method) return null;
    return moduleLabel(entry);
  }

  /** @returns {string|undefined} */
  function formatDetailLine(entry) {
    if (!entry || typeof entry !== 'object') return undefined;

    if (entry.logKind === 'agent-phase') {
      const phase = String(entry.phase || '').trim().toUpperCase();
      if (isAgentPhaseDone(entry)) {
        const note = String(entry.note || entry.output || '').trim();
        if (note) return note;
        const done = PHASE_DONE[phase];
        if (done) return done;
        return undefined;
      }
      if (isAgentPhaseStart(entry)) {
        const method = String(entry.method || entry.methodLabel || '').trim();
        if (method) return method;
        const note = String(entry.note || entry.output || '').trim();
        if (note) return note;
        if (phase === 'FEED') {
          const prefix = phaseRoundPrefix(entry);
          return `${prefix}合并对话上下文…`;
        }
        const phaseKey = phase;
        const prefix = phaseRoundPrefix(entry);
        const hint = PHASE_ACTIVE_HINT[phaseKey];
        return hint ? `${prefix}${hint}…` : `${prefix}处理中…`;
      }
      return undefined;
    }

    if (entry.logKind === 'xcode-progress' || entry.logKind === 'skill-progress') {
      let line = String(entry.command || entry.output || '')
        .trim()
        .replace(/^Run:\s*/i, '');
      line = line.replace(/^\*\*\s*|\s*\*\*$/g, '').trim();
      if (line) return line;
      const method = String(entry.method || '').trim();
      if (method === 'xcode_build') return 'xcode_build…';
      if (method === 'xcode_run') return 'xcode_run…';
      return method || '执行中…';
    }

    const method = String(entry.method || entry.name || '').trim();
    if (!method) return undefined;
    if (method === 'finish_task') {
      const sum = String(entry.args?.summary || entry.output || '').trim();
      return sum || '任务完成';
    }

    const path = pickPath(entry);
    const file = lastSeg(path);
    const head = file ? `${method} · ${file}` : method;
    const tail = briefOutput(entry);
    if (tail && tail !== head && !head.includes(tail)) return `${head} — ${tail}`;
    return head;
  }

  function formatStreamPayload(payload) {
    if (!payload) return { phase: null, detail: undefined };

    const name = String(payload.name || '').trim();

    if (payload.streaming && name) {
      return { phase: '思考', detail: `计划调用 ${name}…` };
    }

    if (payload.streaming) {
      return { phase: '思考', detail: '流式生成中…' };
    }

    if (!name || name === 'finish_task') {
      if (name === 'finish_task') {
        const sum = String(payload.arguments?.summary || '').trim();
        return { phase: 'Agent', detail: sum || '任务完成' };
      }
      if (payload.phase === 'codx_edit_plan' && payload.path) {
        const file = lastSeg(payload.path);
        return { phase: 'CodX', detail: file ? `codx_edit_plan · ${file}` : 'codx_edit_plan' };
      }
      return { phase: null, detail: undefined };
    }

    const entry = {
      method: name,
      name,
      module: moduleLabel({ method: name }),
      relPath: payload.arguments?.path || payload.path,
      sourceLabel: payload.arguments?.path || payload.path,
    };
    return {
      phase: moduleLabel(entry),
      detail: formatDetailLine(entry),
    };
  }

  /** @type {{
   *   historyEl: HTMLElement | null,
   *   phaseEl: HTMLElement | null,
   *   detailEl: HTMLElement | null,
   *   curPhase: string,
   *   curDetail: string,
   *   inferTextAcc: string,
   *   inferStreaming: boolean,
   *   turnActive: boolean
   * }} */
  const active = {
    historyEl: null,
    phaseEl: null,
    detailEl: null,
    curPhase: '',
    curDetail: '',
    inferTextAcc: '',
    inferStreaming: false,
    turnActive: false,
  };

  function isTurnActive() {
    return active.turnActive;
  }

  function bindLines(historyEl, phaseEl, detailEl) {
    active.historyEl = historyEl || null;
    active.phaseEl = phaseEl || null;
    active.detailEl = detailEl || null;
    active.curPhase = '思考';
    active.curDetail = '等待模型响应…';
    active.inferTextAcc = '';
    active.inferStreaming = false;
    active.turnActive = Boolean(phaseEl);
    if (active.historyEl) {
      active.historyEl.textContent = '';
      active.historyEl.hidden = true;
    }
    if (active.phaseEl) {
      active.phaseEl.textContent = '思考';
      active.phaseEl.classList.remove('is-live-shimmer');
    }
    if (active.detailEl) {
      active.detailEl.textContent = active.curDetail;
      active.detailEl.hidden = false;
      active.detailEl.classList.add('is-live-shimmer');
    }
  }

  function setHistory(text) {
    if (!active.historyEl) return;
    const t = String(text || '').trim();
    if (!t) {
      active.historyEl.textContent = '';
      active.historyEl.hidden = true;
      return;
    }
    active.historyEl.hidden = false;
    active.historyEl.textContent = t;
  }

  function renderPhase() {
    if (!active.phaseEl) return;
    const t = String(active.curPhase || '').trim() || '思考';
    active.phaseEl.textContent = t;
  }

  function getDisplayedDetail() {
    let t = String(active.curDetail ?? '').trim();
    if (!t && active.curPhase) {
      t = defaultDetailForPhase(active.curPhase);
    }
    return t;
  }

  function renderDetail() {
    if (!active.detailEl) return;
    let t = String(active.curDetail ?? '').trim();
    if (!t && active.curPhase && !active.inferStreaming) {
      t = defaultDetailForPhase(active.curPhase);
    }
    if (!t) {
      active.detailEl.textContent = '';
      active.detailEl.hidden = true;
      active.detailEl.classList.remove('is-live-shimmer', 'is-infer-stream');
      return;
    }
    active.detailEl.hidden = false;
    active.detailEl.textContent = t;
    active.detailEl.classList.add('is-live-shimmer');
    active.detailEl.classList.toggle('is-infer-stream', Boolean(active.inferStreaming));
  }

  function setInferDetail(text, streaming) {
    if (!active.turnActive) return;
    const raw = String(text ?? '');
    active.inferStreaming = Boolean(streaming);
    active.curPhase = '思考';
    active.curDetail = raw || active.curDetail;
    renderPhase();
    renderDetail();
  }

  function onInferTextDelta(piece) {
    if (!active.turnActive || !piece) return;
    active.inferTextAcc += String(piece);
    setInferDetail(active.inferTextAcc, true);
  }

  function commitCurrent(phase, detail) {
    if (!active.turnActive) return;

    const nextPhase = phase != null ? String(phase).trim() : active.curPhase;
    let nextDetail = detail !== undefined ? String(detail ?? '').trim() : active.curDetail;
    const phaseChanged = phase != null && nextPhase !== active.curPhase;
    const detailChanged = detail !== undefined && nextDetail !== active.curDetail;
    const prevDisplayed = getDisplayedDetail();

    if ((phaseChanged || detailChanged) && prevDisplayed) {
      setHistory(prevDisplayed);
    }

    active.curPhase = nextPhase || active.curPhase || '思考';
    if (nextPhase !== '思考') {
      active.inferStreaming = false;
      active.inferTextAcc = '';
    }
    if (phaseChanged && nextPhase === '思考') {
      active.inferTextAcc = '';
      active.inferStreaming = false;
    }
    if (!nextDetail && phaseChanged && !active.inferStreaming) {
      nextDetail = defaultDetailForPhase(active.curPhase);
    }
    active.curDetail = nextDetail;
    renderPhase();
    renderDetail();
  }

  function applyUpdate(entry) {
    if (!active.turnActive) return;

    if (
      entry?.logKind === 'agent-phase' &&
      String(entry.phase || '').trim().toUpperCase() === 'INFER' &&
      isAgentPhaseStart(entry)
    ) {
      if (active.inferTextAcc.trim()) {
        setHistory(formatSnapshot('思考', active.inferTextAcc.trim()));
      }
      active.inferTextAcc = '';
      active.inferStreaming = false;
    }

    if (
      entry?.logKind === 'agent-phase' &&
      String(entry.phase || '').trim().toUpperCase() === 'INFER' &&
      isAgentPhaseDone(entry) &&
      active.inferTextAcc.trim()
    ) {
      commitCurrent('思考', active.inferTextAcc.trim());
      return;
    }

    const phase = formatPhaseLine(entry);
    const detail = formatDetailLine(entry);
    if (phase == null && detail === undefined) return;

    let p = active.curPhase;
    let d = active.curDetail;
    if (phase) p = phase;
    if (detail !== undefined) d = detail;
    commitCurrent(p, d);
  }

  function onExecEntry(entry) {
    applyUpdate(entry);
  }

  function onStepStart(payload) {
    if (!active.turnActive) return;
    const { phase, detail } = formatStreamPayload(payload);
    let p = active.curPhase;
    let d = active.curDetail;
    if (phase) p = phase;
    if (detail !== undefined) d = detail;
    commitCurrent(p, d);
  }

  function onToolStream(payload) {
    if (!active.turnActive) return;
    const name = String(payload?.name || 'codx_edit').trim();
    const path = payload?.path || '';
    const file = lastSeg(path);
    const phase = moduleLabel({ method: name });
    const label = file ? `${name} · ${file}…` : `${name}…`;
    commitCurrent(phase, label);
  }

  function clear() {
    active.historyEl = null;
    active.phaseEl = null;
    active.detailEl = null;
    active.curPhase = '';
    active.curDetail = '';
    active.inferTextAcc = '';
    active.inferStreaming = false;
    active.turnActive = false;
  }

  window.CodXLiveStatus = {
    bindLines,
    isTurnActive,
    onExecEntry,
    onStepStart,
    onToolStream,
    onInferTextDelta,
    clear,
  };
})();
