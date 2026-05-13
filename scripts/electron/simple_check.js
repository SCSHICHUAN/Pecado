const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1098,
    height: 1144,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'src', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.html'));
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
