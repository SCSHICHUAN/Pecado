/**
 * @file file-download-server.js
 * 【功能】局域网 HTTP 文件服务（目录层级浏览 + 预览/下载）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getFileTypeInfo, getMimeType, isPreviewable } = require('../../shared/file-type');
const { ensureVideoThumbnail, thumbUrlForRel, getVideoThumbnailCacheStats } = require('./video-thumbnail');

const DEFAULT_PORT = 8765;
const MAX_LOG = 200;

/** iOS「文件」→ 我的 iPhone → 下载（Safari 默认保存位置） */
const IOS_FILES_DOWNLOADS_URL =
  'shareddocuments:///private/var/mobile/Containers/Shared/AppGroup/70C1E25C-347D-4D36-8184-BDEF619B7C03/File%20Provider%20Storage/Downloads';

/** @type {import('http').Server | null} */
let server = null;
let rootDir = '';
let port = DEFAULT_PORT;
/** @type {Array<object>} */
let accessLog = [];

function getLocalIPv4Addresses() {
  const nets = os.networkInterfaces();
  /** @type {string[]} */
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function normalizeRelDir(rel) {
  return String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

/**
 * @param {string} root
 * @param {string} requestPath
 */
function resolveSafePath(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0] || '/');
  const rel = normalizeRelDir(decoded);
  if (!rel) return path.resolve(root);
  const abs = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    return null;
  }
  return abs;
}

function relFromRoot(absPath) {
  const rel = path.relative(rootDir, absPath);
  return rel === '' ? '' : rel.split(path.sep).join('/');
}

function pathToUrl(rel) {
  const r = normalizeRelDir(rel);
  if (!r) return '/';
  return `/${r.split('/').map(encodeURIComponent).join('/')}`;
}

function dirToUrl(relDir) {
  const r = normalizeRelDir(relDir);
  if (!r) return '/';
  return `${pathToUrl(r)}/`;
}

function parentRelDir(relDir) {
  const parts = normalizeRelDir(relDir).split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function pushLog(entry) {
  accessLog.unshift(entry);
  if (accessLog.length > MAX_LOG) accessLog.length = MAX_LOG;
}

/**
 * @param {string} root
 * @param {string} [relDir]
 */
function listDirectoryContents(root, relDir = '') {
  const rel = normalizeRelDir(relDir);
  const abs = rel ? path.join(root, rel) : root;
  const rootResolved = path.resolve(root);
  const absResolved = path.resolve(abs);
  if (absResolved !== rootResolved && !absResolved.startsWith(rootResolved + path.sep)) {
    return null;
  }
  if (!fs.existsSync(absResolved) || !fs.statSync(absResolved).isDirectory()) {
    return null;
  }

  /** @type {Array<{ name: string, rel: string, type: 'dir' }>} */
  const dirs = [];
  /** @type {Array<{ name: string, rel: string, size: number, type: 'file' }>} */
  const files = [];

  let entries;
  try {
    entries = fs.readdirSync(absResolved, { withFileTypes: true });
  } catch {
    return { relDir: rel, dirs: [], files: [] };
  }

  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const childRel = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      dirs.push({ name: ent.name, rel: childRel, type: 'dir' });
    } else if (ent.isFile()) {
      try {
        const st = fs.statSync(path.join(absResolved, ent.name));
        files.push({ name: ent.name, rel: childRel, size: st.size, type: 'file' });
      } catch (_) {
        /* skip */
      }
    }
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return { relDir: rel, dirs, files };
}

function enrichBrowseEntry(entry) {
  if (entry.type === 'dir') {
    return {
      ...entry,
      kind: 'folder',
      label: '文件夹',
      icon: '📁',
    };
  }
  const type = getFileTypeInfo(entry.name);
  const base = {
    ...entry,
    kind: type.kind,
    label: type.label,
    icon: type.icon,
    previewable: isPreviewable(entry.name),
  };
  if (type.kind === 'video') {
    base.thumbPath = thumbUrlForRel(entry.rel);
  }
  return base;
}

