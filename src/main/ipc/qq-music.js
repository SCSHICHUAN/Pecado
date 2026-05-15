/**
 * @file qq-music.js
 *
 * 主进程 IPC 处理器：响应 preload 的 `OPEN_DESKTOP` / `OPEN_WEB`。
 *
 * - 桌面端：按 `process.platform` 使用 `exec` 调起 QQMusic 可执行文件或 macOS `open -a`；
 * - 失败或 Linux 等未覆盖路径时 `shell.openExternal` 打开 y.qq.com。
 */
const { shell } = require('electron');
const { exec } = require('child_process');
const { QQ_MUSIC } = require('../../shared/ipc-channels');

function openDesktopQQMusic() {
  if (process.platform === 'darwin') {
    exec('open -a "QQMusic"', (err) => {
      if (err) {
        console.error('无法打开 QQ 音乐:', err);
        shell.openExternal('https://y.qq.com');
      }
    });
  } else if (process.platform === 'win32') {
    exec('start "" "C:\\Program Files\\Tencent\\QQMusic\\QQMusic.exe"', (err) => {
      if (err) {
        console.error('无法打开 QQ 音乐:', err);
        shell.openExternal('https://y.qq.com');
      }
    });
  } else {
    exec('xdg-open qqmusic', (err) => {
      if (err) {
        console.error('无法打开 QQ 音乐:', err);
        shell.openExternal('https://y.qq.com');
      }
    });
  }
}

function openQQMusicWeb() {
  shell.openExternal('https://y.qq.com');
}

function register(ipcMain) {
  ipcMain.handle(QQ_MUSIC.OPEN_DESKTOP, () => {
    openDesktopQQMusic();
  });

  ipcMain.handle(QQ_MUSIC.OPEN_WEB, () => {
    openQQMusicWeb();
  });
}

module.exports = { register };
