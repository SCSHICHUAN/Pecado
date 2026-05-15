/**
 * @file preload.js
 *
 * 隔离上下文下的预加载桥：唯一适合放 `require('markdown-it')` / `highlight.js` 且能安全暴露给页面的地方。
 *
 * - `contextBridge.exposeInMainWorld('electronAPI', …)`：QQ 音乐 invoke、方舟 `volcArkBotsChatStream` + `onVolcArkStreamEvent`、
 *   用户配置 get/set、`renderMarkdown`（markdown-it，围栏代码走 highlight，当前仅注册 cpp，未知语言按 cpp）。
 * - 渲染进程不持有 API Key；网络与密钥只在主进程 `ark-chat.js`。
 * - 通道名来自 `../shared/ipc-channels.js`，与主进程注册保持一致。
 */
const { contextBridge, ipcRenderer } = require('electron');
const MarkdownIt = require('markdown-it');
const hljs = require('highlight.js/lib/core');
hljs.registerLanguage('cpp', require('highlight.js/lib/languages/cpp'));
const { QQ_MUSIC, VOLC_ARK, VOLC_USER_CONFIG } = require('../shared/ipc-channels');

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
    openQQMusic: () => ipcRenderer.invoke(QQ_MUSIC.OPEN_DESKTOP),
    openQQMusicWeb: () => ipcRenderer.invoke(QQ_MUSIC.OPEN_WEB),
    /** 流式豆包：invoke 结束后返回 { content } 或 { error }；增量通过 onVolcArkStreamEvent 推送 */
    volcArkBotsChatStream: (messages, streamId) =>
      ipcRenderer.invoke(VOLC_ARK.BOTS_CHAT_COMPLETION, { messages, streamId }),
    /**
     * @param {(payload: { streamId: string, phase: string, text?: string, error?: string }) => void} callback
     * @returns {() => void} 取消订阅
     */
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
    volcGetUserConfig: () => ipcRenderer.invoke(VOLC_USER_CONFIG.GET),
    volcSetUserConfig: (data) => ipcRenderer.invoke(VOLC_USER_CONFIG.SET, data),
    /** 助手气泡 Markdown → HTML（highlight.js 仅 cpp 语法集；样式见 app.html 引入的 github-dark） */
    renderMarkdown: (src) => md.render(String(src ?? '')),
  });
} catch (error) {
  console.error('Failed to expose electronAPI:', error);
}
