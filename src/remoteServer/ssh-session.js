/**
 * @file ssh-session.js
 * 【功能】RemoteServer SSH/SFTP 会话（主进程单例）
 * 【职责】连接/断开、列目录、读写删、上传下载、媒体元信息
 * 【调用】register.js；媒体流式预览经 getSftpHandle → media-stream-server
 */
const fs = require('fs');
const { spawn } = require('child_process');
const { Client } = require('ssh2');
const path = require('path');

/** @type {import('ssh2').Client | null} */
let client = null;
/** @type {import('ssh2').SFTPWrapper | null} */
let sftp = null;
/** @type {{ host: string, port: number, username: string } | null} */
let connectedMeta = null;
/** @type {(() => void) | null} */
let activeUploadAbort = null;
/** @type {(() => void) | null} */
let activeDownloadAbort = null;
let downloadCancelRequested = false;

function cancelActiveUpload() {
  if (activeUploadAbort) {
    try {
      activeUploadAbort();
    } catch (_) {}
    activeUploadAbort = null;
  }
}

function resetDownloadCancel() {
  downloadCancelRequested = false;
  activeDownloadAbort = null;
}

function cancelActiveDownload() {
  downloadCancelRequested = true;
  if (activeDownloadAbort) {
    try {
      activeDownloadAbort();
    } catch (_) {}
  }
}

function throwIfDownloadCancelled() {
  if (downloadCancelRequested) {
    const err = new Error('下载已取消');
    err.code = 'DOWNLOAD_CANCELLED';
    throw err;
  }
}

function walkLocalFilesSync(localDir, onFile, relBase = '') {
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
      walkLocalFilesSync(abs, onFile, rel);
    } else if (ent.isFile()) {
      onFile(abs, rel.replace(/\\/g, '/'));
    }
  }
}

// —— 连接状态 ——

function isConnected() {
  return Boolean(client && sftp && connectedMeta);
}

function getStatus() {
  if (!isConnected()) {
    return { connected: false, host: '', username: '', port: 22 };
  }
  return {
    connected: true,
    host: connectedMeta.host,
    username: connectedMeta.username,
    port: connectedMeta.port,
  };
}

function normalizeRemotePath(p) {
  let s = String(p || '/').trim() || '/';
  if (!s.startsWith('/')) s = `/${s}`;
  s = s.replace(/\/+/g, '/');
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s || '/';
}

function withSftp() {
  if (!isConnected()) {
    const err = new Error('未连接服务器');
    err.code = 'NOT_CONNECTED';
    throw err;
  }
  return sftp;
}

function withClient() {
  if (!client || !connectedMeta) {
    const err = new Error('未连接服务器');
    err.code = 'NOT_CONNECTED';
    throw err;
  }
  return client;
}

