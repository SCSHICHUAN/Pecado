/**
 * @file register.js
 *
 * Preferences 窗口、SETTINGS IPC、LLM 配置读写入口；并 re-export 应用菜单。
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
  LLM_PRESETS,
  validateVolcConfig,
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
    width: 760,
    height: 560,
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
      const cfg = readUserVolcConfig();
      return {
        ok: true,
        llmProviders: cfg.llmProviders,
        activeLlmProviderId: cfg.activeLlmProviderId,
        llmProfiles: cfg.llmProfiles,
        activeLlmProfileId: cfg.activeLlmProfileId,
        llmBaseUrl: cfg.llmBaseUrl,
        llmPath: cfg.llmPath,
        llmApiType: cfg.llmPath,
        llmModel: cfg.model,
        llmApiKey: cfg.apiKey,
        llmName: cfg.llmName,
        llmPaths: cfg.llmPaths,
        llmModels: cfg.llmModels,
        llmPresets: LLM_PRESETS,
        gitGraphCommitLimit: cfg.gitGraphCommitLimit,
        codxEditorTheme: cfg.codxEditorTheme,
        codxEditorLineHeight: cfg.codxEditorLineHeight,
        codxEditorLetterSpacing: cfg.codxEditorLetterSpacing,
        codxEditorSpaceWidth: cfg.codxEditorSpaceWidth,
        codxEditorTabSize: cfg.codxEditorTabSize,
        codxEditorFontSize: cfg.codxEditorFontSize,
        codxEditorLineNumbers: cfg.codxEditorLineNumbers,
        codxEditorLineNumberMinChars: cfg.codxEditorLineNumberMinChars,
        codxEditorLineNumberFontSize: cfg.codxEditorLineNumberFontSize,
        codxEditorLineNumberFontWeight: cfg.codxEditorLineNumberFontWeight,
        codxDesignDepth: cfg.codxDesignDepth,
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
      const body = payload || {};
      const mode = String(body.llmSaveMode || '').trim();
      const isDelete =
        mode === 'delete-provider' || mode === 'delete-path' || mode === 'delete-model';
      if (!isDelete && (mode === 'add' || body.llmBaseUrl != null || body.llmApiKey != null)) {
        const check = validateVolcConfig(body);
        if (!check.ok) return check;
      }
      const saved = writeUserVolcConfig(body);
      console.log('[settings] saved:', saved.configPath);
      const mainWin = typeof getMainWindowFn === 'function' ? getMainWindowFn() : null;
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send(SETTINGS.CONFIG_CHANGED, {
          gitGraphCommitLimit: saved.gitGraphCommitLimit,
          codxEditorTheme: saved.codxEditorTheme,
          codxEditorLineHeight: saved.codxEditorLineHeight,
          codxEditorLetterSpacing: saved.codxEditorLetterSpacing,
          codxEditorSpaceWidth: saved.codxEditorSpaceWidth,
          codxEditorTabSize: saved.codxEditorTabSize,
          codxEditorFontSize: saved.codxEditorFontSize,
          codxEditorLineNumbers: saved.codxEditorLineNumbers,
          codxEditorLineNumberMinChars: saved.codxEditorLineNumberMinChars,
          codxEditorLineNumberFontSize: saved.codxEditorLineNumberFontSize,
          codxEditorLineNumberFontWeight: saved.codxEditorLineNumberFontWeight,
          codxDesignDepth: saved.codxDesignDepth,
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
      const filePath = getUserVolcConfigPath();
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(filePath)) {
        shell.showItemInFolder(filePath);
      } else {
        const err = await shell.openPath(dir);
        if (err) return { ok: false, error: err };
      }
      return { ok: true, configDir: dir, configPath: filePath };
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
