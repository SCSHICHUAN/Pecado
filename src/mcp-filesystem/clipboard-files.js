/**
 * @file clipboard-files.js
 * 将文件路径写入系统剪贴板，可在 Finder 中 ⌘V 粘贴文件。
 */
const fs = require('fs');
const path = require('path');
const { clipboard } = require('electron');

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function existingFiles(filePaths) {
  const out = [];
  for (const raw of filePaths) {
    const abs = path.resolve(String(raw || '').trim());
    if (!abs) continue;
    try {
      if (fs.existsSync(abs) && (fs.statSync(abs).isFile() || fs.statSync(abs).isDirectory())) out.push(abs);
    } catch (_) {
      /* ignore */
    }
  }
  return out;
}

function writeDarwinFiles(filePaths) {
  const files = existingFiles(filePaths);
  if (!files.length) return { ok: false, error: '文件不存在' };
  const items = files.map((p) => `  <string>${xmlEscape(p)}</string>`).join('\n');
  const plist =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0">\n<array>\n' +
    items +
    '\n</array>\n</plist>';
  clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plist, 'utf8'));
  return { ok: true, paths: files };
}

/**
 * @param {string[]} filePaths
 * @returns {{ ok: boolean, paths?: string[], error?: string }}
 */
function writeFilesToClipboard(filePaths) {
  if (!Array.isArray(filePaths) || !filePaths.length) {
    return { ok: false, error: '缺少 path' };
  }
  if (process.platform === 'darwin') return writeDarwinFiles(filePaths);
  return { ok: false, error: '当前平台暂不支持复制文件到剪贴板' };
}

module.exports = { writeFilesToClipboard };
