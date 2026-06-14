/**
 * @file preview-preload.js
 * 【功能】预览窗口 preload：接收正文、打开 Finder
 */
const { contextBridge, ipcRenderer } = require('electron');
const { SKILL, MCP_FS } = require('../../shared/ipc-channels');

contextBridge.exposeInMainWorld('previewAPI', {
  onContent: (callback) => {
    const ch = SKILL.PREVIEW_CONTENT;
    const fn = (_evt, payload) => {
      try {
        callback(payload);
      } catch (e) {
        console.error('[preview-preload] onContent', e);
      }
    };
    ipcRenderer.on(ch, fn);
    return () => ipcRenderer.removeListener(ch, fn);
  },
  openInFinder: (filePath) => ipcRenderer.invoke(MCP_FS.OPEN_PATH, { path: filePath }),
});
