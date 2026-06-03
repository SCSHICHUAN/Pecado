/**
 * @file context.js
 * MCP 模块共享上下文（主窗口引用等）。
 */
/** @type {() => import('electron').BrowserWindow | null} */
let getMainWindowRef = () => null;

function setMainWindowGetter(fn) {
  getMainWindowRef = typeof fn === 'function' ? fn : () => null;
}

function getMainWindow() {
  return getMainWindowRef?.() || null;
}

module.exports = { setMainWindowGetter, getMainWindow };
