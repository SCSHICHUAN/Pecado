/**
 * @file register.js
 * 【功能】RemoteServer IPC 注册与编排（主进程）
 * 【职责】面板 HTML、连接状态、SFTP 代理、上传任务队列、本机目录选择对话框
 * 【生命周期】main.js → register(ipcMain, getMainWindow)；app 退出 → shutdown()
 */
const fs = require('fs');
const path = require('path');
const { dialog, BrowserWindow, app } = require('electron');
const { REMOTE_SERVER } = require('../shared/ipc-channels');
const { readConfig, writeConfig, getStorePath, normalizeUploadItems, normalizeTreeExpanded } =
  require('./config-store');

/** 上传循环中由 CANCEL_UPLOAD 置位，用于中断当前批次 */
let uploadCancelRequested = false;
const session = require('./ssh-session');
const mediaStream = require('./media-stream-server');

const PANEL_HTML = path.join(__dirname, 'html', 'panel.html');

function mediaCacheDir() {
  return path.join(app.getPath('userData'), 'remote-server-media-cache');
}

function clearMediaCache() {
  const dir = mediaCacheDir();
  try {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch (_) {}
    }
  } catch (_) {}
}
function readPanelHtml() {
  return fs.readFileSync(PANEL_HTML, 'utf8');
}

function errPayload(e) {
  return {
    ok: false,
    error: e && e.message ? String(e.message) : String(e || '未知错误'),
    code: e && e.code ? String(e.code) : '',
  };
}

function resolveParentWindow(getMainWindowFn) {
  let win = typeof getMainWindowFn === 'function' ? getMainWindowFn() : null;
  if (win && !win.isDestroyed()) return win;
  win = BrowserWindow.getFocusedWindow();
  if (win && !win.isDestroyed()) return win;
  const all = BrowserWindow.getAllWindows().filter((w) => w && !w.isDestroyed());
  return all[0] || null;
}

/**
 * 将本机文件/文件夹上传到远端 targetDir。
 * localEntries 带 relativePath 时按相对路径拼远端；否则按 basename / 整目录 walk。
 */
async function uploadLocalPathsToRemote(targetDir, localPaths, localEntries) {
  uploadCancelRequested = false;
  const jobs = buildUploadJobs(targetDir, localPaths, localEntries);
  const uploaded = [];
  const errors = [];

  for (const job of jobs) {
    if (uploadCancelRequested) {
      if (!uploaded.length) {
        return {
          ok: false,
          cancelled: true,
          error: '上传已取消',
          dir: session.normalizeRemotePath(targetDir),
        };
      }
      const firstDir = uploaded[0].dir || session.normalizeRemotePath(targetDir);
      return {
        ok: true,
        cancelled: true,
        uploaded: uploaded.map((u) => u.realPath || u.path),
        details: uploaded,
        dir: firstDir,
        fileCount: uploaded.filter((u) => u.kind !== 'dir').length,
        dirCount: uploaded.filter((u) => u.kind === 'dir').length,
        warning: '上传已中断',
      };
    }
    if (job.error) {
      errors.push(job.error);
      continue;
    }
    if (job.mkdirOnly) {
      try {
        await session.ensureRemoteDir(job.remotePath);
        const parent = path.posix.dirname(job.remotePath) || '/';
        uploaded.push({
          path: job.remotePath,
          realPath: job.remotePath,
          size: 0,
          dir: session.normalizeRemotePath(parent),
          kind: 'dir',
        });
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        errors.push(`${path.posix.basename(job.remotePath)}: ${msg}`);
      }
      continue;
    }

    const name = path.basename(job.localPath);
    try {
      const remoteDir = path.posix.dirname(job.remotePath);
      if (remoteDir && remoteDir !== '/') {
        await session.ensureRemoteDir(remoteDir);
      }
      console.log('[remote-server] uploading', job.localPath, '→', job.remotePath);
      const put = await session.uploadLocalFile(job.localPath, job.remotePath);
      console.log(
        '[remote-server] upload verified',
        put.realPath || put.path,
        'size=',
        put.size,
        'dir=',
        put.dir
      );
      uploaded.push({
        path: put.path,
        realPath: put.realPath || put.path,
        size: put.size,
        dir: put.dir || targetDir,
        kind: 'file',
      });
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      console.error('[remote-server] upload failed', job.remotePath, msg);
      errors.push(`${name}: ${msg}`);
    }
  }

  if (!uploaded.length) {
    return {
      ok: false,
      error: errors.length ? errors.join('；') : '没有可上传的文件',
      dir: session.normalizeRemotePath(targetDir),
    };
  }
  const firstDir = uploaded[0].dir || session.normalizeRemotePath(targetDir);
  const fileCount = uploaded.filter((u) => u.kind !== 'dir').length;
  const dirCount = uploaded.filter((u) => u.kind === 'dir').length;
  return {
    ok: true,
    uploaded: uploaded.map((u) => u.realPath || u.path),
    details: uploaded,
    dir: firstDir,
    fileCount,
    dirCount,
    warning: errors.length ? errors.join('；') : '',
  };
}

