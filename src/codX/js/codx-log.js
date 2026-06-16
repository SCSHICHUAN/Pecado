/**
 * @file codx-log.js
 * CodX log：扁平分层行，详情格式化展示
 */
(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function formatTime(ts) {
    return new Date(ts || Date.now()).toLocaleTimeString('zh-CN', { hour12: false });
  }

  function pickText(entry, keys) {
    for (const key of keys) {
      const v = entry?.[key];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return '';
  }

  const DETAIL_KEY_LABELS = {
    path: 'path',
    startLine: 'line',
    endLine: 'end',
    charCount: 'len',
    op: 'op',
    text: 'text',
    content: 'content',
    skill: 'skill',
    tool: 'tool',
    模块: 'mod',
    edits: 'edits',
    arguments: 'args',
    index: 'idx',
  };

  function formatDetailKey(key) {
    const k = String(key || '').trim();
    if (!k) return '·';
    return DETAIL_KEY_LABELS[k] || (k.length > 10 ? `${k.slice(0, 9)}…` : k);
  }

  function formatDetailValue(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return '';
    if (
      (text.startsWith('{') && text.endsWith('}')) ||
      (text.startsWith('[') && text.endsWith(']'))
    ) {
      try {
        return JSON.stringify(JSON.parse(text), null, 2);
      } catch (_) {
        /* keep raw */
      }
    }
    return text;
  }

  function createItem(className) {
    const node = document.createElement('div');
    node.className = className || 'codx-log-item';
    return node;
  }

  function addMainLine(item, { time, level, text, isError }) {
    const line = document.createElement('div');
    line.className = 'codx-log-line' + (isError ? ' is-error' : '');

    const timeEl = document.createElement('span');
    timeEl.className = 'codx-log-time';
    timeEl.textContent = formatTime(time);

    const levelEl = document.createElement('span');
    levelEl.className = 'codx-log-level';
    levelEl.textContent = level || 'LOG';

    const msgEl = document.createElement('span');
    msgEl.className = 'codx-log-msg';
    msgEl.textContent = text || '—';

    line.appendChild(timeEl);
    line.appendChild(levelEl);
    line.appendChild(msgEl);
    item.appendChild(line);
    return line;
  }

  function addLayer(item, text, opts = {}) {
    if (text == null || String(text).trim() === '') return null;
    const body = String(text);
    const multiline =
      opts.multiline || body.includes('\n') || (body.length > 200 && !opts.forceSingleLine);
    const line = document.createElement('div');
    line.className =
      'codx-log-line codx-log-layer' +
      (opts.isError ? ' is-error' : '') +
      (opts.kind ? ` is-${opts.kind}` : '');

    const timeEl = document.createElement('span');
    timeEl.className = 'codx-log-time';
    timeEl.setAttribute('aria-hidden', 'true');

    const levelEl = document.createElement('span');
    levelEl.className = 'codx-log-level';
    levelEl.textContent = opts.level || '↳';

    const msgEl = document.createElement(multiline ? 'pre' : 'span');
    msgEl.className = 'codx-log-msg' + (multiline ? ' is-pre' : '');
    msgEl.textContent = body;

    line.appendChild(timeEl);
    line.appendChild(levelEl);
    line.appendChild(msgEl);
    item.appendChild(line);
    return line;
  }

  function appendDetailRows(item, detail, opts = {}) {
    const skip = new Set(opts.skipKeys || []);
    const items = Array.isArray(detail) ? detail : [];
    for (const row of items) {
      const k = row?.k != null ? String(row.k).trim() : '';
      const v = row?.v;
      if (!k || v == null || v === '' || skip.has(k)) continue;
      const formatted = formatDetailValue(v);
      if (!formatted) continue;
      addLayer(item, formatted, {
        level: formatDetailKey(k),
        multiline: formatted.includes('\n') || formatted.length > 160,
        isError: opts.isError,
        kind: 'detail',
      });
    }
  }

  function appendMetaLayers(item, entry, opts = {}) {
    const file = pickText(entry, ['sourceLabel', 'relPath', 'sourcePath', 'src']);
    const layerPath = pickText(entry, ['layerPath']);
    const command = pickText(entry, ['command']);

    if (file && !opts.fileInDetail) {
      addLayer(item, file, { level: 'file', kind: 'detail' });
    }
    if (layerPath) {
      addLayer(item, layerPath.replace(/\\/g, '/'), { level: 'layer', kind: 'detail' });
    }
    if (command && command !== pickText(entry, ['method', 'methodLabel'])) {
      addLayer(item, command, { level: 'cmd', kind: 'detail' });
    }

    appendDetailRows(item, entry.detail, {
      skipKeys: opts.skipDetailKeys,
      isError: opts.isError,
    });
  }

  function appendOutputLayer(item, output, opts = {}) {
    const text = String(output ?? '').trim();
    if (!text) return;
    addLayer(item, text, {
      level: '输出',
      multiline: text.includes('\n') || text.length > 160,
      isError: opts.isError,
      kind: 'output',
    });
  }

  function buildAgentPhaseEntry(entry) {
    const status = String(entry.phaseStatus || 'start');
    const item = createItem(
      'codx-log-item codx-log-item-phase' +
        (entry.isError || status === 'error' ? ' is-error' : '') +
        (status === 'done' ? ' is-done' : status === 'start' ? ' is-active' : '')
    );

    const phase = String(entry.phaseShort || entry.phase || 'PHASE').trim();
    const phaseLabel = String(entry.phaseLabel || '').trim();
    const round = Number(entry.round) > 0 ? Number(entry.round) : 1;
    const statusText =
      status === 'done' ? '完成' : status === 'error' ? '失败' : '进行中';
    const level = phaseLabel ? `${phase} ${phaseLabel}` : phase;
    const method = pickText(entry, ['methodLabel', 'method']);
    const note = pickText(entry, ['output', 'note']);

    const main = [`R${round}`, statusText, method].filter(Boolean).join(' · ');
    addMainLine(item, {
      time: entry.ts,
      level,
      text: main,
      isError: entry.isError,
    });

    appendMetaLayers(item, entry, {
      skipDetailKeys: method ? ['tool'] : [],
      isError: entry.isError,
    });

    if (note) {
      appendOutputLayer(item, note, { isError: entry.isError });
    }

    return item;
  }

  function buildProgressEntry(entry) {
    const item = createItem('codx-log-item' + (entry.isError ? ' is-error' : ''));
    const level = pickText(entry, ['method', 'moduleLabel', 'module']) || 'RUN';
    let line = pickText(entry, ['command', 'output']).replace(/^Run:\s*/i, '');

    addMainLine(item, {
      time: entry.ts,
      level,
      text: line || '—',
      isError: entry.isError,
    });

    appendMetaLayers(item, entry, { isError: entry.isError });
    const extra = pickText(entry, ['output']);
    if (extra && extra !== line) {
      appendOutputLayer(item, extra, { isError: entry.isError });
    }

    return item;
  }

  function buildToolEntry(entry) {
    const item = createItem('codx-log-item' + (entry.isError ? ' is-error' : ''));

    const module = pickText(entry, ['moduleLabel', 'module', 'skill']) || 'tool';
    const method = pickText(entry, ['method', 'command']);
    const output = pickText(entry, ['output', 'body']);

    addMainLine(item, {
      time: entry.ts,
      level: module,
      text: method || '—',
      isError: entry.isError,
    });

    appendMetaLayers(item, entry, {
      fileInDetail: false,
      skipDetailKeys: ['path'],
      isError: entry.isError,
    });

    appendOutputLayer(item, output, { isError: entry.isError });

    return item;
  }

  function buildSimpleEntry(entry) {
    const item = createItem('codx-log-item' + (entry.isError ? ' is-error' : ''));
    const level = pickText(entry, ['method', 'command']) || 'log';
    const text = pickText(entry, ['output', 'body', 'command']) || '—';

    addMainLine(item, {
      time: entry.ts,
      level,
      text: text.includes('\n') ? text.split('\n')[0] : text,
      isError: entry.isError,
    });

    appendMetaLayers(item, entry, { isError: entry.isError });

    if (text.includes('\n')) {
      appendOutputLayer(item, text.split('\n').slice(1).join('\n'), { isError: entry.isError });
    } else if (Array.isArray(entry.detail) && entry.detail.length) {
      /* 详情已在 appendMetaLayers */
    }

    return item;
  }

  function buildCodxLogEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      const item = createItem('codx-log-item');
      addMainLine(item, { level: 'LOG', text: String(entry) });
      return item;
    }

    if (entry.logKind === 'agent-phase') return buildAgentPhaseEntry(entry);
    if (entry.logKind === 'xcode-progress' || entry.logKind === 'skill-progress') {
      return buildProgressEntry(entry);
    }

    const hasToolShape =
      entry.module ||
      entry.moduleLabel ||
      entry.skill ||
      entry.sourceLabel ||
      entry.relPath ||
      entry.detail?.length ||
      entry.layerPath ||
      entry.command;

    if (hasToolShape) return buildToolEntry(entry);
    return buildSimpleEntry(entry);
  }

  function formatLogFirstLine(entry) {
    if (!entry || typeof entry !== 'object') {
      return String(entry || '').trim().split('\n')[0] || '';
    }

    if (entry.logKind === 'agent-phase') {
      const phase = String(entry.phaseShort || entry.phase || 'PHASE').trim();
      const phaseLabel = String(entry.phaseLabel || '').trim();
      const round = Number(entry.round) > 0 ? Number(entry.round) : 1;
      const status = String(entry.phaseStatus || 'start');
      const statusText =
        status === 'done' ? '完成' : status === 'error' ? '失败' : '进行中';
      const level = phaseLabel ? `${phase} ${phaseLabel}` : phase;
      const method = pickText(entry, ['methodLabel', 'method']);
      const main = [`R${round}`, statusText, method].filter(Boolean).join(' · ');
      return `${level}  ${main}`.trim();
    }

    if (entry.logKind === 'xcode-progress' || entry.logKind === 'skill-progress') {
      const level = pickText(entry, ['method', 'moduleLabel', 'module']) || 'RUN';
      const line = pickText(entry, ['command', 'output']).replace(/^Run:\s*/i, '');
      return `${level}  ${line || '—'}`.trim();
    }

    const module = pickText(entry, ['moduleLabel', 'module', 'skill']);
    const method = pickText(entry, ['method', 'command']);
    if (module || method) {
      return `${module || 'tool'}  ${method || '—'}`.trim();
    }

    const level = pickText(entry, ['method', 'command']) || 'log';
    const text = pickText(entry, ['output', 'body', 'command']) || '—';
    const first = text.includes('\n') ? text.split('\n')[0] : text;
    return `${level}  ${first}`.trim();
  }

  function append(entry) {
    const logEl = $('codx-log-output');
    if (!logEl || !entry) return;
    logEl.appendChild(buildCodxLogEntry(typeof entry === 'object' ? entry : { output: entry }));
    logEl.scrollTop = logEl.scrollHeight;
  }

  function clear() {
    const logEl = $('codx-log-output');
    if (logEl) logEl.replaceChildren();
  }

  window.CodXLog = { append, clear, buildCodxLogEntry, formatLogFirstLine };
})();
