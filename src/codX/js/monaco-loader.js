/**
 * @file monaco-loader.js
 * 加载 monaco-editor 0.55（AMD，路径相对 index.html）
 */
(function () {
  /** 相对 src/main/html/index.html，勿用 file:// 绝对 URL */
  const MONACO_BASE = '../../../node_modules/monaco-editor/min/vs';

  /** @returns {Promise<typeof import('monaco-editor')>} */
  function loadMonaco() {
    if (window.monaco) return Promise.resolve(window.monaco);
    return new Promise((resolve, reject) => {
      const req = window.require;
      if (!req) {
        reject(new Error('Monaco loader.js 未加载，请检查 node_modules/monaco-editor'));
        return;
      }
      req(
        ['vs/editor/editor.main'],
        () => {
          if (window.monaco) resolve(window.monaco);
          else reject(new Error('Monaco 初始化失败'));
        },
        (err) => reject(err instanceof Error ? err : new Error(String(err)))
      );
    });
  }

  window.CodXMonacoLoader = { loadMonaco, MONACO_BASE };
})();
