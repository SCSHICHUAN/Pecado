const { contextBridge, ipcRenderer } = require('electron');
const MarkdownIt = require('markdown-it');
const { QQ_MUSIC, VOLC_ARK, VOLC_USER_CONFIG } = require('../shared/ipc-channels');

/** html: false 禁止原文 HTML，降低模型输出 XSS 风险；不开启 linkify 避免危险 scheme */
const md = new MarkdownIt({ html: false, linkify: false, breaks: true });

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
    /** 助手气泡 Markdown → HTML（仅主进程侧 require，渲染进程勿信任意 innerHTML） */
    renderMarkdown: (src) => md.render(String(src ?? '')),
  });
} catch (error) {
  console.error('Failed to expose electronAPI:', error);
}
