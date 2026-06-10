/**
 * @file main.js
 *
 * 【功能】Pecado 主进程唯一入口：生命周期 + 模块 IPC 注册 + 主窗口。
 *
 * 【模块注册顺序】app.whenReady 内（先于 createWindow）：
 *   1. pecado/js/register.js        → VOLC_ARK 流式对话
 *   2. commands/js/register.js      → QQ_MUSIC 助手 JSON 后置指令
 *   3. settings/js/register.js      → SETTINGS Preferences
 *   4. mcp-filesystem/ipc.js        → MCP_FS + File → Open Folder
 *   5. gitgraph/js/register.js      → GIT 面板
 *   6. xcode/register.js            → Xcode 自动化权限
 *   7. workflow/register.js        → Workflow 自动化
 *   8. settings.setupApplicationMenu → 菜单栏（含 Open Folder、Preferences）
 *
 * 【渲染进程】main/html/index.html + preload/preload.js
 *   · pecado/js/index.js — 对话 UI
 *   · gitgraph/js/index.js — Git 侧栏
 *
 * 【调用方】package.json `"main": "src/main/js/main.js"`
 */
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const fs = require('fs');
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
const pecado = require('../../pecado/js/register');
const commands = require('../../commands/js/register');
const mcpFilesystemIpc = require('../../mcp-filesystem/ipc');
const gitgraph = require('../../gitgraph/js/register');
const xcodeRegister = require('../../xcode/register');
const workflowRegister = require('../../workflow/register');
const settings = require('../../settings/js/register');

loadEnvFromSearchRoots(getDefaultSearchRoots());

const RENDERER_HTML = path.join(__dirname, '..', 'html', 'index.html');
const PRELOAD_SCRIPT = path.join(__dirname, '..', '..', 'preload', 'preload.js');
const APP_ICON = path.join(__dirname, '..', '..', '..', 'assets', 'icons', 'icon.png');

function resolveAppIcon() {
  return fs.existsSync(APP_ICON) ? APP_ICON : undefined;
}

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
    icon: resolveAppIcon(),
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

  mainWindow.webContents.once('did-finish-load', () => {
    mcpFilesystemIpc.notifyConnectedProject(() => mainWindowRef);
  });

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

app.whenReady().then(async () => {
  const appIcon = resolveAppIcon();
  if (appIcon && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(appIcon);
  }
  const roots = getDefaultSearchRoots();
  try {
    roots.push(app.getAppPath());
  } catch (_) {}
  loadEnvFromSearchRoots(roots);

  pecado.register(ipcMain);
  commands.register(ipcMain);
  settings.register(ipcMain, () => mainWindowRef);
  mcpFilesystemIpc.register(ipcMain, () => mainWindowRef);
  gitgraph.register(ipcMain);
  xcodeRegister.register(ipcMain, () => mainWindowRef);
  workflowRegister.register(ipcMain, () => mainWindowRef);
  settings.setupApplicationMenu(() => mainWindowRef);

  try {
    const res = await mcpFilesystemIpc.restoreSavedProject(() => mainWindowRef, { notify: false });
    if (res?.ok) console.log('[main] restored project:', res.projectRoot);
  } catch (e) {
    console.error('[main] restoreSavedProject', e);
  }

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  workflowRegister.shutdown();
});