/** POSIX shell 单引号转义，供 rm 等远程命令使用 */
function shellQuotePosix(p) {
  return `'${String(p).replace(/'/g, `'\\''`)}'`;
}

/** 在远端执行 shell 命令（比 SFTP 逐文件删目录快得多） */
function execRemote(command) {
  const c = withClient();
  return new Promise((resolve, reject) => {
    c.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stderr = '';
      let stdout = '';
      stream.on('close', (code) => {
        if (code !== 0) {
          const msg = stderr.trim() || stdout.trim() || `命令失败 (exit ${code})`;
          const e = new Error(msg);
          e.code = 'EXEC_FAILED';
          e.exitCode = code;
          reject(e);
        } else {
          resolve({ stdout, stderr });
        }
      });
      stream.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      stream.stdout.on('data', (d) => {
        stdout += d.toString();
      });
    });
  });
}

function sftpStat(remotePath) {
  const s = withSftp();
  const p = normalizeRemotePath(remotePath);
  return new Promise((resolve, reject) => {
    s.stat(p, (err, st) => (err ? reject(err) : resolve(st)));
  });
}

function sftpRealpath(remotePath) {
  const s = withSftp();
  const p = normalizeRemotePath(remotePath);
  return new Promise((resolve, reject) => {
    s.realpath(p, (err, abs) => (err ? reject(err) : resolve(abs || p)));
  });
}

function sftpReaddirNames(remotePath) {
  const s = withSftp();
  const p = normalizeRemotePath(remotePath);
  return new Promise((resolve, reject) => {
    s.readdir(p, (err, list) => {
      if (err) return reject(err);
      resolve((list || []).map((e) => e.filename).filter((n) => n && n !== '.' && n !== '..'));
    });
  });
}

function disconnect() {
  try {
    if (sftp) sftp.end();
  } catch (_) {}
  try {
    if (client) client.end();
  } catch (_) {}
  sftp = null;
  client = null;
  connectedMeta = null;
}

/** 建立 SSH 并打开 SFTP；成功后写入单例 client/sftp */
function connect({ host, port, username, password, readyTimeout }) {
  return new Promise((resolve, reject) => {
    disconnect();
    const h = String(host || '').trim();
    const u = String(username || '').trim();
    const pwd = password != null ? String(password) : '';
    const pt = parseInt(String(port || 22), 10) || 22;
    if (!h) return reject(new Error('请填写主机地址'));
    if (!u) return reject(new Error('请填写用户名'));
    if (!pwd) return reject(new Error('请填写密码'));

    const c = new Client();
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try {
        c.end();
      } catch (_) {}
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    c.on('ready', () => {
      c.sftp((err, s) => {
        if (err) return fail(err);
        client = c;
        sftp = s;
        connectedMeta = { host: h, port: pt, username: u };
        settled = true;
        resolve(getStatus());
      });
    });
    c.on('error', fail);
    c.connect({
      host: h,
      port: pt,
      username: u,
      password: pwd,
      readyTimeout: readyTimeout || 20000,
      tryKeyboard: false,
    });
  });
}

// —— 远端目录 / 文本读写 ——

/** 列目录：目录在前，名称按中文 locale 排序 */
function listDir(remotePath) {
  const s = withSftp();
  const dir = normalizeRemotePath(remotePath);
  return new Promise((resolve, reject) => {
    s.readdir(dir, (err, list) => {
      if (err) return reject(err);
      const items = (list || [])
        .filter((e) => e.filename !== '.' && e.filename !== '..')
        .map((e) => {
          const attrs = e.attrs || {};
          const mode = attrs.mode || 0;
          const isDir = (mode & 0o170000) === 0o040000;
          const isLink = (mode & 0o170000) === 0o120000;
          return {
            name: e.filename,
            path: dir === '/' ? `/${e.filename}` : `${dir}/${e.filename}`,
            isDir,
            isLink,
            size: attrs.size || 0,
            mtime: attrs.mtime ? attrs.mtime * 1000 : 0,
          };
        })
        .sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name, 'zh');
        });
      resolve({ path: dir, items });
    });
  });
}

function readFile(remotePath, maxBytes = 2 * 1024 * 1024) {
  const s = withSftp();
  const p = normalizeRemotePath(remotePath);
  return new Promise((resolve, reject) => {
    s.stat(p, (err, st) => {
      if (err) return reject(err);
      if ((st.mode & 0o170000) === 0o040000) {
        return reject(new Error('不能打开文件夹'));
      }
      if (st.size > maxBytes) {
        return reject(
          new Error(`文件过大（>${Math.round(maxBytes / 1024 / 1024)}MB），请用其它方式下载`)
        );
      }
      s.readFile(p, (err2, data) => {
        if (err2) return reject(err2);
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data || '');
        const sample = buf.subarray(0, Math.min(buf.length, 8000));
        let nul = 0;
        for (let i = 0; i < sample.length; i++) if (sample[i] === 0) nul++;
        if (nul > 0) {
          return reject(new Error('疑似二进制文件，暂不支持在线编辑'));
        }
        resolve({
          path: p,
          content: buf.toString('utf8'),
          size: st.size,
        });
      });
    });
  });
}

function writeFile(remotePath, content) {
  const s = withSftp();
  const p = normalizeRemotePath(remotePath);
  const buf = Buffer.from(content != null ? String(content) : '', 'utf8');
  return new Promise((resolve, reject) => {
    s.writeFile(p, buf, (err) => {
      if (err) return reject(err);
      resolve({ ok: true, path: p, size: buf.length });
    });
  });
}

/** SFTP 逐层递归删除（exec 不可用时的回退） */
function removePathSftp(p, isDir) {
  const s = withSftp();
  if (!isDir) {
    return new Promise((resolve, reject) => {
      s.unlink(p, (e) => (e ? reject(e) : resolve()));
    });
  }
  const rmdirRecursive = (dir) =>
    new Promise((res, rej) => {
      s.readdir(dir, (e3, list) => {
        if (e3) return rej(e3);
        const entries = (list || []).filter((x) => x.filename !== '.' && x.filename !== '..');
        let i = 0;
        const next = () => {
          if (i >= entries.length) {
            return s.rmdir(dir, (e4) => (e4 ? rej(e4) : res()));
          }
          const name = entries[i++].filename;
          const child = dir === '/' ? `/${name}` : `${dir}/${name}`;
          s.stat(child, (e5, st2) => {
            if (e5) return rej(e5);
            const childDir = (st2.mode & 0o170000) === 0o040000;
            const done = (e6) => (e6 ? rej(e6) : next());
            if (childDir) rmdirRecursive(child).then(() => next()).catch(rej);
            else s.unlink(child, done);
          });
        };
        next();
      });
    });
  return rmdirRecursive(p);
}

async function removePath(remotePath) {
  const p = normalizeRemotePath(remotePath);
  if (p === '/') throw new Error('不能删除根目录');

  let st;
  try {
    st = await sftpStat(p);
  } catch (e) {
    throw e;
  }
  const isDir = (st.mode & 0o170000) === 0o040000;

  // 优先在服务端 rm，一次命令删整棵目录树
  try {
    const cmd = isDir
      ? `rm -rf -- ${shellQuotePosix(p)}`
      : `rm -f -- ${shellQuotePosix(p)}`;
    await execRemote(cmd);
    return { ok: true, path: p, method: 'exec' };
  } catch (_) {
    await removePathSftp(p, isDir);
    return { ok: true, path: p, method: 'sftp' };
  }
}

// —— 上传 / 下载 / 建目录 ——

function putByStream(localPath, remote) {
  const s = withSftp();
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(localPath);
    const ws = s.createWriteStream(remote);
    let settled = false;
    const fail = (e) => {
      if (settled) return;
      settled = true;
      reject(e instanceof Error ? e : new Error(String(e || '上传流失败')));
    };
    const ok = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    rs.on('error', fail);
    ws.on('error', fail);
    ws.on('finish', ok);
    rs.pipe(ws);
  });
}

/**
 * 上传后强制校验：父目录存在、远端文件大小一致、目录列表能看到文件名
 */
async function uploadLocalFile(localPath, remotePath) {
  const s = withSftp();
  const remote = normalizeRemotePath(remotePath);
  const remoteDir = path.posix.dirname(remote);
  const baseName = path.posix.basename(remote);
  if (!fs.existsSync(localPath)) {
    throw new Error(`本地文件不存在: ${localPath}`);
  }
  const localSize = fs.statSync(localPath).size;

  let parentStat;
  try {
    parentStat = await sftpStat(remoteDir);
  } catch (e) {
    throw new Error(`远程目录不存在或不可访问: ${remoteDir}（${e.message || e}）`);
  }
  if ((parentStat.mode & 0o170000) !== 0o040000) {
    throw new Error(`远程路径不是目录: ${remoteDir}`);
  }

  let realDir = remoteDir;
  try {
    realDir = await sftpRealpath(remoteDir);
  } catch (_) {}
  realDir = normalizeRemotePath(realDir);

  const dest = realDir === '/' ? `/${baseName}` : `${realDir}/${baseName}`;

  await new Promise((resolve, reject) => {
    s.fastPut(localPath, dest, (err) => {
      if (!err) return resolve();
      putByStream(localPath, dest)
        .then(resolve)
        .catch((e2) => {
          reject(new Error(`上传失败: ${e2.message || err.message || err}`));
        });
    });
  });

  await new Promise((r) => setTimeout(r, 80));

  let st;
  try {
    st = await sftpStat(dest);
  } catch (e) {
    throw new Error(`上传后找不到文件: ${dest}（${e.message || e}）`);
  }
  if ((st.mode & 0o170000) === 0o040000) {
    throw new Error(`上传目标变成了目录: ${dest}`);
  }
  if (Number(st.size) !== Number(localSize)) {
    throw new Error(`上传校验失败: ${dest} 远端 ${st.size} 字节 ≠ 本地 ${localSize} 字节`);
  }

  let names = [];
  try {
    names = await sftpReaddirNames(realDir);
  } catch (e) {
    throw new Error(`上传后无法列出目录 ${realDir}: ${e.message || e}`);
  }
  if (!names.includes(baseName)) {
    throw new Error(
      `上传校验失败: 目录 ${realDir} 的列表中没有 ${baseName}（当前共 ${names.length} 项）`
    );
  }

  let realFile = dest;
  try {
    realFile = await sftpRealpath(dest);
  } catch (_) {}

  return {
    ok: true,
    path: dest,
    realPath: realFile,
    size: st.size,
    dir: realDir,
  };
}

/**
 * 文件夹快速上传：本机 tar.gz 经 SSH 管道在远端解压（比 SFTP 逐文件快得多）
 */
async function uploadLocalDirViaTar(localDir, remoteParentDir) {
  cancelActiveUpload();
  const absLocal = path.resolve(localDir);
  if (!fs.existsSync(absLocal) || !fs.statSync(absLocal).isDirectory()) {
    throw new Error('不是本地文件夹');
  }
  const baseName = path.basename(absLocal);
  const parent = path.dirname(absLocal);
  const remoteParent = normalizeRemotePath(remoteParentDir);
  const remoteRoot =
    remoteParent === '/' ? `/${baseName}` : `${remoteParent}/${baseName}`.replace(/\/+/g, '/');

  await ensureRemoteDir(remoteParent);

  return new Promise((resolve, reject) => {
    const c = withClient();
    const extractCmd = `tar xzf - -C ${shellQuotePosix(remoteParent)}`;
    const TAR_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;

    c.exec(extractCmd, (err, stream) => {
      if (err) return reject(err);

      const tarProc = spawn('tar', ['czf', '-', '-C', parent, baseName], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let remoteErr = '';
      let tarErr = '';
      let remoteExit = null;
      let tarClosed = false;
      let streamClosed = false;
      let settled = false;

      const buildResult = () => {
        const files = [];
        let totalSize = 0;
        walkLocalFilesSync(absLocal, (abs, rel) => {
          const rp = rel
            ? `${remoteRoot}/${rel}`.replace(/\/+/g, '/')
            : remoteRoot;
          const st = fs.statSync(abs);
          files.push({
            path: normalizeRemotePath(rp),
            localPath: abs,
            size: st.size,
          });
          totalSize += st.size;
        });
        return {
          ok: true,
          remoteRoot: normalizeRemotePath(remoteRoot),
          path: normalizeRemotePath(remoteRoot),
          realPath: normalizeRemotePath(remoteRoot),
          dir: remoteParent,
          kind: 'dir',
          fileCount: files.length,
          size: totalSize,
          files,
          method: 'tar',
        };
      };

      const finish = (e, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        activeUploadAbort = null;
        try {
          tarProc.kill('SIGKILL');
        } catch (_) {}
        if (e) reject(e);
        else resolve(result);
      };

      const tryFinishSuccess = () => {
        if (settled || !tarClosed || !streamClosed) return;
        const code = remoteExit;
        if (code != null && code !== 0) {
          finish(new Error(remoteErr.trim() || `远端解压失败 (exit ${code})`));
          return;
        }
        finish(null, buildResult());
      };

      const timer = setTimeout(() => {
        finish(new Error('文件夹上传超时（30 分钟）'));
      }, TAR_UPLOAD_TIMEOUT_MS);

      activeUploadAbort = () => {
        finish(new Error('上传已取消'));
      };

      // 必须消费远端 stdout，否则管道阻塞会导致 channel 永不 close
      stream.stdout.on('data', () => {});
      stream.stderr.on('data', (d) => {
        remoteErr += d.toString();
      });
      tarProc.stderr.on('data', (d) => {
        tarErr += d.toString();
      });

      tarProc.on('error', (e) => {
        if (e.code === 'ENOENT') {
          finish(new Error('本机未找到 tar 命令，无法快速上传文件夹'));
        } else {
          finish(e);
        }
      });

      tarProc.stdout.on('error', () => {});
      stream.stdin.on('error', () => {});

      tarProc.stdout.pipe(stream.stdin);

      tarProc.on('close', (code) => {
        if (code !== 0 && !settled) {
          finish(new Error(tarErr.trim() || `本地打包失败 (exit ${code})`));
          return;
        }
        tarClosed = true;
        try {
          stream.stdin.end();
        } catch (_) {}
        tryFinishSuccess();
      });

      stream.on('exit', (code) => {
        remoteExit = code;
      });

      stream.on('close', (code) => {
        if (settled) return;
        if (remoteExit == null && code != null) remoteExit = code;
        streamClosed = true;
        tryFinishSuccess();
      });
    });
  });
}

function mkdir(remotePath) {
  const s = withSftp();
  const p = normalizeRemotePath(remotePath);
  return new Promise((resolve, reject) => {
    s.mkdir(p, (err) => {
      if (err) return reject(err);
      resolve({ ok: true, path: p });
    });
  });
}

async function ensureRemoteDir(remotePath) {
  const p = normalizeRemotePath(remotePath);
  if (!p || p === '/') return { ok: true, path: '/' };
  const parts = p.split('/').filter(Boolean);
  let cur = '';
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : `/${part}`;
    try {
      await mkdir(cur);
    } catch (e) {
      try {
        const st = await sftpStat(cur);
        if ((st.mode & 0o170000) !== 0o040000) throw e;
      } catch (_) {
        throw e;
      }
    }
  }
  return { ok: true, path: p };
}

function uniqueLocalPath(dir, baseName) {
  const ext = path.extname(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  let candidate = path.join(dir, baseName);
  if (!fs.existsSync(candidate)) return candidate;
  for (let i = 1; i < 1000; i++) {
    candidate = path.join(dir, `${stem} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${stem}-${Date.now()}${ext}`);
}

function uniqueLocalDir(dir, folderName) {
  let candidate = path.join(dir, folderName);
  if (!fs.existsSync(candidate)) return candidate;
  for (let i = 1; i < 1000; i++) {
    candidate = path.join(dir, `${folderName} (${i})`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${folderName}-${Date.now()}`);
}

