/**
 * @file ipc.js
 *
 * 【功能】mcp-filesystem 的 Electron 集成：对话框、IPC、主窗口引用、持久化工程路径。
 *   - File → Open Folder：dialog 选目录 → projectIo.connect → 推送 xcodeProject 供底栏「打开项目」→ saveProjectRoot
 *   - 连接成功 webContents.send MCP_FS.PROJECT_CHANGED → renderer 更新工程路径（仅 Open Folder 时带目录树）
 *   - ipcMain.handle MCP_FS.DIRECTORY_TREE → readDirectoryTree
 *   - app.before-quit → disconnect
 *   - getMainWindow()：供 xcode 弹窗、tool-executor 取 BrowserWindow
 *
 * 【注册】main/js/main.js → mcpFilesystemIpc.register(ipcMain, () => mainWindowRef)
 *
 * 【调用方】settings/js/app-menu.js → openProjectFolder
 *
 * 【对外能力】
 *   register(ipcMain, getMainWindowFn)
 *   pickAndConnectProject(getMainWindowFn) → { ok, projectRoot, tools } | { canceled } | { error }
 *   openProjectFolder(getMainWindowFn)
 *   getMainWindow() → BrowserWindow | null
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, dialog, shell } = require('electron');
const { MCP_FS } = require('../shared/ipc-channels');
const projectIo = require('./index');
const xcodeProject = require('../xcode/project');
const {
  clearProjectCache,
  warmProjectTreeCache,
  getCachedTreeAscii,
} = require('./project-context');
const { writeFilesToClipboard } = require('./clipboard-files');

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

/**
 * @param {string} projectRoot
 * @param {() => import('electron').BrowserWindow | null} getMainWindowFn
 * @param {{ notify?: boolean, openXcode?: boolean, showTree?: boolean }} [opts]
 */
