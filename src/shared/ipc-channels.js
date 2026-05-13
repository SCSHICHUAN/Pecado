/** 主进程 ipcMain.handle 与 preload ipcRenderer.invoke 共用，避免通道名不一致 */
module.exports = {
  QQ_MUSIC: {
    OPEN_DESKTOP: 'open-qqmusic',
    OPEN_WEB: 'open-qqmusic-web',
  },
  VOLC_ARK: {
    BOTS_CHAT_COMPLETION: 'volc-ark-bots-chat-completion',
  },
  VOLC_USER_CONFIG: {
    GET: 'volc-user-config-get',
    SET: 'volc-user-config-set',
  },
};
