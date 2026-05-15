/**
 * @file simple_check.js
 *
 * 独立运行的 Electron 小工具（非主应用入口）：创建临时窗口加载 `src/renderer/app.html`，
 * `did-finish-load` 后在页面内执行简单 JS（如数 `.message`）、`capturePage` 写入 `simple_check_screenshot.png` 后退出。
 * 路径相对 `src/scripts/electron` 指向 `preload`/`renderer`。
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1098,
    height: 1144,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'app.html'));
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

    mainWindow.capturePage().then(image => {
      fs.writeFileSync('simple_check_screenshot.png', image.toPNG());
      console.log('Screenshot saved');
      setTimeout(() => {
        app.quit();
      }, 1000);
    }).catch(error => {
      console.error('Error capturing screenshot:', error);
      setTimeout(() => {
        app.quit();
      }, 1000);
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