function getByStream(remote, localPath) {
  const s = withSftp();
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(localPath);
    const rs = s.createReadStream(remote);
    let settled = false;
    const cleanup = () => {
      activeDownloadAbort = null;
    };
    const fail = (e) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        rs.destroy();
      } catch (_) {}
      try {
        ws.destroy();
      } catch (_) {}
      try {
        fs.unlinkSync(localPath);
      } catch (_) {}
      reject(e instanceof Error ? e : new Error(String(e || '下载流失败')));
    };
    const ok = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    activeDownloadAbort = () => fail(new Error('下载已取消'));
    rs.on('error', fail);
    ws.on('error', fail);
    ws.on('finish', ok);
    rs.pipe(ws);
  });
}

/**
 * 下载单个远程文件到指定本机路径（父目录会自动创建）
 */
async function downloadRemoteFileTo(remotePath, localPath) {
  throwIfDownloadCancelled();
  const remote = normalizeRemotePath(remotePath);
  const st = await sftpStat(remote);
  if ((st.mode & 0o170000) === 0o040000) {
    throw new Error('期望文件');
  }
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const s = withSftp();
  await new Promise((resolve, reject) => {
    activeDownloadAbort = () => {
      downloadCancelRequested = true;
    };
    s.fastGet(remote, localPath, (err) => {
      activeDownloadAbort = null;
      if (downloadCancelRequested) {
        try {
          fs.unlinkSync(localPath);
        } catch (_) {}
        return reject(new Error('下载已取消'));
      }
      if (!err) return resolve();
      getByStream(remote, localPath).then(resolve).catch(reject);
    });
  });
  throwIfDownloadCancelled();
  const localStat = fs.statSync(localPath);
  if (Number(localStat.size) !== Number(st.size)) {
    try {
      fs.unlinkSync(localPath);
    } catch (_) {}
    throw new Error(`下载校验失败: 本地 ${localStat.size} 字节 ≠ 远端 ${st.size} 字节`);
  }
  return { localPath, size: localStat.size, remotePath: remote };
}