async function connectProjectRoot(projectRoot, getMainWindowFn, opts = {}) {
  const root = String(projectRoot || '').trim();
  if (!root) return { ok: false, error: '未指定目录' };
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { ok: false, error: '目录不存在或不可用' };
  }
  try {
    const r = await projectIo.connect(root);
    saveProjectRoot(r.projectRoot);
    clearProjectCache();
    let treeAscii = '';
    if (opts.showTree) {
      await warmProjectTreeCache();
      treeAscii = getCachedTreeAscii();
    }
    const xcodeMeta = xcodeProject.findXcodeForProjectRoot(r.projectRoot);
    const xcodeOpened =
      opts.openXcode && xcodeMeta ? xcodeProject.openXcodeForProjectRoot(r.projectRoot) : null;
    if (opts.notify !== false) {
      const notifyWin = getMainWindowFn?.();
      if (notifyWin && !notifyWin.isDestroyed()) {
        notifyWin.webContents.send(MCP_FS.PROJECT_CHANGED, {
          projectRoot: r.projectRoot,
          tools: r.tools,
          showTree: opts.showTree === true,
          treeAscii: opts.showTree ? treeAscii : '',
          xcodeProject: xcodeMeta || null,
        });
      }
    }
    return { ok: true, canceled: false, ...r, xcodeProject: xcodeMeta || null, xcodeOpened: xcodeOpened || null };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function notifyConnectedProject(getMainWindowFn) {
  const status = projectIo.getStatus();
  if (!status.connected || !status.projectRoot) return false;
  const notifyWin = getMainWindowFn?.();
  if (!notifyWin || notifyWin.isDestroyed()) return false;
  notifyWin.webContents.send(MCP_FS.PROJECT_CHANGED, {
    projectRoot: status.projectRoot,
    tools: status.tools || [],
    showTree: false,
    xcodeProject: xcodeProject.findXcodeForProjectRoot(status.projectRoot) || null,
  });
  return true;
}

async function restoreSavedProject(getMainWindowFn, opts = {}) {
  const saved = readSavedProjectRoot();
  if (!saved) return { ok: false, skipped: true, reason: 'no-saved-path' };
  if (!fs.existsSync(saved) || !fs.statSync(saved).isDirectory()) {
    console.warn('[mcp-fs] saved project path missing:', saved);
    return { ok: false, skipped: true, reason: 'path-missing', projectRoot: saved };
  }
  const status = projectIo.getStatus();
  if (status.connected && status.projectRoot === path.resolve(saved)) {
    if (opts.notify !== false) notifyConnectedProject(getMainWindowFn);
    return { ok: true, restored: true, projectRoot: status.projectRoot, alreadyConnected: true };
  }
  return connectProjectRoot(saved, getMainWindowFn, {
    openXcode: false,
    notify: opts.notify !== false,
    showTree: false,
  });
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
  return connectProjectRoot(picked.projectRoot, getMainWindowFn, {
    openXcode: false,
    notify: true,
    showTree: true,
  });
}

async function openProjectFolder(getMainWindowFn) {
  const result = await pickAndConnectProject(getMainWindowFn);
  if (result.canceled) return;
  if (result.error || result.ok === false) {
    dialog.showErrorBox('Open Folder', result.error || '无法打开目录');
    return;
  }
  console.log('[menu] Open Folder:', result.projectRoot);
  if (result.xcodeProject) {
    console.log('[menu] Xcode project detected:', result.xcodeProject.path);
  } else if (xcodeProject.IS_DARWIN) {
    console.log('[menu] Open Folder: no Xcode project found under', result.projectRoot);
  }
}

function registerIpcHandlers(ipcMain) {
  ipcMain.handle(MCP_FS.DIRECTORY_TREE, async (_event, payload) => {
    try {
      const status = projectIo.getStatus();
      const tree = await projectIo.readDirectoryTree(payload || {});
      return {
        ok: true,
        tree,
        projectRoot: status.connected ? status.projectRoot : '',
      };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  });

  ipcMain.handle(MCP_FS.OPEN_XCODE_PROJECT, async (_event, payload) => {
    try {
      const filePath = String(payload?.path || '').trim();
      if (!filePath) return { ok: false, error: '缺少 path' };
      if (!fs.existsSync(filePath)) return { ok: false, error: `路径不存在：${filePath}` };
      xcodeProject.openXcodeProject(filePath);
      return { ok: true, path: filePath };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(MCP_FS.OPEN_PROJECT_ROOT, async (_event, payload) => {
    try {
      const root = String(payload?.projectRoot || readSavedProjectRoot() || '').trim();
      if (!root) return { ok: false, error: '未打开工程目录' };
      const err = await shell.openPath(root);
      if (err) return { ok: false, error: err };
      return { ok: true, projectRoot: root };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(MCP_FS.OPEN_PATH, async (_event, payload) => {
    try {
      const filePath = String(payload?.path || '').trim();
      if (!filePath) return { ok: false, error: '缺少 path' };
      if (!fs.existsSync(filePath)) return { ok: false, error: `路径不存在：${filePath}` };
      if (process.platform === 'darwin') {
        shell.showItemInFolder(filePath);
      } else {
        const err = await shell.openPath(filePath);
        if (err) return { ok: false, error: err };
      }
      return { ok: true, path: filePath };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(MCP_FS.COPY_FILES, async (_event, payload) => {
    try {
      /** @type {string[]} */
      const paths = [];
      if (Array.isArray(payload?.paths)) {
        for (const p of payload.paths) {
          const s = String(p || '').trim();
          if (s) paths.push(s);
        }
      } else {
        const single = String(payload?.path || '').trim();
        if (single) paths.push(single);
      }
      return writeFilesToClipboard(paths);
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(MCP_FS.WRITE_TEXT_FILE, async (_event, payload) => {
    try {
      const status = projectIo.getStatus();
      if (!status.connected || !status.projectRoot) {
        return { ok: false, error: '未打开工程目录' };
      }
      const filePath = String(payload?.path || '').trim();
      const content = payload?.content == null ? '' : String(payload.content);
      if (!filePath) return { ok: false, error: '缺少 path' };
      let absPath;
      try {
        absPath = projectIo.resolveUnderProject(status.projectRoot, filePath);
      } catch (e) {
        return { ok: false, error: e.message || String(e) };
      }
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, 'utf8');
      return { ok: true, path: absPath };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(MCP_FS.READ_TEXT_FILE, async (_event, payload) => {
    try {
      const status = projectIo.getStatus();
      const rawPath = String(payload?.path || '').trim();
      if (!rawPath) return { ok: false, error: '缺少 path' };
      let filePath = rawPath;
      if (!path.isAbsolute(rawPath)) {
        if (!status.connected || !status.projectRoot) {
          return { ok: false, error: '未打开工程目录' };
        }
        try {
          filePath = projectIo.resolveUnderProject(status.projectRoot, rawPath);
        } catch (e) {
          return { ok: false, error: e.message || String(e) };
        }
      }
      if (!fs.existsSync(filePath)) return { ok: false, error: `文件不存在：${filePath}` };
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return { ok: false, error: '不是文件' };
      const ext = path.extname(filePath).toLowerCase();
      const binaryExts = new Set([
        '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp',
        '.pdf', '.mp4', '.webm', '.mov', '.mp3', '.wav', '.m4a', '.aac', '.ogg',
        '.zip', '.gz', '.dmg', '.app', '.exe', '.dll', '.so', '.dylib',
      ]);
      if (binaryExts.has(ext)) {
        return { ok: false, error: '该文件为二进制格式，请使用预览打开' };
      }
      if (stat.size > 512000) return { ok: false, error: '文件过大，无法在面板内预览' };
      let body = fs.readFileSync(filePath, 'utf8');
      if (body.includes('\u0000')) {
        return { ok: false, error: '该文件不是文本格式' };
      }
      if (body.length > 48000) body = `${body.slice(0, 48000)}\n…(已截断)`;
      return { ok: true, path: filePath, body, title: path.basename(filePath) };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  const PREVIEW_MIME = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.bmp': 'image/bmp',
    '.pdf': 'application/pdf',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
  };

  ipcMain.handle(MCP_FS.PREVIEW_FILE, async (_event, payload) => {
    try {
      const status = projectIo.getStatus();
      const rawPath = String(payload?.path || '').trim();
      if (!rawPath) return { ok: false, error: '缺少 path' };
      if (!status.connected || !status.projectRoot) {
        return { ok: false, error: '未打开工程目录' };
      }
      let filePath;
      try {
        filePath = projectIo.resolveUnderProject(status.projectRoot, rawPath);
      } catch (e) {
        return { ok: false, error: e.message || String(e) };
      }
      if (!fs.existsSync(filePath)) return { ok: false, error: `文件不存在：${filePath}` };
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return { ok: false, error: '不是文件' };
      const ext = path.extname(filePath).toLowerCase();
      const mime = PREVIEW_MIME[ext];
      if (!mime) return { ok: false, error: '不支持预览该文件类型' };
      if (stat.size > 50 * 1024 * 1024) return { ok: false, error: '文件过大，无法在编辑器内预览' };

      let kind = 'embed';
      if (mime.startsWith('image/')) kind = 'image';
      else if (mime === 'application/pdf') kind = 'pdf';
      else if (mime.startsWith('video/')) kind = 'video';
      else if (mime.startsWith('audio/')) kind = 'audio';

      return {
        ok: true,
        path: filePath,
        fileUrl: pathToFileURL(filePath).href,
        mime,
        kind,
        title: path.basename(filePath),
      };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
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

module.exports = {
  register,
  pickAndConnectProject,
  openProjectFolder,
  getMainWindow,
  readSavedProjectRoot,
  connectProjectRoot,
  restoreSavedProject,
  notifyConnectedProject,
};
