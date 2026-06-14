/**
 * @file thumbnails.js
 * 【功能】文件服务：视频封面缓存
 *
 * 【功能】macOS Quick Look（qlmanage）提取视频封面，缓存至 userData。
 * 【缓存位置】~/Library/Application Support/pecado/workflow-video-thumbs/
 *   不写入用户共享文件夹，避免污染下载目录；按「文件路径 + 修改时间」哈希命名，视频更新后自动失效。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { app } = require('electron');
const { getFileTypeInfo } = require('../../shared/file-type');

const execFileAsync = promisify(execFile);
const THUMB_SIZE = 480;
const QL_TIMEOUT_MIN_MS = 120000;
const QL_TIMEOUT_MAX_MS = 600000;

/** @type {Map<string, Promise<string | null>>} */
const inflight = new Map();

function qlTimeoutForFileSize(bytes) {
  const size = Number(bytes) || 0;
  // 大文件 Quick Look 更慢：基础 2 分钟 + 每 GB 再加 2 分钟，上限 10 分钟
  const gb = size / (1024 * 1024 * 1024);
  return Math.min(QL_TIMEOUT_MAX_MS, QL_TIMEOUT_MIN_MS + Math.ceil(gb) * 120000);
}

function getThumbCacheDir() {
  return path.join(app.getPath('userData'), 'workflow-video-thumbs');
}

function isVideoFile(fileName) {
  return getFileTypeInfo(fileName).kind === 'video';
}

/**
 * @param {string} absPath
 * @param {number} mtimeMs
 */
function cacheFilePath(absPath, mtimeMs) {
  const key = crypto
    .createHash('sha256')
    .update(`${absPath}\0${mtimeMs}`)
    .digest('hex');
  return path.join(getThumbCacheDir(), `${key}.png`);
}

/**
 * @param {string} absPath
 */
async function generateWithQuickLook(absPath, outPng) {
  if (process.platform !== 'darwin') return false;
  let fileSize = 0;
  try {
    fileSize = fs.statSync(absPath).size;
  } catch {
    return false;
  }
  const timeoutMs = qlTimeoutForFileSize(fileSize);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pecado-ql-'));
  try {
    await execFileAsync(
      '/usr/bin/qlmanage',
      ['-t', `-s${THUMB_SIZE}`, '-o', tmpDir, absPath],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }
    );
    const pngName = fs.readdirSync(tmpDir).find((n) => n.endsWith('.png'));
    if (!pngName) return false;
    fs.mkdirSync(path.dirname(outPng), { recursive: true });
    fs.copyFileSync(path.join(tmpDir, pngName), outPng);
    return true;
  } catch (e) {
    console.warn('[workflow] qlmanage thumbnail failed:', absPath, e.message || e);
    return false;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * @param {string} absPath
 * @returns {Promise<string | null>} 缓存 PNG 绝对路径
 */
async function ensureVideoThumbnail(absPath) {
  if (!absPath || !fs.existsSync(absPath) || process.platform !== 'darwin') {
    return null;
  }
  if (!isVideoFile(path.basename(absPath))) return null;

  let st;
  try {
    st = fs.statSync(absPath);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;

  const outPng = cacheFilePath(absPath, st.mtimeMs);
  if (fs.existsSync(outPng)) return outPng;

  if (inflight.has(outPng)) {
    return inflight.get(outPng);
  }

  const job = (async () => {
    const ok = await generateWithQuickLook(absPath, outPng);
    return ok && fs.existsSync(outPng) ? outPng : null;
  })();

  inflight.set(outPng, job);
  try {
    return await job;
  } finally {
    inflight.delete(outPng);
  }
}

function thumbUrlForRel(rel) {
  const r = String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!r) return '';
  return `/_thumb/${r.split('/').map(encodeURIComponent).join('/')}`;
}

function getVideoThumbnailCacheStats() {
  const cacheDir = getThumbCacheDir();
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch {
    /* ignore */
  }
  if (!fs.existsSync(cacheDir)) {
    return { cacheDir, count: 0, bytes: 0 };
  }
  let count = 0;
  let bytes = 0;
  for (const name of fs.readdirSync(cacheDir)) {
    if (!name.endsWith('.png')) continue;
    try {
      const st = fs.statSync(path.join(cacheDir, name));
      if (st.isFile()) {
        count += 1;
        bytes += st.size;
      }
    } catch {
      /* ignore */
    }
  }
  return { cacheDir, count, bytes };
}

function clearVideoThumbnailCache() {
  const { cacheDir } = getVideoThumbnailCacheStats();
  if (!fs.existsSync(cacheDir)) {
    return { ok: true, deleted: 0, cacheDir };
  }
  let deleted = 0;
  for (const name of fs.readdirSync(cacheDir)) {
    if (!name.endsWith('.png')) continue;
    try {
      fs.unlinkSync(path.join(cacheDir, name));
      deleted += 1;
    } catch (e) {
      console.warn('[workflow] clear thumb cache failed:', name, e.message || e);
    }
  }
  return { ok: true, deleted, cacheDir, ...getVideoThumbnailCacheStats() };
}

module.exports = {
  getThumbCacheDir,
  getVideoThumbnailCacheStats,
  clearVideoThumbnailCache,
  ensureVideoThumbnail,
  thumbUrlForRel,
  isVideoFile,
};