function fileIconInnerHtml(f, type) {
  if (type.kind === 'image') {
    const fileHref = pathToUrl(f.rel);
    return `<img class="file-thumb" src="${escapeHtml(fileHref)}" alt="" loading="lazy">`;
  }
  if (type.kind === 'video') {
    const thumbHref = thumbUrlForRel(f.rel);
    return `<div class="file-thumb-wrap">
      <img class="file-thumb file-thumb-video" src="${escapeHtml(thumbHref)}" alt="" loading="lazy">
      <span class="file-icon file-icon-video file-thumb-fallback" aria-hidden="true">${type.icon}</span>
    </div>`;
  }
  return `<span class="file-icon file-icon-${type.kind}" aria-hidden="true">${type.icon}</span>`;
}

function formatLogTime(iso) {
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return String(iso || '');
  }
}

/** 图片/视频直链；音频、PDF、文本等走最简浏览页（iPhone Safari 兼容更好） */
function openHrefForFile(rel, type) {
  const fileHref = pathToUrl(rel);
  if (!isPreviewable(path.basename(rel))) return fileHref;
  if (type.kind === 'image' || type.kind === 'video') return fileHref;
  return `${fileHref}?view=1`;
}

/**
 * @param {{ fileName: string, mediaUrl: string, backUrl: string, type: ReturnType<typeof getFileTypeInfo> }} opts
 */
