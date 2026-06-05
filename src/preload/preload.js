/**
 * @file preload.js
 *
 * 隔离上下文下的预加载桥：唯一适合放 `require('markdown-it')` / `highlight.js` 且能安全暴露给页面的地方。
 */
const { contextBridge, ipcRenderer } = require('electron');
const MarkdownIt = require('markdown-it');
const hljs = require('highlight.js/lib/core');
hljs.registerLanguage('cpp', require('highlight.js/lib/languages/cpp'));
const { QQ_MUSIC, VOLC_ARK, MCP_FS } = require('../shared/ipc-channels');

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
    renderMarkdown: (src) => md.render(String(src ?? '')),
  });
} catch (error) {
  console.error('Failed to expose electronAPI:', error);
}