function buildDownloadCancelledResult(partial) {
  const files = partial.files || [];
  const hasFiles = files.length > 0;
  return {
    ok: hasFiles,
    cancelled: true,
    error: hasFiles ? undefined : '下载已取消',
    remotePath: partial.remotePath,
    localPath: partial.localPath,
    isDir: Boolean(partial.isDir),
    fileCount: files.length,
    size: partial.size || 0,
    files,
    fileName: partial.fileName,
    warning: hasFiles ? '下载已中断' : undefined,
  };
}

function clearLocalDirContents(dirPath) {
  const abs = path.resolve(dirPath);
  if (!fs.existsSync(abs)) return;
  for (const ent of fs.readdirSync(abs)) {
    fs.rmSync(path.join(abs, ent), { recursive: true, force: true });
  }
}

function collectLocalDownloadFiles(localRoot, remoteDir) {
  const remote = normalizeRemotePath(remoteDir);
  const absLocal = path.resolve(localRoot);
  const files = [];
  let totalSize = 0;
  walkLocalFilesSync(absLocal, (abs, rel) => {
    const rp = rel ? `${remote}/${rel}`.replace(/\/+/g, '/') : remote;
    const st = fs.statSync(abs);
    files.push({
      localPath: abs,
      path: normalizeRemotePath(rp),
      remotePath: normalizeRemotePath(rp),
      size: st.size,
    });
    totalSize += st.size;
  });
  return { files, totalSize };
}

