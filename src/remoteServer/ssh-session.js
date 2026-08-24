/**
 * @file ssh-session.js
 * 【功能】RemoteServer SSH/SFTP 会话（主进程单例）
 * 【职责】连接/断开、列目录、读写删、上传下载、媒体元信息
 * 【调用】register.js；媒体流式预览经 getSftpHandle → media-stream-server
 */
const fs = require('fs');
const { Client } = require('ssh2');
const path = require('path');

/** @type {import('ssh2').Client | null} */
let client = null;
/** @type {import('ssh2').SFTPWrapper | null} */
let sftp = null;
/** @type {{ host: string, port: number, username: string } | null} */
let connectedMeta = null;

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

function removePath(remotePath) {
  const s = withSftp();
  const p = normalizeRemotePath(remotePath);
  if (p === '/') return Promise.reject(new Error('不能删除根目录'));
  return new Promise((resolve, reject) => {
    s.stat(p, (err, st) => {
      if (err) return reject(err);
      const isDir = (st.mode & 0o170000) === 0o040000;
      if (!isDir) {
        return s.unlink(p, (e2) => (e2 ? reject(e2) : resolve({ ok: true, path: p })));
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
      rmdirRecursive(p)
        .then(() => resolve({ ok: true, path: p }))
        .catch(reject);
    });
  });
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

function getByStream(remote, localPath) {
  const s = withSftp();
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(localPath);
    const rs = s.createReadStream(remote);
    let settled = false;
    const fail = (e) => {
      if (settled) return;
      settled = true;
      try {
        fs.unlinkSync(localPath);
      } catch (_) {}
      reject(e instanceof Error ? e : new Error(String(e || '下载流失败')));
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
 * 下载远程文件到本机目录
 */
async function downloadRemoteFile(remotePath, localDir) {
  const remote = normalizeRemotePath(remotePath);
  const st = await sftpStat(remote);
  if ((st.mode & 0o170000) === 0o040000) {
    throw new Error('暂不支持下载文件夹，请选文件');
  }
  const baseName = path.posix.basename(remote) || 'download.bin';
  fs.mkdirSync(localDir, { recursive: true });
  const localPath = uniqueLocalPath(localDir, baseName);
  const s = withSftp();
  await new Promise((resolve, reject) => {
    s.fastGet(remote, localPath, (err) => {
      if (!err) return resolve();
      getByStream(remote, localPath).then(resolve).catch(reject);
    });
  });
  const localStat = fs.statSync(localPath);
  if (Number(localStat.size) !== Number(st.size)) {
    try {
      fs.unlinkSync(localPath);
    } catch (_) {}
    throw new Error(`下载校验失败: 本地 ${localStat.size} 字节 ≠ 远端 ${st.size} 字节`);
  }
  return {
    ok: true,
    remotePath: remote,
    localPath,
    size: localStat.size,
    fileName: path.basename(localPath),
  };
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
  mkdir,
  ensureRemoteDir,
  downloadRemoteFile,
  isMediaPath,
  downloadMedia,
  statMedia,
  getSftpHandle,
  MEDIA_MIME,
};
