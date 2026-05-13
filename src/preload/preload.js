const { contextBridge, ipcRenderer } = require('electron');
const { QQ_MUSIC, VOLC_ARK, VOLC_USER_CONFIG } = require('../shared/ipc-channels');

try {
  contextBridge.exposeInMainWorld('electronAPI', {
    openQQMusic: () => ipcRenderer.invoke(QQ_MUSIC.OPEN_DESKTOP),
    openQQMusicWeb: () => ipcRenderer.invoke(QQ_MUSIC.OPEN_WEB),
    volcArkBotsChat: (messages) =>
      ipcRenderer.invoke(VOLC_ARK.BOTS_CHAT_COMPLETION, { messages }),
    volcGetUserConfig: () => ipcRenderer.invoke(VOLC_USER_CONFIG.GET),
    volcSetUserConfig: (data) => ipcRenderer.invoke(VOLC_USER_CONFIG.SET, data),
  });
} catch (error) {
  console.error('Failed to expose electronAPI:', error);
}