function renderBrowserViewHtml(opts) {
  const { fileName, mediaUrl, backUrl, type } = opts;
  let stage = '';
  if (type.kind === 'audio') {
    stage = `<audio id="view-media" controls autoplay playsinline webkit-playsinline preload="auto" src="${escapeHtml(mediaUrl)}"></audio>`;
  } else if (type.ext === '.pdf') {
    stage = `<iframe id="view-media" src="${escapeHtml(mediaUrl)}" title="${escapeHtml(fileName)}"></iframe>`;
  } else {
    stage = `<iframe id="view-media" src="${escapeHtml(mediaUrl)}" title="${escapeHtml(fileName)}"></iframe>`;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${escapeHtml(fileName)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #000; color: #eee; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    .bar {
      display: flex; align-items: center; padding: 10px 12px;
      padding-top: max(10px, env(safe-area-inset-top));
      background: #1a1a1a; border-bottom: 1px solid #333;
    }
    .bar a { padding: 8px 12px; border-radius: 8px; background: #333; color: #fff; text-decoration: none; font-size: 0.88rem; }
    .stage {
      display: flex; align-items: center; justify-content: center;
      min-height: calc(100dvh - 52px);
      padding: 8px; padding-bottom: max(8px, env(safe-area-inset-bottom));
    }
    audio { width: min(100%, 360px); }
    iframe { width: 100%; height: calc(100dvh - 60px); border: none; background: #fff; }
  </style>
</head>
<body>
  <div class="bar"><a href="${escapeHtml(backUrl)}">← 返回</a></div>
  <div class="stage">${stage}</div>
  <script>
    (function() {
      var el = document.getElementById('view-media');
      function release() {
        if (!el) return;
        if (el.tagName === 'AUDIO' || el.tagName === 'VIDEO') {
          el.pause();
          el.removeAttribute('src');
          el.load();
        } else if (el.tagName === 'IFRAME') {
          el.removeAttribute('src');
        }
      }
      if (el && el.tagName === 'AUDIO') {
        el.play().catch(function() {});
      }
      window.addEventListener('pagehide', release);
      window.addEventListener('beforeunload', release);
    })();
  </script>
</body>
</html>`;
}

function renderDownloadsLogHtml(backUrl) {
  const items = accessLog.filter((e) => e.action === 'download');
  const rows = items.length
    ? items
        .map((e) => {
          const rel = e.relPath || e.file || '';
          const href = rel ? `${pathToUrl(rel)}?dl=1` : '#';
          return `<li class="log-item">
            <a class="log-name" href="${escapeHtml(href)}" download>${escapeHtml(e.file || rel)}</a>
            <div class="log-meta">${escapeHtml(formatLogTime(e.time))} · ${escapeHtml(formatBytes(e.bytes))} · ${escapeHtml(e.ip || '—')}</div>
          </li>`;
        })
        .join('')
    : '<li class="log-empty">暂无下载记录</li>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>下载记录 · Pecado</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #111; color: #eee; }
    .bar { display: flex; align-items: center; gap: 10px; padding: 12px; background: #1a1a1a; border-bottom: 1px solid #333; }
    .bar a { padding: 8px 12px; border-radius: 8px; background: #2a2a2a; color: #9cdcfe; text-decoration: none; font-size: 0.9rem; }
    h1 { font-size: 1rem; margin: 0; flex: 1; }
    .page { padding: 12px 16px 24px; }
    .hint { color: #888; font-size: 0.82rem; margin: 0 0 12px; line-height: 1.5; }
    ul { list-style: none; margin: 0; padding: 0; }
    .log-item { padding: 12px 0; border-bottom: 1px solid #333; }
    .log-name { color: #eee; word-break: break-all; text-decoration: none; font-size: 0.95rem; }
    .log-meta { margin-top: 4px; color: #888; font-size: 0.75rem; }
    .log-empty { color: #666; padding: 16px 0; font-size: 0.9rem; }
    .files-link { color: #6eb5ff; text-decoration: none; }
    .files-link:active { opacity: 0.85; }
  </style>
</head>
<body>
  <div class="bar">
    <a href="${escapeHtml(backUrl || '/')}">← 文件列表</a>
    <h1>下载记录</h1>
  </div>
  <main class="page">
    <p class="hint">此处为通过「下载」按钮保存的文件。iPhone 上实际文件在「文件」App → 我的 iPhone → 下载 中。</p>
    <p class="hint"><a class="files-link" href="${escapeHtml(IOS_FILES_DOWNLOADS_URL)}">已下载文件</a></p>
    <ul>${rows}</ul>
  </main>
</body>
</html>`;
}

function renderBrowseHtml(root, listing) {
  const relDir = listing.relDir || '';
  const parent = parentRelDir(relDir);
  const parentUrl = dirToUrl(parent);
  const rootName = path.basename(root);

  const crumbs = [{ label: rootName, url: '/' }];
  if (relDir) {
    const parts = relDir.split('/');
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      crumbs.push({ label: part, url: dirToUrl(acc) });
    }
  }

  const crumbHtml = crumbs
    .map((c, i) => {
      const sep = i > 0 ? '<span class="crumb-sep">/</span>' : '';
      const isLast = i === crumbs.length - 1;
      if (isLast) return `${sep}<span class="crumb-current">${escapeHtml(c.label)}</span>`;
      return `${sep}<a class="crumb-link" href="${escapeHtml(c.url)}">${escapeHtml(c.label)}</a>`;
    })
    .join('');

  const backHref = relDir !== '' ? parentUrl : '/';
  const backClass = relDir !== '' ? 'btn-back' : 'btn-back is-root';
  const backBtn = `<a class="${backClass}" href="${escapeHtml(backHref)}"${relDir === '' ? ' aria-disabled="true" tabindex="-1"' : ''}>← 返回</a>`;

  const dirRows = listing.dirs
    .map((d) => {
      const href = dirToUrl(d.rel);
      return `<li class="file-item folder-item">
        <a class="file-row-link" href="${escapeHtml(href)}" aria-label="进入 ${escapeHtml(d.name)}">
          <span class="file-icon file-icon-folder" aria-hidden="true">📁</span>
          <div class="file-main">
            <span class="file-name-text folder-name">${escapeHtml(d.name)}</span>
            <span class="file-kind-label">文件夹</span>
          </div>
        </a>
      </li>`;
    })
    .join('');

  const fileRows = listing.files
    .map((f) => {
      const type = getFileTypeInfo(f.name);
      const openHref = openHrefForFile(f.rel, type);
      const dlHref = `${pathToUrl(f.rel)}?dl=1`;
      const canPreview = isPreviewable(f.name);
      const iconHtml = fileIconInnerHtml(f, type);
      const mainHtml = `<div class="file-main">
          <span class="file-name-text">${escapeHtml(f.name)}</span>
          <span class="file-meta-row"><span class="file-kind-label">${escapeHtml(type.label)}</span><span class="meta">${formatBytes(f.size)}</span></span>
        </div>`;
      const rowLink = `<a class="file-row-link" href="${escapeHtml(openHref)}" aria-label="打开 ${escapeHtml(f.name)}">${iconHtml}${mainHtml}</a>`;
      return `<li class="file-item file-kind-${type.kind}${canPreview ? '' : ' file-no-preview'}">
        ${rowLink}
        <a class="btn-action btn-download" href="${escapeHtml(dlHref)}" download>下载</a>
      </li>`;
    })
    .join('');

  const allRows = dirRows + fileRows;
  const empty =
    allRows ||
    '<li class="file-item empty-item"><span class="file-icon">📂</span><div class="file-main">此文件夹为空</div></li>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Pecado · ${escapeHtml(relDir || rootName)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; background: #111; color: #eee; }
    .top-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      padding-top: max(10px, env(safe-area-inset-top));
      background: rgba(17, 17, 17, 0.96);
      border-bottom: 1px solid #333;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }
    .btn-back {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      padding: 8px 12px;
      border-radius: 8px;
      background: #2a2a2a;
      color: #9cdcfe;
      text-decoration: none;
      font-size: 0.9rem;
      white-space: nowrap;
    }
    .btn-back.is-root { opacity: 0.45; pointer-events: none; }
    .btn-files-app {
      flex-shrink: 0;
      display: inline-flex; align-items: center;
      padding: 8px 10px; border-radius: 8px;
      background: #007aff; color: #fff; text-decoration: none; font-size: 0.78rem; white-space: nowrap;
    }
    .top-bar-main { flex: 1; min-width: 0; }
    .top-title { font-size: 0.95rem; font-weight: 600; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .breadcrumb { font-size: 0.75rem; color: #888; word-break: break-all; line-height: 1.5; margin-top: 2px; }
    .page { padding: 12px 16px 24px; padding-top: calc(72px + env(safe-area-inset-top)); }
    .crumb-link { color: #6eb5ff; text-decoration: none; }
    .crumb-current { color: #ccc; }
    .crumb-sep { margin: 0 3px; color: #555; }
    .hint { color: #666; font-size: 0.8rem; margin: 0 0 12px; }
    ul { list-style: none; padding: 0; margin: 0; }
    .file-item { display: flex; flex-wrap: nowrap; align-items: stretch; gap: 10px; padding: 0; border-bottom: 1px solid #333; }
    .file-row-link {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 0;
      text-decoration: none;
      color: inherit;
      -webkit-tap-highlight-color: transparent;
    }
    .file-row-link:active { opacity: 0.85; }
    .file-row-link.is-static { cursor: default; }
    .file-icon { flex-shrink: 0; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; font-size: 1.35rem; border-radius: 8px; background: #1e1e1e; }
    .file-icon-folder { background: #3a3520; }
    .file-icon-video { background: #2a2438; }
    .file-icon-audio { background: #24302a; }
    .file-thumb-wrap { position: relative; flex-shrink: 0; width: 40px; height: 40px; }
    .file-thumb { flex-shrink: 0; width: 40px; height: 40px; object-fit: cover; border-radius: 8px; background: #222; display: block; }
    .file-thumb-fallback { position: absolute; inset: 0; display: none; }
    .file-thumb-wrap.no-thumb .file-thumb { display: none; }
    .file-thumb-wrap.no-thumb .file-thumb-fallback { display: flex; }
    .file-main { flex: 1; min-width: 0; overflow: hidden; }
    .file-name-text { display: block; color: #eee; word-break: break-all; font-size: 0.95rem; }
    .folder-name { color: #6eb5ff; }
    .file-meta-row { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
    .file-kind-label { font-size: 0.72rem; color: #888; padding: 2px 6px; border-radius: 4px; background: #1a1a1a; }
    .meta { color: #888; font-size: 0.75rem; white-space: nowrap; }
    .btn-action { flex-shrink: 0; align-self: center; display: inline-block; padding: 8px 14px; border-radius: 8px; font-size: 0.82rem; text-decoration: none; text-align: center; white-space: nowrap; }
    .btn-download { background: #2f5f4a; color: #fff; }
  </style>
</head>
<body>
  <header class="top-bar">
    ${backBtn}
    <div class="top-bar-main">
      <h1 class="top-title">${escapeHtml(relDir ? path.basename(relDir) : rootName)}</h1>
      <div class="breadcrumb">${crumbHtml}</div>
    </div>
    <a class="btn-files-app" href="${escapeHtml(IOS_FILES_DOWNLOADS_URL)}">已下载文件</a>
  </header>
  <main class="page">
  <p class="hint">${listing.dirs.length} 个文件夹 · ${listing.files.length} 个文件 · 点行由浏览器直接打开 · 右上「已下载文件」</p>
  <ul>${empty}</ul>
  </main>
  <script>
    (function() {
      function rememberThumbSrc(img) {
        var src = img.getAttribute('src');
        if (src && !img.dataset.origSrc) img.dataset.origSrc = src;
      }

      function releaseBrowseMedia() {
        document.querySelectorAll('video, audio').forEach(function(el) {
          try {
            el.pause();
            el.removeAttribute('src');
            el.load();
          } catch (e) {}
        });
        document.querySelectorAll('.file-thumb, .file-thumb-video').forEach(function(img) {
          rememberThumbSrc(img);
          img.removeAttribute('src');
        });
      }

      function restoreBrowseThumbs() {
        document.querySelectorAll('.file-thumb, .file-thumb-video').forEach(function(img) {
          var orig = img.dataset.origSrc;
          if (!orig) return;
          var sep = orig.indexOf('?') >= 0 ? '&' : '?';
          img.src = orig + sep + '_=' + Date.now();
        });
      }

      document.querySelectorAll('.file-thumb, .file-thumb-video').forEach(rememberThumbSrc);
      document.querySelectorAll('.file-thumb-video').forEach(function(img) {
        img.addEventListener('error', function() {
          var wrap = img.closest('.file-thumb-wrap');
          if (wrap) wrap.classList.add('no-thumb');
        });
      });

      window.addEventListener('pagehide', releaseBrowseMedia);
      window.addEventListener('pageshow', function(e) {
        if (e.persisted) {
          releaseBrowseMedia();
          restoreBrowseThumbs();
        }
      });
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') releaseBrowseMedia();
        else restoreBrowseThumbs();
      });
    })();
  </script>
</body>
</html>`;
}

async function serveVideoThumbnail(absPath, res) {
  const thumbPath = await ensureVideoThumbnail(absPath);
  if (!thumbPath || !fs.existsSync(thumbPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Thumbnail not available');
    return;
  }
  const st = fs.statSync(thumbPath);
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': st.size,
    'Cache-Control': 'public, max-age=86400',
  });
  fs.createReadStream(thumbPath)
    .on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    })
    .pipe(res);
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress?.replace(/^::ffff:/, '') || '';
}

function parseQueryFlags(query) {
  const q = String(query || '');
  return {
    forceDownload: /(?:^|&)dl=1(?:&|$)/.test(q),
    forceView: /(?:^|&)view=1(?:&|$)/.test(q),
  };
}

/**
 * @param {string | undefined} rangeHeader
 * @param {number} fileSize
 * @returns {{ start: number, end: number, length: number } | { invalid: true } | null}
 */
function parseByteRange(rangeHeader, fileSize) {
  if (!rangeHeader || !String(rangeHeader).startsWith('bytes=')) return null;
  const spec = String(rangeHeader).slice(6).trim();
  const dash = spec.indexOf('-');
  if (dash < 0) return null;

  const startStr = spec.slice(0, dash);
  const endStr = spec.slice(dash + 1);
  let start;
  let end;

  if (startStr === '') {
    const suffix = parseInt(endStr, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(fileSize - suffix, 0);
    end = fileSize - 1;
  } else {
    start = parseInt(startStr, 10);
    if (!Number.isFinite(start) || start < 0) return null;
    end = endStr ? parseInt(endStr, 10) : fileSize - 1;
    if (!Number.isFinite(end)) return null;
    if (end >= fileSize) end = fileSize - 1;
  }

  if (start > end || start >= fileSize) return { invalid: true };
  return { start, end, length: end - start + 1 };
}

function pipeFileStream(abs, res, start, end) {
  const stream =
    start != null && end != null
      ? fs.createReadStream(abs, { start, end })
      : fs.createReadStream(abs);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
  stream.pipe(res);
}

function serveFile(abs, req, res, opts) {
  const { forceDownload } = opts;
  const st = fs.statSync(abs);
  if (!st.isFile()) return false;

  const relPath = relFromRoot(abs);
  const fileName = path.basename(abs);
  const mime = getMimeType(fileName);
  const canPreview = isPreviewable(fileName);
  const useInline = canPreview && !forceDownload;
  const fileSize = st.size;
  const method = String(req.method || 'GET').toUpperCase();
  const isHead = method === 'HEAD';

  const baseHeaders = {
    'Accept-Ranges': 'bytes',
  };
  if (useInline) {
    baseHeaders['Cache-Control'] = 'private, no-store, no-cache, must-revalidate';
    baseHeaders['Pragma'] = 'no-cache';
  } else {
    baseHeaders['Cache-Control'] = 'private, max-age=0';
  }

  if (useInline) {
    const kind = getFileTypeInfo(fileName).kind;
    const isTextLike =
      kind === 'code' ||
      mime.startsWith('text/') ||
      mime === 'application/json' ||
      mime === 'application/xml';
    baseHeaders['Content-Type'] = isTextLike ? `${mime}; charset=utf-8` : mime;
    baseHeaders['Content-Disposition'] = `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  } else {
    baseHeaders['Content-Type'] = mime !== 'application/octet-stream' ? mime : 'application/octet-stream';
    baseHeaders['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
    if (!useInline) {
      pushLog({
        time: new Date().toISOString(),
        file: fileName,
        relPath,
        ip: getClientIp(req),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 120),
        bytes: fileSize,
        action: 'download',
        ...getFileTypeInfo(fileName),
      });
    }
  }

  const range = useInline ? parseByteRange(req.headers.range, fileSize) : null;

  if (range && 'invalid' in range) {
    res.writeHead(416, {
      'Content-Range': `bytes */${fileSize}`,
      'Content-Type': 'text/plain; charset=utf-8',
    });
    res.end();
    return true;
  }

  if (range) {
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${range.start}-${range.end}/${fileSize}`,
      'Content-Length': range.length,
    });
    if (isHead) {
      res.end();
      return true;
    }
    pipeFileStream(abs, res, range.start, range.end);
    return true;
  }

  res.writeHead(200, {
    ...baseHeaders,
    'Content-Length': fileSize,
  });
  if (isHead) {
    res.end();
    return true;
  }
  pipeFileStream(abs, res);
  return true;
}

async function handleRequest(req, res) {
  if (!rootDir) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('服务未就绪');
    return;
  }

  let urlPath = (req.url || '/').split('?')[0];
  const query = (req.url || '').includes('?') ? req.url.split('?')[1] : '';
  const flags = parseQueryFlags(query);

  if (urlPath.startsWith('/_thumb/')) {
    const relEncoded = urlPath.slice('/_thumb/'.length);
    const rel = relEncoded
      .split('/')
      .map((seg) => decodeURIComponent(seg))
      .join('/');
    const abs = resolveSafePath(rootDir, rel);
    if (!abs || !fs.existsSync(abs) || getFileTypeInfo(path.basename(abs)).kind !== 'video') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    await serveVideoThumbnail(abs, res);
    return;
  }

  if (urlPath === '/_downloads') {
    const html = renderDownloadsLogHtml('/');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
    return;
  }

  if (urlPath !== '/' && urlPath.endsWith('/')) {
    urlPath = urlPath.replace(/\/+$/, '') || '/';
  }

  const abs = resolveSafePath(rootDir, urlPath === '/' ? '' : urlPath);
  if (!abs) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(abs)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  const st = fs.statSync(abs);

  if (st.isDirectory()) {
    const relDir = relFromRoot(abs);
    const listing = listDirectoryContents(rootDir, relDir);
    if (!listing) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const html = renderBrowseHtml(rootDir, listing);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    });
    res.end(html);
    return;
  }

  const fileName = path.basename(abs);
  if (flags.forceView && isPreviewable(fileName)) {
    const rel = relFromRoot(abs);
    const fileType = getFileTypeInfo(fileName);
    const html = renderBrowserViewHtml({
      fileName,
      mediaUrl: pathToUrl(rel),
      backUrl: dirToUrl(parentRelDir(rel)),
      type: fileType,
    });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
    return;
  }

  serveFile(abs, req, res, {
    forceDownload: flags.forceDownload,
  });
}

/**
 * @param {string} folderPath
 * @param {{ port?: number, keepLog?: boolean }} [opts]
 */
function startDownloadServer(folderPath, opts = {}) {
  const dir = path.resolve(String(folderPath || '').trim());
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { ok: false, error: '请选择有效的文件夹' };
  }

  stopDownloadServer();

  const usePort = opts.port != null ? parseInt(String(opts.port), 10) : DEFAULT_PORT;
  if (!Number.isFinite(usePort) || usePort < 1024 || usePort > 65535) {
    return { ok: false, error: '端口需在 1024–65535 之间' };
  }

  if (!opts.keepLog) accessLog = [];
  rootDir = dir;
  port = usePort;

  try {
    server = http.createServer((req, res) => {
      handleRequest(req, res).catch((e) => {
        console.error('[workflow] download server', e);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Internal Error');
        }
      });
    });
  } catch (e) {
    server = null;
    rootDir = '';
    return { ok: false, error: e.message || String(e) };
  }

  return new Promise((resolve) => {
    server.on('error', (err) => {
      server = null;
      rootDir = '';
      resolve({ ok: false, error: err.message || String(err) });
    });
    server.listen(port, '0.0.0.0', () => {
      resolve({ ok: true, ...getDownloadServerStatus() });
    });
  });
}

function stopDownloadServer() {
  if (server) {
    try {
      server.close();
    } catch (_) {
      /* ignore */
    }
    server = null;
  }
  rootDir = '';
}

function countFilesRecursive(root, max = 5000) {
  let n = 0;
  function walk(rel) {
    if (n >= max) return;
    const listing = listDirectoryContents(root, rel);
    if (!listing) return;
    n += listing.files.length;
    for (const d of listing.dirs) walk(d.rel);
  }
  walk('');
  return n;
}

function getDownloadServerStatus() {
  const running = Boolean(server && rootDir);
  const ips = getLocalIPv4Addresses();
  const urls = running ? ips.map((ip) => `http://${ip}:${port}/`) : [];
  const primaryUrl = urls[0] || (running ? `http://127.0.0.1:${port}/` : '');

  const listing = running ? listDirectoryContents(rootDir, '') : null;
  const baseUrl = primaryUrl.replace(/\/$/, '');
  const mapEntry = (entry) => {
    const e = enrichBrowseEntry(entry);
    if (e.thumbPath) e.thumbUrl = `${baseUrl}${e.thumbPath}`;
    return e;
  };
  const entries = listing
    ? [...listing.dirs.map(mapEntry), ...listing.files.map(mapEntry)].slice(0, 100)
    : [];

  const thumbCache = getVideoThumbnailCacheStats();

  return {
    running,
    rootDir,
    port: running ? port : null,
    urls,
    primaryUrl,
    localhostUrl: running ? `http://127.0.0.1:${port}/` : '',
    accessLog: [...accessLog],
    fileCount: running ? countFilesRecursive(rootDir) : 0,
    thumbCacheDir: thumbCache.cacheDir,
    thumbCacheCount: thumbCache.count,
    thumbCacheBytes: thumbCache.bytes,
    entries,
    dirs: listing?.dirs.map(mapEntry) || [],
    files: listing?.files.map(mapEntry) || [],
  };
}

module.exports = {
  startDownloadServer,
  stopDownloadServer,
  getDownloadServerStatus,
  listDirectoryContents,
  DEFAULT_PORT,
};