/**
 * 文件夹快速下载：远端 tar.gz 经 SSH 管道在本机解压（比 SFTP 逐文件快得多）
 */
async function downloadRemoteDirViaTar(remoteDir, localRoot) {
  const remote = normalizeRemotePath(remoteDir);
  const absLocal = path.resolve(localRoot);
  fs.mkdirSync(absLocal, { recursive: true });

  return new Promise((resolve, reject) => {
    const c = withClient();
    const packCmd = `tar czf - -C ${shellQuotePosix(remote)} .`;
    const TAR_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

    c.exec(packCmd, (err, stream) => {
      if (err) return reject(err);

      const tarProc = spawn('tar', ['xzf', '-', '-C', absLocal], {
        stdio: ['pipe', 'ignore', 'pipe'],
      });

      let remoteErr = '';
      let tarErr = '';
      let remoteExit = null;
      let tarClosed = false;
      let streamClosed = false;
      let settled = false;

      const buildResult = () => {
        const { files, totalSize } = collectLocalDownloadFiles(absLocal, remote);
        return {
          ok: true,
          fileCount: files.length,
          size: totalSize,
          files,
          method: 'tar',
        };
      };

      const finish = (e, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        activeDownloadAbort = null;
        try {
          tarProc.kill('SIGKILL');
        } catch (_) {}
        if (e) reject(e);
        else resolve(result);
      };

      const tryFinishSuccess = () => {
        if (settled || !tarClosed || !streamClosed) return;
        if (remoteExit != null && remoteExit !== 0) {
          finish(new Error(remoteErr.trim() || `远端打包失败 (exit ${remoteExit})`));
          return;
        }
        finish(null, buildResult());
      };

      const timer = setTimeout(() => {
        finish(new Error('文件夹下载超时（30 分钟）'));
      }, TAR_DOWNLOAD_TIMEOUT_MS);

      activeDownloadAbort = () => {
        finish(new Error('下载已取消'));
      };

      stream.stderr.on('data', (d) => {
        remoteErr += d.toString();
      });
      tarProc.stderr.on('data', (d) => {
        tarErr += d.toString();
      });

      tarProc.on('error', (e) => {
        if (e.code === 'ENOENT') {
          finish(new Error('本机未找到 tar 命令，无法快速下载文件夹'));
        } else {
          finish(e);
        }
      });

      stream.stdout.on('error', () => {});
      tarProc.stdin.on('error', () => {});

      stream.stdout.pipe(tarProc.stdin);

      stream.on('exit', (code) => {
        remoteExit = code;
      });

      stream.on('close', () => {
        streamClosed = true;
        try {
          tarProc.stdin.end();
        } catch (_) {}
        tryFinishSuccess();
      });

      tarProc.on('close', (code) => {
        if (code !== 0 && !settled) {
          finish(new Error(tarErr.trim() || `本地解压失败 (exit ${code})`));
          return;
        }
        tarClosed = true;
        tryFinishSuccess();
      });
    });
  });
}

