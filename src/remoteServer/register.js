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
const { readConfig, writeConfig, getStorePath, normalizeUploadItems, normalizeTreeExpanded, normalizeTreeWidth } =
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

/** 推送 SFTP/FTP 风格日志到渲染进程底栏 */
function emitLog(sender, message, kind, meta) {
  if (!sender || typeof sender.send !== 'function') return;
  try {
    if (sender.isDestroyed?.()) return;
    const payload = {
      message: String(message || ''),
      kind: kind === 'error' || kind === 'ok' ? kind : 'info',
      at: Date.now(),
    };
    if (meta && typeof meta === 'object') {
      if (meta.progress) payload.progress = meta.progress;
    }
    sender.send(REMOTE_SERVER.LOG, payload);
  } catch (_) {
    /* ignore */
  }
}

function progressMeta(done, total, phase, indeterminate) {
  const d = Math.max(0, Number(done) || 0);
  const t = Math.max(0, Number(total) || 0);
  return {
    progress: {
      done: d,
      total: t,
      phase: phase || 'upload',
      indeterminate: Boolean(indeterminate) || t <= 0,
    },
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
 * @param {Electron.WebContents | null} sender 用于推送 LOG
 */
async function uploadLocalPathsToRemote(targetDir, localPaths, localEntries, sender) {
  uploadCancelRequested = false;
  const jobs = buildUploadJobs(targetDir, localPaths, localEntries);
  const uploaded = [];
  const errors = [];
  const total = jobs.filter((j) => !j.error).length;
  let totalProgress = total;
  let done = 0;

  emitLog(
    sender,
    `[SFTP] 开始上传 → ${session.normalizeRemotePath(targetDir)}（${total} 项）`,
    'info',
    progressMeta(0, totalProgress, 'upload')
  );

  async function runSftpJob(job) {
    if (job.error) {
      errors.push(job.error);
      emitLog(sender, `[SFTP] 跳过 ${job.error}`, 'error');
      return;
    }
    if (job.mkdirOnly) {
      done += 1;
      emitLog(
        sender,
        `[SFTP] MKDIR ${job.remotePath}（${done}/${totalProgress}）`,
        'info',
        progressMeta(done, totalProgress, 'upload')
      );
      await session.ensureRemoteDir(job.remotePath);
      const parent = path.posix.dirname(job.remotePath) || '/';
      uploaded.push({
        path: job.remotePath,
        realPath: job.remotePath,
        size: 0,
        dir: session.normalizeRemotePath(parent),
        kind: 'dir',
      });
      emitLog(
        sender,
        `[SFTP] OK MKDIR ${job.remotePath}`,
        'ok',
        progressMeta(done, totalProgress, 'upload')
      );
      return;
    }

    const name = path.basename(job.localPath);
    const remoteDir = path.posix.dirname(job.remotePath);
    if (remoteDir && remoteDir !== '/') {
      await session.ensureRemoteDir(remoteDir);
    }
    done += 1;
    emitLog(
      sender,
      `[SFTP] PUT ${job.localPath} → ${job.remotePath}（${done}/${totalProgress}）`,
      'info',
      progressMeta(done, totalProgress, 'upload')
    );
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
    emitLog(
      sender,
      `[SFTP] OK ${put.realPath || put.path} ${put.size}B`,
      'ok',
      progressMeta(done, totalProgress, 'upload')
    );
  }

  for (const job of jobs) {
    if (uploadCancelRequested) {
      emitLog(sender, '[SFTP] 上传已取消', 'error');
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
        selection: (() => {
          const firstFile = uploaded.find((u) => u.kind !== 'dir');
          const first = firstFile || uploaded[0];
          const p = session.normalizeRemotePath(first.realPath || first.path);
          // 中断时若已有嵌套路径，尽量选顶层文件夹
          const target = session.normalizeRemotePath(targetDir);
          const prefix = target === '/' ? '/' : `${target}/`;
          const rest =
            target === '/'
              ? p.replace(/^\//, '')
              : p.startsWith(prefix)
                ? p.slice(prefix.length)
                : '';
          if (rest.includes('/')) {
            const name = rest.split('/')[0];
            return {
              path: target === '/' ? `/${name}` : `${target}/${name}`,
              isDir: true,
            };
          }
          return { path: p, isDir: first.kind === 'dir' };
        })(),
      };
    }
    if (job.dirBundle) {
      try {
        emitLog(
          sender,
          `[SFTP] TAR ${job.localPath} → ${job.remoteParentDir}`,
          'info',
          progressMeta(Math.max(0, done), Math.max(1, totalProgress), 'upload', true)
        );
        const result = await session.uploadLocalDirViaTar(
          job.localPath,
          job.remoteParentDir
        );
        uploaded.push({
          path: result.remoteRoot,
          realPath: result.remoteRoot,
          size: result.size,
          dir: result.dir,
          kind: 'dir',
        });
        for (const f of result.files || []) {
          uploaded.push({
            path: f.path,
            realPath: f.path,
            size: f.size,
            dir: result.dir,
            kind: 'file',
          });
        }
        done += 1;
        console.log(
          '[remote-server] upload tar verified',
          result.remoteRoot,
          'files=',
          result.fileCount
        );
        emitLog(
          sender,
          `[SFTP] OK TAR ${result.remoteRoot} · ${result.fileCount} 文件 · ${result.size}B`,
          'ok',
          progressMeta(done, totalProgress, 'upload')
        );
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        if (msg === '上传已取消') {
          emitLog(sender, '[SFTP] 上传已取消', 'error');
          if (!uploaded.length) {
            return {
              ok: false,
              cancelled: true,
              error: '上传已取消',
              dir: session.normalizeRemotePath(targetDir),
            };
          }
          break;
        }
        emitLog(sender, `[SFTP] TAR 失败，改用逐文件上传: ${msg}`, 'error');
        const fallback = expandLocalDirToSftpJobs(job.localPath, job.remoteParentDir);
        totalProgress += fallback.filter((j) => !j.error && !j.mkdirOnly).length;
        for (const fj of fallback) {
          if (uploadCancelRequested) break;
          try {
            await runSftpJob(fj);
          } catch (err) {
            const em = err && err.message ? err.message : String(err);
            errors.push(`${path.basename(fj.localPath || fj.remotePath || '')}: ${em}`);
            emitLog(sender, `[SFTP] FAIL ${fj.remotePath}: ${em}`, 'error');
          }
        }
      }
      continue;
    }
    if (job.error) {
      errors.push(job.error);
      emitLog(sender, `[SFTP] 跳过 ${job.error}`, 'error');
      continue;
    }
    if (job.mkdirOnly) {
      try {
        await runSftpJob(job);
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        errors.push(`${path.posix.basename(job.remotePath)}: ${msg}`);
        emitLog(sender, `[SFTP] FAIL MKDIR ${job.remotePath}: ${msg}`, 'error');
      }
      continue;
    }

    const name = path.basename(job.localPath);
    try {
      await runSftpJob(job);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      console.error('[remote-server] upload failed', job.remotePath, msg);
      errors.push(`${name}: ${msg}`);
      emitLog(sender, `[SFTP] FAIL ${job.remotePath}: ${msg}`, 'error');
    }
  }

  if (!uploaded.length) {
    emitLog(sender, `[SFTP] 上传失败：${errors.join('；') || '没有可上传的文件'}`, 'error');
    return {
      ok: false,
      error: errors.length ? errors.join('；') : '没有可上传的文件',
      dir: session.normalizeRemotePath(targetDir),
    };
  }
  const firstDir = uploaded[0].dir || session.normalizeRemotePath(targetDir);
  const fileCount = uploaded.filter((u) => u.kind !== 'dir').length;
  const dirCount = uploaded.filter((u) => u.kind === 'dir').length;
  const warn = errors.length ? `；部分失败：${errors.join('；')}` : '';
  console.log(
    '[remote-server] upload done',
    fileCount,
    'files',
    dirCount,
    'dirs →',
    firstDir
  );
  emitLog(
    sender,
    `[SFTP] 完成 ${fileCount} 文件${dirCount ? `、${dirCount} 文件夹` : ''} → ${firstDir}${warn}`,
    errors.length ? 'error' : 'ok',
    progressMeta(totalProgress, totalProgress, 'upload')
  );

  /** 选中策略：单文件选文件；文件夹（含子路径）选顶层目录 */
  function selectionFromUpload() {
    const target = session.normalizeRemotePath(targetDir);
    const tops = new Map();
    const consider = (remotePath, asDir) => {
      const p = session.normalizeRemotePath(remotePath);
      if (!p || p === target) return;
      let top;
      let nested = false;
      if (target === '/') {
        const parts = p.split('/').filter(Boolean);
        if (!parts.length) return;
        top = `/${parts[0]}`;
        nested = parts.length > 1 || asDir;
      } else {
        const prefix = `${target}/`;
        if (!p.startsWith(prefix)) return;
        const rest = p.slice(prefix.length);
        const parts = rest.split('/').filter(Boolean);
        if (!parts.length) return;
        top = `${target}/${parts[0]}`;
        nested = parts.length > 1 || asDir;
      }
      const cur = tops.get(top) || { nested: false };
      if (nested) cur.nested = true;
      tops.set(top, cur);
    };

    for (const job of jobs) {
      if (job.error) continue;
      if (job.dirBundle) {
        const name = path.basename(job.localPath);
        consider(remoteJoin(job.remoteParentDir, name), true);
        continue;
      }
      if (job.mkdirOnly) {
        consider(job.remotePath, true);
        continue;
      }
      const rp = job.remotePath;
      const targetNorm = session.normalizeRemotePath(targetDir);
      const prefix = targetNorm === '/' ? '/' : `${targetNorm}/`;
      const rel =
        targetNorm === '/'
          ? String(rp || '').replace(/^\//, '')
          : String(rp || '').startsWith(prefix)
            ? String(rp).slice(prefix.length)
            : '';
      consider(rp, rel.includes('/'));
    }
    for (const u of uploaded) {
      consider(u.realPath || u.path, u.kind === 'dir');
    }

    if (tops.size === 1) {
      const [[topPath, meta]] = [...tops.entries()];
      return { path: topPath, isDir: Boolean(meta.nested) };
    }
    const firstFile = uploaded.find((u) => u.kind !== 'dir');
    if (firstFile) {
      return {
        path: session.normalizeRemotePath(firstFile.realPath || firstFile.path),
        isDir: false,
      };
    }
    const first = uploaded[0];
    return {
      path: session.normalizeRemotePath(first.realPath || first.path),
      isDir: first.kind === 'dir',
    };
  }

  return {
    ok: true,
    uploaded: uploaded.map((u) => u.realPath || u.path),
    details: uploaded,
    dir: firstDir,
    fileCount,
    dirCount,
    warning: errors.length ? errors.join('；') : '',
    selection: selectionFromUpload(),
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

function folderRootFromEntries(entries) {
  const first = (entries || []).find((e) => e?.relativePath);
  if (!first?.path) return '';
  const rel = String(first.relativePath).replace(/\\/g, '/');
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length) return first.path;
  let p = String(first.path).replace(/\\/g, '/');
  for (let i = 0; i < parts.length - 1; i++) {
    const j = p.lastIndexOf('/');
    if (j <= 0) break;
    p = p.slice(0, j);
  }
  return p;
}

function expandLocalDirToSftpJobs(localPath, targetDir) {
  const jobs = [];
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
  return jobs;
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
    const root = folderRootFromEntries(entries);
    if (root && fs.existsSync(root) && fs.statSync(root).isDirectory()) {
      let hasFiles = false;
      walkLocalFiles(root, () => {
        hasFiles = true;
      });
      if (!hasFiles) {
        jobs.push({
          mkdirOnly: true,
          remotePath: remoteJoin(targetDir, path.basename(root)),
        });
      } else {
        jobs.push({
          dirBundle: true,
          localPath: root,
          remoteParentDir: session.normalizeRemotePath(targetDir),
        });
      }
      return jobs;
    }
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
    walkLocalFiles(localPath, () => {
      fileCount += 1;
    });
    if (!fileCount) {
      jobs.push({
        mkdirOnly: true,
        remotePath: remoteJoin(targetDir, rootName),
      });
    } else {
      jobs.push({
        dirBundle: true,
        localPath,
        remoteParentDir: session.normalizeRemotePath(targetDir),
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
        treeWidth: cfg.treeWidth || 0,
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
          treeWidth: cfg.treeWidth || 0,
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
      emitLog(_evt.sender, `[SFTP] 连接 ${username}@${host}:${port} …`);
      const status = await session.connect({ host, port, username, password });
      writeConfig({ host, port, username, password, lastPath: cfg.lastPath || '/' });
      emitLog(_evt.sender, `[SFTP] 已连接 ${username}@${host}:${port}`, 'ok');
      return { ok: true, ...status, saved: true };
    } catch (e) {
      emitLog(_evt.sender, `[SFTP] 连接失败：${e && e.message ? e.message : e}`, 'error');
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.DISCONNECT, async (_evt) => {
    try {
      mediaStream.clearTickets();
      session.disconnect();
      emitLog(_evt.sender, '[SFTP] 已断开', 'ok');
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
      const remotePath = String(payload.path || '').trim();
      if (!remotePath) return { ok: false, error: '未指定删除路径' };
      emitLog(
        _evt.sender,
        `[SFTP] 删除中 ${remotePath}`,
        'info',
        progressMeta(0, 1, 'delete', true)
      );
      const res = await session.removePath(remotePath);
      emitLog(
        _evt.sender,
        `[SFTP] OK RM ${remotePath}`,
        'ok',
        progressMeta(1, 1, 'delete')
      );
      return { ok: true, ...res };
    } catch (e) {
      emitLog(_evt.sender, `[SFTP] FAIL RM：${e && e.message ? e.message : e}`, 'error');
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
          emitLog(_evt.sender, '[SFTP] 已取消选择文件', 'error');
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

      return await uploadLocalPathsToRemote(targetDir, localPaths, localEntries, _evt.sender);
    } catch (e) {
      console.error('[remote-server] upload error', e);
      emitLog(_evt.sender, `[SFTP] 上传异常：${e && e.message ? e.message : e}`, 'error');
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.MKDIR, async (_evt, payload = {}) => {
    try {
      const parent = session.normalizeRemotePath(payload.dir || '/');
      const name = String(payload.name || '').trim().replace(/[\\/]/g, '');
      if (!name) return { ok: false, error: '文件夹名不能为空' };
      const remote = parent === '/' ? `/${name}` : `${parent}/${name}`;
      emitLog(_evt.sender, `[SFTP] MKDIR ${remote}`);
      await session.mkdir(remote);
      emitLog(_evt.sender, `[SFTP] OK MKDIR ${remote}`, 'ok');
      return { ok: true, path: remote };
    } catch (e) {
      emitLog(_evt.sender, `[SFTP] FAIL MKDIR：${e && e.message ? e.message : e}`, 'error');
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
      if (!remotePath) return { ok: false, error: '请选择要下载的文件或文件夹' };
      const cfg = readConfig();
      const downloadDir = cfg.downloadDir;
      emitLog(
        _evt.sender,
        `[SFTP] GET ${remotePath} → ${downloadDir}`,
        'info',
        progressMeta(0, 1, 'download', true)
      );
      const res = await session.downloadRemotePath(remotePath, downloadDir, (info) => {
        const total = Math.max(1, Number(info.total) || 1);
        const index = Math.max(0, Number(info.index) || 0);
        let msg;
        if (info.method === 'tar') {
          msg = index >= total ? `[SFTP] TAR GET ${remotePath}` : `[SFTP] TAR GET ${remotePath}…`;
        } else if (total > 1) {
          msg = `[SFTP] GET ${info.remotePath}（${index}/${total}）`;
        } else {
          msg = `[SFTP] GET ${remotePath}…`;
        }
        emitLog(
          _evt.sender,
          msg,
          'info',
          progressMeta(
            index,
            total,
            'download',
            info.method === 'tar' || (total <= 1 && index < 1)
          )
        );
      });
      if (res.cancelled) {
        if (res.ok && (res.fileCount > 0 || res.localPath)) {
          emitLog(
            _evt.sender,
            `[SFTP] GET 已中断 · ${res.localPath || remotePath} · ${res.fileCount || 0} 文件`,
            'error',
            progressMeta(res.fileCount || 0, Math.max(1, res.fileCount || 1), 'download')
          );
        } else {
          emitLog(_evt.sender, '[SFTP] 下载已取消', 'error');
        }
        return { ...res, downloadDir };
      }
      if (res.isDir) {
        const total = Math.max(1, Number(res.fileCount) || 1);
        const okMsg =
          res.method === 'tar'
            ? `[SFTP] OK TAR GET ${res.localPath} · ${res.fileCount} 文件 · ${res.size}B`
            : `[SFTP] OK GET ${res.localPath} · ${res.fileCount} 文件 · ${res.size}B`;
        emitLog(
          _evt.sender,
          okMsg,
          'ok',
          progressMeta(total, total, 'download')
        );
      } else {
        emitLog(
          _evt.sender,
          `[SFTP] OK GET ${res.localPath || remotePath}${res.size != null ? ` ${res.size}B` : ''}`,
          'ok',
          progressMeta(1, 1, 'download')
        );
      }
      return { ok: true, ...res, downloadDir };
    } catch (e) {
      emitLog(_evt.sender, `[SFTP] FAIL GET：${e && e.message ? e.message : e}`, 'error');
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
      const treeWidth =
        payload.treeWidth != null ? normalizeTreeWidth(payload.treeWidth) : undefined;
      const patch = {};
      if (lastPath != null) patch.lastPath = lastPath;
      if (treeExpanded != null) patch.treeExpanded = treeExpanded;
      if (selectedPath != null) patch.selectedPath = selectedPath;
      if (selectedIsDir != null) patch.selectedIsDir = selectedIsDir;
      if (treeWidth != null) patch.treeWidth = treeWidth;
      const cfg = writeConfig(patch);
      return {
        ok: true,
        lastPath: cfg.lastPath,
        treeExpanded: cfg.treeExpanded,
        selectedPath: cfg.selectedPath,
        selectedIsDir: cfg.selectedIsDir,
        treeWidth: cfg.treeWidth,
      };
    } catch (e) {
      return errPayload(e);
    }
  });

  ipcMain.handle(REMOTE_SERVER.CANCEL_UPLOAD, async (_evt) => {
    uploadCancelRequested = true;
    session.cancelActiveUpload();
    emitLog(_evt.sender, '[SFTP] 正在取消上传…', 'error');
    return { ok: true };
  });

  ipcMain.handle(REMOTE_SERVER.CANCEL_DOWNLOAD, async (_evt) => {
    session.cancelActiveDownload();
    emitLog(_evt.sender, '[SFTP] 正在取消下载…', 'error');
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
