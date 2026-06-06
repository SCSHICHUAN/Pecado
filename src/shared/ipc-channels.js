/**
 * @file ipc-channels.js
 *
 * 【功能】全项目 IPC 通道名字符串的单一数据源。
 *   - VOLC_ARK：流式对话 invoke + 主→渲染 stream event
 *   - QQ_MUSIC：助手 JSON 指令后置处理（历史命名）
 *   - MCP_FS：目录树 invoke + Open Folder 后 project changed 推送
 *   - GIT：Git 视图（gitgraph/js/register.js）
 *   - SETTINGS：Preferences（settings/js/register.js）
 *
 * 【主进程注册】见 main/js/main.js → app.whenReady 顺序注册各模块 register()
 *
 * 【调用方】
 *   preload/preload.js、settings/js/preload.js
 *   pecado/js/agent/router.js、stream-ui.js
 *   commands/js/local-commands.js
 *   mcp-filesystem/ipc.js、settings/js/register.js
 */
module.exports = {
  SETTINGS: {
    GET: 'settings-get',
    SAVE: 'settings-save',
    OPEN_CONFIG_DIR: 'settings-open-config-dir',
    /** main → renderer：Preferences 保存后推送 */
    CONFIG_CHANGED: 'settings-config-changed',
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
    /** invoke：{ projectRoot? } → shell.openPath 在 Finder/资源管理器中打开 */
    OPEN_PROJECT_ROOT: 'mcp-fs-open-project-root',
    /** main → renderer：用户通过菜单 Open Folder 后推送 */
    PROJECT_CHANGED: 'mcp-fs-project-changed',
  },
  GIT: {
    GET_STATE: 'git-get-state',
    GET_PANEL_HTML: 'git-get-panel-html',
    PULL: 'git-pull',
    PUSH: 'git-push',
    COMMIT: 'git-commit',
    /** invoke：节点右键菜单 { action, hash, ... } */
    NODE_ACTION: 'git-node-action',
  },
};
