/**
 * @file index.js
 * CodX 编程视图：文件树 + Monaco + Pecado/log 底栏
 */
(function () {
  let active = false;
  let projectRoot = '';
  let lastCodxProjectRoot = '';
  let dockOpen = false;
  let dockTab = 'pecado';
  let dockSideLayout = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let treeRefreshTimer = null;
  const DOCK_SIDE_LAYOUT_KEY = 'codx.dockSideLayout';
  const DOCK_OPEN_KEY = 'codx.dockOpen';
  const DOCK_TAB_KEY = 'codx.dockTab';
  const PANEL_OPEN_KEY = 'codx.panelOpen';
  const PREV_VIEW_KEY = 'codx.prevView';
  let restoringSession = false;
  /** @type {Map<string, string>} relPath → stream buffer for deferred disk write */
  const deferredDisk = new Map();
  /** @type {Promise<void> | null} */
  let initPromise = null;
  const bottomBarHome = { parent: null, next: null };

  function captureBottomBarHome() {
    const bar = document.querySelector('footer.app-bottom-bar');
    if (!bar || bottomBarHome.parent) return;
    bottomBarHome.parent = bar.parentElement;
    bottomBarHome.next = bar.nextElementSibling;
  }

  function mountCodxBottomBar() {
    const bar = document.querySelector('footer.app-bottom-bar');
    const anchor = $('codx-bottom-bar-anchor');
    const dock = $('codx-dock');
    if (!bar || !anchor) return;
    captureBottomBarHome();
    if (dock && dock.parentElement !== anchor) {
      anchor.insertBefore(dock, anchor.firstChild);
    }
    bar.hidden = false;
    bar.removeAttribute('hidden');
    bar.style.display = 'flex';
    anchor.appendChild(bar);
  }

  function restoreBottomBar() {
    const bar = document.querySelector('footer.app-bottom-bar');
    if (!bar || !bottomBarHome.parent) return;
    bar.hidden = false;
    bar.removeAttribute('hidden');
    bar.style.display = '';
    if (bottomBarHome.next) {
      bottomBarHome.parent.insertBefore(bar, bottomBarHome.next);
    } else {
      bottomBarHome.parent.appendChild(bar);
    }
  }

  function $(id) {
    return document.getElementById(id);
  }

  function getApi() {
    return window.electronAPI;
  }

  function isActive() {
    return active;
  }

  function resetCodxSession() {
    window.CodXEditor?.resetAll?.();
    window.CodXFileTree?.clearActivePath?.();
    window.CodXChat?.resetHistory?.();
    deferredDisk.clear();
  }

  function syncCodxBtnUi() {
    const btn = $('pecado-codx-btn');
    if (!btn) return;
    if (active) {
      btn.textContent = '关闭编程';
      btn.title = '退出 CodX 代码编辑器';
      btn.setAttribute('aria-label', '关闭编程');
      btn.classList.add('is-active');
    } else {
      btn.textContent = '打开编程';
      btn.title = 'CodX 代码编辑器';
      btn.setAttribute('aria-label', '打开编程');
      btn.classList.remove('is-active');
    }
  }

  async function loadSettings() {
    const api = getApi();
    if (!api?.getAppSettings) return;
    try {
      const cfg = await api.getAppSettings();
      if (cfg?.ok) {
        if (cfg.codxEditorTheme) {
          window.CodXEditor?.setEditorTheme?.(cfg.codxEditorTheme);
        }
        window.CodXEditor?.setEditorTypography?.({
          lineHeight: cfg.codxEditorLineHeight,
          letterSpacing: cfg.codxEditorLetterSpacing,
          spaceWidth: cfg.codxEditorSpaceWidth,
          tabSize: cfg.codxEditorTabSize,
        });
        if (cfg.codxEditorFontSize != null) {
          window.CodXEditor?.setEditorFontSize?.(cfg.codxEditorFontSize);
        }
        applyCodxLineNumberSettings(cfg);
      }
    } catch (_) {
      /* ignore */
    }
  }

  function applyCodxLineNumberSettings(cfg) {
    if (!cfg) return;
    if (
      'codxEditorLineNumbers' in cfg ||
      'codxEditorLineNumberMinChars' in cfg ||
      'codxEditorLineNumberFontSize' in cfg ||
      'codxEditorLineNumberFontWeight' in cfg
    ) {
      window.CodXEditor?.setEditorLineNumbers?.({
        mode: cfg.codxEditorLineNumbers,
        minChars: cfg.codxEditorLineNumberMinChars,
        fontSize: cfg.codxEditorLineNumberFontSize,
        fontWeight: cfg.codxEditorLineNumberFontWeight,
      });
    }
  }

  function applyEditorSettingsFromConfig(cfg) {
    if (!cfg) return;
    if (cfg.codxEditorTheme) {
      window.CodXEditor?.setEditorTheme?.(cfg.codxEditorTheme);
    }
    if (
      'codxEditorLineHeight' in cfg ||
      'codxEditorLetterSpacing' in cfg ||
      'codxEditorSpaceWidth' in cfg ||
      'codxEditorTabSize' in cfg
    ) {
      window.CodXEditor?.setEditorTypography?.({
        lineHeight: cfg.codxEditorLineHeight,
        letterSpacing: cfg.codxEditorLetterSpacing,
        spaceWidth: cfg.codxEditorSpaceWidth,
        tabSize: cfg.codxEditorTabSize,
      });
    }
    if ('codxEditorFontSize' in cfg) {
      window.CodXEditor?.setEditorFontSize?.(cfg.codxEditorFontSize);
    }
    applyCodxLineNumberSettings(cfg);
  }

  let fontSizeSaveTimer = null;

  function schedulePersistFontSize() {
    clearTimeout(fontSizeSaveTimer);
    fontSizeSaveTimer = setTimeout(() => {
      const size = window.CodXEditor?.getEditorFontSize?.() ?? 0;
      getApi()
        ?.saveAppSettings?.({ codxEditorFontSize: size })
        .catch(() => {});
    }, 400);
  }

  function codxFontZoomDelta(e) {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return 0;
    if (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') return 1;
    if (e.key === '-' || e.code === 'Minus' || e.code === 'NumpadSubtract') return -1;
    return 0;
  }

  function shouldIgnoreCodxFontZoom(e) {
    const el = e.target;
    if (!el || typeof el.closest !== 'function') return false;
    return Boolean(el.closest('#codx-chat-input, .codx-chat-composer, .codx-chat-panel textarea'));
  }

  async function syncProjectRootFromTree(res) {
    if (res?.projectRoot) {
      projectRoot = String(res.projectRoot);
    }
  }

  function projectNameFromRoot(root) {
    if (!root) return '未打开工程';
    const name = String(root).split(/[/\\]/).filter(Boolean).pop();
    return name || String(root);
  }

  function syncProjectHead() {
    const head = $('codx-project-head');
    if (!head) return;
    head.textContent = projectNameFromRoot(projectRoot);
    head.title = projectRoot
      ? `${projectRoot}\n点击在 Finder 中打开`
      : '未打开工程';
  }

  async function openProjectInFinder() {
    const api = getApi();
    if (!api?.mcpFsOpenProjectRoot) return;
    try {
      const res = await api.mcpFsOpenProjectRoot(
        projectRoot ? { projectRoot } : {}
      );
      if (!res?.ok && res?.error) console.warn('[CodX] open project root:', res.error);
    } catch (e) {
      console.error('[CodX] open project root failed', e);
    }
  }

  async function refreshTree(opts = {}) {
    const api = getApi();
    const treeEl = $('codx-file-tree');
    if (!api?.mcpFsDirectoryTree || !treeEl) return;
    const res = await api.mcpFsDirectoryTree({ directoriesOnly: false });
    if (res.error) {
      treeEl.textContent = `读取目录失败：${res.error}`;
      return;
    }
    await syncProjectRootFromTree(res);
    syncProjectHead();
    window.CodXFileTree?.renderFileTree?.(treeEl, res.tree, (relPath) => {
      openFileByRelPath(relPath).catch(console.error);
    }, projectRoot);

    if (opts.revealPath) {
      window.CodXFileTree?.revealPath?.(opts.revealPath, projectRoot);
    }

    if (!opts.skipReopen) {
      const savedPath = window.CodXFileTree?.getSavedSelectedPath?.(projectRoot);
      if (savedPath) {
        await openFileByRelPath(savedPath);
      }
    }
  }

  function scheduleTreeRefresh(opts = {}) {
    if (!active) return;
    if (treeRefreshTimer) clearTimeout(treeRefreshTimer);
    treeRefreshTimer = setTimeout(() => {
      treeRefreshTimer = null;
      refreshTree({ skipReopen: true, ...opts }).catch(console.error);
    }, 280);
  }

  function readDockSidePref() {
    try {
      return localStorage.getItem(DOCK_SIDE_LAYOUT_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function writeDockSidePref(on) {
    try {
      localStorage.setItem(DOCK_SIDE_LAYOUT_KEY, on ? '1' : '0');
    } catch (_) {
      /* ignore */
    }
  }

  function readDockOpenPref() {
    try {
      const v = localStorage.getItem(DOCK_OPEN_KEY);
      if (v === null) return false;
      return v !== '0';
    } catch (_) {
      return false;
    }
  }

  function writeDockOpenPref(open) {
    try {
      localStorage.setItem(DOCK_OPEN_KEY, open ? '1' : '0');
    } catch (_) {
      /* ignore */
    }
  }

  function readDockTabPref() {
    try {
      const tab = String(localStorage.getItem(DOCK_TAB_KEY) || '').trim();
      return tab === 'log' ? 'log' : 'pecado';
    } catch (_) {
      return 'pecado';
    }
  }

  function writeDockTabPref(tab) {
    try {
      localStorage.setItem(DOCK_TAB_KEY, tab === 'log' ? 'log' : 'pecado');
    } catch (_) {
      /* ignore */
    }
  }

  function readPanelOpenPref() {
    try {
      return localStorage.getItem(PANEL_OPEN_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function writePanelOpenPref(open) {
    try {
      localStorage.setItem(PANEL_OPEN_KEY, open ? '1' : '0');
    } catch (_) {
      /* ignore */
    }
  }

  function readPrevViewPref() {
    try {
      const view = String(localStorage.getItem(PREV_VIEW_KEY) || '').trim();
      if (view === 'git' || view === 'workflow' || view === 'chat') return view;
    } catch (_) {
      /* ignore */
    }
    return 'chat';
  }

  function writePrevViewPref(view) {
    try {
      const v = view === 'git' || view === 'workflow' ? view : 'chat';
      localStorage.setItem(PREV_VIEW_KEY, v);
    } catch (_) {
      /* ignore */
    }
  }

  function resolvePrevView() {
    if (document.body.classList.contains('app-view-git')) return 'git';
    if (document.body.classList.contains('app-view-workflow')) return 'workflow';
    return 'chat';
  }

  function persistCodxSessionPrefs() {
    writeDockSidePref(dockSideLayout);
    writeDockOpenPref(dockSideLayout ? true : dockOpen);
    writeDockTabPref(dockTab);
  }

  function syncDockSideUi() {
    const shell = $('codx-shell');
    shell?.classList.toggle('is-dock-side', dockSideLayout);
    document.body.classList.toggle('codx-dock-side-layout', dockSideLayout && active);
    const btn = $('codx-dock-side-toggle');
    if (btn) {
      btn.classList.toggle('is-on', dockSideLayout);
      btn.title = dockSideLayout ? '关闭右侧分区' : '打开右侧分区';
      btn.setAttribute('aria-label', dockSideLayout ? '关闭右侧分区' : '打开右侧分区');
      btn.setAttribute('aria-pressed', dockSideLayout ? 'true' : 'false');
    }
    const maxBtn = $('codx-dock-maximize');
    if (maxBtn) {
      maxBtn.hidden = dockSideLayout;
      maxBtn.style.display = dockSideLayout ? 'none' : '';
    }
    syncDockToggle();
    scheduleEditorLayout();
  }

  function toggleDockSideLayout() {
    dockSideLayout = !dockSideLayout;
    if (dockSideLayout) {
      setDockOpen(true, { skipPersist: true });
      $('codx-bottom-bar-anchor')?.classList.remove('is-dock-maximized');
      window.CodXResizer?.syncMaximizeButton?.();
    } else {
      setDockOpen(false, { skipPersist: true });
    }
    syncDockSideUi();
    persistCodxSessionPrefs();
  }

  function scheduleEditorLayout() {
    requestAnimationFrame(() => {
      window.CodXEditor?.layout?.();
      requestAnimationFrame(() => window.CodXEditor?.layout?.());
    });
  }

  async function ensureReady() {
    if (initPromise) await initPromise;
  }

  async function openFileByRelPath(relPath) {
    try {
      await ensureEditor();
    } catch (e) {
      console.error('[CodX] editor init failed', e);
      alert(`编辑器初始化失败：${e?.message || e}`);
      return;
    }
    const api = getApi();
    const rel = String(relPath || '')
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/^\/+/, '');
    if (!rel) return;

    const openFiles = window.CodXEditor?.getOpenFiles?.();
    if (openFiles?.has(rel)) {
      window.CodXFileTree?.setActivePath?.(rel);
      window.CodXEditor?.switchToFile?.(rel);
      scheduleEditorLayout();
      return;
    }

    if (window.CodXPreview?.isPreviewPath?.(rel)) {
      if (!api?.mcpFsPreviewFile) {
        alert('预览 API 不可用，请重启应用');
        return;
      }
      const res = await api.mcpFsPreviewFile({ path: rel });
      if (!res?.ok) {
        window.CodXLog?.append?.({ method: 'preview', output: res?.error || '预览失败', isError: true });
        alert(`无法预览文件：${res?.error || '预览失败'}`);
        return;
      }
      window.CodXFileTree?.setActivePath?.(rel);
      window.CodXEditor?.openPreview?.(rel, res);
      scheduleEditorLayout();
      return;
    }

    if (!api?.mcpFsReadTextFile) {
      alert('文件读取 API 不可用，请重启应用');
      return;
    }

    const res = await api.mcpFsReadTextFile({ path: rel });
    if (!res.ok) {
      window.CodXLog?.append?.({ method: 'read', output: res.error || '读取失败', isError: true });
      alert(`无法打开文件：${res.error || '读取失败'}`);
      return;
    }
    window.CodXFileTree?.setActivePath?.(rel);
    window.CodXEditor?.openFile?.(rel, res.body || '');
    scheduleEditorLayout();
  }

  async function saveActiveFile() {
    const api = getApi();
    const { relPath, content } = window.CodXEditor?.getActiveContent?.() || {};
    if (!relPath || !api?.mcpFsWriteTextFile) return;
    const res = await api.mcpFsWriteTextFile({ path: relPath, content });
    if (res?.ok) {
      window.CodXEditor?.markSaved?.(relPath);
      deferredDisk.delete(relPath);
      window.CodXLog?.append?.({ method: 'save', output: `已保存 ${relPath}` });
      scheduleTreeRefresh({ revealPath: relPath });
    } else {
      window.CodXLog?.append?.({ method: 'save', output: res?.error || '保存失败', isError: true });
    }
  }

  function setDockOpen(open, opts = {}) {
    const wasCollapsed = !dockOpen;
    dockOpen = Boolean(open);
    $('codx-bottom-bar-anchor')?.classList.toggle('is-dock-collapsed', !dockOpen);
    if (dockOpen && wasCollapsed) {
      requestAnimationFrame(() => {
        window.CodXResizer?.applyPopupDockHeight?.();
        window.CodXEditor?.layout?.();
      });
    }
    syncDockToggle();
    scheduleEditorLayout();
    if (!opts.skipPersist && active && !restoringSession) {
      persistCodxSessionPrefs();
    }
  }

  function syncDockToggle() {
    if (typeof window.__syncAppBottomDockToggle === 'function') {
      window.__syncAppBottomDockToggle();
    }
  }

  function setDockTab(tab, opts = {}) {
    dockTab = tab === 'log' ? 'log' : 'pecado';
    document.querySelectorAll('.codx-dock-tab').forEach((el) => {
      const on = el.dataset.codxDockTab === dockTab;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('codx-dock-pecado')?.classList.toggle('hidden', dockTab !== 'pecado');
    $('codx-dock-log')?.classList.toggle('hidden', dockTab !== 'log');
    if (dockTab === 'log') {
      requestAnimationFrame(() => {
        window.CodXLog?.onLogTabShown?.();
      });
    }
    if (!opts.skipPersist && active && !restoringSession) {
      persistCodxSessionPrefs();
    }
  }

  function revealDock(tab) {
    setDockTab(tab || 'pecado');
    setDockOpen(true);
  }

  async function enter(prevView = 'chat') {
    await ensureReady();
    writePanelOpenPref(true);
    writePrevViewPref(prevView);
    document.body.dataset.codxPrevView = prevView;
    active = true;
    document.body.classList.add('app-view-codx');
    document.body.classList.remove('app-view-chat', 'app-view-git', 'app-view-workflow');
    $('panel-chat')?.classList.add('hidden');
    $('panel-workflow')?.classList.add('hidden');
    $('panel-git')?.classList.add('hidden');
    $('panel-codx')?.classList.remove('hidden');
    document.querySelector('.sidebar')?.classList.add('hidden');
    document.querySelector('.main-column')?.classList.add('codx-full-width');
    mountCodxBottomBar();
    restoringSession = true;
    dockSideLayout = readDockSidePref();
    dockTab = readDockTabPref();
    syncDockSideUi();
    setDockTab(dockTab, { skipPersist: true });
    setDockOpen(dockSideLayout || readDockOpenPref(), { skipPersist: true });
    restoringSession = false;
    syncDockToggle();
    await ensureEditor();
    refreshTree().catch(console.error);
    scheduleEditorLayout();
    requestAnimationFrame(() => {
      window.CodXEditor?.layout?.();
    });
    syncDockToggle();
    syncCodxBtnUi();
  }

  function exit() {
    persistCodxSessionPrefs();
    writePanelOpenPref(false);
    document.body.classList.remove('codx-dock-side-layout');
    active = false;
    const prev = document.body.dataset.codxPrevView || 'chat';
    document.body.classList.remove('app-view-codx');
    document.querySelector('.sidebar')?.classList.remove('hidden');
    document.querySelector('.main-column')?.classList.remove('codx-full-width');
    $('panel-codx')?.classList.add('hidden');
    restoreBottomBar();
    document.body.classList.add(`app-view-${prev}`);
    if (prev === 'chat') $('panel-chat')?.classList.remove('hidden');
    if (prev === 'git') $('panel-git')?.classList.remove('hidden');
    if (prev === 'workflow') $('panel-workflow')?.classList.remove('hidden');
    window.CodXStreamBridge?.reset?.();
    deferredDisk.clear();
    syncDockToggle();
    if (typeof window.__setMainPanelVisible === 'function') {
      window.__setMainPanelVisible(prev);
    }
    syncCodxBtnUi();
  }

  async function tryOpenCodx(opts = {}) {
    const { prevView, silent = false } = opts;
    if (active) return true;
    await ensureReady();
    const api = getApi();
    const tree = await api?.mcpFsDirectoryTree?.({ directoriesOnly: false });
    if (tree?.error) {
      if (!silent) alert('请先 File → Open Folder 打开工程');
      return false;
    }
    await syncProjectRootFromTree(tree);
    syncProjectHead();
    if (lastCodxProjectRoot && lastCodxProjectRoot !== projectRoot) {
      resetCodxSession();
    }
    lastCodxProjectRoot = projectRoot;
    const prev = prevView || resolvePrevView();
    await enter(prev);
    return true;
  }

  async function maybeRestoreCodxPanel() {
    if (!readPanelOpenPref()) return;
    try {
      await tryOpenCodx({ prevView: readPrevViewPref(), silent: true });
    } catch (e) {
      console.error('[CodX] restore panel failed', e);
    }
  }

  async function writeFileToXcode(relPath, content) {
    const api = getApi();
    if (!relPath || !api?.mcpFsWriteTextFile) return false;
    const res = await api.mcpFsWriteTextFile({ path: relPath, content });
    if (res?.ok) {
      window.CodXEditor?.markAcceptedWrite?.(relPath);
      deferredDisk.delete(relPath);
      window.CodXLog?.append?.({ method: 'sync', output: `已写入 Xcode：${relPath}` });
      scheduleTreeRefresh({ revealPath: relPath });
      return true;
    }
    window.CodXLog?.append?.({
      method: 'sync',
      output: res?.error || `写入失败：${relPath}`,
      isError: true,
    });
    return false;
  }

  async function syncAllToXcode() {
    const items = window.CodXEditor?.getPendingWrites?.() || [];
    if (!items.length) return;
    let ok = 0;
    for (const item of items) {
      if (await writeFileToXcode(item.relPath, item.content)) ok += 1;
    }
    if (ok > 0) {
      window.CodXLog?.append?.({ method: 'sync', output: `已同步 ${ok} 个文件到 Xcode` });
    }
    window.CodXEditor?.syncToolbarUi?.();
  }

  function bindUi() {
    document.querySelectorAll('.codx-dock-tab').forEach((tab) => {
      tab.addEventListener('click', () => revealDock(tab.dataset.codxDockTab));
    });

    $('codx-dock-maximize')?.addEventListener('click', () => {
      setDockOpen(true);
      window.CodXResizer?.toggleDockMaximize?.();
    });

    $('codx-dock-side-toggle')?.addEventListener('click', () => {
      toggleDockSideLayout();
    });

    $('codx-project-head')?.addEventListener('click', () => {
      openProjectInFinder().catch(console.error);
    });

    document.addEventListener('keydown', (e) => {
      if (!active) return;
      const zoom = codxFontZoomDelta(e);
      if (zoom) {
        if (!shouldIgnoreCodxFontZoom(e)) {
          e.preventDefault();
          window.CodXEditor?.adjustEditorFontSize?.(zoom);
          schedulePersistFontSize();
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        saveActiveFile().catch(console.error);
      }
    });

    const api = getApi();
    api?.onMcpFsProjectChanged?.(({ projectRoot: root }) => {
      if (root) {
        const prev = projectRoot;
        projectRoot = root;
        syncProjectHead();
        if (active && prev && prev !== root) {
          resetCodxSession();
        }
        if (active) {
          refreshTree().catch(console.error);
        } else if (readPanelOpenPref()) {
          tryOpenCodx({ prevView: readPrevViewPref(), silent: true }).catch(console.error);
        }
      }
    });

    api?.onSettingsConfigChanged?.((cfg) => {
      applyEditorSettingsFromConfig(cfg);
    });
  }

  async function initCore() {
    await loadSettings();
    captureBottomBarHome();
    window.CodXChat?.bind?.();
    window.CodXStreamBridge?.bind?.();
    try {
      window.CodXResizer?.bind?.();
    } catch (e) {
      console.error('[CodX] resizer bind failed', e);
    }
    bindUi();
  }

  async function ensureEditor() {
    await ensureReady();
    await loadSettings();
    await window.CodXEditor?.init?.({});
    window.CodXEditor?.updateEmptyState?.();
    scheduleEditorLayout();
  }

  async function init() {
    try {
      initPromise = initCore();
      await initPromise;
    } catch (e) {
      console.error('[CodX] init failed', e);
      initPromise = Promise.resolve();
    }

    $('pecado-codx-btn')?.addEventListener('click', async () => {
      try {
        if (active) {
          exit();
          return;
        }
        await tryOpenCodx({ prevView: resolvePrevView() });
      } catch (e) {
        console.error('[CodX] enter failed', e);
        alert(`编程视图打开失败：${e?.message || e}`);
      }
    });

    $('pecado-codx-git-btn')?.addEventListener('click', () => {
      if (!active) return;
      window.__enterGitFocusFromCodx?.()?.catch?.((e) => {
        console.error('[CodX] git focus failed', e);
      });
    });

    syncCodxBtnUi();
    maybeRestoreCodxPanel().catch(console.error);
  }

  window.CodX = {
    init,
    enter,
    exit,
    isActive,
    getProjectRoot: () => projectRoot,
    revealDock,
    isDockOpen: () => dockOpen,
    toggleDock: () => setDockOpen(!dockOpen),
    setDockOpen,
    refreshTree,
    scheduleTreeRefresh,
    saveActiveFile,
    syncAllToXcode,
  };

  window.__codxDockOpen = () => dockOpen && active;
  window.__codxDockSideLayout = () => dockSideLayout && active;
  window.__codxToggleDock = () => {
    if (active && dockSideLayout) return;
    if (active) setDockOpen(!dockOpen);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init().catch(console.error));
  } else {
    init().catch(console.error);
  }
})();
