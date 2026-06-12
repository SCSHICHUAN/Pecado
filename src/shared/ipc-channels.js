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
  APP: {
    /** main → renderer：{ view: 'chat' | 'workflow' | 'git' } 切换主内容区 */
    NAVIGATE_VIEW: 'app-navigate-view',
  },
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
    /** main → renderer：工程路径变更；showTree 为 true 时仅 Open Folder 会读并展示目录树 */
    PROJECT_CHANGED: 'mcp-fs-project-changed',
  },
  XCODE: {
    /** invoke：触发 macOS 自动化权限弹窗（Pecado → Xcode） */
    REQUEST_AUTOMATION: 'xcode-request-automation',
  },
  WORKFLOW: {
    GET_PANEL_HTML: 'workflow-get-panel-html',
    GET_STATE: 'workflow-get-state',
    ORGANIZE_FILES: 'workflow-organize-files',
    CREATE_PPT_OUTLINE: 'workflow-create-ppt-outline',
    SAVE_SCHEDULE: 'workflow-save-schedule',
    DELETE_SCHEDULE: 'workflow-delete-schedule',
    RUN_SCHEDULE_NOW: 'workflow-run-schedule-now',
    PICK_APP: 'workflow-pick-app',
    PICK_FOLDER: 'workflow-pick-folder',
    DOWNLOAD_SERVER_START: 'workflow-download-server-start',
    DOWNLOAD_SERVER_STOP: 'workflow-download-server-stop',
    GET_DOWNLOAD_SERVER: 'workflow-get-download-server',
    CLEAR_VIDEO_THUMB_CACHE: 'workflow-clear-video-thumb-cache',
    OPEN_DOWNLOAD_URL: 'workflow-open-download-url',
    DEV_DOCS_LIST: 'workflow-dev-docs-list',
    DEV_DOCS_GET: 'workflow-dev-docs-get',
    DEV_DOCS_PICK_FILE: 'workflow-dev-docs-pick-file',
    DEV_DOCS_CREATE: 'workflow-dev-docs-create',
    DEV_DOCS_UPDATE: 'workflow-dev-docs-update',
    DEV_DOCS_READ_RESOURCE: 'workflow-dev-docs-read-resource',
    DEV_DOCS_GENERATE_SKILL: 'workflow-dev-docs-generate-skill',
    DEV_DOCS_DELETE: 'workflow-dev-docs-delete',
    DEV_DOCS_OPEN_DIR: 'workflow-dev-docs-open-dir',
  },
  GIT: {
    GET_STATE: 'git-get-state',
    GET_PANEL_HTML: 'git-get-panel-html',
    PULL: 'git-pull',
    PUSH: 'git-push',
    COMMIT: 'git-commit',
    /** invoke：节点右键菜单 { action, hash, ... } */
    NODE_ACTION: 'git-node-action',
    /** invoke：{ command, projectRoot? } → 用户确认后执行 shell 命令 */
    RUN_SHELL: 'git-run-shell',
  },
};
