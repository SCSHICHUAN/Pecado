const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const { loadEnvFromSearchRoots, getDefaultSearchRoots } = require('./load-env');
const qqMusicIpc = require('./ipc/qq-music');
const arkChatIpc = require('./ipc/ark-chat');
const volcUserConfigIpc = require('./ipc/volc-user-config');

loadEnvFromSearchRoots(getDefaultSearchRoots());

const RENDERER_HTML = path.join(__dirname, '..', 'renderer', 'app.html');
const PRELOAD_SCRIPT = path.join(__dirname, '..', 'preload', 'preload.js');

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const { bounds, workArea } = display;
  // 按整屏 bounds 取 2/3，再限制在可用 workArea 内，避免被系统忽略初始尺寸或超出可视区
  let winWidth = Math.floor((bounds.width * 2) / 3);
  let winHeight = Math.floor((bounds.height * 2) / 3);
  winWidth = Math.max(480, Math.min(winWidth, workArea.width));
  winHeight = Math.max(400, Math.min(winHeight, workArea.height));
  const x = Math.floor(workArea.x + (workArea.width - winWidth) / 2);
  const y = Math.floor(workArea.y + (workArea.height - winHeight) / 2);

  const mainWindow = new BrowserWindow({
    title: 'Pecado AI',
    show: false,
    width: winWidth,
    height: winHeight,
    x,
    y,
    webPreferences: {
      preload: PRELOAD_SCRIPT,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.setBounds({ x, y, width: winWidth, height: winHeight });
    mainWindow.show();
  });

  console.log(
    `[window] workArea ${workArea.width}x${workArea.height} @ (${workArea.x},${workArea.y}) → open ${winWidth}x${winHeight} @ (${x},${y})`
  );

  mainWindow.loadFile(RENDERER_HTML);
  mainWindow.webContents.openDevTools();

  mainWindow.webContents.on('preload-error', (event, preloadPath, error) => {
    console.error('Preload script error:', preloadPath, error);
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`Renderer console: ${message} (${line}:${sourceId})`);
  });

  mainWindow.on('show', () => {
    console.log('Window is shown');
    console.log('Is visible:', mainWindow.isVisible());
    console.log('Is focused:', mainWindow.isFocused());
  });

  mainWindow.on('focus', () => {
    console.log('Window is focused');
  });

  console.log('Main window created');
  console.log('Is visible:', mainWindow.isVisible());
  console.log('Is focused:', mainWindow.isFocused());
}

app.whenReady().then(() => {
  const roots = getDefaultSearchRoots();
  try {
    roots.push(app.getAppPath());
  } catch (_) {}
  loadEnvFromSearchRoots(roots);

  qqMusicIpc.register(ipcMain);
  arkChatIpc.register(ipcMain);
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
