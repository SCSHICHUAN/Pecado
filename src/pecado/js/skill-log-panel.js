/**
 * @file skill-log-panel.js
 * 【功能】Pecado 底部 log 面板（覆盖输入区；记录全部 tool call / fun call）
 * 【切换】底部 #git-dock-toggle 在 Pecado 页由 gitgraph/js/index.js 转发
 */
(function () {
  let skillLogDockOpen = false;

  /** 与 Pecado 对话区 / Xcode 控制台一致的贴底滚动策略 */
  const SCROLL_PIN_THRESHOLD_PX = 80;
  const STREAM_FOLLOW_MAX_GAP_PX = 20;
  const STREAM_DETACH_SCROLL_GAP_PX = 40;
  const WHEEL_UP_BLOCK_STREAM_MS = 900;

  let logProgrammaticScrollActive = false;
  let logUserDetached = false;
  let lastWheelUpIntentAt = 0;
  let logTouchLastY = null;
  /** @type {HTMLElement | null} */
  let logScrollEl = null;
  const outputPreviewCache = new Map();
  let outputPreviewSeq = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function syncAppBottomDockToggle() {
    if (typeof window.__syncAppBottomDockToggle === 'function') {
      window.__syncAppBottomDockToggle();
    }
  }

  function setSkillLogDockOpen(open) {
    skillLogDockOpen = Boolean(open);
    $('panel-chat')?.classList.toggle('is-skill-log-collapsed', !skillLogDockOpen);
    syncAppBottomDockToggle();
  }

  function toggleSkillLogDock() {
    setSkillLogDockOpen(!skillLogDockOpen);
  }

  function formatTime(ts) {
    return new Date(ts || Date.now()).toLocaleTimeString('zh-CN', { hour12: false });
  }

  function formatSkillTitle(skill) {
    const name = String(skill || '').trim();
    if (!name) return '';
    return name.endsWith('/') ? name : `${name}/`;
  }

  function formatModuleTitle(module, moduleLabel) {
    return String(moduleLabel || module || 'tool').trim() || 'tool';
  }

  const AGENT_PHASE_ORDER = ['FEED', 'INFER', 'PARSE', 'DISPATCH', 'EXEC'];

  function formatAgentPhaseTitle(entry) {
    const phase = String(entry.phaseShort || entry.phase || '').trim() || 'PHASE';
    const label = String(entry.phaseLabel || '').trim();
    return label ? `${phase} · ${label}` : phase;
  }

  function formatAgentPhaseStatus(entry) {
    const status = String(entry.phaseStatus || 'start').trim();
    if (status === 'done') return '完成';
    if (status === 'error') return '失败';
    return '进行中';
  }

  function formatLayerPath(layerPath) {
    const raw = String(layerPath || '').trim();
    if (!raw) return '';
    return raw
      .replace(/\\/g, '/')
      .split(/[·/]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' · ');
  }

  function createRow(label, contentEl) {
    const row = document.createElement('div');
    row.className = 'skill-log-entry-row';
    const labelEl = document.createElement('div');
    labelEl.className = 'skill-log-entry-label';
    labelEl.textContent = label;
    row.appendChild(labelEl);
    row.appendChild(contentEl);
    return row;
  }

  function createPreviewLink(displayText, payload) {
    const text = String(displayText || '').trim();
    if (!payload) {
      const span = document.createElement('span');
      span.textContent = text || '—';
      if (!text) span.style.color = '#666';
      return span;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'skill-log-preview-link';
    btn.textContent = text || '预览';
    btn.dataset.previewKind = String(payload.kind || '');
    if (payload.skill) btn.dataset.previewSkill = String(payload.skill);
    if (payload.skillDocId) btn.dataset.previewSkillDoc = String(payload.skillDocId);
    if (payload.sectionPath) btn.dataset.previewSection = String(payload.sectionPath);
    if (payload.filePath) btn.dataset.previewFile = String(payload.filePath);
    if (payload.resourcePath) btn.dataset.previewResource = String(payload.resourcePath);
    if (payload.title) btn.dataset.previewTitle = String(payload.title);
    return btn;
  }

  function buildLayerPreviewPayload(entry) {
    const kind = String(entry.layerPreviewKind || '').trim();
    const layerTitle = formatLayerPath(entry.layerPath) || 'Layer';
    const filePath = String(entry.sourcePath || '').trim();

    if (kind === 'section' && entry.layerSectionPath && (entry.skill || entry.skillDocId)) {
      return {
        kind: 'section',
        skill: entry.skill,
        skillDocId: entry.skillDocId,
        sectionPath: entry.layerSectionPath,
        title: layerTitle,
      };
    }

    if (filePath) {
      return { kind: 'file', filePath, title: entry.sourceLabel || layerTitle };
    }

    const resourcePath = String(entry.previewResourcePath || entry.relPath || entry.path || '').trim();
    if ((entry.skill || entry.skillDocId) && resourcePath) {
      return {
        kind: 'skill-file',
        skill: entry.skill,
        skillDocId: entry.skillDocId,
        resourcePath,
        title: layerTitle,
      };
    }
    return null;
  }

  function buildFilePreviewPayload(entry) {
    const filePath = String(entry.sourcePath || '').trim();
    const fileLabel = String(entry.sourceLabel || entry.relPath || entry.path || '').trim();
    if (filePath) {
      return { kind: 'file', filePath, title: fileLabel || filePath };
    }
    const src = String(entry.src || '').trim();
    if (src) {
      return { kind: 'file', filePath: src, title: src };
    }
    const resourcePath = String(entry.previewResourcePath || entry.relPath || entry.path || '').trim();
    if ((entry.skill || entry.skillDocId) && resourcePath) {
      return {
        kind: 'skill-file',
        skill: entry.skill,
        skillDocId: entry.skillDocId,
        resourcePath,
        title: fileLabel || resourcePath,
      };
    }
    return null;
  }

  function readPreviewPayload(el) {
    return {
      kind: el.dataset.previewKind,
      skill: el.dataset.previewSkill,
      skillDocId: el.dataset.previewSkillDoc,
      sectionPath: el.dataset.previewSection,
      filePath: el.dataset.previewFile,
      resourcePath: el.dataset.previewResource,
      title: el.dataset.previewTitle,
      previewId: el.dataset.previewId,
    };
  }

  function lastPathSegment(raw) {
    const s = String(raw || '')
      .trim()
      .replace(/\\/g, '/');
    if (!s) return '';
    const parts = s.split(/[·/]/).map((p) => p.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  const LAYER_SECTION_METHODS = new Set(['read_skill_section', 'read_dev_doc_resources']);
  const FILE_TAIL_METHODS = new Set([
    'read_skill_resource_file',
    'run_skill_resource_script',
    'read_file',
    'write_file',
    'edit_file',
    'xcode_build',
    'xcode_run',
    'xcode_test',
  ]);

  /** 气泡状态行末尾：Layer 取 path 最后一段，文件类取文件名 */
  function formatBubbleExecTail(entry) {
    const method = String(entry?.method || '').trim();

    if (LAYER_SECTION_METHODS.has(method) || entry?.layerPreviewKind === 'section') {
      const seg = lastPathSegment(
        entry?.layerSectionPath || entry?.layerPath || entry?.path || entry?.previewResourcePath
      );
      if (seg && seg !== '__layer__') return seg;
    }

    const fileRaw =
      entry?.relPath ||
      entry?.previewResourcePath ||
      entry?.path ||
      entry?.sourceLabel ||
      entry?.sourcePath ||
      '';
    const fileName = lastPathSegment(fileRaw);

    if (
      fileName &&
      (FILE_TAIL_METHODS.has(method) ||
        entry?.layerPreviewKind === 'file' ||
        entry?.layerPreviewKind === 'skill-file' ||
        (entry?.sourcePath && method && !LAYER_SECTION_METHODS.has(method)))
    ) {
      return fileName;
    }

    return '';
  }

  function formatExecMethodLine(entry) {
    const method = String(entry.method || '').trim();
    const methodLabel = String(entry.methodLabel || '').trim();
    if (methodLabel && method && methodLabel !== method) {
      return `${methodLabel} · ${method}`;
    }
    return methodLabel || method || '—';
  }

  /** 气泡第三行：模块 | Func call | 文件名/路径 | 执行信息/阶段 */
  function formatBubbleToolLine(entry) {
    if (!entry || typeof entry !== 'object') return '';

    const scope = formatSkillTitle(entry.skill)
      ? formatSkillTitle(entry.skill).replace(/\/$/, '')
      : formatModuleTitle(entry.module, entry.moduleLabel);

    const funcCall = String(entry.method || entry.methodLabel || '').trim();
    const fileOrPath = formatBubbleExecTail(entry) || formatBubbleExecPath(entry);
    const infoOrPhase = formatBubbleExecInfo(entry);

    return [scope, funcCall, fileOrPath, infoOrPhase].filter(Boolean).join(' | ');
  }

  function formatBubbleExecPath(entry) {
    const raw =
      entry?.relPath ||
      entry?.previewResourcePath ||
      entry?.path ||
      entry?.sourcePath ||
      entry?.src ||
      '';
    const seg = lastPathSegment(raw);
    return seg || String(raw || '').trim();
  }

  function formatBubbleExecInfo(entry) {
    if (entry.logKind === 'agent-phase') {
      const parts = [entry.phaseLabel || entry.phase, formatAgentPhaseStatus(entry)];
      return parts.filter(Boolean).join(' · ');
    }
    if (entry.logKind === 'xcode-progress' || entry.logKind === 'skill-progress') {
      return String(entry.command || entry.output || '').trim();
    }
    const note = String(entry.note || '').trim();
    if (note) return note;
    const out = String(entry.output || entry.body || '').trim();
    if (!out) return '';
    const first = out.split('\n').find((l) => l.trim());
    return first ? first.trim() : '';
  }

  /** 对话气泡：模块标题 + 第三行 pipe 摘要 */
  function formatBubbleExecSummary(entry) {
    const skillTitle = formatSkillTitle(entry.skill);
    const moduleTitle = formatModuleTitle(entry.module, entry.moduleLabel);
    return {
      headTitle: skillTitle || moduleTitle || 'tool',
      headKind: skillTitle ? 'skill' : 'module',
      methodLine: formatBubbleToolLine(entry),
      isError: Boolean(entry.isError),
    };
  }

  /** 整轮执行秒表：01.09 格式，最大 59.99 */
  function formatTurnElapsed(ms) {
    const centis = Math.min(5999, Math.max(0, Math.floor(Number(ms) / 10)));
    const sec = Math.floor(centis / 100);
    const frac = centis % 100;
    return `${String(sec).padStart(2, '0')}.${String(frac).padStart(2, '0')}`;
  }

  /** @type {WeakMap<HTMLElement, { startedAt: number, timerId: number, stopped: boolean, frozenMs?: number }>} */
  const turnStopwatchByBubble = new WeakMap();
  const PROGRESS_BUBBLE_MS = 400;
  let lastProgressBubbleAt = 0;

  function createExecStopwatchEl() {
    const el = document.createElement('div');
    el.className = 'chat-exec-stopwatch';
    el.hidden = true;
    el.setAttribute('aria-label', '整轮耗时');
    return el;
  }

  function ensureExecSummaryRow(execBlock) {
    if (!execBlock) return { row: null, text: null };
    let row = execBlock.querySelector('.chat-exec-summary-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'chat-exec-summary-row';
      const text = document.createElement('div');
      text.className = 'chat-exec-tool-line';
      text.hidden = true;
      row.appendChild(text);
      execBlock.appendChild(row);
    }
    return {
      row,
      text: row.querySelector('.chat-exec-tool-line'),
    };
  }

  function ensureExecStopwatch(execBlock) {
    if (!execBlock) return null;
    let el = execBlock.querySelector('.chat-exec-stopwatch');
    if (el) return el;

    el = createExecStopwatchEl();
    execBlock.classList.add('has-exec-stopwatch');

    const track = execBlock.querySelector('.chat-agent-phase-track');
    if (track) {
      track.appendChild(el);
      return el;
    }

    const headRow = execBlock.querySelector('.chat-exec-head-row');
    if (headRow) {
      headRow.appendChild(el);
      return el;
    }

    const row = document.createElement('div');
    row.className = 'chat-exec-phase-row';
    row.appendChild(el);
    execBlock.insertBefore(row, execBlock.firstChild);
    return el;
  }

  function syncStopwatchFromBubble(bubble, execBlock) {
    if (!bubble || !execBlock) return;
    const state = turnStopwatchByBubble.get(bubble);
    if (!state) return;
    const stopwatch = ensureExecStopwatch(execBlock);
    if (!stopwatch) return;
    const ms = state.stopped ? state.frozenMs ?? 0 : performance.now() - state.startedAt;
    stopwatch.hidden = false;
    stopwatch.textContent = formatTurnElapsed(ms);
    stopwatch.classList.toggle('is-running', !state.stopped);
    stopwatch.classList.toggle('is-done', Boolean(state.stopped));
  }

  function paintExecStopwatch(execBlock, ms, done) {
    const el = ensureExecStopwatch(execBlock);
    if (!el) return;
    el.hidden = false;
    el.textContent = formatTurnElapsed(ms);
    el.classList.toggle('is-running', !done);
    el.classList.toggle('is-done', Boolean(done));
  }

  function stopExecStopwatchTimer(state) {
    if (!state) return;
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = 0;
    }
  }

  function startBubbleStopwatch(bubble, startedAt) {
    if (!bubble) return;
    const t0 = Number(startedAt) > 0 ? Number(startedAt) : performance.now();
    stopExecStopwatchTimer(turnStopwatchByBubble.get(bubble));
    const state = { startedAt: t0, timerId: 0, stopped: false };
    turnStopwatchByBubble.set(bubble, state);
    const execBlock = bubble.querySelector('.chat-exec-block');
    if (execBlock) paintExecStopwatch(execBlock, 0, false);
    state.timerId = setInterval(() => {
      const s = turnStopwatchByBubble.get(bubble);
      const block = bubble.querySelector('.chat-exec-block');
      if (!s || s.stopped || !block) return;
      paintExecStopwatch(block, performance.now() - s.startedAt, false);
    }, 500);
  }

  function finishBubbleStopwatch(bubble, opts = {}) {
    if (!bubble) return;
    const state = turnStopwatchByBubble.get(bubble);
    const execBlock = bubble.querySelector('.chat-exec-block');
    if (!state) return;
    stopExecStopwatchTimer(state);
    if (!state.stopped) {
      state.stopped = true;
      state.frozenMs = performance.now() - state.startedAt;
    }
    if (execBlock) {
      execBlock.classList.toggle('is-error', Boolean(opts.isError));
      paintExecStopwatch(execBlock, state.frozenMs ?? 0, true);
    }
  }

  function formatExecSummary(entry) {
    const skillTitle = formatSkillTitle(entry.skill) || formatModuleTitle(entry.module, entry.moduleLabel);
    const command = formatExecMethodLine(entry);
    const outputText = String(entry.output || entry.body || '').trim();
    return { skillTitle, command, outputText, isError: Boolean(entry.isError) };
  }

  function createOutputContent(entry) {
    const outputText = String(entry.output || entry.body || '').trim();
    if (!outputText) return null;

    const wrap = document.createElement('div');
    wrap.className = 'skill-log-entry-output skill-log-entry-output-preview';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'skill-log-output-preview-btn';
    const id = `out-${++outputPreviewSeq}`;
    outputPreviewCache.set(id, outputText);
    btn.dataset.previewKind = 'text';
    btn.dataset.previewId = id;
    btn.dataset.previewTitle = '输出';

    const pre = document.createElement('pre');
    pre.textContent = outputText;
    btn.appendChild(pre);
    wrap.appendChild(btn);
    return wrap;
  }

  function createExecContent(entry) {
    const wrap = document.createElement('div');
    wrap.className = 'skill-log-entry-exec';

    const method = String(entry.method || '').trim();
    const command = String(entry.command || '').trim();
    const methodLine = formatExecMethodLine(entry);

    if (method && command && command !== method) {
      const methodSpan = document.createElement('span');
      methodSpan.className = 'skill-log-exec-method';
      methodSpan.textContent = methodLine;
      wrap.appendChild(methodSpan);
      const cmd = document.createElement('code');
      cmd.className = 'skill-log-exec-command';
      cmd.textContent = command;
      wrap.appendChild(cmd);
    } else if (command) {
      const cmd = document.createElement('code');
      cmd.className = 'skill-log-exec-command';
      cmd.textContent = command;
      wrap.appendChild(cmd);
    } else if (method) {
      wrap.textContent = methodLine;
    } else {
      wrap.textContent = '—';
      wrap.style.color = '#666';
    }
    return wrap;
  }

  function createFileContent(entry) {
    const wrap = document.createElement('div');
    wrap.className = 'skill-log-entry-file-link';
    const fileLabel = String(entry.sourceLabel || entry.relPath || entry.sourcePath || entry.src || '').trim();
    wrap.appendChild(createPreviewLink(fileLabel, buildFilePreviewPayload(entry)));
    return wrap;
  }

  function createDetailList(detail) {
    const wrap = document.createElement('div');
    const items = Array.isArray(detail) ? detail : [];
    if (!items.length) {
      wrap.textContent = '—';
      wrap.style.color = '#666';
      return wrap;
    }
    const dl = document.createElement('dl');
    dl.className = 'skill-log-kv';
    items.forEach(({ k, v }) => {
      if (!k || v == null || v === '') return;
      const dt = document.createElement('dt');
      dt.textContent = String(k);
      const dd = document.createElement('dd');
      dd.textContent = String(v);
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    wrap.appendChild(dl);
    return wrap;
  }

  function buildAgentPhaseLogEntry(entry) {
    const node = document.createElement('article');
    const status = String(entry.phaseStatus || 'start');
    node.className =
      'skill-log-entry skill-log-entry-phase' +
      (entry.isError || status === 'error' ? ' is-error' : '') +
      (status === 'done' ? ' is-phase-done' : status === 'start' ? ' is-phase-active' : '');

    const head = document.createElement('div');
    head.className = 'skill-log-entry-head';

    const titleEl = document.createElement('div');
    titleEl.className = 'skill-log-entry-module';
    titleEl.textContent = 'agent';

    const timeEl = document.createElement('div');
    timeEl.className = 'skill-log-entry-time';
    timeEl.textContent = formatTime(entry.ts);

    head.appendChild(titleEl);
    head.appendChild(timeEl);
    node.appendChild(head);

    const phaseWrap = document.createElement('div');
    phaseWrap.className = 'skill-log-phase-line';
    const phaseBadge = document.createElement('span');
    phaseBadge.className = 'skill-log-phase-badge';
    phaseBadge.textContent = formatAgentPhaseTitle(entry);
    phaseWrap.appendChild(phaseBadge);
    const round = Number(entry.round) > 0 ? Number(entry.round) : 1;
    const statusEl = document.createElement('span');
    statusEl.className = 'skill-log-phase-status';
    statusEl.textContent = `第 ${round} 轮 · ${formatAgentPhaseStatus(entry)}`;
    phaseWrap.appendChild(statusEl);
    node.appendChild(createRow('阶段', phaseWrap));

    if (entry.method || entry.methodLabel) {
      const toolWrap = document.createElement('div');
      toolWrap.className = 'skill-log-phase-tool';
      toolWrap.textContent = formatExecMethodLine(entry);
      node.appendChild(createRow('执行', toolWrap));
    }

    const note = String(entry.output || '').trim();
    if (note) {
      const noteEl = document.createElement('div');
      noteEl.className = 'skill-log-phase-note';
      noteEl.textContent = note;
      node.appendChild(createRow('详情', noteEl));
    }

    return node;
  }

  function ensureBubblePhaseTrack(execBlock) {
    if (!execBlock) return null;
    let track = execBlock.querySelector('.chat-agent-phase-track');
    if (track) return track;

    execBlock.replaceChildren();
    execBlock.classList.add('chat-agent-phase-block');

    const phaseRow = document.createElement('div');
    phaseRow.className = 'chat-exec-phase-row';

    track = document.createElement('div');
    track.className = 'chat-agent-phase-track';
    track.setAttribute('role', 'list');
    track.setAttribute('aria-label', 'Agent 阶段');

    AGENT_PHASE_ORDER.forEach((phase, index) => {
      if (index > 0) {
        const sep = document.createElement('span');
        sep.className = 'chat-agent-phase-sep';
        sep.setAttribute('aria-hidden', 'true');
        track.appendChild(sep);
      }
      const chip = document.createElement('span');
      chip.className = 'chat-agent-phase-chip';
      chip.dataset.phase = phase;
      chip.setAttribute('role', 'listitem');
      chip.textContent = phase;
      track.appendChild(chip);
    });

    track.appendChild(createExecStopwatchEl());

    const caption = document.createElement('div');
    caption.className = 'chat-agent-phase-caption';

    phaseRow.appendChild(track);

    execBlock.appendChild(phaseRow);
    execBlock.appendChild(caption);
    ensureExecSummaryRow(execBlock);
    execBlock.classList.add('has-exec-stopwatch');
    return track;
  }

  function updateBubbleAgentPhases(execBlock, entry, bubble) {
    if (!execBlock || entry?.logKind !== 'agent-phase') return;
    execBlock.hidden = false;
    execBlock.classList.toggle('is-error', Boolean(entry.isError));

    ensureBubblePhaseTrack(execBlock);

    const phase = String(entry.phase || '').trim().toUpperCase();
    const status = String(entry.phaseStatus || 'start').trim();
    const phaseIdx = AGENT_PHASE_ORDER.indexOf(phase);

    execBlock.querySelectorAll('.chat-agent-phase-chip').forEach((chip) => {
      const p = String(chip.dataset.phase || '').trim();
      const idx = AGENT_PHASE_ORDER.indexOf(p);
      chip.className = 'chat-agent-phase-chip';
      if (entry.isError && idx === phaseIdx && status === 'error') {
        chip.classList.add('is-error', `is-phase-${p.toLowerCase()}`);
      } else if (idx < phaseIdx || (idx === phaseIdx && status === 'done')) {
        chip.classList.add('is-done');
      } else if (idx === phaseIdx && status === 'start') {
        chip.classList.add('is-active', `is-phase-${p.toLowerCase()}`);
      }
    });

    const caption = execBlock.querySelector('.chat-agent-phase-caption');
    if (caption) {
      const round = Number(entry.round) > 0 ? Number(entry.round) : 1;
      const parts = [`第 ${round} 轮`, entry.phaseLabel || phase, formatAgentPhaseStatus(entry)];
      if (entry.methodLabel || entry.method) {
        parts.push(entry.methodLabel || entry.method);
      }
      caption.textContent = parts.filter(Boolean).join(' · ');
    }

    const toolLine = execBlock.querySelector('.chat-exec-summary-row .chat-exec-tool-line');
    if (toolLine && (entry.method || entry.methodLabel || entry.logKind === 'agent-phase')) {
      toolLine.hidden = false;
      toolLine.textContent = formatBubbleToolLine(entry);
    }
    syncStopwatchFromBubble(bubble, execBlock);
  }

  function updateBubbleToolSummary(execBlock, entry, bubble) {
    if (!execBlock || !entry) return;

    if (entry.logKind === 'xcode-progress' || entry.logKind === 'skill-progress') {
      execBlock.hidden = false;
      const now = performance.now();
      const force = Boolean(entry.isError);
      if (!force && now - lastProgressBubbleAt < PROGRESS_BUBBLE_MS) return;
      lastProgressBubbleAt = now;
      if (execBlock.querySelector('.chat-agent-phase-track')) {
        const toolLine = execBlock.querySelector('.chat-exec-summary-row .chat-exec-tool-line');
        if (toolLine) {
          toolLine.hidden = false;
          toolLine.textContent = formatBubbleToolLine(entry);
        }
      }
      syncStopwatchFromBubble(bubble, execBlock);
      return;
    }

    const summary = formatBubbleExecSummary(entry);
    execBlock.hidden = false;
    execBlock.classList.toggle('is-error', Boolean(summary.isError));

    if (!execBlock.querySelector('.chat-agent-phase-track')) {
      execBlock.replaceChildren();
      execBlock.classList.remove('chat-agent-phase-block');
      if (summary.headTitle) {
        const headRow = document.createElement('div');
        headRow.className = 'chat-exec-head-row';
        const headEl = document.createElement('div');
        headEl.className =
          summary.headKind === 'skill' ? 'chat-exec-skill' : 'chat-exec-module';
        headEl.textContent = summary.headTitle;
        headRow.appendChild(headEl);
        headRow.appendChild(createExecStopwatchEl());
        execBlock.appendChild(headRow);
        execBlock.classList.add('has-exec-stopwatch');
      }
      const { text: toolLine } = ensureExecSummaryRow(execBlock);
      if (summary.methodLine && toolLine) {
        toolLine.hidden = false;
        toolLine.textContent = summary.methodLine;
      }
      syncStopwatchFromBubble(bubble, execBlock);
      return;
    }

    ensureBubblePhaseTrack(execBlock);
    const toolLine = execBlock.querySelector('.chat-exec-summary-row .chat-exec-tool-line');
    if (!toolLine) return;
    if (summary.methodLine) {
      toolLine.hidden = false;
      toolLine.textContent = summary.methodLine;
    } else {
      toolLine.hidden = true;
      toolLine.textContent = '';
    }
    syncStopwatchFromBubble(bubble, execBlock);
  }

  function formatXcodeProgressDisplayLine(entry) {
    let t = String(entry.command || entry.output || '').trim();
    t = t.replace(/^Run:\s*/i, '');
    return t || '—';
  }

  function buildXcodeProgressLogEntry(entry) {
    const node = document.createElement('article');
    node.className =
      'skill-log-entry skill-log-entry-xcode-progress' + (entry.isError ? ' is-error' : '');

    const head = document.createElement('div');
    head.className = 'skill-log-entry-head';

    const titleEl = document.createElement('div');
    titleEl.className = 'skill-log-entry-module';
    const method = String(entry.method || 'xcode').trim();
    const project = String(entry.sourceLabel || '').trim();
    titleEl.textContent = project ? `${method} · ${project}` : method;

    const timeEl = document.createElement('div');
    timeEl.className = 'skill-log-entry-time';
    timeEl.textContent = formatTime(entry.ts);

    head.appendChild(titleEl);
    head.appendChild(timeEl);
    node.appendChild(head);

    const line = document.createElement('pre');
    line.className = 'skill-log-xcode-progress-line';
    line.textContent = formatXcodeProgressDisplayLine(entry);
    node.appendChild(line);
    return node;
  }

  function buildLogEntry(entry) {
    if (entry.logKind === 'agent-phase') {
      return buildAgentPhaseLogEntry(entry);
    }
    if (entry.logKind === 'xcode-progress') {
      return buildXcodeProgressLogEntry(entry);
    }

    const node = document.createElement('article');
    node.className = 'skill-log-entry' + (entry.isError ? ' is-error' : '');

    const head = document.createElement('div');
    head.className = 'skill-log-entry-head';

    const titleEl = document.createElement('div');
    const skillTitle = formatSkillTitle(entry.skill);
    if (skillTitle) {
      titleEl.className = 'skill-log-entry-skill';
      titleEl.textContent = skillTitle;
    } else {
      titleEl.className = 'skill-log-entry-module';
      titleEl.textContent = formatModuleTitle(entry.module, entry.moduleLabel);
    }

    const timeEl = document.createElement('div');
    timeEl.className = 'skill-log-entry-time';
    timeEl.textContent = formatTime(entry.ts);

    head.appendChild(titleEl);
    head.appendChild(timeEl);
    node.appendChild(head);

    node.appendChild(createRow('执行', createExecContent(entry)));
    node.appendChild(createRow('文件', createFileContent(entry)));

    const layerText = formatLayerPath(entry.layerPath);
    if (layerText) {
      const layerWrap = document.createElement('div');
      layerWrap.className = 'skill-log-layer-path';
      layerWrap.appendChild(createPreviewLink(layerText, buildLayerPreviewPayload(entry)));
      node.appendChild(createRow('Layer', layerWrap));
    }

    node.appendChild(createRow('详情', createDetailList(entry.detail)));

    const outputText = String(entry.output || entry.body || '').trim();
    if (outputText) {
      node.appendChild(createRow('输出', createOutputContent(entry)));
    }

    return node;
  }

  function logScrollGapFromBottom() {
    const el = logScrollEl;
    if (!el) return 0;
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  }

  function isLogPinnedToBottom() {
    return logScrollGapFromBottom() <= SCROLL_PIN_THRESHOLD_PX;
  }

  function shouldAutoScrollLog() {
    if (logUserDetached) return false;
    const now = performance.now();
    if (lastWheelUpIntentAt > 0 && now - lastWheelUpIntentAt < WHEEL_UP_BLOCK_STREAM_MS) {
      return false;
    }
    return logScrollGapFromBottom() <= STREAM_FOLLOW_MAX_GAP_PX;
  }

  function syncDetachFromLogScroll() {
    if (logProgrammaticScrollActive) return;
    const gap = logScrollGapFromBottom();
    if (gap > STREAM_DETACH_SCROLL_GAP_PX) {
      logUserDetached = true;
    } else if (gap <= 8) {
      logUserDetached = false;
    }
  }

  function scrollLogToBottom() {
    const el = logScrollEl;
    if (!el) return;

    logProgrammaticScrollActive = true;
    const flush = () => {
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    };

    flush();
    let passes = 0;
    const settle = () => {
      passes += 1;
      flush();
      if (logScrollGapFromBottom() > 2 && passes < 12) {
        requestAnimationFrame(settle);
        return;
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          logProgrammaticScrollActive = false;
        });
      });
    };
    requestAnimationFrame(settle);
  }

  function setupLogScrollFollow() {
    const el = $('skill-log-output');
    if (!el || el.dataset.scrollBound === '1') return;
    el.dataset.scrollBound = '1';
    logScrollEl = el;

    el.addEventListener('scroll', syncDetachFromLogScroll, { passive: true });

    el.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey) return;
        if (e.deltaY < 0) {
          lastWheelUpIntentAt = performance.now();
          logUserDetached = true;
          return;
        }
        if (!logProgrammaticScrollActive && e.deltaY > 0 && isLogPinnedToBottom()) {
          logUserDetached = false;
        }
      },
      { passive: true, capture: true }
    );

    el.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 1) logTouchLastY = e.touches[0].clientY;
      },
      { passive: true }
    );
    el.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length !== 1) return;
        const y = e.touches[0].clientY;
        if (logTouchLastY == null) return;
        const dy = y - logTouchLastY;
        if (dy > 2) {
          lastWheelUpIntentAt = performance.now();
          logUserDetached = true;
        }
        if (!logProgrammaticScrollActive && dy < -2 && isLogPinnedToBottom()) {
          logUserDetached = false;
        }
        logTouchLastY = y;
      },
      { passive: true }
    );
    el.addEventListener(
      'touchend',
      () => {
        logTouchLastY = null;
      },
      { passive: true }
    );
  }

  function notifyTurnExec(entry) {
    if (!entry || typeof entry !== 'object') return;
    if (typeof window.__pecadoTurnExec?.update === 'function') {
      window.__pecadoTurnExec.update(entry);
    }
  }

  function appendLog(entry) {
    const logEl = $('skill-log-output');
    if (!entry || typeof entry !== 'object') return;

    const isPhase = entry.logKind === 'agent-phase';
    if (isPhase) {
      notifyTurnExec(entry);
      return;
    }

    if (!logEl) return;
    if (
      !entry.method &&
      !entry.skill &&
      !entry.command &&
      !entry.output &&
      !entry.body
    ) {
      return;
    }

    const stick = shouldAutoScrollLog();
    logEl.appendChild(buildLogEntry(entry));
    if (window.CodX?.isActive?.()) window.CodXLog?.append?.(entry);
    if (stick) scrollLogToBottom();
    notifyTurnExec(entry);
  }

  function setupChatDismissLog() {
    const chatBody = $('workspace-scroll');
    if (!chatBody || chatBody.dataset.logDismissBound === '1') return;
    chatBody.dataset.logDismissBound = '1';
    chatBody.addEventListener('click', () => {
      if (skillLogDockOpen) setSkillLogDockOpen(false);
    });
  }

  function setupPreviewLinks() {
    const logEl = $('skill-log-output');
    if (!logEl || logEl.dataset.previewBound === '1') return;
    logEl.dataset.previewBound = '1';
    logEl.addEventListener('click', (e) => {
      const textBtn = e.target.closest('[data-preview-kind="text"]');
      if (textBtn) {
        e.preventDefault();
        const payload = readPreviewPayload(textBtn);
        window.LogPreview?.openPreview?.({
          kind: 'text',
          title: payload.title || '输出',
          previewId: payload.previewId,
        });
        return;
      }
      const btn = e.target.closest('.skill-log-preview-link');
      if (!btn) return;
      e.preventDefault();
      window.LogPreview?.openPreview?.(readPreviewPayload(btn));
    });
  }

  function setupLogListener() {
    const api = window.electronAPI;
    if (!api || typeof api.onSkillLogEvent !== 'function') return;
    api.onSkillLogEvent((payload) => appendLog(payload));
  }

  function init() {
    $('panel-chat')?.classList.add('is-skill-log-collapsed');
    setupLogScrollFollow();
    setupChatDismissLog();
    setupPreviewLinks();
    setupLogListener();
  }

  const panel = {
    append: appendLog,
    notifyTurnExec,
    toggle: toggleSkillLogDock,
    setOpen: setSkillLogDockOpen,
    isOpen: () => skillLogDockOpen,
    formatExecSummary,
    formatBubbleExecSummary,
    formatBubbleToolLine,
    updateBubbleAgentPhases,
    updateBubbleToolSummary,
    startBubbleStopwatch,
    finishBubbleStopwatch,
    getOutputPreview: (id) => outputPreviewCache.get(id) || '',
  };

  window.LogPanel = panel;
  window.SkillLogPanel = panel;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
