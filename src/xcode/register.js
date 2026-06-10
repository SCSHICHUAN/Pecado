/**
 * @file register.js
 *
 * 【功能】Xcode 相关 IPC（自动化权限等）。
 * 【注册】main/js/main.js → xcode.register(ipcMain, getMainWindowFn)
 */
const { XCODE } = require('../shared/ipc-channels');
const { promptXcodeAutomationPermission } = require('./automation-permission');

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {() => import('electron').BrowserWindow | null} getMainWindowFn
 */
function register(ipcMain, getMainWindowFn) {
  ipcMain.handle(XCODE.REQUEST_AUTOMATION, async () => {
    const win = typeof getMainWindowFn === 'function' ? getMainWindowFn() : null;
    return promptXcodeAutomationPermission(win);
  });
}

module.exports = { register };
