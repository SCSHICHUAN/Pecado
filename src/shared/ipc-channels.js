/**
 * @file ipc-channels.js
 *
 * 全项目 IPC 名字的单一数据源（字符串常量）。
 *
 * 主进程：`ipcMain.handle` / `webContents.send`；preload：`ipcRenderer.invoke` / `ipcRenderer.on`。
 * 改通道名时只改此处，避免主进程与 preload 拼写不一致导致静默失败。
 *
 * - QQ_MUSIC：打开桌面/Web QQ 音乐
 * - VOLC_ARK：豆包流式 completion + 增量 stream 推送
 * - VOLC_USER_CONFIG：方舟 apiKey/model 在用户数据目录中的读写
 */

module.exports = {
  QQ_MUSIC: {
    OPEN_DESKTOP: 'open-qqmusic',
    OPEN_WEB: 'open-qqmusic-web',
  },
  VOLC_ARK: {
    /** invoke：{ messages, streamId }，流中增量见 BOTS_STREAM_EVENT */
    BOTS_CHAT_COMPLETION: 'volc-ark-bots-chat-completion',
    /** main → renderer：{ streamId, phase: 'delta'|'error', text?, error? } */
    BOTS_STREAM_EVENT: 'volc-ark-bots-stream-event',
  },
  VOLC_USER_CONFIG: {
    GET: 'volc-user-config-get',
    SET: 'volc-user-config-set',
  },
};
