/**
 * @file editor.js
 * Monaco 编辑区（Monaco 不可用时回退 textarea）
 */
(function () {
  /** @type {import('monaco-editor').editor.IStandaloneCodeEditor | null} */
  let editor = null;
  let monacoRef = null;
  let useFallback = false;
  /** @type {HTMLTextAreaElement | null} */
  let fallbackTa = null;

  /** @type {Map<string, { relPath: string, dirty: boolean, aiPending?: boolean, original: string, content: string }>} */
  const openFiles = new Map();
  /** deferred 且未打开时，流式阶段在后台缓冲，完成后再进入 openFiles */
  const backgroundStreams = new Map();
  /** 已关闭但有未保存修改的文件，重新打开时从这里恢复 */
  const closedDirtyFiles = new Map();
  /** @type {Map<string, string[]>} AI 改动行装饰 id */
  const aiDecorationIds = new Map();
  let activeRelPath = '';
  let minimapEnabled = true;

  function computeChangedLineNumbers(original, modified) {
    const origLines = String(original ?? '').split('\n');
    const modLines = String(modified ?? '').split('\n');
    const changed = [];
    const max = Math.max(origLines.length, modLines.length);
    for (let i = 0; i < max; i += 1) {
      if ((origLines[i] ?? '') !== (modLines[i] ?? '') && i < modLines.length) {
        changed.push(i + 1);
      }
    }
    return changed;
  }

  function clearAiChangeMarkers(relPath) {
    const ids = aiDecorationIds.get(relPath);
    if (!ids?.length) {
      aiDecorationIds.delete(relPath);
      return;
    }
    if (editor && editor.getModel() === models.get(relPath)) {
      editor.deltaDecorations(ids, []);
    }
    aiDecorationIds.delete(relPath);
  }

  function focusEditorPane(relPath) {
    if (relPath) clearAiChangeMarkers(relPath);
    hidePreview();
    showMonacoHost();
    syncMinimapToggleUi();
  }

  function promoteBackgroundStream(incomingPath) {
    const bg = backgroundStreams.get(incomingPath);
    if (!bg) return null;

    // 先检查打开的文件
    for (const [key] of openFiles.entries()) {
      if (!pathsReferToSameFile(key, incomingPath)) continue;
      backgroundStreams.delete(incomingPath);
      const existing = openFiles.get(key);
      existing.content = bg.content;
      existing.original = bg.original;
      existing.writeMode = bg.writeMode;
      existing.pendingDisk = bg.pendingDisk;
      existing.aiPending = false;
      existing.mode = 'text';
      delete existing.preview;
      return key;
    }

    // 检查已关闭但有未保存修改的文件
    for (const [key, dirtyState] of closedDirtyFiles.entries()) {
      if (!pathsReferToSameFile(key, incomingPath)) continue;
      backgroundStreams.delete(incomingPath);
      closedDirtyFiles.delete(key);
      const merged = { ...dirtyState, ...bg, relPath: key, aiPending: false, mode: 'text' };
      openFiles.set(key, merged);
      delete merged.preview;
      return key;
    }

    backgroundStreams.delete(incomingPath);
    openFiles.set(incomingPath, { ...bg, relPath: incomingPath });
    return incomingPath;
  }

  function normalizeRelPath(pathStr) {
    return String(pathStr || '')
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/^\/+/, '');
  }

  function pathsReferToSameFile(pathA, pathB) {
    const a = normalizeRelPath(pathA);
    const b = normalizeRelPath(pathB);
    if (!a || !b) return false;
    if (a === b) return true;
    return a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
  }

  /** 与 openFiles / backgroundStreams / closedDirtyFiles 的 key 对齐（避免 Agent 路径与树路径不一致） */
  function resolveRelPath(pathStr) {
    const norm = normalizeRelPath(pathStr);
    if (!norm) return '';
    if (openFiles.has(norm)) return norm;
    if (backgroundStreams.has(norm)) return norm;
    if (closedDirtyFiles.has(norm)) return norm;
    for (const key of openFiles.keys()) {
      if (pathsReferToSameFile(key, norm)) return key;
    }
    for (const key of backgroundStreams.keys()) {
      if (pathsReferToSameFile(key, norm)) return key;
    }
    for (const key of closedDirtyFiles.keys()) {
      if (pathsReferToSameFile(key, norm)) return key;
    }
    if (activeRelPath && pathsReferToSameFile(activeRelPath, norm)) {
      return activeRelPath;
    }
    return norm;
  }

  function isActiveRelPath(relPath) {
    if (!relPath || !activeRelPath) return false;
    return pathsReferToSameFile(activeRelPath, relPath);
  }

  function shouldShowLiveInEditor(state, relPath) {
    if (!state) return false;
    if (state.writeMode === 'live') return true;
    if (!isActiveRelPath(relPath)) return false;
    return state.writeMode === 'deferred' || state.aiPending;
  }

  let editorTheme = 'pecado-dark';
  const MIN_EDITOR_FONT_SIZE = 8;
  const MAX_EDITOR_FONT_SIZE = 32;
  /** @type {number} 0 = 跟随主题默认字号 */
  let editorFontSize = 0;
  const MINIMAP_KEY = 'codx.minimap';
  const DEFAULT_EDITOR_TYPOGRAPHY = {
    lineHeight: 0,
    letterSpacing: 0,
    spaceWidth: 0,
    tabSize: 2,
  };
  let editorTypography = { ...DEFAULT_EDITOR_TYPOGRAPHY };

  const LINE_NUMBER_MODES = new Set(['on', 'off', 'relative']);
  const DEFAULT_LINE_NUMBER_OPTS = {
    mode: 'on',
    minChars: 3,
    fontSize: 0,
    fontWeight: 0,
  };
  let lineNumberOpts = { ...DEFAULT_LINE_NUMBER_OPTS };

  function normalizeLineNumberMode(value) {
    const v = String(value || 'on').trim().toLowerCase();
    return LINE_NUMBER_MODES.has(v) ? v : 'on';
  }

  function normalizeLineNumberMinChars(value) {
    const n = parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n)) return DEFAULT_LINE_NUMBER_OPTS.minChars;
    return Math.min(6, Math.max(2, n));
  }

  function normalizeLineNumberFontSize(value) {
    const n = parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n) || n === 0) return 0;
    return Math.min(24, Math.max(8, n));
  }

  const LINE_NUMBER_FONT_WEIGHTS = new Set([300, 400, 500, 600, 700]);

  function normalizeLineNumberFontWeight(value) {
    const n = parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n) || n === 0) return 0;
    return LINE_NUMBER_FONT_WEIGHTS.has(n) ? n : 0;
  }

  function normalizeLineNumberOpts(input = {}) {
    const next = { ...lineNumberOpts };
    if (input.mode != null || input.lineNumbers != null) {
      next.mode = normalizeLineNumberMode(input.mode ?? input.lineNumbers);
    }
    if (input.minChars != null || input.lineNumberMinChars != null) {
      next.minChars = normalizeLineNumberMinChars(input.minChars ?? input.lineNumberMinChars);
    }
    if (input.fontSize != null || input.lineNumberFontSize != null) {
      next.fontSize = normalizeLineNumberFontSize(input.fontSize ?? input.lineNumberFontSize);
    }
    if (input.fontWeight != null || input.lineNumberFontWeight != null) {
      next.fontWeight = normalizeLineNumberFontWeight(
        input.fontWeight ?? input.lineNumberFontWeight
      );
    }
    return next;
  }

  function getLineNumberMonacoOptions() {
    return {
      lineNumbers: lineNumberOpts.mode,
      lineNumbersMinChars: lineNumberOpts.minChars,
    };
  }

  function applyLineNumberStyleCss() {
    const host = $('codx-monaco-host');
    if (!host) return;
    const hasSize = lineNumberOpts.fontSize > 0;
    const hasWeight = lineNumberOpts.fontWeight > 0;
    if (hasSize) {
      host.style.setProperty('--codx-line-number-font-size', `${lineNumberOpts.fontSize}px`);
    } else {
      host.style.removeProperty('--codx-line-number-font-size');
    }
    if (hasWeight) {
      host.style.setProperty('--codx-line-number-font-weight', String(lineNumberOpts.fontWeight));
    } else {
      host.style.removeProperty('--codx-line-number-font-weight');
    }
    if (hasSize || hasWeight) {
      host.dataset.codxLnCustom = '1';
    } else {
      delete host.dataset.codxLnCustom;
    }
  }

  function setEditorLineNumbers(input = {}) {
    lineNumberOpts = normalizeLineNumberOpts(input);
    if (editor) {
      editor.updateOptions(getLineNumberMonacoOptions());
    }
    applyLineNumberStyleCss();
    layout();
    return { ...lineNumberOpts };
  }

  function getEditorLineNumbers() {
    return { ...lineNumberOpts };
  }

  function readMinimapPref() {
    try {
      const v = localStorage.getItem(MINIMAP_KEY);
      if (v === '0') return false;
      if (v === '1') return true;
    } catch (_) {
      /* ignore */
    }
    return true;
  }

  function writeMinimapPref(enabled) {
    try {
      localStorage.setItem(MINIMAP_KEY, enabled ? '1' : '0');
    } catch (_) {
      /* ignore */
    }
  }

  function syncMinimapToggleUi() {
    const btn = $('codx-minimap-toggle');
    if (!btn) return;
    const isPreview = activeRelPath && openFiles.get(activeRelPath)?.mode === 'preview';
    if (useFallback || !editor || isPreview) {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    btn.setAttribute('aria-pressed', minimapEnabled ? 'true' : 'false');
    btn.title = minimapEnabled ? '关闭缩略图' : '开启缩略图';
    btn.setAttribute('aria-label', minimapEnabled ? '关闭缩略图' : '开启缩略图');
    syncToolbarUi();
  }

  function setMinimapEnabled(enabled) {
    minimapEnabled = Boolean(enabled);
    writeMinimapPref(minimapEnabled);
    if (editor) {
      editor.updateOptions({ minimap: { enabled: minimapEnabled } });
    }
    syncMinimapToggleUi();
    layout();
  }

  function toggleMinimap() {
    setMinimapEnabled(!minimapEnabled);
  }

  function bindMinimapToggle() {
    const btn = $('codx-minimap-toggle');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMinimap();
    });
  }

  function $(id) {
    return document.getElementById(id);
  }

  /** @type {Map<string, import('monaco-editor').editor.ITextModel>} */
  const models = new Map();

  function fileUri(relPath) {
    const rel = String(relPath || '').replace(/^\/+/, '');
    const root = window.CodX?.getProjectRoot?.() || '';
    if (root) {
      const abs = `${String(root).replace(/\/+$/, '')}/${rel}`;
      return monacoRef.Uri.file(abs);
    }
    return monacoRef.Uri.parse(`inmemory://codx/${encodeURIComponent(rel)}`);
  }

  function guessLanguage(relPath) {
    const ext = relPath.includes('.') ? relPath.slice(relPath.lastIndexOf('.')).toLowerCase() : '';
    const map = {
      '.swift': 'swift',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.json': 'json',
      '.md': 'markdown',
      '.m': 'objective-c',
      '.mm': 'objective-c',
      '.h': 'objective-c',
      '.cpp': 'cpp',
      '.c': 'c',
      '.html': 'html',
      '.css': 'css',
      '.plist': 'xml',
      '.py': 'python',
      '.rb': 'ruby',
      '.go': 'go',
      '.rs': 'rust',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.sh': 'shell',
      '.xml': 'xml',
    };
    return map[ext] || 'plaintext';
  }

  function configureMonacoLanguages(monaco) {
    monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
    monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: true,
    });
    if (monaco.languages.css?.cssDefaults?.setOptions) {
      monaco.languages.css.cssDefaults.setOptions({ validate: true });
    }
    if (monaco.languages.css?.scssDefaults?.setOptions) {
      monaco.languages.css.scssDefaults.setOptions({ validate: true });
    }
    if (monaco.languages.css?.lessDefaults?.setOptions) {
      monaco.languages.css.lessDefaults.setOptions({ validate: true });
    }
    if (monaco.languages.html?.htmlDefaults?.setOptions) {
      monaco.languages.html.htmlDefaults.setOptions({ validate: true });
    }
    window.CodXObjcMonarch?.register?.(monaco);
  }

  /** @type {ReturnType<typeof window.CodXDiagnostics.bind> | null} */
  let diagnostics = null;

  function relPathForModel(model) {
    for (const [rel, m] of models.entries()) {
      if (m === model) return rel;
    }
    return '';
  }

  function bindDiagnostics(monaco) {
    if (!window.CodXDiagnostics?.bind) return;
    diagnostics = window.CodXDiagnostics.bind(monaco, relPathForModel);
  }

  function attachModelDiagnostics(relPath, model) {
    if (!diagnostics || !model || model.isDisposed()) return;
    diagnostics.bindModel(relPath, model);
  }

  function disposeModel(relPath) {
    const model = models.get(relPath);
    if (!model) return;
    diagnostics?.clearForRelPath?.(relPath, model);
    if (editor?.getModel?.() === model) editor.setModel(null);
    model.dispose();
    models.delete(relPath);
  }

  function applyEditorTheme(themeId) {
    if (!monacoRef) return editorTheme;
    const id = window.CodXEditorThemes?.apply?.(monacoRef, themeId) || editorTheme;
    editorTheme = id;
    applyEditorFont();
    return id;
  }

  function normalizeEditorTypography(input = {}) {
    const clamp = (value, min, max, fallback) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    };
    const tab = parseInt(String(input.tabSize ?? ''), 10);
    return {
      lineHeight: clamp(input.lineHeight, 0, 48, 0),
      letterSpacing: clamp(input.letterSpacing, -2, 10, 0),
      spaceWidth: clamp(input.spaceWidth, 0, 24, 0),
      tabSize: [2, 4, 8].includes(tab) ? tab : 2,
    };
  }

  function getEditorTypographyOptions() {
    return {
      lineHeight: editorTypography.lineHeight || 0,
      letterSpacing: editorTypography.letterSpacing || 0,
      tabSize: editorTypography.tabSize || 2,
      insertSpaces: true,
    };
  }

  function syncTypographyCss() {
    const space = `${editorTypography.spaceWidth || 0}px`;
    const hosts = [$('codx-monaco-host')];
    for (const host of hosts) {
      if (!host) continue;
      host.style.setProperty('--codx-word-spacing', space);
    }
    if (fallbackTa) {
      fallbackTa.style.letterSpacing = `${editorTypography.letterSpacing || 0}px`;
      fallbackTa.style.wordSpacing = space;
      fallbackTa.style.lineHeight =
        editorTypography.lineHeight > 0 ? `${editorTypography.lineHeight}px` : '';
      fallbackTa.style.tabSize = String(editorTypography.tabSize || 2);
    }
  }

  function applyEditorTypography() {
    syncTypographyCss();
    const opts = getEditorTypographyOptions();
    if (editor) editor.updateOptions(opts);
  }

  function setEditorTypography(input = {}) {
    editorTypography = normalizeEditorTypography({ ...editorTypography, ...input });
    applyEditorTypography();
    return { ...editorTypography };
  }

  function getEditorTypography() {
    return { ...editorTypography };
  }

  function normalizeEditorFontSize(value) {
    const n = parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n) || n === 0) return 0;
    return Math.min(MAX_EDITOR_FONT_SIZE, Math.max(MIN_EDITOR_FONT_SIZE, n));
  }

  function getThemeFontOptions() {
    return (
      window.CodXEditorThemes?.getFontOptions?.(editorTheme) || {
        fontFamily: 'Menlo, Monaco, Consolas, monospace',
        fontSize: 12,
        fontWeight: 'normal',
      }
    );
  }

  function getEffectiveFontOptions() {
    const themeFont = getThemeFontOptions();
    if (editorFontSize > 0) {
      return { ...themeFont, fontSize: editorFontSize };
    }
    return themeFont;
  }

  function getCurrentFontSize() {
    if (editorFontSize > 0) return editorFontSize;
    if (editor && monacoRef) {
      try {
        return editor.getOption(monacoRef.editor.EditorOption.fontSize);
      } catch (_) {
        /* ignore */
      }
    }
    return getThemeFontOptions().fontSize || 12;
  }

  function applyEditorFont() {
    const opts = getEffectiveFontOptions();
    if (editor) editor.updateOptions(opts);
    if (fallbackTa) {
      fallbackTa.style.fontFamily = opts.fontFamily;
      fallbackTa.style.fontSize = `${opts.fontSize}px`;
      fallbackTa.style.fontWeight = opts.fontWeight || 'normal';
      if (opts.fontLigatures) {
        fallbackTa.style.fontVariantLigatures = 'normal';
      } else {
        fallbackTa.style.fontVariantLigatures = 'none';
      }
    }
  }

  function setEditorFontSize(value) {
    editorFontSize = normalizeEditorFontSize(value);
    applyEditorFont();
    return editorFontSize;
  }

  function adjustEditorFontSize(delta) {
    const step = Number(delta) || 0;
    if (!step) return getCurrentFontSize();
    const next = normalizeEditorFontSize(getCurrentFontSize() + step);
    editorFontSize = next;
    applyEditorFont();
    return editorFontSize;
  }

  function getEditorFontSize() {
    return editorFontSize;
  }

  function editorCreateOptions(extra = {}) {
    const font = getEffectiveFontOptions();
    return {
      theme: editorTheme,
      automaticLayout: true,
      ...font,
      ...getEditorTypographyOptions(),
      minimap: { enabled: minimapEnabled },
      scrollBeyondLastLine: false,
      wordWrap: 'off',
      renderLineHighlight: 'line',
      renderValidationDecorations: 'on',
      glyphMargin: false,
      lineDecorationsWidth: 4,
      ...getLineNumberMonacoOptions(),
      quickSuggestions: true,
      ...extra,
    };
  }

  function setEditorTheme(themeId) {
    editorTheme = window.CodXEditorThemes?.normalizeThemeId?.(themeId) || 'pecado-dark';
    if (monacoRef) applyEditorTheme(editorTheme);
    return editorTheme;
  }

  function getEditorTheme() {
    return editorTheme;
  }

  function bindFallbackInput() {
    if (!fallbackTa) return;
    fallbackTa.addEventListener('input', () => {
      const state = openFiles.get(activeRelPath);
      if (!state || state.aiPending) return;
      state.content = fallbackTa.value;
      state.dirty = true;
      updateTabDirty(activeRelPath);
    });
  }

  function initFallbackEditor() {
    useFallback = true;
    const host = $('codx-monaco-host');
    if (!host) throw new Error('缺少 #codx-monaco-host');
    host.replaceChildren();
    fallbackTa = document.createElement('textarea');
    fallbackTa.className = 'codx-fallback-editor';
    fallbackTa.spellcheck = false;
    fallbackTa.value = PLACEHOLDER;
    host.appendChild(fallbackTa);
    bindFallbackInput();
    syncTypographyCss();
    applyEditorFont();
    syncMinimapToggleUi();
    updateEmptyState();
    return fallbackTa;
  }

  function createMonacoEditor(monaco) {
    const host = $('codx-monaco-host');
    if (!host) throw new Error('缺少 #codx-monaco-host');
    const pending = activeRelPath ? openFiles.get(activeRelPath)?.content : null;
    const fromFallback = fallbackTa ? fallbackTa.value : '';
    const initial = pending ?? fromFallback ?? PLACEHOLDER;
    editor?.dispose();
    host.replaceChildren();
    fallbackTa = null;
    useFallback = false;
    minimapEnabled = readMinimapPref();
    editor = monaco.editor.create(host, editorCreateOptions({
      value: initial,
      language: activeRelPath ? guessLanguage(activeRelPath) : 'plaintext',
    }));
    editor.onDidChangeModelContent(() => {
      const state = openFiles.get(activeRelPath);
      if (!state || state.aiPending) return;
      state.content = editor.getValue();
      state.dirty = true;
      updateTabDirty(activeRelPath);
      syncToolbarUi();
    });
    bindMinimapToggle();
    bindSyncXcodeButton();
    syncTypographyCss();
    applyLineNumberStyleCss();
    syncMinimapToggleUi();
    syncToolbarUi();
    updateEmptyState();
    return editor;
  }

  function initSync() {
    if ((editor && monacoRef) || (useFallback && fallbackTa)) {
      return editor || fallbackTa;
    }
    return null;
  }

  async function init(opts = {}) {
    if (opts.editorTheme) setEditorTheme(opts.editorTheme);
    if (opts.editorFontSize != null) setEditorFontSize(opts.editorFontSize);
    if (opts.editorTypography) setEditorTypography(opts.editorTypography);
    if (editor && monacoRef) {
      applyEditorTheme(editorTheme);
      applyEditorTypography();
      return editor;
    }
    try {
      const monaco = await window.CodXMonacoLoader.loadMonaco();
      monacoRef = monaco;
      window.CodXEditorThemes?.registerAll?.(monaco);
      applyEditorTheme(editorTheme);
      configureMonacoLanguages(monaco);
      bindDiagnostics(monaco);
      useFallback = false;
      return createMonacoEditor(monaco);
    } catch (e) {
      console.error('[CodXEditor] Monaco 不可用，使用文本编辑器', e);
      if (!fallbackTa) initFallbackEditor();
      return fallbackTa;
    }
  }

  function updateTabDirty(relPath) {
    const tab = document.querySelector(`.codx-tab[data-rel-path="${CSS.escape(relPath)}"]`);
    if (!tab) return;
    const state = openFiles.get(relPath);
    tab.classList.toggle('is-dirty', Boolean(state?.dirty));
  }

  function persistActiveEditorContent() {
    if (!activeRelPath) return;
    const state = openFiles.get(activeRelPath);
    if (!state || state.aiPending || state.mode === 'preview') return;
    if (useFallback && fallbackTa) {
      state.content = fallbackTa.value;
      return;
    }
    if (editor) state.content = editor.getValue();
  }

  const PLACEHOLDER = '';

  function updateEmptyState() {
    const empty = $('codx-editor-empty');
    const stack = $('codx-monaco-host')?.parentElement;
    if (!empty) return;
    const noFile = !activeRelPath || !openFiles.has(activeRelPath);
    empty.classList.toggle('hidden', !noFile);
    stack?.classList.toggle('is-empty', noFile);
  }

  function renderTabs() {
    const bar = $('codx-editor-tabs');
    if (!bar) return;
    bar.replaceChildren();
    for (const relPath of openFiles.keys()) {
      const tab = document.createElement('div');
      tab.className = `codx-tab${relPath === activeRelPath ? ' is-active' : ''}`;
      tab.dataset.relPath = relPath;

      const labelBtn = document.createElement('button');
      labelBtn.type = 'button';
      labelBtn.className = 'codx-tab-label';
      labelBtn.textContent = relPath.split('/').pop() || relPath;
      labelBtn.title = relPath;
      labelBtn.addEventListener('click', () => switchToFile(relPath));

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'codx-tab-close';
      closeBtn.setAttribute('aria-label', `关闭 ${relPath}`);
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeFile(relPath);
      });

      const state = openFiles.get(relPath);
      if (state?.dirty) tab.classList.add('is-dirty');
      if (state?.pendingDiff) tab.classList.add('is-pending-sync');
      if (state?.aiPending) tab.classList.add('is-ai-streaming');

      tab.appendChild(labelBtn);
      tab.appendChild(closeBtn);
      bar.appendChild(tab);
    }
  }

  function showPlaceholder() {
    hidePreview();
    showMonacoHost();
    if (useFallback && fallbackTa) {
      fallbackTa.value = PLACEHOLDER;
    } else if (editor && monacoRef) {
      editor.setModel(null);
    }
    updateEmptyState();
  }

  function closeFile(relPath) {
    persistActiveEditorContent();
    if (!openFiles.has(relPath)) return;
    const state = openFiles.get(relPath);
    disposeModel(relPath);
    openFiles.delete(relPath);

    // 如果文件有未保存修改，保存到closedDirtyFiles，重新打开时恢复
    if (isFileEdited(state)) {
      closedDirtyFiles.set(relPath, state);
    } else {
      closedDirtyFiles.delete(relPath);
    }

    if (activeRelPath === relPath) {
      const remaining = [...openFiles.keys()];
      if (remaining.length) {
        switchToFile(remaining[remaining.length - 1]);
      } else {
        activeRelPath = '';
        hidePreview();
        showMonacoHost();
        showPlaceholder();
        renderTabs();
      }
      return;
    }
    renderTabs();
  }

  function resetAll() {
    persistActiveEditorContent();
    for (const relPath of [...models.keys()]) disposeModel(relPath);
    openFiles.clear();
    backgroundStreams.clear();
    closedDirtyFiles.clear();
    aiDecorationIds.clear();
    activeRelPath = '';
    hidePreview();
    showMonacoHost();
    renderTabs();
    showPlaceholder();
    window.CodXFileTree?.clearActivePath?.();
  }

  function hidePreview() {
    $('codx-preview-host')?.classList.add('hidden');
    $('codx-preview-host')?.replaceChildren();
  }

  function showMonacoHost() {
    $('codx-monaco-host')?.classList.remove('hidden');
  }

  function hideMonacoHost() {
    $('codx-monaco-host')?.classList.add('hidden');
  }

  function detachMainEditor() {
    if (!editor || useFallback) return;
    editor.setModel(null);
  }

  function showPreviewPanel(preview) {
    hideMonacoHost();
    detachMainEditor();
    const host = $('codx-preview-host');
    if (!host || !preview) return;
    host.classList.remove('hidden');
    host.replaceChildren();

    const { kind, fileUrl, title } = preview;
    if (kind === 'image') {
      const img = document.createElement('img');
      img.src = fileUrl;
      img.alt = title || '';
      img.decoding = 'async';
      host.appendChild(img);
      return;
    }
    if (kind === 'video') {
      const video = document.createElement('video');
      video.src = fileUrl;
      video.controls = true;
      video.playsInline = true;
      host.appendChild(video);
      return;
    }
    if (kind === 'audio') {
      const wrap = document.createElement('div');
      wrap.className = 'codx-preview-audio';
      const audio = document.createElement('audio');
      audio.src = fileUrl;
      audio.controls = true;
      wrap.appendChild(audio);
      host.appendChild(wrap);
      return;
    }
    const iframe = document.createElement('iframe');
    iframe.src = fileUrl;
    iframe.title = title || '预览';
    host.appendChild(iframe);
  }

  function openPreview(relPath, previewMeta) {
    persistActiveEditorContent();
    let state = openFiles.get(relPath);
    if (!state) {
      state = ensureFileState(relPath, '');
    }
    state.mode = 'preview';
    state.preview = previewMeta;
    state.dirty = false;
    state.aiPending = false;
    activeRelPath = relPath;
    showPreviewPanel(previewMeta);
    renderTabs();
    window.CodXFileTree?.setActivePath?.(relPath);
    syncMinimapToggleUi();
    layout();
    updateEmptyState();
  }

  function applyEditorContent(relPath, content) {
    hidePreview();
    showMonacoHost();
    if (useFallback && fallbackTa) {
      fallbackTa.value = content || '';
      updateEmptyState();
      return;
    }
    if (!editor || !monacoRef) return;
    const lang = guessLanguage(relPath);
    let model = models.get(relPath);
    if (!model || model.isDisposed()) {
      model = monacoRef.editor.createModel(content || '', lang, fileUri(relPath));
      models.set(relPath, model);
    } else {
      monacoRef.editor.setModelLanguage(model, lang);
      if (model.getValue() !== (content || '')) model.setValue(content || '');
    }
    editor.setModel(model);
    attachModelDiagnostics(relPath, model);
    updateEmptyState();
  }

  function switchToFile(relPath) {
    persistActiveEditorContent();
    const state = openFiles.get(relPath);
    if (!state) return;
    activeRelPath = relPath;
    if (state.mode === 'preview' && state.preview) {
      showPreviewPanel(state.preview);
    } else {
      hidePreview();
      const codxStreaming = state.codxPlanReady && state.codxEdits?.some((ed) => !ed.complete);
      const codxLiveIdx = codxStreaming ? getSerialLiveEditIndex(state) : -1;
      if (
        codxStreaming &&
        codxLiveIdx >= 0 &&
        !state.codxEdits[codxLiveIdx]?.complete &&
        !useFallback
      ) {
        focusEditorPane(relPath);
        applyEditorContent(relPath, state.content || '');
        applyCodxLiveToMonaco(relPath, state, codxLiveIdx);
      } else {
        focusEditorPane(relPath);
        applyEditorContent(relPath, state.content || '');
      }
    }
    renderTabs();
    window.CodXFileTree?.setActivePath?.(relPath);
    syncMinimapToggleUi();
    syncToolbarUi();
    updateEmptyState();
    layout();
  }

  function ensureFileState(relPath, original = '') {
    if (!openFiles.has(relPath)) {
      openFiles.set(relPath, {
        relPath,
        mode: 'text',
        dirty: false,
        aiPending: false,
        writeMode: null,
        pendingDisk: false,
        pendingDiff: false,
        original,
        content: original,
      });
    }
    return openFiles.get(relPath);
  }

  function getFileState(relPath) {
    const resolved = resolveRelPath(relPath);
    return openFiles.get(resolved) || backgroundStreams.get(resolved) || closedDirtyFiles.get(resolved);
  }

  /** 文件是否被 Monaco 编辑过（人 或 AI coding） */
  function isFileEdited(state) {
    if (!state) return false;
    if (state.dirty) return true;
    if (state.aiPending) return true;
    if (state.original !== state.content) return true;
    if (state.codxEdits?.length) return true;
    return false;
  }

  /**
   * 获取 Monaco 缓存中某文件的编辑内容（UI：文件树打开等）。
   * @returns {null|{ content: string, isEdited: boolean, isBackground: boolean, isClosedDirty: boolean }}
   */
  function getCachedContent(relPath) {
    const resolved = resolveRelPath(relPath);
    if (!resolved) return null;
    const state = openFiles.get(resolved) || backgroundStreams.get(resolved) || closedDirtyFiles.get(resolved);
    if (!state) return null;
    return {
      content: state.content ?? '',
      isEdited: isFileEdited(state),
      isBackground: backgroundStreams.has(resolved) && !openFiles.has(resolved),
      isClosedDirty: closedDirtyFiles.has(resolved) && !openFiles.has(resolved),
    };
  }

  /**
   * Agent read_text_file：CodX 已打开该文件则读 Monaco 最新内容（含未保存 / 流式编辑）。
   * @returns {null|{ content: string, relPath: string }}
   */
  function readTextForAgent(relPath) {
    const resolved = resolveRelPath(relPath);
    if (!resolved) return null;
    const state = openFiles.get(resolved) || backgroundStreams.get(resolved) || closedDirtyFiles.get(resolved);
    if (!state) return null;

    if (state.codxEdits?.length) {
      state.content = recomputeContentFromCodxEdits(state);
    } else if (isActiveRelPath(resolved)) {
      if (useFallback && fallbackTa) {
        state.content = fallbackTa.value;
      } else if (editor && !useFallback) {
        const model = models.get(resolved) || editor.getModel();
        if (model && !model.isDisposed()) {
          state.content = model.getValue();
        }
      }
    }

    return {
      content: state.content ?? '',
      relPath: resolved,
    };
  }

  /**
   * 打开缓存中的文件（包括后台AI编辑中的文件、已关闭但有未保存修改的文件），保留所有编辑状态
   */
  function openCachedFile(relPath) {
    const resolved = resolveRelPath(relPath);
    if (!resolved) return false;

    const bgState = backgroundStreams.get(resolved);
    if (bgState) {
      // 从后台流移动到打开文件列表，保留所有AI编辑状态
      backgroundStreams.delete(resolved);
      openFiles.set(resolved, bgState);
    }

    const closedDirtyState = closedDirtyFiles.get(resolved);
    if (closedDirtyState) {
      // 从已关闭脏文件列表恢复，保留所有未保存修改
      closedDirtyFiles.delete(resolved);
      openFiles.set(resolved, closedDirtyState);
    }

    const state = openFiles.get(resolved);
    if (!state) return false;

    persistActiveEditorContent();
    activeRelPath = resolved;
    state.mode = 'text';
    delete state.preview;

    focusEditorPane(resolved);
    const codxStreaming = state.codxPlanReady && state.codxEdits?.some((ed) => !ed.complete);
    const codxLiveIdx = codxStreaming ? getSerialLiveEditIndex(state) : -1;
    if (codxStreaming && codxLiveIdx >= 0 && !useFallback) {
      applyEditorContent(resolved, state.content || '');
      applyCodxLiveToMonaco(resolved, state, codxLiveIdx);
    } else {
      applyEditorContent(resolved, state.content || '');
    }

    renderTabs();
    window.CodXFileTree?.setActivePath?.(resolved);
    syncMinimapToggleUi();
    syncToolbarUi();
    updateEmptyState();
    layout();
    return true;
  }

  async function loadDiskOriginal(relPath) {
    const api = window.electronAPI;
    if (!api?.mcpFsReadTextFile) return '';
    try {
      const res = await api.mcpFsReadTextFile({ path: relPath });
      if (res?.ok) return res.body || '';
    } catch (_) {
      /* ignore */
    }
    return '';
  }

  function codxOps() {
    return window.CodXEditOps;
  }

  function recomputeContentFromCodxEdits(state, opts = {}) {
    const base = state?.original ?? '';
    const edits = state?.codxEdits;
    if (!edits?.length || !codxOps()) return base;
    const liveArrayIndex = opts.liveArrayIndex ?? -1;
    const applied = edits.map((ed, i) => {
      if (ed.complete || i === liveArrayIndex) return ed;
      return { ...ed, streamText: '' };
    });
    const sorted = [...applied].sort((a, b) => b.startLine - a.startLine);
    let content = base;
    for (const ed of sorted) {
      content = codxOps().applyCodxEditOp(content, ed);
    }
    return content;
  }

  function recomputeContentBeforeEdit(state, beforeArrayIndex) {
    const base = state?.original ?? '';
    const edits = state?.codxEdits;
    if (!edits?.length || !codxOps()) return base;
    const sorted = edits
      .map((ed, i) => ({ ed, i }))
      .filter(({ i, ed }) => i < beforeArrayIndex && ed.complete)
      .sort((a, b) => b.ed.startLine - a.ed.startLine);
    let content = base;
    for (const { ed } of sorted) {
      content = codxOps().applyCodxEditOp(content, ed);
    }
    return content;
  }

  /** 串行流式：plan 顺序（大行号优先）中第一个未完成的 edit */
  function getSerialLiveEditIndex(state) {
    const edits = state?.codxEdits;
    if (!edits?.length) return -1;
    for (let i = 0; i < edits.length; i += 1) {
      if (!edits[i].complete) return i;
    }
    return -1;
  }

  function createCodxEditEntry(opts = {}) {
    const startLine = Math.max(1, Math.floor(Number(opts.startLine) || 1));
    return {
      op: opts.op || 'insert_code',
      startLine,
      endLine: opts.endLine,
      streamText: '',
      complete: false,
    };
  }

  async function ensureCodxSessionReady(resolved) {
    let state = openFiles.get(resolved) || backgroundStreams.get(resolved);
    if (!state) return null;

    if (!state._codxSessionInitNeeded) {
      return state;
    }
    delete state._codxSessionInitNeeded;

    const original = await loadDiskOriginal(resolved);
    state.original = original;
    state.content = original;
    state.mode = 'text';
    state.pendingDisk = true;
    delete state.preview;

    if (!openFiles.has(resolved)) {
      openFiles.set(resolved, state);
    }
    if (backgroundStreams.has(resolved)) {
      backgroundStreams.delete(resolved);
    }

    if (isActiveRelPath(resolved)) {
      focusEditorPane(resolved);
      applyEditorContent(resolved, original);
    } else {
      renderTabs();
    }

    state.content = recomputeContentFromCodxEdits(state);
    return state;
  }

  /** @type {Map<string, Promise<object|null>>} */
  const codxInitInflight = new Map();

  async function initCodxLineEditSession(relPath) {
    const resolved = resolveRelPath(relPath);
    if (!resolved) return null;

    if (!codxInitInflight.has(resolved)) {
      const p = ensureCodxSessionReady(resolved).finally(() => {
        codxInitInflight.delete(resolved);
      });
      codxInitInflight.set(resolved, p);
    }
    const state = await codxInitInflight.get(resolved);
    if (!state) return null;

    const liveIdx = getSerialLiveEditIndex(state);
    state.content = recomputeContentFromCodxEdits(state, { liveArrayIndex: liveIdx });
    if (isActiveRelPath(resolved) && liveIdx >= 0) {
      focusEditorPane(resolved);
      applyCodxLiveToMonaco(resolved, state, liveIdx);
    }
    syncToolbarUi();
    return state;
  }

  function resetCodxStreamSession(state) {
    delete state.codxStreamSession;
  }

  function distributeEditsFromRawStream(state) {
    if (!state?.codxEdits?.length) return;
    const raw = String(state.codxRawStream ?? '');
    const planFn = window.CodXEditPlan?.distributeStream;
    if (!planFn) return;
    const { edits } = planFn(raw, state.codxEdits);
    state.codxEdits = edits;
  }

  /** 第一轮 plan 登记（大行号优先，第二轮流按 pecado_block_end 切分） */
  function applyCodxEditPlan(relPath, rawEdits) {
    let resolved = resolveRelPath(relPath);
    if (!resolved || !Array.isArray(rawEdits) || !rawEdits.length) return null;
    if (activeRelPath && pathsReferToSameFile(activeRelPath, resolved)) {
      resolved = activeRelPath;
    }

    let state = openFiles.get(resolved) || backgroundStreams.get(resolved);
    if (!state) {
      state = {
        relPath: resolved,
        mode: 'text',
        dirty: false,
        aiPending: true,
        writeMode: 'deferred',
        pendingDisk: true,
        pendingDiff: false,
        original: '',
        content: '',
      };
      openFiles.set(resolved, state);
    }

    delete state.codxStreamSession;
    delete state.codxEdit;
    state.pendingDiff = false;
    state.codxPlanReady = true;
    state.codxRawStream = '';
    state.aiPending = true;
    state.writeMode = 'deferred';
    state._codxSessionInitNeeded = true;

    state.codxEdits = rawEdits.map((ed) =>
      createCodxEditEntry({
        op: ed.op || 'insert_code',
        startLine: ed.startLine ?? ed.line_start,
        endLine: ed.endLine ?? ed.line_end,
      })
    );

    const init = initCodxLineEditSession(resolved);
    if (init?.then) init.catch(console.error);
    syncToolbarUi();
    return state;
  }

  function appendCodxContentStream(relPath, fullText) {
    if (useFallback && !fallbackTa) return;
    if (!useFallback && (!editor || !monacoRef)) return;
    let resolved = resolveRelPath(relPath);
    if (!resolved) return;
    if (activeRelPath && pathsReferToSameFile(activeRelPath, resolved)) {
      resolved = activeRelPath;
    }
    const state = openFiles.get(resolved) || backgroundStreams.get(resolved);
    if (!state?.codxEdits?.length || !state.codxPlanReady) return;

    state.aiPending = true;
    state.writeMode = 'deferred';
    const prevComplete = state.codxEdits.map((ed) => ed.complete);
    state.codxRawStream = String(fullText ?? '');
    distributeEditsFromRawStream(state);

    const liveIdx = getSerialLiveEditIndex(state);
    state.content = recomputeContentFromCodxEdits(state, { liveArrayIndex: liveIdx });

    for (let i = 0; i < state.codxEdits.length; i += 1) {
      if (!prevComplete[i] && state.codxEdits[i].complete) {
        resetCodxStreamSession(state);
        state.dirty = state.original !== state.content;
        state.pendingDisk = state.dirty;
        updateTabDirty(resolved);
      }
    }

    const showLive = shouldShowLiveInEditor(state, resolved);
    if (!showLive || liveIdx < 0) {
      syncToolbarUi();
      return;
    }
    focusEditorPane(resolved);
    applyCodxLiveToMonaco(resolved, state, liveIdx);
    syncMinimapToggleUi();
    syncToolbarUi();
  }

  function finishCodxContentStream(relPath) {
    let resolved = resolveRelPath(relPath);
    if (!resolved) return;
    if (activeRelPath && pathsReferToSameFile(activeRelPath, resolved)) {
      resolved = activeRelPath;
    }
    const state = openFiles.get(resolved) || backgroundStreams.get(resolved);
    if (!state?.codxEdits?.length) {
      finishAiStream(relPath);
      return;
    }

    distributeEditsFromRawStream(state);
    for (const ed of state.codxEdits) {
      if (!ed.complete && ed.streamText != null) ed.complete = true;
    }
    resetCodxStreamSession(state);
    delete state.codxEdit;
    delete state.codxPlanReady;

    state.content = recomputeContentFromCodxEdits(state);
    state.aiPending = false;
    const changed = state.original !== state.content;
    state.writeMode = 'deferred';

    if (changed) {
      state.dirty = true;
      state.pendingDiff = true;
      state.pendingDisk = true;
      updateTabDirty(resolved);
    } else {
      state.pendingDiff = false;
      state.pendingDisk = false;
    }
    if (isActiveRelPath(resolved)) {
      focusEditorPane(resolved);
      applyEditorContent(resolved, state.content);
    }
    syncToolbarUi();
    renderTabs();
    layout();
  }

  function applyCodxLiveToMonaco(resolved, state, editArrayIndex) {
    if (!codxOps()) {
      pushLiveContentToEditor(resolved, state);
      return;
    }
    const ed = state.codxEdits[editArrayIndex];
    if (!ed) return;
    const enriched = codxOps()?.enrichCodxEditForApply?.(ed) || ed;
    const op = codxOps()?.inferCodxOp?.(enriched) || 'insert_code';

    if (useFallback && fallbackTa) {
      fallbackTa.value = recomputeContentFromCodxEdits(state, { liveArrayIndex: editArrayIndex });
      return;
    }
    if (!editor || !monacoRef) return;

    let model = models.get(resolved);
    const lang = guessLanguage(resolved);

    function ensureModelWithBase() {
      const baseContent = recomputeContentBeforeEdit(state, editArrayIndex);
      if (!model || model.isDisposed()) {
        model = monacoRef.editor.createModel(baseContent, lang, fileUri(resolved));
        models.set(resolved, model);
      } else if (model.getValue() !== baseContent) {
        model.setValue(baseContent);
      }
      return baseContent;
    }

    function streamInsertAtStartLine() {
      let session = state.codxStreamSession;
      const text = ed.streamText || '';
      if (session && session.editArrayIndex === editArrayIndex && session.streamedLen > text.length) {
        resetCodxStreamSession(state);
        session = null;
      }
      if (!session || session.editArrayIndex !== editArrayIndex) {
        ensureModelWithBase();
        const anchorLine = codxOps().mapOriginalLineToCurrent(ed.startLine, state.codxEdits, {
          completeOnly: true,
          beforeArrayIndex: editArrayIndex,
        });
        state.codxStreamSession = {
          editArrayIndex,
          op,
          streamedLen: 0,
          anchorLine: Math.max(1, anchorLine),
          anchorColumn: 1,
        };
        session = state.codxStreamSession;
      }
      const piece = text.slice(session.streamedLen);
      if (piece) {
        const line = session.anchorLine;
        const col = session.anchorColumn;
        model.pushEditOperations(
          [],
          [{
            range: new monacoRef.Range(line, col, line, col),
            text: piece,
            forceMoveMarkers: true,
          }],
          () => null
        );
        const parts = piece.split('\n');
        if (parts.length === 1) {
          session.anchorColumn += piece.length;
        } else {
          session.anchorLine += parts.length - 1;
          session.anchorColumn = parts[parts.length - 1].length + 1;
        }
        session.streamedLen = text.length;
      }
    }

    if (op === 'del_code' || op === 'insert_blanks') {
      if (!ed.complete) return;
      state.content = recomputeContentFromCodxEdits(state, { liveArrayIndex: editArrayIndex });
      pushLiveContentToEditor(resolved, state);
      resetCodxStreamSession(state);
      return;
    }

    if (op === 'edit_code') {
      let session = state.codxStreamSession;
      const text = ed.streamText || '';
      if (session && session.editArrayIndex === editArrayIndex && session.streamedLen > text.length) {
        resetCodxStreamSession(state);
        session = null;
      }
      if (!session || session.editArrayIndex !== editArrayIndex) {
        ensureModelWithBase();
        const mappedStart = codxOps().mapOriginalLineToCurrent(enriched.startLine, state.codxEdits, {
          completeOnly: true,
          beforeArrayIndex: editArrayIndex,
        });
        const span = Math.max(0, enriched.endLine - enriched.startLine);
        const mappedEnd = Math.min(model.getLineCount(), mappedStart + span);
        const endCol = model.getLineMaxColumn(mappedEnd);
        model.pushEditOperations(
          [],
          [{
            range: new monacoRef.Range(mappedStart, 1, mappedEnd, endCol),
            text: '',
            forceMoveMarkers: true,
          }],
          () => null
        );
        state.codxStreamSession = {
          editArrayIndex,
          op,
          streamedLen: 0,
          anchorLine: Math.max(1, mappedStart),
          anchorColumn: 1,
          deleteDone: true,
        };
        session = state.codxStreamSession;
      }
      const piece = text.slice(session.streamedLen);
      if (piece) {
        const line = session.anchorLine;
        const col = session.anchorColumn;
        model.pushEditOperations(
          [],
          [{
            range: new monacoRef.Range(line, col, line, col),
            text: piece,
            forceMoveMarkers: true,
          }],
          () => null
        );
        const parts = piece.split('\n');
        if (parts.length === 1) {
          session.anchorColumn += piece.length;
        } else {
          session.anchorLine += parts.length - 1;
          session.anchorColumn = parts[parts.length - 1].length + 1;
        }
        session.streamedLen = text.length;
      }
    } else if (op === 'insert_code') {
      streamInsertAtStartLine();
    } else {
      pushLiveContentToEditor(resolved, state);
      return;
    }

    if (editor.getModel() !== model) editor.setModel(model);
    const revealLine = codxOps().mapOriginalLineToCurrent(ed.startLine, state.codxEdits, {
      completeOnly: true,
      beforeArrayIndex: editArrayIndex,
    });
    editor.revealPosition({
      lineNumber: Math.min(Math.max(1, revealLine), model.getLineCount()),
      column: 1,
    });
  }

  function pushLiveContentToEditor(resolved, state) {
    if (useFallback && fallbackTa) {
      fallbackTa.value = state.content;
      return;
    }
    if (!editor || !monacoRef) return;
    let model = models.get(resolved);
    const lang = guessLanguage(resolved);
    const newContent = state.content || '';
    if (!model || model.isDisposed()) {
      model = monacoRef.editor.createModel(newContent, lang, fileUri(resolved));
      models.set(resolved, model);
    } else if (model.getValue() !== newContent) {
      model.setValue(newContent);
    }
    if (editor.getModel() !== model) editor.setModel(model);
  }

  async function beginAiStream(relPath, opts = {}) {
    let resolved = resolveRelPath(relPath);
    if (!resolved) return null;
    if (activeRelPath && pathsReferToSameFile(activeRelPath, resolved)) {
      resolved = activeRelPath;
    }
    const live = !!opts.live;
    const deferred = !!opts.deferred;
    const wasOpen = openFiles.has(resolved);
    let state = openFiles.get(resolved);

    if (state?.aiPending || backgroundStreams.get(resolved)?.aiPending) {
      return state || backgroundStreams.get(resolved);
    }

    if (deferred && !wasOpen) {
      const original = await loadDiskOriginal(resolved);
      backgroundStreams.set(resolved, {
        relPath: resolved,
        mode: 'text',
        dirty: false,
        aiPending: true,
        writeMode: 'deferred',
        pendingDisk: true,
        pendingDiff: false,
        original,
        content: original,
        streamDisplayedLen: 0,
      });
      syncToolbarUi();
      return backgroundStreams.get(resolved);
    }

    if (!state) {
      if (deferred) {
        const original = await loadDiskOriginal(resolved);
        state = ensureFileState(resolved, original);
        state.content = original;
      } else {
        state = ensureFileState(resolved, '');
      }
    }

    if (deferred && wasOpen && !state.codxEdits?.length) {
      persistActiveEditorContent();
      state.original = state.content;
    }

    state.writeMode = live ? 'live' : 'deferred';
    state.pendingDisk = deferred;
    state.pendingDiff = false;
    state.aiPending = true;
    state.mode = 'text';
    delete state.preview;
    state.streamDisplayedLen = 0;

    if (live) {
      if (!wasOpen) {
        openFile(resolved, state.content || '');
      } else if (isActiveRelPath(resolved)) {
        focusEditorPane(resolved);
      }
      state.aiPending = true;
      syncToolbarUi();
      return state;
    }

    if (isActiveRelPath(resolved)) {
      focusEditorPane(resolved);
      applyEditorContent(resolved, state.content || '');
    }

    if (wasOpen) updateTabDirty(resolved);
    else renderTabs();
    syncToolbarUi();
    return state;
  }

  function openFile(relPath, content) {
    if (!useFallback && (!editor || !monacoRef)) return;
    if (useFallback && !fallbackTa && !editor) return;
    persistActiveEditorContent();
    const text = content == null ? '' : String(content);
    const existing = openFiles.get(relPath);
    if (existing) {
      existing.mode = 'text';
      delete existing.preview;
    }
    if (existing && activeRelPath === relPath && !existing.aiPending) {
      existing.content = text;
      existing.original = text;
      applyEditorContent(relPath, text);
      renderTabs();
      window.CodXFileTree?.setActivePath?.(relPath);
      layout();
      return;
    }
    if (existing && activeRelPath !== relPath) {
      existing.content = text;
      if (!existing.aiPending) existing.original = text;
      switchToFile(relPath);
      return;
    }
    const state = ensureFileState(relPath, text);
    state.mode = 'text';
    delete state.preview;
    state.content = text;
    if (!state.aiPending) state.original = text;
    activeRelPath = relPath;
    focusEditorPane(relPath);
    applyEditorContent(relPath, text);
    renderTabs();
    window.CodXFileTree?.setActivePath?.(relPath);
    syncMinimapToggleUi();
    layout();
    updateEmptyState();
  }

  function appendTextToModel(model, piece) {
    if (!piece) return;
    const lc = model.getLineCount();
    const col = model.getLineMaxColumn(lc);
    model.pushEditOperations(
      [],
      [{ range: new monacoRef.Range(lc, col, lc, col), text: piece, forceMoveMarkers: true }],
      () => null
    );
  }

  function applyStreamChunkToEditor(model, state, fullText) {
    const full = String(fullText ?? '');
    const displayed = state.streamDisplayedLen ?? 0;
    if (full.length <= displayed) return;

    const piece = full.slice(displayed);
    if (displayed === 0) {
      model.setValue(full);
    } else {
      const current = model.getValue();
      if (full.startsWith(current)) {
        appendTextToModel(model, full.slice(current.length));
      } else {
        model.setValue(full);
      }
    }
    state.streamDisplayedLen = full.length;
  }

  function appendStreamDelta(relPath, delta, fullText) {
    if (useFallback && !fallbackTa) return;
    if (!useFallback && (!editor || !monacoRef)) return;
    let resolved = resolveRelPath(relPath);
    if (!resolved) return;
    if (activeRelPath && pathsReferToSameFile(activeRelPath, resolved)) {
      resolved = activeRelPath;
    }
    let state = openFiles.get(resolved) || backgroundStreams.get(resolved);
    if (!state && activeRelPath && pathsReferToSameFile(activeRelPath, resolved)) {
      for (const [key, bg] of backgroundStreams.entries()) {
        if (!pathsReferToSameFile(key, resolved)) continue;
        const existing = openFiles.get(activeRelPath);
        if (!existing) break;
        existing.content = bg.content;
        existing.aiPending = true;
        existing.writeMode = bg.writeMode || 'deferred';
        backgroundStreams.delete(key);
        resolved = activeRelPath;
        state = existing;
        break;
      }
    }
    if (!state) return;
    state.aiPending = true;
    if (!state.writeMode && isActiveRelPath(resolved)) {
      state.writeMode = 'deferred';
    }
    state.content = fullText != null ? String(fullText) : `${state.content || ''}${delta || ''}`;
    const showLive = shouldShowLiveInEditor(state, resolved);
    if (!showLive) {
      syncToolbarUi();
      return;
    }
    focusEditorPane(resolved);
    if (useFallback && fallbackTa) {
      const full = state.content;
      const displayed = state.streamDisplayedLen ?? 0;
      if ((state.streamDisplayedLen ?? 0) === 0) {
        fallbackTa.value = full;
      } else if (full.length > displayed) {
        fallbackTa.value += full.slice(displayed);
      }
      state.streamDisplayedLen = full.length;
    } else if (editor) {
      let model = models.get(resolved);
      const lang = guessLanguage(resolved);
      if (!model || model.isDisposed()) {
        model = monacoRef.editor.createModel(state.content || '', lang, fileUri(resolved));
        models.set(resolved, model);
        state.streamDisplayedLen = state.content?.length || 0;
      } else {
        applyStreamChunkToEditor(model, state, state.content);
      }
      if (editor.getModel() !== model) editor.setModel(model);
      editor.revealLine(model.getLineCount());
    }
    syncMinimapToggleUi();
    syncToolbarUi();
  }

  function finishAiStream(relPath) {
    let resolved = resolveRelPath(relPath);
    if (!resolved) return;
    if (activeRelPath && pathsReferToSameFile(activeRelPath, resolved)) {
      resolved = activeRelPath;
    }
    for (const key of [...backgroundStreams.keys()]) {
      if (pathsReferToSameFile(key, resolved)) {
        const promoted = promoteBackgroundStream(key);
        if (promoted) resolved = promoted;
      }
    }
    let state = openFiles.get(resolved);
    if (!state) return;
    state.aiPending = false;
    delete state.codxEdit;
    delete state.codxEdits;
    delete state.codxEditActiveIndex;
    delete state.codxStreamSession;
    delete state.codxEditDisplayedContent;
    delete state.streamDisplayedLen;
    const changed = state.original !== state.content;
    const isLive = state.writeMode === 'live';
    const isDeferred = state.writeMode === 'deferred';

    if (isLive) {
      if (changed) state.original = state.content;
      state.dirty = false;
      state.pendingDisk = false;
      state.pendingDiff = false;
      updateTabDirty(resolved);
      focusEditorPane(resolved);
      if (isActiveRelPath(resolved)) {
        applyEditorContent(resolved, state.content);
      }
      syncToolbarUi();
      layout();
      return;
    }

    if (isDeferred && changed) {
      state.dirty = true;
      state.pendingDiff = true;
      state.pendingDisk = true;
      updateTabDirty(resolved);
    } else {
      state.pendingDiff = false;
      state.pendingDisk = false;
    }

    if (isActiveRelPath(resolved)) {
      focusEditorPane(resolved);
      applyEditorContent(resolved, state.content);
    }
    syncToolbarUi();
    renderTabs();
    layout();
  }

  function getPendingWrites() {
    const items = [];
    // 收集所有打开的已编辑文件
    for (const [relPath, state] of openFiles.entries()) {
      if (!isFileEdited(state)) continue;
      if (state.original === state.content) continue;
      items.push({ relPath, content: state.content || '' });
    }
    // 收集已关闭但有未保存修改的文件
    for (const [relPath, state] of closedDirtyFiles.entries()) {
      if (!isFileEdited(state)) continue;
      if (state.original === state.content) continue;
      items.push({ relPath, content: state.content || '' });
    }
    return items;
  }

  function markAcceptedWrite(relPath) {
    const resolved = resolveRelPath(relPath);
    const state = openFiles.get(resolved);
    if (state) {
      clearAiChangeMarkers(resolved);
      state.pendingDiff = false;
      state.pendingDisk = false;
      state.original = state.content;
      state.dirty = false;
      state.aiPending = false;
      updateTabDirty(resolved);
      if (activeRelPath === resolved) focusEditorPane(resolved);
    }
    // 写入成功后从已关闭脏文件列表移除
    closedDirtyFiles.delete(resolved);
    syncToolbarUi();
    renderTabs();
  }

  function syncToolbarUi() {
    syncPendingUi();
  }

  function syncPendingUi() {
    const btn = $('codx-sync-xcode-btn');
    if (!btn) return;
    const isPreview = activeRelPath && openFiles.get(activeRelPath)?.mode === 'preview';
    const pending = getPendingWrites().length;
    if (useFallback || !editor || isPreview) {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    btn.disabled = pending === 0;
    btn.setAttribute('aria-pressed', pending > 0 ? 'true' : 'false');
    btn.classList.toggle('is-pending', pending > 0);
    const syncLabel = window.electronAPI?.hasXcode ? 'Xcode' : '磁盘';
    btn.title =
      pending > 0 ? `同步 ${pending} 个待确认改动到${syncLabel}` : '没有待同步的改动';
    btn.setAttribute('aria-label', btn.title);
  }

  function bindSyncXcodeButton() {
    const btn = $('codx-sync-xcode-btn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.CodX?.syncAllToXcode?.().catch(console.error);
    });
  }

  function getActiveContent() {
    persistActiveEditorContent();
    const state = openFiles.get(activeRelPath);
    if (state) {
      return { relPath: activeRelPath, content: state.content ?? '' };
    }
    if (useFallback && fallbackTa) {
      return { relPath: activeRelPath, content: fallbackTa.value };
    }
    if (editor) {
      return { relPath: activeRelPath, content: editor.getValue() };
    }
    return { relPath: '', content: '' };
  }

  function markSaved(relPath) {
    const resolved = resolveRelPath(relPath);
    const state = openFiles.get(resolved);
    if (state) {
      state.dirty = false;
      state.original = state.content;
      updateTabDirty(resolved);
    }
    // 保存后从已关闭脏文件列表中移除
    closedDirtyFiles.delete(resolved);
  }

  function layout() {
    if (useFallback) return;
    const host = $('codx-monaco-host');
    if (editor && host && !host.classList.contains('hidden')) {
      const w = host.clientWidth || host.parentElement?.clientWidth || 0;
      const h = host.clientHeight || host.parentElement?.clientHeight || 0;
      if (w > 0 && h > 0) editor.layout({ width: w, height: h });
      else editor.layout();
    }
  }

  window.CodXEditor = {
    init,
    initSync,
    openFile,
    openPreview,
    switchToFile,
    closeFile,
    resetAll,
    appendStreamDelta,
    beginAiStream,
    applyCodxEditPlan,
    initCodxLineEditSession,
    appendCodxContentStream,
    finishCodxContentStream,
    finishAiStream,
    getPendingWrites,
    markAcceptedWrite,
    syncPendingUi,
    syncToolbarUi,
    getActiveContent,
    markSaved,
    layout,
    toggleMinimap,
    setMinimapEnabled,
    setEditorTheme,
    getEditorTheme,
    setEditorFontSize,
    adjustEditorFontSize,
    getEditorFontSize,
    getCurrentFontSize,
    setEditorTypography,
    getEditorTypography,
    setEditorLineNumbers,
    getEditorLineNumbers,
    getOpenFiles: () => openFiles,
    getCachedContent,
    readTextForAgent,
    openCachedFile,
    persistActiveEditorContent,
    resolveRelPath,
    updateEmptyState,
    isFallback: () => useFallback,
  };
})();