async function walkRemoteFiles(remoteDir, onFile, relBase = '') {
  const { items } = await listDir(remoteDir);
  for (const item of items) {
    if (item.isLink) continue;
    const rel = relBase ? `${relBase}/${item.name}` : item.name;
    if (item.isDir) {
      await walkRemoteFiles(item.path, onFile, rel);
    } else {
      await onFile(item.path, rel, item.size);
    }
  }
}

/**
 * 下载远程文件夹到本机目录（SFTP 逐文件，TAR 失败时的回退）
 */
async function downloadRemoteFolderViaSftp(remotePath, localRoot, onProgress) {
  const remote = normalizeRemotePath(remotePath);
  const jobs = [];
  await walkRemoteFiles(remote, async (remoteFile, rel) => {
    jobs.push({ remoteFile, rel });
  });

  const files = [];
  let totalSize = 0;
  const total = jobs.length;
  if (onProgress && total > 0) {
    onProgress({
      remotePath: remote,
      rel: '',
      localPath: localRoot,
      index: 0,
      total,
      method: 'sftp',
    });
  }
  for (let i = 0; i < jobs.length; i++) {
    throwIfDownloadCancelled();
    const { remoteFile, rel } = jobs[i];
    const localPath = path.join(localRoot, rel.split('/').join(path.sep));
    if (onProgress) {
      onProgress({
        remotePath: remoteFile,
        rel,
        localPath,
        index: i + 1,
        total,
        method: 'sftp',
      });
    }
    try {
      const r = await downloadRemoteFileTo(remoteFile, localPath);
      files.push(r);
      totalSize += r.size;
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (downloadCancelRequested || msg === '下载已取消' || e.code === 'DOWNLOAD_CANCELLED') {
        return buildDownloadCancelledResult({
          remotePath: remote,
          localPath: localRoot,
          isDir: true,
          files,
          size: totalSize,
          fileName: path.basename(localRoot),
        });
      }
      throw e;
    }
  }

  return {
    ok: true,
    remotePath: remote,
    localPath: localRoot,
    isDir: true,
    fileCount: files.length,
    size: totalSize,
    files,
    fileName: path.basename(localRoot),
    method: 'sftp',
  };
}

