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

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Page loaded successfully');
    mainWindow.capturePage().then(image => {
      fs.writeFileSync('final_screenshot.png', image.toPNG());
      console.log('Screenshot saved');
      setTimeout(() => {
        app.quit();
      }, 1000);
    }).catch(error => {
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
