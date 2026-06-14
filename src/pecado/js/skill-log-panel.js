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

  /** 对话气泡：仅 log 头部 + 执行方法摘要，不含 command 路径 / 输出 / 详情 */
  function formatBubbleExecSummary(entry) {
    const skillTitle = formatSkillTitle(entry.skill);
    const moduleTitle = formatModuleTitle(entry.module, entry.moduleLabel);
    let methodLine = formatExecMethodLine(entry);
    const tail = formatBubbleExecTail(entry);
    if (tail) methodLine = `${methodLine} · ${tail}`;
    return {
      headTitle: skillTitle || moduleTitle || 'tool',
      headKind: skillTitle ? 'skill' : 'module',
      methodLine,
      isError: Boolean(entry.isError),
    };
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

    const caption = document.createElement('div');
    caption.className = 'chat-agent-phase-caption';

    const toolLine = document.createElement('div');
    toolLine.className = 'chat-exec-tool-line';
    toolLine.hidden = true;

    execBlock.appendChild(track);
    execBlock.appendChild(caption);
    execBlock.appendChild(toolLine);
    return track;
  }

  function updateBubbleAgentPhases(execBlock, entry) {
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
  }

  function updateBubbleToolSummary(execBlock, entry) {
    if (!execBlock || !entry) return;
    const summary = formatBubbleExecSummary(entry);
    execBlock.hidden = false;
    execBlock.classList.toggle('is-error', Boolean(summary.isError));

    if (!execBlock.querySelector('.chat-agent-phase-track')) {
      execBlock.replaceChildren();
      execBlock.classList.remove('chat-agent-phase-block');
      if (summary.headTitle) {
        const headEl = document.createElement('div');
        headEl.className =
          summary.headKind === 'skill' ? 'chat-exec-skill' : 'chat-exec-module';
        headEl.textContent = summary.headTitle;
        execBlock.appendChild(headEl);
      }
      if (summary.methodLine) {
        const methodEl = document.createElement('div');
        methodEl.className = 'chat-exec-method';
        methodEl.textContent = summary.methodLine;
        execBlock.appendChild(methodEl);
      }
      return;
    }

    const toolLine = execBlock.querySelector('.chat-exec-tool-line');
    if (!toolLine) return;
    if (summary.methodLine) {
      toolLine.hidden = false;
      toolLine.textContent = summary.methodLine;
    } else {
      toolLine.hidden = true;
      toolLine.textContent = '';
    }
  }

  function buildLogEntry(entry) {
    if (entry.logKind === 'agent-phase') {
      return buildAgentPhaseLogEntry(entry);
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
    updateBubbleAgentPhases,
    updateBubbleToolSummary,
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