function walkLocalFiles(localDir, onFile, relBase = '') {
  let entries;
  try {
    entries = fs.readdirSync(localDir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const ent of entries) {
    if (ent.isSymbolicLink()) continue;
    const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
    const abs = path.join(localDir, ent.name);
    if (ent.isDirectory()) {
      walkLocalFiles(abs, onFile, rel);
    } else if (ent.isFile()) {
      onFile(abs, rel.replace(/\\/g, '/'));
    }
  }
}

function remoteJoin(targetDir, relPath) {
  const target = session.normalizeRemotePath(targetDir);
  const rel = String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!rel) return target;
  return target === '/' ? `/${rel}` : `${target}/${rel}`;
}

function buildUploadJobs(targetDir, localPaths, localEntries) {
  const jobs = [];
  const entries = Array.isArray(localEntries)
    ? localEntries
        .map((ent) => ({
          path: String(ent?.path || '').trim(),
          relativePath: String(ent?.relativePath || '')
            .trim()
            .replace(/\\/g, '/'),
        }))
        .filter((ent) => ent.path)
    : [];

  if (entries.length && entries.some((ent) => ent.relativePath)) {
    for (const ent of entries) {
      if (!fs.existsSync(ent.path)) {
        jobs.push({ error: `${ent.relativePath || ent.path}: 本地路径不存在` });
        continue;
      }
      if (!fs.statSync(ent.path).isFile()) continue;
      jobs.push({
        localPath: ent.path,
        remotePath: remoteJoin(targetDir, ent.relativePath || path.basename(ent.path)),
      });
    }
    return jobs;
  }

  const paths = entries.length
    ? entries.map((ent) => ent.path)
    : (Array.isArray(localPaths) ? localPaths : [])
        .map((p) => String(p || '').trim())
        .filter(Boolean);

  for (const localPath of paths) {
    if (!fs.existsSync(localPath)) {
      jobs.push({ error: `${path.basename(localPath)}: 本地路径不存在` });
      continue;
    }
    const st = fs.statSync(localPath);
    if (st.isFile()) {
      jobs.push({
        localPath,
        remotePath: remoteJoin(targetDir, path.basename(localPath)),
      });
      continue;
    }
    if (!st.isDirectory()) {
      jobs.push({ error: `${path.basename(localPath)}: 不支持的类型` });
      continue;
    }

    const rootName = path.basename(localPath);
    let fileCount = 0;
    walkLocalFiles(localPath, (abs, rel) => {
      fileCount += 1;
      const remoteRel = rel ? `${rootName}/${rel}` : rootName;
      jobs.push({
        localPath: abs,
        remotePath: remoteJoin(targetDir, remoteRel),
      });
    });
    if (!fileCount) {
      jobs.push({
        mkdirOnly: true,
        remotePath: remoteJoin(targetDir, rootName),
      });
    }
  }

  return jobs;
}

