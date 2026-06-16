/**
 * @file resizer.js
 * CodX 面板拖拽：目录区左右、Pecado/log 区上下
 */
(function () {
  const SIDEBAR_KEY = 'codx.sidebarWidth';
  const DOCK_KEY = 'codx.dockHeight';
  const SIDEBAR_MIN = 160;
  const SIDEBAR_MAX = 520;
  const DOCK_MIN = 120;
  const EDITOR_MIN = 72;
  let dockRestoreHeight = null;

  function $(id) {
    return document.getElementById(id);
  }

  function readNumber(key, fallback) {
    try {
      const n = Number(localStorage.getItem(key));
      return Number.isFinite(n) && n > 0 ? n : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeNumber(key, value) {
    try {
      localStorage.setItem(key, String(Math.round(value)));
    } catch (_) {
      /* ignore */
    }
  }

  function setSidebarWidth(px) {
    const shell = $('codx-shell');
    if (!shell) return;
    const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, px));
    shell.style.setProperty('--codx-sidebar-width', `${w}px`);
    writeNumber(SIDEBAR_KEY, w);
    window.CodXEditor?.layout?.();
  }

  function getSidebarWidth() {
    const shell = $('codx-shell');
    if (!shell) return 240;
    const raw = getComputedStyle(shell).getPropertyValue('--codx-sidebar-width').trim();
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 240;
  }

  function dockAnchor() {
    return $('codx-bottom-bar-anchor');
  }

  function getToolbarHeight() {
    const bar = document.querySelector('.codx-bottom-bar-anchor > .app-bottom-bar');
    return bar?.offsetHeight || 34;
  }

  /** log/Pecado 最高可覆盖编辑区（保留最小编辑区 EDITOR_MIN） */
  function getDockMaxHeight() {
    const shell = $('codx-shell');
    const barH = getToolbarHeight();
    if (shell?.clientHeight) {
      return Math.max(DOCK_MIN, shell.clientHeight - barH - EDITOR_MIN);
    }
    const winH = getWindowHeight();
    if (winH > 0) {
      return Math.max(DOCK_MIN, winH - barH - EDITOR_MIN);
    }
    return 480;
  }

  function isDockMaximized() {
    return dockAnchor()?.classList.contains('is-dock-maximized') ?? false;
  }

  function syncMaximizeButton() {
    const btn = $('codx-dock-maximize');
    if (!btn) return;
    const maxed = isDockMaximized();
    btn.textContent = maxed ? '还原' : '最大';
    btn.title = maxed ? '还原面板高度' : '最大化面板';
  }

  function toggleDockMaximize() {
    const anchor = dockAnchor();
    if (!anchor) return;
    if (isDockMaximized()) {
      anchor.classList.remove('is-dock-maximized');
      setDockHeight(dockRestoreHeight || getDefaultDockHeight());
      dockRestoreHeight = null;
    } else {
      dockRestoreHeight = getDockHeight();
      anchor.classList.add('is-dock-maximized');
      setDockHeight(getDockMaxHeight());
    }
    syncMaximizeButton();
  }

  function getWindowHeight() {
    return window.innerHeight || document.documentElement?.clientHeight || 0;
  }

  function setDockHeight(px) {
    const anchor = dockAnchor();
    if (!anchor) return;
    const max = getDockMaxHeight();
    const h = Math.min(max, Math.max(DOCK_MIN, px));
    if (isDockMaximized() && h < max - 2) {
      anchor.classList.remove('is-dock-maximized');
      dockRestoreHeight = null;
    }
    anchor.style.setProperty('--codx-dock-height', `${h}px`);
    writeNumber(DOCK_KEY, h);
    syncMaximizeButton();
    window.CodXEditor?.layout?.();
  }

  function getDefaultDockHeight() {
    const winH = getWindowHeight();
    if (winH > 0) {
      const target = Math.max(DOCK_MIN, Math.round(winH / 3));
      return Math.min(getDockMaxHeight(), target);
    }
    return 220;
  }

  function hasStoredDockHeight() {
    try {
      const n = Number(localStorage.getItem(DOCK_KEY));
      return Number.isFinite(n) && n > 0;
    } catch (_) {
      return false;
    }
  }

  function ensureDefaultDockHeight() {
    if (hasStoredDockHeight()) return;
    setDockHeight(getDefaultDockHeight());
  }

  /** 点击展开底栏：高度 = 窗口 1/3 */
  function applyPopupDockHeight() {
    setDockHeight(getDefaultDockHeight());
  }

  function getDockHeight() {
    const anchor = dockAnchor();
    if (!anchor) return getDefaultDockHeight();
    const raw = getComputedStyle(anchor).getPropertyValue('--codx-dock-height').trim();
    const n = parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : getDefaultDockHeight();
  }

  function bindColResizer(handle, onResize) {
    if (!handle) return;
    let startX = 0;
    let startVal = 0;

    const onMove = (e) => {
      onResize(startVal + (e.clientX - startX));
    };

    const onUp = () => {
      handle.classList.remove('is-dragging');
      document.body.classList.remove('codx-resizing-v');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startX = e.clientX;
      startVal = getSidebarWidth();
      handle.classList.add('is-dragging');
      document.body.classList.add('codx-resizing-v');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function bindRowResizer(handle, onResize) {
    if (!handle) return;
    let startY = 0;
    let startVal = 0;

    const onMove = (e) => {
      onResize(startVal + (startY - e.clientY));
    };

    const onUp = () => {
      handle.classList.remove('is-dragging');
      document.body.classList.remove('codx-resizing-h');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      window.CodXEditor?.layout?.();
    };

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if ($('codx-bottom-bar-anchor')?.classList.contains('is-dock-collapsed')) return;
      e.preventDefault();
      startY = e.clientY;
      startVal = getDockHeight();
      handle.classList.add('is-dragging');
      document.body.classList.add('codx-resizing-h');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function applyStoredSizes() {
    setSidebarWidth(readNumber(SIDEBAR_KEY, getSidebarWidth()));
    const dockFallback = hasStoredDockHeight() ? getDockHeight() : getDefaultDockHeight();
    setDockHeight(readNumber(DOCK_KEY, dockFallback));
  }

  function bind() {
    applyStoredSizes();
    bindColResizer($('codx-resizer-sidebar'), setSidebarWidth);
    bindRowResizer($('codx-resizer-dock'), setDockHeight);
    window.addEventListener('resize', () => {
      if (isDockMaximized()) {
        setDockHeight(getDockMaxHeight());
      } else {
        const h = getDockHeight();
        if (h > getDockMaxHeight()) setDockHeight(getDockMaxHeight());
      }
    });
    syncMaximizeButton();
  }

  window.CodXResizer = {
    bind,
    setSidebarWidth,
    setDockHeight,
    ensureDefaultDockHeight,
    applyPopupDockHeight,
    toggleDockMaximize,
    syncMaximizeButton,
    isDockMaximized,
  };
})();
