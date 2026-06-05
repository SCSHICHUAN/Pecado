/**
 * @file ipc-channels.js
 *
 * 【功能】全项目 IPC 通道名字符串的单一数据源（改一处即可，避免主进程/preload 拼写不一致静默失败）。
 *   三组命名空间：
 *     - VOLC_ARK：流式对话 invoke + 主→渲染 stream event
 *     - QQ_MUSIC：助手 JSON 指令后置处理（历史命名，实际为 bot-handle-command）
 *     - MCP_FS：目录树 invoke + Open Folder 后 project changed 推送
 *
 * 【调用方】
 *   preload/preload.js（invoke/on 绑定）
 *   main/agent/router.js、stream-ui.js、agent-commands.js
 *   main/mcp-filesystem/ipc.js
 *
 * 【对外能力】module.exports 常量对象，无函数：
 *   VOLC_ARK.BOTS_CHAT_COMPLETION / BOTS_STREAM_EVENT
 *   QQ_MUSIC.HANDLE_BOT_COMMAND
 *   MCP_FS.DIRECTORY_TREE / PROJECT_CHANGED
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
