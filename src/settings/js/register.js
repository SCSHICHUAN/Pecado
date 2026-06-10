/**
 * @file register.js
 *
 * 【功能】settings 模块主进程入口：Preferences 窗口、IPC、Volc 用户配置、应用菜单。
 *
 * 【目录】
 *   - register.js           窗口 + IPC 注册
 *   - index.html/css/js   Preferences UI（html/、css/、js/ 目录）
 *   - preload.js          Preferences 窗口 preload
 *   - app-menu.js         应用菜单栏
 *   - volc-user-config.js   Volc 配置读写
 *
 * 【注册】main/js/main.js → register(ipcMain)、setupApplicationMenu(getMainWindowFn)
 *
 * 【对外能力】
 *   - register(ipcMain)
 *   - openSettings(parentWindow?)
 *   - setupApplicationMenu(getMainWindowFn)
 */
const fs = require('fs');
const path = require('path');
const { BrowserWindow, shell } = require('electron');
const { SETTINGS } = require('../../shared/ipc-channels');
const {
  readUserVolcConfig,
  writeUserVolcConfig,
  getUserVolcConfigPath,
  getUserConfigDir,
} = require('./volc-user-config');

const PRELOAD_SCRIPT = path.join(__dirname, 'preload.js');
const SETTINGS_HTML = path.join(__dirname, '..', 'html', 'index.html');

/** @type {import('electron').BrowserWindow | null} */
let settingsWindowRef = null;

function openSettings() {
  if (settingsWindowRef && !settingsWindowRef.isDestroyed()) {
    settingsWindowRef.focus();
    return;
  }

  const win = new BrowserWindow({
    title: 'Preferences',
    width: 720,
    height: 480,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    show: false,
    webPreferences: {
      preload: PRELOAD_SCRIPT,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  settingsWindowRef = win;

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[settings] preload error:', preloadPath, error);
  });

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    settingsWindowRef = null;
  });
  win.loadFile(SETTINGS_HTML);
}

/** @param {import('electron').IpcMain} ipcMain */
/** @param {() => import('electron').BrowserWindow | null} [getMainWindowFn] */
function register(ipcMain, getMainWindowFn) {
  ipcMain.handle(SETTINGS.GET, async () => {
    try {
      const { apiKey, model, volcApiMode, gitGraphCommitLimit } = readUserVolcConfig();
      return {
        ok: true,
        volcArkApiKey: apiKey,
        volcArkModel: model,
        volcApiMode,
        gitGraphCommitLimit,
        configPath: getUserVolcConfigPath(),
        configDir: getUserConfigDir(),
      };
    } catch (e) {
      console.error('[settings] GET failed:', e);
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(SETTINGS.SAVE, async (_event, payload) => {
    try {
      const saved = writeUserVolcConfig(payload || {});
      console.log('[settings] saved:', saved.configPath);
      const mainWin = typeof getMainWindowFn === 'function' ? getMainWindowFn() : null;
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send(SETTINGS.CONFIG_CHANGED, {
          gitGraphCommitLimit: saved.gitGraphCommitLimit,
        });
      }
      return { ok: true, ...saved };
    } catch (e) {
      console.error('[settings] SAVE failed:', e);
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(SETTINGS.OPEN_CONFIG_DIR, async () => {
    try {
      const dir = getUserConfigDir();
      fs.mkdirSync(dir, { recursive: true });
      const err = await shell.openPath(dir);
      if (err) return { ok: false, error: err };
      return { ok: true, configDir: dir };
    } catch (e) {
      console.error('[settings] OPEN_CONFIG_DIR failed:', e);
      return { ok: false, error: e.message || String(e) };
    }
  });
}

module.exports = {
  openSettings,
  register,
  setupApplicationMenu: require('./app-menu').setupApplicationMenu,
};
