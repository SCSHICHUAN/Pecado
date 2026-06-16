/**
 * @file window-state.js
 *
 * 【功能】主窗口 bounds / 最大化状态持久化（userData/main-window.json）。
 * 【调用方】main/js/main.js → createWindow
 */
const fs = require('fs');
const path = require('path');
const { app, screen } = require('electron');

const MIN_WIDTH = 480;
const MIN_HEIGHT = 400;
const SAVE_DEBOUNCE_MS = 400;

function stateFilePath() {
  return path.join(app.getPath('userData'), 'main-window.json');
}

function defaultBounds() {
  const display = screen.getPrimaryDisplay();
  const { bounds, workArea } = display;
  let width = Math.floor((bounds.width * 2) / 3);
  let height = Math.floor((workArea.height * 8) / 10);
  width = Math.max(MIN_WIDTH, Math.min(width, workArea.width));
  height = Math.max(MIN_HEIGHT, Math.min(height, workArea.height));
  const x = Math.floor(workArea.x + (workArea.width - width) / 2);
  const y = Math.floor(workArea.y + (workArea.height - height) / 2);
  return { x, y, width, height };
}

function normalizeBounds(raw = {}) {
  return {
    x: Math.floor(Number(raw.x) || 0),
    y: Math.floor(Number(raw.y) || 0),
    width: Math.max(MIN_WIDTH, Math.floor(Number(raw.width) || MIN_WIDTH)),
    height: Math.max(MIN_HEIGHT, Math.floor(Number(raw.height) || MIN_HEIGHT)),
  };
}

/** 至少 100×100 像素落在某块屏幕 workArea 内 */
function isBoundsVisible(bounds) {
  for (const display of screen.getAllDisplays()) {
    const wa = display.workArea;
    const overlapW =
      Math.min(bounds.x + bounds.width, wa.x + wa.width) - Math.max(bounds.x, wa.x);
    const overlapH =
      Math.min(bounds.y + bounds.height, wa.y + wa.height) - Math.max(bounds.y, wa.y);
    if (overlapW >= 100 && overlapH >= 100) return true;
  }
  return false;
}

function readSavedWindowState() {
  try {
    const p = stateFilePath();
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!j || typeof j !== 'object') return null;
    const bounds = normalizeBounds(j.bounds || j);
    if (!isBoundsVisible(bounds)) return null;
    return {
      bounds,
      isMaximized: j.isMaximized === true,
    };
  } catch {
    return null;
  }
}

function writeWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const isMaximized = win.isMaximized();
    const bounds = isMaximized && typeof win.getNormalBounds === 'function'
      ? win.getNormalBounds()
      : win.getBounds();
    const payload = {
      bounds: normalizeBounds(bounds),
      isMaximized,
    };
    const p = stateFilePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8');
  } catch (e) {
    console.error('[window-state] save failed:', e);
  }
}

/**
 * @returns {{ bounds: { x: number, y: number, width: number, height: number }, isMaximized: boolean }}
 */
function resolveInitialWindowOptions() {
  const saved = readSavedWindowState();
  if (saved) return saved;
  return { bounds: defaultBounds(), isMaximized: false };
}

/** @param {import('electron').BrowserWindow} win */
function attachWindowStatePersistence(win) {
  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      writeWindowState(win);
    }, SAVE_DEBOUNCE_MS);
  };

  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('maximize', scheduleSave);
  win.on('unmaximize', scheduleSave);
  win.on('close', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    writeWindowState(win);
  });
}

module.exports = {
  resolveInitialWindowOptions,
  attachWindowStatePersistence,
  defaultBounds,
};
