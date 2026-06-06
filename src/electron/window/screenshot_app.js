/**
 * @file screenshot_app.js
 *
 * 独立 Electron 窗口脚本：加载主页面，首屏 `did-finish-load` 后截图为 `final_screenshot.png` 并退出。
 * 用于 CI/本地快速肉眼看布局。
 *
 * 运行：npx electron src/electron/window/screenshot_app.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const SRC_ROOT = path.join(__dirname, '..', '..');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1098,
    height: 1144,
    webPreferences: {
      preload: path.join(SRC_ROOT, 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(SRC_ROOT, 'main', 'html', 'index.html'));
  mainWindow.webContents.openDevTools();

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Page loaded successfully');
    mainWindow
      .capturePage()
      .then((image) => {
        fs.writeFileSync('final_screenshot.png', image.toPNG());
        console.log('Screenshot saved');
        setTimeout(() => app.quit(), 1000);
      })
      .catch((error) => {
        console.error('Error capturing screenshot:', error);
      });
  });
}

app.whenReady().then(() => {
  console.log('App is ready');
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
