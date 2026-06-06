/**
 * @file settings-preload.js
 *
 * 【功能】Preferences 窗口 preload：contextBridge 暴露 window.settingsAPI。
 *
 * 【调用方】settings/index.js → BrowserWindow webPreferences.preload
 *
 * 【对外能力】window.settingsAPI.getConfig() / saveConfig(payload) / openConfigDir()
 */
const { contextBridge, ipcRenderer } = require('electron');
const { SETTINGS } = require('../shared/ipc-channels');

try {
  contextBridge.exposeInMainWorld('settingsAPI', {
    getConfig: () => ipcRenderer.invoke(SETTINGS.GET),
    saveConfig: (payload) => ipcRenderer.invoke(SETTINGS.SAVE, payload),
    openConfigDir: () => ipcRenderer.invoke(SETTINGS.OPEN_CONFIG_DIR),
  });
} catch (error) {
  console.error('[settings-preload] expose settingsAPI failed:', error);
}
