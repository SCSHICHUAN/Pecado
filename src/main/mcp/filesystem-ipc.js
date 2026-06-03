/**
 * @file filesystem-ipc.js
 *
 * MCP 文件系统 IPC：选工程目录、连接/断开、转发 directory_tree / read / write 等工具调用。
 */
const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');
const { MCP_FS } = require('./ipc-channels');
const mcpFs = require('./filesystem-client');

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

async function pickAndConnectProject(getMainWindow) {
  const win = getMainWindow?.() || null;
  const picked = await pickProjectDirectory(win);
  if (picked.canceled) return { canceled: true };
  try {
    const r = await mcpFs.connect(picked.projectRoot);
    saveProjectRoot(r.projectRoot);
    const out = { ok: true, canceled: false, ...r };
    const notifyWin = getMainWindow?.();
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

function register(ipcMain, getMainWindow) {
  ipcMain.handle(MCP_FS.GET_STATUS, () => {
    const status = mcpFs.getStatus();
    return { ...status, savedProjectRoot: readSavedProjectRoot() || null };
  });

  ipcMain.handle(MCP_FS.PICK_PROJECT, async () => {
    const win = getMainWindow?.() || null;
    return pickProjectDirectory(win);
  });

  ipcMain.handle(MCP_FS.CONNECT, async (_event, payload) => {
    const root = payload?.projectRoot ? String(payload.projectRoot) : readSavedProjectRoot();
    if (!root) return { error: '未指定工程目录' };
    try {
      const r = await mcpFs.connect(root);
      saveProjectRoot(r.projectRoot);
      return { ok: true, ...r };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  });

  ipcMain.handle(MCP_FS.PICK_AND_CONNECT, async () => pickAndConnectProject(getMainWindow));

  ipcMain.handle(MCP_FS.DISCONNECT, async () => {
    await mcpFs.disconnect();
    clearSavedProjectRoot();
    return { ok: true };
  });

  ipcMain.handle(MCP_FS.LIST_TOOLS, async () => {
    try {
      const tools = await mcpFs.listTools();
      return { ok: true, tools };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  });

  ipcMain.handle(MCP_FS.CALL_TOOL, async (_event, payload) => {
    const name = payload?.name;
    if (!name) return { error: '缺少 tool name' };
    try {
      const result = await mcpFs.callTool(String(name), payload?.arguments || {});
      return { ok: true, result };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  });

  ipcMain.handle(MCP_FS.DIRECTORY_TREE, async (_event, payload) => {
    try {
      const tree = await mcpFs.directoryTree(payload || {});
      return { ok: true, tree };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  });

  ipcMain.handle(MCP_FS.READ_TEXT_FILE, async (_event, payload) => {
    if (!payload?.path) return { error: '缺少 path' };
    try {
      const text = await mcpFs.readTextFile(payload.path, payload);
      return { ok: true, text };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  });

  ipcMain.handle(MCP_FS.WRITE_FILE, async (_event, payload) => {
    if (!payload?.path) return { error: '缺少 path' };
    if (payload.content == null) return { error: '缺少 content' };
    try {
      const message = await mcpFs.writeFile(payload.path, payload.content);
      return { ok: true, message };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  });

  ipcMain.handle(MCP_FS.LIST_ALLOWED, async () => {
    try {
      const text = await mcpFs.listAllowedDirectories();
      return { ok: true, text };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  });

  app.on('before-quit', () => {
    mcpFs.disconnect().catch(() => {});
  });
}

module.exports = { register, pickAndConnectProject };
