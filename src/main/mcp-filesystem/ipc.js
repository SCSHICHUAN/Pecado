/**
 * @file ipc.js
 *
 * 【功能】mcp-filesystem 的 Electron 集成：对话框、IPC、主窗口引用、持久化工程路径。
 *   - File → Open Folder：dialog 选目录 → projectIo.connect → 若有则打开 Xcode 工程 → saveProjectRoot
 *   - 连接成功 webContents.send MCP_FS.PROJECT_CHANGED → renderer 展示目录树
 *   - ipcMain.handle MCP_FS.DIRECTORY_TREE → readDirectoryTree
 *   - app.before-quit → disconnect
 *   - getMainWindow()：供 xcode 弹窗、tool-executor 取 BrowserWindow
 *
 * 【调用方】main.js → register(ipcMain, () => mainWindowRef)；settings/app-menu.js → openProjectFolder
 *
 * 【对外能力】
 *   register(ipcMain, getMainWindowFn)
 *   pickAndConnectProject(getMainWindowFn) → { ok, projectRoot, tools } | { canceled } | { error }
 *   openProjectFolder(getMainWindowFn)
 *   getMainWindow() → BrowserWindow | null
 */
const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');
const { MCP_FS } = require('../../shared/ipc-channels');
const projectIo = require('./index');
const xcodeProject = require('../xcode/project');

/** @type {() => import('electron').BrowserWindow | null} */
let getMainWindowRef = () => null;

function setMainWindowGetter(fn) {
  getMainWindowRef = typeof fn === 'function' ? fn : () => null;
}

function getMainWindow() {
  return getMainWindowRef?.() || null;
}

function projectConfigPath() {
  return path.join(app.getPath('userData'), 'mcp-project.json');
}

function readSavedProjectRoot() {
  try {
    const p = projectConfigPath();
    if (!fs.existsSync(p)) return '';
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return j.projectRoot ? String(j.projectRoot).trim() : '';
  } catch {
    return '';
  }
}

function saveProjectRoot(root) {
  const p = projectConfigPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ projectRoot: root }, null, 2), 'utf8');
}

async function pickProjectDirectory(browserWindow) {
  const win = browserWindow && !browserWindow.isDestroyed() ? browserWindow : null;
  const saved = readSavedProjectRoot();
  const result = await dialog.showOpenDialog(win, {
    title: '选择代码工程目录',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: saved || app.getPath('documents'),
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { canceled: true };
  }
  return { canceled: false, projectRoot: result.filePaths[0] };
}

async function pickAndConnectProject(getMainWindowFn) {
  const win = getMainWindowFn?.() || null;
  const picked = await pickProjectDirectory(win);
  if (picked.canceled) return { canceled: true };
  try {
    const r = await projectIo.connect(picked.projectRoot);
    saveProjectRoot(r.projectRoot);
    const xcodeOpened = xcodeProject.openXcodeForProjectRoot(r.projectRoot);
    const out = { ok: true, canceled: false, ...r, xcodeOpened: xcodeOpened || null };
    const notifyWin = getMainWindowFn?.();
    if (notifyWin && !notifyWin.isDestroyed()) {
      notifyWin.webContents.send(MCP_FS.PROJECT_CHANGED, {
        projectRoot: r.projectRoot,
        tools: r.tools,
      });
    }
    return out;
  } catch (e) {
    return { canceled: false, error: e.message || String(e) };
  }
}

async function openProjectFolder(getMainWindowFn) {
  const result = await pickAndConnectProject(getMainWindowFn);
  if (result.canceled) return;
  if (result.error) {
    dialog.showErrorBox('Open Folder', result.error);
    return;
  }
  console.log('[menu] Open Folder:', result.projectRoot);
  if (result.xcodeOpened) {
    console.log('[menu] Open Xcode:', result.xcodeOpened.path);
  } else if (xcodeProject.IS_DARWIN) {
    console.log('[menu] Open Folder: no Xcode project found under', result.projectRoot);
  }
}

function registerIpcHandlers(ipcMain) {
  ipcMain.handle(MCP_FS.DIRECTORY_TREE, async (_event, payload) => {
    try {
      const tree = await projectIo.readDirectoryTree(payload || {});
      return { ok: true, tree };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  });

  app.on('before-quit', () => {
    projectIo.disconnect().catch(() => {});
  });
}

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {() => import('electron').BrowserWindow | null} getMainWindowFn
 */
function register(ipcMain, getMainWindowFn) {
  setMainWindowGetter(getMainWindowFn);
  registerIpcHandlers(ipcMain);
}

module.exports = { register, pickAndConnectProject, openProjectFolder, getMainWindow };
