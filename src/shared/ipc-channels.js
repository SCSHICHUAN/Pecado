/**
 * @file ipc-channels.js
 *
 * 【功能】全项目 IPC 通道名字符串的单一数据源。
 *   - VOLC_ARK：流式对话 invoke + 主→渲染 stream event
 *   - QQ_MUSIC：助手 JSON 指令后置处理（历史命名）
 *   - MCP_FS：目录树 invoke + Open Folder 后 project changed 推送
 *   - SETTINGS：Preferences 窗口 get/save（settings/settings-preload.js）
 *
 * 【调用方】
 *   preload/preload.js、settings/settings-preload.js
 *   main/agent/router.js、stream-ui.js、agent-commands.js
 *   main/mcp-filesystem/ipc.js、settings/index.js
 */
module.exports = {
  SETTINGS: {
    GET: 'settings-get',
    SAVE: 'settings-save',
    OPEN_CONFIG_DIR: 'settings-open-config-dir',
  },
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
