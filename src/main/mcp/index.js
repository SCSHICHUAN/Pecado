/**
 * @file index.js
 *
 * MCP 模块统一入口：IPC、菜单、方舟对话集成。
 */
const filesystemIpc = require('./filesystem-ipc');
const { setupApplicationMenu } = require('./app-menu');
const { handleMcpToolsChat } = require('./chat-integration');
const { resolveXcodeStreamAbsPath } = require('./xcode-stream-target');
const { writeSseDeltaToXcode, finalizeSseXcodeStream } = require('./sse-xcode-stream');
const { setMainWindowGetter, getMainWindow } = require('./context');

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {() => import('electron').BrowserWindow | null} getMainWindow
 */
function register(ipcMain, getMainWindowFn) {
  setMainWindowGetter(getMainWindowFn);
  filesystemIpc.register(ipcMain, getMainWindowFn);
  setupApplicationMenu(getMainWindowFn);
}

module.exports = {
  register,
  getMainWindow,
  handleMcpToolsChat,
  resolveXcodeStreamAbsPath,
  writeSseDeltaToXcode,
  finalizeSseXcodeStream,
};