/**
 * 下载远程文件夹到本机目录（优先 TAR 管道，失败回退 SFTP 逐文件）
 * @param {(info: object) => void} [onProgress]
 */
async function downloadRemoteFolder(remotePath, localDir, onProgress) {
  const remote = normalizeRemotePath(remotePath);
  const st = await sftpStat(remote);
  if ((st.mode & 0o170000) !== 0o040000) {
    throw new Error('期望文件夹');
  }
  const folderName = path.posix.basename(remote) || 'folder';
  fs.mkdirSync(localDir, { recursive: true });
  const localRoot = uniqueLocalDir(localDir, folderName);
  fs.mkdirSync(localRoot, { recursive: true });

  let fileCount = 0;
  await walkRemoteFiles(remote, async () => {
    fileCount += 1;
  });
  if (fileCount === 0) {
    return {
      ok: true,
      remotePath: remote,
      localPath: localRoot,
      isDir: true,
      fileCount: 0,
      size: 0,
      files: [],
      fileName: path.basename(localRoot),
      method: 'sftp',
    };
  }

  try {
    if (onProgress) {
      onProgress({
        remotePath: remote,
        rel: '',
        localPath: localRoot,
        index: 0,
        total: 1,
        method: 'tar',
      });
    }
    const tarResult = await downloadRemoteDirViaTar(remote, localRoot);
    if (onProgress) {
      onProgress({
        remotePath: remote,
        rel: '',
        localPath: localRoot,
        index: 1,
        total: 1,
        method: 'tar',
      });
    }
    return {
      ok: true,
      remotePath: remote,
      localPath: localRoot,
      isDir: true,
      fileName: path.basename(localRoot),
      ...tarResult,
    };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (downloadCancelRequested || msg === '下载已取消' || e.code === 'DOWNLOAD_CANCELLED') {
      const partial = collectLocalDownloadFiles(localRoot, remote);
      return buildDownloadCancelledResult({
        remotePath: remote,
        localPath: localRoot,
        isDir: true,
        files: partial.files,
        size: partial.totalSize,
        fileName: path.basename(localRoot),
      });
    }
    clearLocalDirContents(localRoot);
    console.log('[remote-server] TAR download failed, fallback SFTP:', msg);
    return downloadRemoteFolderViaSftp(remote, localRoot, onProgress);
  }
}

/**
 * 下载远程文件或文件夹到本机目录
 * @param {(info: object) => void} [onProgress] 文件夹下载时逐文件回调
 */
async function downloadRemotePath(remotePath, localDir, onProgress) {
  resetDownloadCancel();
  const remote = normalizeRemotePath(remotePath);
  const st = await sftpStat(remote);
  if ((st.mode & 0o170000) === 0o040000) {
    return downloadRemoteFolder(remote, localDir, onProgress);
  }
  throwIfDownloadCancelled();
  const baseName = path.posix.basename(remote) || 'download.bin';
  fs.mkdirSync(localDir, { recursive: true });
  const localPath = uniqueLocalPath(localDir, baseName);
  try {
    const r = await downloadRemoteFileTo(remote, localPath);
    return {
      ok: true,
      remotePath: remote,
      localPath: r.localPath,
      isDir: false,
      fileCount: 1,
      size: r.size,
      fileName: path.basename(r.localPath),
    };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (downloadCancelRequested || msg === '下载已取消' || e.code === 'DOWNLOAD_CANCELLED') {
      try {
        fs.unlinkSync(localPath);
      } catch (_) {}
      return {
        ok: false,
        cancelled: true,
        error: '下载已取消',
        remotePath: remote,
        isDir: false,
      };
    }
    throw e;
  }
}

