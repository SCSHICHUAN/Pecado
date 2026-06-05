/**
 * @file ipc-channels.js
 *
 * 全项目 IPC 名字的单一数据源（字符串常量）。
 *
 * 主进程：`ipcMain.handle` / `webContents.send`；preload：`ipcRenderer.invoke` / `ipcRenderer.on`。
 * 改通道名时只改此处，避免主进程与 preload 拼写不一致导致静默失败。
 */

module.exports = {
  QQ_MUSIC: {
    /** invoke：{ rawContent } → { displayText } */
    HANDLE_BOT_COMMAND: 'bot-handle-command',
  },
  VOLC_ARK: {
    /** invoke：{ streamId, userText, history }，流中增量见 BOTS_STREAM_EVENT */
    BOTS_CHAT_COMPLETION: 'volc-ark-bots-chat-completion',
    /** main → renderer：{ streamId, phase, text?, error?, name?, path? } */
    BOTS_STREAM_EVENT: 'volc-ark-bots-stream-event',
  },
  MCP_FS: {
    DIRECTORY_TREE: 'mcp-fs-directory-tree',
    /** main → renderer：用户通过菜单 Open Folder 后推送 */
    PROJECT_CHANGED: 'mcp-fs-project-changed',
  },
};
