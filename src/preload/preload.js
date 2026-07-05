/**
 * @file preload.js
 *
 * 【功能】contextIsolation 下的安全桥：把 IPC 与 Markdown 渲染暴露为 window.electronAPI。
 *   - contextBridge.exposeInMainWorld，renderer 无法直接 require Node/Electron
 *   - MarkdownIt：html:false、linkify:false、breaks:true；highlight.js 仅注册 cpp，未知语言 fallback cpp
 *   - onVolcArkStreamEvent / onMcpFsProjectChanged 返回 unsubscribe 函数
 *
 * 【调用方】main/js/main.js → BrowserWindow webPreferences.preload
 *
 * 【对外能力】window.electronAPI：
 *   volcArkBotsChatStream(payload)     → invoke BOTS_CHAT_COMPLETION { streamId, userText, history }
 *   onVolcArkStreamEvent(callback)     → listen BOTS_STREAM_EVENT { streamId, phase, text?, ... }
 *   handleBotCommand(rawContent)       → invoke HANDLE_BOT_COMMAND
 *   mcpFsDirectoryTree(opts)             → invoke DIRECTORY_TREE
 *   onMcpFsProjectChanged(callback)      → listen PROJECT_CHANGED { projectRoot, tools?, showTree?, treeAscii?, xcodeProject? }
 *   mcpFsOpenProjectRoot(payload)        → invoke OPEN_PROJECT_ROOT
 *   gitGetState(payload?)                → invoke GIT.GET_STATE
 *   gitPull(payload?)                    → invoke GIT.PULL
 *   gitPush(payload?)                    → invoke GIT.PUSH
 *   gitCommit({ message })               → invoke GIT.COMMIT
 *   onSettingsConfigChanged(callback)    → listen SETTINGS.CONFIG_CHANGED
 *   renderMarkdown(src)                  → HTML string（本地 markdown-it，不经 IPC）
 */
const { contextBridge, ipcRenderer } = require('electron');
const { markdownToHtml } = require('../markdown/markdown-html');
const { QQ_MUSIC, VOLC_ARK, MCP_FS, GIT, SETTINGS, APP, WORKFLOW, SKILL, CODX } = require('../shared/ipc-channels');