/** 注册全部 REMOTE_SERVER.* IPC；通道名见 shared/ipc-channels.js */
function register(ipcMain, getMainWindowFn) {
  ipcMain.handle(REMOTE_SERVER.GET_PANEL_HTML, async () => {
    try {
      return { ok: true, html: readPanelHtml() };
    } catch (e) {
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.GET_STATE, async () => {
    try {
      const cfg = readConfig();
      const status = session.getStatus();
      return {
        ok: true,
        connected: status.connected,
        host: status.connected ? status.host : cfg.host,
        port: status.connected ? status.port : cfg.port,
        username: status.connected ? status.username : cfg.username,
        hasPassword: Boolean(cfg.password),
        lastPath: cfg.lastPath || '/',
        downloadDir: cfg.downloadDir,
        uploadItems: cfg.uploadItems,
        treeExpanded: cfg.treeExpanded,
        selectedPath: cfg.selectedPath || '',
        selectedIsDir: cfg.selectedIsDir !== false,
        configPath: getStorePath(),
        saved: {
          host: cfg.host,
          port: cfg.port,
          username: cfg.username,
          password: cfg.password,
          lastPath: cfg.lastPath || '/',
          downloadDir: cfg.downloadDir,
          uploadItems: cfg.uploadItems,
          treeExpanded: cfg.treeExpanded,
          selectedPath: cfg.selectedPath || '',
          selectedIsDir: cfg.selectedIsDir !== false,
        },
      };
    } catch (e) {
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.CONNECT, async (_evt, payload = {}) => {
    try {
      const cfg = readConfig();
      const host = payload.host != null ? String(payload.host).trim() : cfg.host;
      const username = payload.username != null ? String(payload.username).trim() : cfg.username;
      const password =
        payload.password != null && String(payload.password) !== ''
          ? String(payload.password)
          : cfg.password;
      const port = parseInt(String(payload.port != null ? payload.port : cfg.port), 10) || 22;
      const status = await session.connect({ host, port, username, password });
      writeConfig({ host, port, username, password, lastPath: cfg.lastPath || '/' });
      return { ok: true, ...status, saved: true };
    } catch (e) {
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.DISCONNECT, async () => {
    try {
      mediaStream.clearTickets();
      session.disconnect();
      return { ok: true, connected: false };
    } catch (e) {
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.LIST_DIR, async (_evt, payload = {}) => {
    try {
      const remotePath = payload.path != null ? String(payload.path) : '/';
      const res = await session.listDir(remotePath);
      writeConfig({ lastPath: res.path });
      return { ok: true, ...res };
    } catch (e) {
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.READ_FILE, async (_evt, payload = {}) => {
    try {
      const remotePath = String(payload.path || '');
      const res = await session.readFile(remotePath);
      return { ok: true, ...res };
    } catch (e) {
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.WRITE_FILE, async (_evt, payload = {}) => {
    try {
      const remotePath = String(payload.path || '');
      const content = payload.content != null ? String(payload.content) : '';
      const res = await session.writeFile(remotePath, content);
      return { ok: true, ...res };
    } catch (e) {
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.DELETE, async (_evt, payload = {}) => {
    try {
      if (String(payload.confirm || '') !== 'del') {
        return { ok: false, error: '删除需输入 del 确认' };
      }
      const remotePath = String(payload.path || '');
      const res = await session.removePath(remotePath);
      return { ok: true, ...res };
    } catch (e) {
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.UPLOAD, async (_evt, payload = {}) => {
    try {
      if (!session.isConnected()) {
        return { ok: false, error: '未连接服务器', code: 'NOT_CONNECTED' };
      }
      const targetDir = session.normalizeRemotePath(payload.dir || '/');
      let localPaths = Array.isArray(payload.localPaths)
        ? payload.localPaths.map((p) => String(p || '').trim()).filter(Boolean)
        : [];
      const localEntries = Array.isArray(payload.localEntries)
        ? payload.localEntries
            .map((ent) => ({
              path: String(ent?.path || '').trim(),
              relativePath: String(ent?.relativePath || '').trim(),
            }))
            .filter((ent) => ent.path)
        : [];

      if (!localPaths.length && !localEntries.length) {
        const win = resolveParentWindow(getMainWindowFn);
        const cfg = readConfig();
        console.log('[remote-server] upload pick →', targetDir);
        const picked = await dialog.showOpenDialog(win || undefined, {
          title: `上传到 ${targetDir}`,
          message: `文件将上传到远程目录：${targetDir}`,
          buttonLabel: '上传',
          defaultPath: cfg.downloadDir,
          properties: ['openFile', 'multiSelections'],
        });
        if (picked.canceled || !picked.filePaths?.length) {
          console.log('[remote-server] upload cancelled');
          return { ok: true, cancelled: true, uploaded: [] };
        }
        localPaths = picked.filePaths;
      } else {
        console.log(
          '[remote-server] upload drop/paths →',
          targetDir,
          localEntries.length || localPaths.length
        );
      }

      return await uploadLocalPathsToRemote(targetDir, localPaths, localEntries);
    } catch (e) {
      console.error('[remote-server] upload error', e);
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.MKDIR, async (_evt, payload = {}) => {
    try {
      const parent = session.normalizeRemotePath(payload.dir || '/');
      const name = String(payload.name || '').trim().replace(/[\\/]/g, '');
      if (!name) return { ok: false, error: '文件夹名不能为空' };
      const remote = parent === '/' ? `/${name}` : `${parent}/${name}`;
      await session.mkdir(remote);
      return { ok: true, path: remote };
    } catch (e) {
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.PREVIEW_MEDIA, async (_evt, payload = {}) => {
    try {
      if (!session.isConnected()) {
        return { ok: false, error: '未连接服务器', code: 'NOT_CONNECTED' };
      }
      const remotePath = String(payload.path || '');
      if (!session.isMediaPath(remotePath)) {
        return { ok: false, error: '不是可预览的多媒体文件' };
      }
      const meta = await session.statMedia(remotePath);
      const fileUrl = await mediaStream.createStreamUrl(
        {
          remotePath: meta.path,
          mime: meta.mime,
          size: meta.size,
          kind: meta.kind,
          title: meta.title,
        },
        () => session.getSftpHandle()
      );
      return {
        ok: true,
        path: meta.path,
        fileUrl,
        mime: meta.mime,
        kind: meta.kind,
        size: meta.size,
        title: meta.title,
        mode: 'stream',
      };
    } catch (e) {
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.DOWNLOAD, async (_evt, payload = {}) => {
    try {
      if (!session.isConnected()) {
        return { ok: false, error: '未连接服务器', code: 'NOT_CONNECTED' };
      }
      const remotePath = String(payload.path || '').trim();
      if (!remotePath) return { ok: false, error: '请选择要下载的文件' };
      const cfg = readConfig();
      const downloadDir = cfg.downloadDir;
      const res = await session.downloadRemoteFile(remotePath, downloadDir);
      return { ok: true, ...res, downloadDir };
    } catch (e) {
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.PICK_DOWNLOAD_DIR, async () => {
    try {
      const win = resolveParentWindow(getMainWindowFn);
      const cfg = readConfig();
      const picked = await dialog.showOpenDialog(win || undefined, {
        title: '选择下载保存目录',
        defaultPath: cfg.downloadDir,
        properties: ['openDirectory', 'createDirectory'],
      });
      if (picked.canceled || !picked.filePaths?.length) {
        return { ok: true, cancelled: true, downloadDir: cfg.downloadDir };
      }
      const dir = picked.filePaths[0];
      writeConfig({ downloadDir: dir });
      return { ok: true, downloadDir: dir };
    } catch (e) {
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.SET_DOWNLOAD_DIR, async (_evt, payload = {}) => {
    try {
      const dir = String(payload.downloadDir || '').trim();
      if (!dir) return { ok: false, error: '路径不能为空' };
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        return { ok: false, error: '目录不存在' };
      }
      writeConfig({ downloadDir: dir });
      return { ok: true, downloadDir: dir };
    } catch (e) {
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.PICK_UPLOAD_FILES, async () => {
    try {
      const win = resolveParentWindow(getMainWindowFn);
      const cfg = readConfig();
      const last = cfg.uploadItems?.[0]?.path;
      const defaultPath = last ? path.dirname(last) : cfg.downloadDir;
      const picked = await dialog.showOpenDialog(win || undefined, {
        title: '选择要上传的文件或文件夹',
        defaultPath,
        properties: ['openFile', 'openDirectory', 'multiSelections'],
      });
      if (picked.canceled || !picked.filePaths?.length) {
        return { ok: true, cancelled: true, filePaths: [] };
      }
      return { ok: true, filePaths: picked.filePaths };
    } catch (e) {
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.SET_UPLOAD_PATH, async (_evt, payload = {}) => {
    try {
      const items = normalizeUploadItems(payload.uploadItems || []);
      writeConfig({ uploadItems: items });
      return { ok: true, uploadItems: items };
    } catch (e) {
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.SAVE_TREE_STATE, async (_evt, payload = {}) => {
    try {
      const lastPath = payload.lastPath != null ? String(payload.lastPath).trim() || '/' : undefined;
      const treeExpanded =
        payload.treeExpanded != null ? normalizeTreeExpanded(payload.treeExpanded) : undefined;
      const selectedPath =
        payload.selectedPath != null ? String(payload.selectedPath).trim() : undefined;
      const selectedIsDir = payload.selectedIsDir != null ? Boolean(payload.selectedIsDir) : undefined;
      const patch = {};
      if (lastPath != null) patch.lastPath = lastPath;
      if (treeExpanded != null) patch.treeExpanded = treeExpanded;
      if (selectedPath != null) patch.selectedPath = selectedPath;
      if (selectedIsDir != null) patch.selectedIsDir = selectedIsDir;
      const cfg = writeConfig(patch);
      return {
        ok: true,
        lastPath: cfg.lastPath,
        treeExpanded: cfg.treeExpanded,
        selectedPath: cfg.selectedPath,
        selectedIsDir: cfg.selectedIsDir,
      };
    } catch (e) {
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.CANCEL_UPLOAD, async () => {
    uploadCancelRequested = true;
    return { ok: true };
  });

  ipcMain.handle(REMOTE_SERVER.PICK_UPLOAD_DIR, async () => {
    try {
      const win = resolveParentWindow(getMainWindowFn);
      const cfg = readConfig();
      const picked = await dialog.showOpenDialog(win || undefined, {
        title: '选择本地上传目录',
        defaultPath: cfg.uploadDir,
        properties: ['openDirectory', 'createDirectory'],
      });
      if (picked.canceled || !picked.filePaths?.length) {
        return { ok: true, cancelled: true, uploadDir: cfg.uploadDir };
      }
      const dir = picked.filePaths[0];
      writeConfig({ uploadDir: dir });
      return { ok: true, uploadDir: dir };
    } catch (e) {
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.SET_UPLOAD_DIR, async (_evt, payload = {}) => {
    try {
      const dir = String(payload.uploadDir || '').trim();
      if (!dir) return { ok: false, error: '路径不能为空' };
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        return { ok: false, error: '目录不存在' };
      }
      writeConfig({ uploadDir: dir });
      return { ok: true, uploadDir: dir };
    } catch (e) {
      return errPayload(e);
    }
  });
}

function shutdown() {
  mediaStream.stopServer();
  session.disconnect();
  clearMediaCache();
}

module.exports = { register, shutdown };
