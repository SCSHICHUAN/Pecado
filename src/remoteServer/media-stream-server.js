/**
 * @file media-stream-server.js
 * 【功能】本机 HTTP 代理：按 Range 从 SFTP 流式拉视频/音频，无需整文件下载
 * 【用法】createStreamUrl(info, getSftp) → http://127.0.0.1:<port>/v/<ticket>
 * 【清理】断开连接 / shutdown 时 stopServer()
 */
const http = require('http');
const crypto = require('crypto');

let server = null;
let listenPort = 0;
/** @type {Map<string, { remotePath: string, mime: string, size: number, kind: string, title: string }>} */
const tickets = new Map();
/** @type {null | (() => any)} */
let getSftpFn = null;

function parseRange(rangeHeader, size) {
  if (!rangeHeader || typeof rangeHeader !== 'string') return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!m) return null;
  let start = m[1] === '' ? NaN : parseInt(m[1], 10);
  let end = m[2] === '' ? NaN : parseInt(m[2], 10);
  if (Number.isNaN(start) && Number.isNaN(end)) return null;
  if (Number.isNaN(start)) {
    // bytes=-N → last N bytes
    const n = end;
    if (!Number.isFinite(n) || n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else if (Number.isNaN(end)) {
    end = size - 1;
  }
  if (start < 0 || end < start || start >= size) return null;
  end = Math.min(end, size - 1);
  return { start, end };
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range, Content-Type');
}

function ensureServer(getSftp) {
  getSftpFn = getSftp;
  if (server) return Promise.resolve(listenPort);
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      setCors(res);
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405);
        res.end('Method Not Allowed');
        return;
      }
      try {
        handleMediaRequest(req, res);
      } catch (e) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        }
        res.end(String(e && e.message ? e.message : e));
      }
    });
    server.on('error', (err) => {
      console.error('[remote-server-stream]', err);
      if (!listenPort) reject(err);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      listenPort = addr && addr.port ? addr.port : 0;
      console.log('[remote-server-stream] listening on', listenPort);
      resolve(listenPort);
    });
  });
}

function handleMediaRequest(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const parts = url.pathname.split('/').filter(Boolean);
  // /v/<ticket>
  if (parts[0] !== 'v' || !parts[1]) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const ticket = tickets.get(parts[1]);
  if (!ticket) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('预览已过期，请重新点击文件');
    return;
  }
  const sftp = typeof getSftpFn === 'function' ? getSftpFn() : null;
  if (!sftp) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('SFTP 未连接');
    return;
  }

  const { remotePath, mime, size } = ticket;
  const range = parseRange(req.headers.range, size);

  if (req.method === 'HEAD') {
    if (range) {
      const len = range.end - range.start + 1;
      res.writeHead(206, {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(len),
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      });
    } else {
      res.writeHead(200, {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(size),
      });
    }
    res.end();
    return;
  }

  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range) {
    start = range.start;
    end = range.end;
    status = 206;
  }
  const chunkSize = end - start + 1;
  const headers = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(chunkSize),
    'Cache-Control': 'no-store',
  };
  if (status === 206) {
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  res.writeHead(status, headers);

  const stream = sftp.createReadStream(remotePath, { start, end });
  const onClose = () => {
    try {
      stream.destroy();
    } catch (_) {}
  };
  req.on('close', onClose);
  stream.on('error', (err) => {
    console.error('[remote-server-stream] read error', remotePath, err && err.message);
    try {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    } catch (_) {}
  });
  stream.pipe(res);
}

/**
 * @param {{ remotePath: string, mime: string, size: number, kind: string, title: string }} info
 * @returns {Promise<string>} stream URL
 */
async function createStreamUrl(info, getSftp) {
  await ensureServer(getSftp);
  const id = crypto.randomBytes(12).toString('hex');
  tickets.set(id, {
    remotePath: info.remotePath,
    mime: info.mime,
    size: info.size,
    kind: info.kind,
    title: info.title,
  });
  // 简单清理：超过 40 个票根时删最旧的一半
  if (tickets.size > 40) {
    const keys = [...tickets.keys()];
    for (let i = 0; i < Math.floor(keys.length / 2); i++) tickets.delete(keys[i]);
  }
  return `http://127.0.0.1:${listenPort}/v/${id}`;
}

function clearTickets() {
  tickets.clear();
}

function stopServer() {
  clearTickets();
  if (server) {
    try {
      server.close();
    } catch (_) {}
    server = null;
    listenPort = 0;
  }
}

module.exports = {
  createStreamUrl,
  clearTickets,
  stopServer,
  ensureServer,
};