try {
  contextBridge.exposeInMainWorld('electronAPI', {
    volcArkBotsChatStream: (payload) => ipcRenderer.invoke(VOLC_ARK.BOTS_CHAT_COMPLETION, payload),
    handleBotCommand: (rawContent) =>
      ipcRenderer.invoke(QQ_MUSIC.HANDLE_BOT_COMMAND, { rawContent }),
    onVolcArkStreamEvent: (callback) => {
      const ch = VOLC_ARK.BOTS_STREAM_EVENT;
      const fn = (_evt, payload) => {
        try {
          callback(payload);
        } catch (e) {
          console.error('[preload] onVolcArkStreamEvent', e);
        }
      };
      ipcRenderer.on(ch, fn);
      return () => ipcRenderer.removeListener(ch, fn);
    },
    mcpFsDirectoryTree: (opts) => ipcRenderer.invoke(MCP_FS.DIRECTORY_TREE, opts || {}),
    mcpFsOpenProjectRoot: (payload) =>
      ipcRenderer.invoke(MCP_FS.OPEN_PROJECT_ROOT, payload || {}),
    mcpFsWriteTextFile: (payload) =>
      ipcRenderer.invoke(MCP_FS.WRITE_TEXT_FILE, payload || {}),
    codxCheckSyntax: (payload) => ipcRenderer.invoke(CODX.CHECK_SYNTAX, payload || {}),
    getAppSettings: () => ipcRenderer.invoke(SETTINGS.GET),
    saveAppSettings: (payload) => ipcRenderer.invoke(SETTINGS.SAVE, payload || {}),
    mcpFsOpenPath: (payload) => ipcRenderer.invoke(MCP_FS.OPEN_PATH, payload || {}),
    mcpFsCopyFiles: (payload) => ipcRenderer.invoke(MCP_FS.COPY_FILES, payload || {}),
    mcpFsReadTextFile: (payload) => ipcRenderer.invoke(MCP_FS.READ_TEXT_FILE, payload || {}),
    mcpFsPreviewFile: (payload) => ipcRenderer.invoke(MCP_FS.PREVIEW_FILE, payload || {}),
    onMcpFsProjectChanged: (callback) => {
      const ch = MCP_FS.PROJECT_CHANGED;
      const fn = (_evt, payload) => {
        try {
          callback(payload);
        } catch (e) {
          console.error('[preload] onMcpFsProjectChanged', e);
        }
      };
      ipcRenderer.on(ch, fn);
      return () => ipcRenderer.removeListener(ch, fn);
    },
    gitGetState: (payload) => ipcRenderer.invoke(GIT.GET_STATE, payload || {}),
    gitGetPanelHtml: () => ipcRenderer.invoke(GIT.GET_PANEL_HTML),
    gitPull: (payload) => ipcRenderer.invoke(GIT.PULL, payload || {}),
    gitPush: (payload) => ipcRenderer.invoke(GIT.PUSH, payload || {}),
    gitCommit: (payload) => ipcRenderer.invoke(GIT.COMMIT, payload || {}),
    gitNodeAction: (payload) => ipcRenderer.invoke(GIT.NODE_ACTION, payload || {}),
    gitRunShell: (payload) => ipcRenderer.invoke(GIT.RUN_SHELL, payload || {}),
    workflowGetPanelHtml: () => ipcRenderer.invoke(WORKFLOW.GET_PANEL_HTML),
    workflowGetState: () => ipcRenderer.invoke(WORKFLOW.GET_STATE),
    workflowOrganizeFiles: (payload) => ipcRenderer.invoke(WORKFLOW.ORGANIZE_FILES, payload || {}),
    workflowCreatePptOutline: (payload) =>
      ipcRenderer.invoke(WORKFLOW.CREATE_PPT_OUTLINE, payload || {}),
    workflowSaveSchedule: (payload) => ipcRenderer.invoke(WORKFLOW.SAVE_SCHEDULE, payload || {}),
    workflowDeleteSchedule: (payload) => ipcRenderer.invoke(WORKFLOW.DELETE_SCHEDULE, payload || {}),
    workflowRunScheduleNow: (payload) =>
      ipcRenderer.invoke(WORKFLOW.RUN_SCHEDULE_NOW, payload || {}),
    workflowPickApp: () => ipcRenderer.invoke(WORKFLOW.PICK_APP),
    workflowPickFolder: (payload) => ipcRenderer.invoke(WORKFLOW.PICK_FOLDER, payload || {}),
    workflowDownloadServerStart: (payload) =>
      ipcRenderer.invoke(WORKFLOW.DOWNLOAD_SERVER_START, payload || {}),
    workflowDownloadServerStop: () => ipcRenderer.invoke(WORKFLOW.DOWNLOAD_SERVER_STOP),
    workflowGetDownloadServer: () => ipcRenderer.invoke(WORKFLOW.GET_DOWNLOAD_SERVER),
    workflowClearVideoThumbCache: () => ipcRenderer.invoke(WORKFLOW.CLEAR_VIDEO_THUMB_CACHE),
    workflowOpenDownloadUrl: (payload) => ipcRenderer.invoke(WORKFLOW.OPEN_DOWNLOAD_URL, payload || {}),
    workflowDevDocsList: () => ipcRenderer.invoke(WORKFLOW.DEV_DOCS_LIST),
    workflowDevDocsGet: (payload) => ipcRenderer.invoke(WORKFLOW.DEV_DOCS_GET, payload || {}),
    workflowDevDocsPickFile: () => ipcRenderer.invoke(WORKFLOW.DEV_DOCS_PICK_FILE),
    workflowDevDocsPickFolder: () => ipcRenderer.invoke(WORKFLOW.DEV_DOCS_PICK_FOLDER),
    workflowDevDocsCreate: (payload) => ipcRenderer.invoke(WORKFLOW.DEV_DOCS_CREATE, payload || {}),
    workflowDevDocsUpdate: (payload) => ipcRenderer.invoke(WORKFLOW.DEV_DOCS_UPDATE, payload || {}),
    workflowDevDocsReadResource: (payload) =>
      ipcRenderer.invoke(WORKFLOW.DEV_DOCS_READ_RESOURCE, payload || {}),
    workflowDevDocsGenerateSkill: (payload) =>
      ipcRenderer.invoke(WORKFLOW.DEV_DOCS_GENERATE_SKILL, payload || {}),
    workflowDevDocsDelete: (payload) => ipcRenderer.invoke(WORKFLOW.DEV_DOCS_DELETE, payload || {}),
    workflowDevDocsOpenDir: () => ipcRenderer.invoke(WORKFLOW.DEV_DOCS_OPEN_DIR),
    workflowImportUiDesign: (payload) =>
      ipcRenderer.invoke(WORKFLOW.IMPORT_UI_DESIGN, payload || {}),
    workflowListUiDesigns: (payload) =>
      ipcRenderer.invoke(WORKFLOW.LIST_UI_DESIGNS, payload || {}),
    workflowOpenUiDesign: (payload) =>
      ipcRenderer.invoke(WORKFLOW.OPEN_UI_DESIGN, payload || {}),
    workflowGetUiDesignInfo: (payload) =>
      ipcRenderer.invoke(WORKFLOW.GET_UI_DESIGN_INFO, payload || {}),
    workflowListSimulators: () => ipcRenderer.invoke(WORKFLOW.LIST_SIMULATORS),
    workflowGetSimulator: () => ipcRenderer.invoke(WORKFLOW.GET_SIMULATOR),
    workflowSaveSimulator: (payload) => ipcRenderer.invoke(WORKFLOW.SAVE_SIMULATOR, payload || {}),
    onSettingsConfigChanged: (callback) => {
      const ch = SETTINGS.CONFIG_CHANGED;
      const fn = (_evt, payload) => {
        try {
          callback(payload);
        } catch (e) {
          console.error('[preload] onSettingsConfigChanged', e);
        }
      };
      ipcRenderer.on(ch, fn);
      return () => ipcRenderer.removeListener(ch, fn);
    },
    onNavigateView: (callback) => {
      const ch = APP.NAVIGATE_VIEW;
      const fn = (_evt, payload) => {
        try {
          callback(payload);
        } catch (e) {
          console.error('[preload] onNavigateView', e);
        }
      };
      ipcRenderer.on(ch, fn);
      return () => ipcRenderer.removeListener(ch, fn);
    },
    onSkillLogEvent: (callback) => {
      const ch = SKILL.LOG_EVENT;
      const fn = (_evt, payload) => {
        try {
          callback(payload);
        } catch (e) {
          console.error('[preload] onSkillLogEvent', e);
        }
      };
      ipcRenderer.on(ch, fn);
      return () => ipcRenderer.removeListener(ch, fn);
    },
    skillReadSection: (payload) => ipcRenderer.invoke(SKILL.READ_SECTION, payload || {}),
    skillReadResource: (payload) => ipcRenderer.invoke(SKILL.READ_RESOURCE, payload || {}),
    openLogPreview: (payload) => ipcRenderer.invoke(SKILL.OPEN_PREVIEW, payload || {}),
    renderMarkdown: markdownToHtml,
  });
} catch (error) {
  console.error('Failed to expose electronAPI:', error);
}
