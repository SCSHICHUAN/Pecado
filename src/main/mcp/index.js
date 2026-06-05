/**
 * @file index.js
 *
 * MCP 模块启动入口：注册 filesystem IPC、应用菜单、主窗口上下文。
 * 业务 API（对话、Xcode 流等）请直接 require 对应子模块，勿经此 barrel 再导出。
 */
const filesystemIpc = require('./filesystem-ipc');
const { setupApplicationMenu } = require('./app-menu');
const { setMainWindowGetter } = require('./context');

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {() => import('electron').BrowserWindow | null} getMainWindowFn
 */
function register(ipcMain, getMainWindowFn) {
  setMainWindowGetter(getMainWindowFn);
  filesystemIpc.register(ipcMain, getMainWindowFn);
  setupApplicationMenu(getMainWindowFn);
}

module.exports = { register };
