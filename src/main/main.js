/**
 * @file main.js
 *
 * 【功能】Pecado 主进程唯一入口，负责应用生命周期与模块装配。
 *   - 启动前：load-env 合并 .env / secrets.json 到 process.env
 *   - whenReady：注册 IPC（对话 router、bot 指令、settings、mcp-filesystem）并创建主窗口
 *   - createWindow：计算窗口尺寸（宽约屏宽 2/3、高约 workArea 8/10）、居中、加载 app.html + preload
 *   - macOS 关闭 OverlayScrollbar，使 renderer 自定义滚动条 CSS 生效
 *   - activate 无窗口时重建；非 macOS 全部关闭时 quit
 *
 * 【调用方】Electron 由 package.json `"main": "src/main/main.js"` 加载；无其它模块 require 本文件。
 *
 * 【依赖】bootstrap/load-env；agent/router、agent/agent-commands；../settings；mcp-filesystem/ipc
 *
 * 【对外能力】无 module.exports；副作用即注册 IPC 与创建 BrowserWindow（mainWindowRef 供 mcp ipc 取窗）
 */
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

/* 必须在 app ready 之前设置，否则 macOS 菜单栏仍显示 Electron */
app.setName('Pecado');
/* userData 目录名用小写 pecado（与 package.json name 一致），菜单显示名仍为 Pecado */
app.setPath('userData', path.join(app.getPath('appData'), 'pecado'));
if (process.platform === 'darwin') {
  app.setAboutPanelOptions({
    applicationName: 'Pecado',
    applicationVersion: app.getVersion(),
  });
}

/* macOS 默认「覆盖型」滚动条，::webkit-scrollbar 常完全不生效；关闭后对话区自定义轨道才能显示 */
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'OverlayScrollbar');
}

const { loadEnvFromSearchRoots, getDefaultSearchRoots } = require('./bootstrap/load-env');
const agentRouter = require('./agent/router');
const agentCommands = require('./agent/agent-commands');
const mcpFilesystemIpc = require('./mcp-filesystem/ipc');
const settings = require('../settings');

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
    title: 'Pecado',
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

  agentRouter.register(ipcMain);
  agentCommands.register(ipcMain);
  settings.register(ipcMain);
  mcpFilesystemIpc.register(ipcMain, () => mainWindowRef);
  settings.setupApplicationMenu(() => mainWindowRef);
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
