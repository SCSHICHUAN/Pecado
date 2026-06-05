/**
 * @file ipc.js
 *
 * mcp-filesystem 的 Electron 接线：Open Folder 菜单、IPC 转发读写。
 */
const fs = require('fs');
const path = require('path');
const { app, dialog, Menu } = require('electron');
const { MCP_FS } = require('../../shared/ipc-channels');
const projectIo = require('./index');

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

function clearSavedProjectRoot() {
  try {
    const p = projectConfigPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) {}
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
    const out = { ok: true, canceled: false, ...r };
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

async function onOpenFolder(getMainWindowFn) {
  const result = await pickAndConnectProject(getMainWindowFn);
  if (result.canceled) return;
  if (result.error) {
    dialog.showErrorBox('Open Folder', result.error);
    return;
  }
  console.log('[menu] Open Folder:', result.projectRoot);
}

function setupApplicationMenu(getMainWindowFn) {
  const isMac = process.platform === 'darwin';

  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            onOpenFolder(getMainWindowFn).catch((e) => {
              dialog.showErrorBox('Open Folder', e.message || String(e));
            });
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'toggleDevTools' }, { role: 'reload' }],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }])],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
  setupApplicationMenu(getMainWindowFn);
}

module.exports = { register, pickAndConnectProject, getMainWindow };
