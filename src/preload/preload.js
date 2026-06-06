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
 *   onMcpFsProjectChanged(callback)      → listen PROJECT_CHANGED { projectRoot, tools? }
 *   gitGetState(payload?)                → invoke GIT.GET_STATE
 *   gitPull(payload?)                    → invoke GIT.PULL
 *   gitPush(payload?)                    → invoke GIT.PUSH
 *   gitCommit({ message })               → invoke GIT.COMMIT
 *   onSettingsConfigChanged(callback)    → listen SETTINGS.CONFIG_CHANGED
 *   renderMarkdown(src)                  → HTML string（本地 markdown-it，不经 IPC）
 */
const { contextBridge, ipcRenderer } = require('electron');
const MarkdownIt = require('markdown-it');
const hljs = require('highlight.js/lib/core');
hljs.registerLanguage('cpp', require('highlight.js/lib/languages/cpp'));
const { QQ_MUSIC, VOLC_ARK, MCP_FS, GIT, SETTINGS } = require('../shared/ipc-channels');

/** html: false 禁止原文 HTML；不开启 linkify；代码块用 highlight.js（仅注册 cpp，未知语言按 cpp 高亮） */
const md = new MarkdownIt({ html: false, linkify: false, breaks: true });
md.options.highlight = (str, lang) => {
  const raw = (lang || '').trim().toLowerCase();
  const useLang = raw && hljs.getLanguage(raw) ? raw : 'cpp';
  try {
    return hljs.highlight(str, { language: useLang, ignoreIllegals: true }).value;
  } catch (_) {
    try {
      return hljs.highlight(str, { language: 'cpp', ignoreIllegals: true }).value;
    } catch (__) {
      return md.utils.escapeHtml(str);
    }
  }
};

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
    renderMarkdown: (src) => md.render(String(src ?? '')),
  });
} catch (error) {
  console.error('Failed to expose electronAPI:', error);
}
