/**
 * @file main.js
 *
 * Pecado AI 主进程入口。
 *
 * - `app.whenReady` 后扩展 `bootstrap/load-env` 搜索根、注册 agent IPC（router、agent-commands）与 mcp-filesystem，再 `createWindow`。
 * - `createWindow`：按主显示器 `bounds/workArea` 计算初始宽高（宽约 2/3 屏、高约工作区 8/10，并夹在最小尺寸与 workArea 内）、居中；
 *   `BrowserWindow` 加载 `src/renderer/html/app.html` 与 `preload.js`（沙盒关闭与其它 webPreferences 与项目一致）。
 * - macOS：`disable-features=OverlayScrollbar`，否则 `::-webkit-scrollbar` 自定义常不生效。
 * - `activate` 时若无窗口则再建一扇；非 macOS `window-all-closed` 时 `quit`。
 */
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

/* macOS 默认「覆盖型」滚动条，::webkit-scrollbar 常完全不生效；关闭后对话区自定义轨道才能显示 */
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'OverlayScrollbar');
}

const { loadEnvFromSearchRoots, getDefaultSearchRoots } = require('./bootstrap/load-env');
const agentRouter = require('./agent/router');
const agentCommands = require('./agent/agent-commands');
const mcpFilesystemIpc = require('./mcp-filesystem/ipc');

loadEnvFromSearchRoots(getDefaultSearchRoots());

const RENDERER_HTML = path.join(__dirname, '..', 'renderer', 'html', 'app.html');
const PRELOAD_SCRIPT = path.join(__dirname, '..', 'preload', 'preload.js');

/** @type {import('electron').BrowserWindow | null} */
let mainWindowRef = null;

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const { bounds, workArea } = display;
  // 宽度按整屏 bounds 取 2/3；高度取可用工作区 workArea 的 8/10。再限制在 workArea 内，避免超出可视区
  let winWidth = Math.floor((bounds.width * 2) / 3);
  let winHeight = Math.floor((workArea.height * 8) / 10);
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

  mainWindowRef = mainWindow;

  mainWindow.once('ready-to-show', () => {
    mainWindow.setBounds({ x, y, width: winWidth, height: winHeight });
    mainWindow.show();
  });

  console.log(
    `[window] workArea ${workArea.width}x${workArea.height} @ (${workArea.x},${workArea.y}) → open ${winWidth}x${winHeight} @ (${x},${y})`
  );

  mainWindow.loadFile(RENDERER_HTML);

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

  app.setName('Pecado AI');

  agentRouter.register(ipcMain);
  agentCommands.register(ipcMain);
  mcpFilesystemIpc.register(ipcMain, () => mainWindowRef);
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
