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
    /** invoke：{ path } → 在 Xcode 中打开 .xcodeproj / .xcworkspace */
    OPEN_XCODE_PROJECT: 'mcp-fs-open-xcode-project',
    /** invoke：{ path } → 在 Finder/资源管理器中定位文件 */
    OPEN_PATH: 'mcp-fs-open-path',
    /** invoke：{ path } → 读取文本文件（log 浮层预览） */
    READ_TEXT_FILE: 'mcp-fs-read-text-file',
    /** main → renderer：工程路径变更；showTree 为 true 时仅 Open Folder 会读并展示目录树 */
    PROJECT_CHANGED: 'mcp-fs-project-changed',
    /** invoke：{ path, content } → 写入 Open Folder 内文本文件（CodX Cmd+S） */
    WRITE_TEXT_FILE: 'mcp-fs-write-text-file',
    /** invoke：{ path } → 图片/PDF 等预览 { fileUrl, mime, kind } */
    PREVIEW_FILE: 'mcp-fs-preview-file',
  },
  CODX: {
    /** main → renderer：CodX 流式编辑 { absPath, relPath, delta, fullText, done } */
    STREAM_UPDATE: 'codx-stream-update',
    /** invoke：{ relPath, content? } → { ok, issues[], error? } */
    CHECK_SYNTAX: 'codx-check-syntax',
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
    DEV_DOCS_PICK_FOLDER: 'workflow-dev-docs-pick-folder',
    DEV_DOCS_CREATE: 'workflow-dev-docs-create',
    DEV_DOCS_UPDATE: 'workflow-dev-docs-update',
    DEV_DOCS_READ_RESOURCE: 'workflow-dev-docs-read-resource',
    DEV_DOCS_GENERATE_SKILL: 'workflow-dev-docs-generate-skill',
    DEV_DOCS_DELETE: 'workflow-dev-docs-delete',
    DEV_DOCS_OPEN_DIR: 'workflow-dev-docs-open-dir',
  },
  SKILL: {
    /** main → renderer：Skill tool 执行日志 */
    LOG_EVENT: 'skill-log-event',
    /** invoke：{ skillName, path } → Layer 节点正文预览 */
    READ_SECTION: 'skill-read-section',
    /** invoke：{ skillName, path } → 资源文件正文预览 */
    READ_RESOURCE: 'skill-read-resource',
    /** invoke：打开原生预览窗口 */
    OPEN_PREVIEW: 'skill-open-preview',
    /** main → preview window：{ title, body, filePath?, subtitle? } */
    PREVIEW_CONTENT: 'skill-preview-content',
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
