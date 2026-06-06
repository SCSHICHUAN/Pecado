/**
 * @file simple_check.js
 *
 * 独立 Electron 窗口脚本：加载主页面，执行页面内探测 JS，`capturePage` 后退出。
 *
 * 运行：npx electron src/electron/window/simple_check.js
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

  mainWindow.webContents.on('did-finish-load', async () => {
    console.log('Page loaded successfully');

    try {
      const messagesCount = await mainWindow.webContents.executeJavaScript(`
        document.querySelectorAll('.message').length
      `);
      console.log('Messages count:', messagesCount);

      if (messagesCount > 0) {
        const firstMessageHTML = await mainWindow.webContents.executeJavaScript(`
          document.querySelector('.message').outerHTML
        `);
        console.log('First message HTML:', firstMessageHTML);
      }
    } catch (error) {
      console.error('JavaScript execution error:', error);
    }

    mainWindow
      .capturePage()
      .then((image) => {
        fs.writeFileSync('simple_check_screenshot.png', image.toPNG());
        console.log('Screenshot saved');
        setTimeout(() => app.quit(), 1000);
      })
      .catch((error) => {
        console.error('Error capturing screenshot:', error);
        setTimeout(() => app.quit(), 1000);
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