/**
 * 下载远程文件到本机目录（兼容旧名；亦支持文件夹）
 */
async function downloadRemoteFile(remotePath, localDir, onProgress) {
  return downloadRemotePath(remotePath, localDir, onProgress);
}

const MEDIA_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
};

// —— 媒体：类型判断 / 落盘缓存（流式失败时的回退） ——

function mediaKindOf(mime) {
  if (!mime) return '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  return '';
}

function isMediaPath(remotePath) {
  const ext = path.posix.extname(String(remotePath || '')).toLowerCase();
  return Boolean(MEDIA_MIME[ext]);
}

/**
 * 仅探测媒体元信息（不下载），供流式预览使用
 */
function statMedia(remotePath) {
  const remote = normalizeRemotePath(remotePath);
  const ext = path.posix.extname(remote).toLowerCase();
  const mime = MEDIA_MIME[ext];
  if (!mime) {
    return Promise.reject(new Error('不支持预览该媒体类型'));
  }
  const kind = mediaKindOf(mime);
  return sftpStat(remote).then((st) => {
    if ((st.mode & 0o170000) === 0o040000) {
      throw new Error('不能预览文件夹');
    }
    return {
      path: remote,
      mime,
      kind,
      size: st.size || 0,
      title: path.posix.basename(remote),
    };
  });
}

function getSftpHandle() {
  return withSftp();
}

/**
 * 把远程媒体下载到本地缓存，返回可预览的路径（小图/PDF 可选用）
 */
function downloadMedia(remotePath, cacheDir, maxBytes = 80 * 1024 * 1024) {
  const s = withSftp();
  const remote = normalizeRemotePath(remotePath);
  const ext = path.posix.extname(remote).toLowerCase();
  const mime = MEDIA_MIME[ext];
  if (!mime) {
    return Promise.reject(new Error('不支持预览该媒体类型'));
  }
  const kind = mediaKindOf(mime);
  const base = path.posix.basename(remote) || `media${ext || '.bin'}`;
  const safe = base.replace(/[^\w.\u4e00-\u9fff-]+/g, '_');
  fs.mkdirSync(cacheDir, { recursive: true });
  const localPath = path.join(cacheDir, `${Date.now()}-${safe}`);

  return new Promise((resolve, reject) => {
    s.stat(remote, (err, st) => {
      if (err) return reject(err);
      if ((st.mode & 0o170000) === 0o040000) {
        return reject(new Error('不能预览文件夹'));
      }
      if (st.size > maxBytes) {
        return reject(
          new Error(`文件过大（>${Math.round(maxBytes / 1024 / 1024)}MB），无法预览`)
        );
      }
      s.fastGet(remote, localPath, (err2) => {
        if (err2) {
          // fallback stream
          const ws = fs.createWriteStream(localPath);
          const rs = s.createReadStream(remote);
          let settled = false;
          const fail = (e) => {
            if (settled) return;
            settled = true;
            try {
              fs.unlinkSync(localPath);
            } catch (_) {}
            reject(e instanceof Error ? e : new Error(String(e || err2)));
          };
          const ok = () => {
            if (settled) return;
            settled = true;
            resolve({
              ok: true,
              path: remote,
              localPath,
              mime,
              kind,
              size: st.size,
              title: path.posix.basename(remote),
            });
          };
          rs.on('error', fail);
          ws.on('error', fail);
          ws.on('finish', ok);
          rs.pipe(ws);
          return;
        }
        resolve({
          ok: true,
          path: remote,
          localPath,
          mime,
          kind,
          size: st.size,
          title: path.posix.basename(remote),
        });
      });
    });
  });
}

module.exports = {
  connect,
  disconnect,
  isConnected,
  getStatus,
  normalizeRemotePath,
  listDir,
  readFile,
  writeFile,
  removePath,
  uploadLocalFile,
  uploadLocalDirViaTar,
  cancelActiveUpload,
  cancelActiveDownload,
  resetDownloadCancel,
  mkdir,
  ensureRemoteDir,
  downloadRemoteFile,
  downloadRemotePath,
  isMediaPath,
  downloadMedia,
  statMedia,
  getSftpHandle,
  MEDIA_MIME,
};
