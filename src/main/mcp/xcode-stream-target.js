/**
 * @file xcode-stream-target.js
 *
 * 将渲染进程传入的相对路径解析为工程内绝对路径（macOS Xcode 流式写入）。
 */
const fs = require('fs');
const mcpFs = require('./filesystem-client');
const { resolveUnderProject } = require('./project-path');

const IS_DARWIN = process.platform === 'darwin';

/**
 * 仅对新文件做 Xcode 流式预览；已存在文件避免首片 truncate 清空（编辑时 Xcode 会先变空）。
 * @param {string} absPath
 */
function shouldLiveStreamToXcode(absPath) {
  if (!IS_DARWIN || !absPath) return false;
  try {
    return !fs.existsSync(absPath);
  } catch {
    return false;
  }
}

/**
 * @param {string | null | undefined} xcodeStreamPath
 * @returns {string | null}
 */
function resolveXcodeStreamAbsPath(xcodeStreamPath) {
  if (!IS_DARWIN || !xcodeStreamPath) return null;
  if (!mcpFs.getStatus().connected) return null;
  try {
    const abs = resolveUnderProject(mcpFs.getStatus().projectRoot, xcodeStreamPath);
    console.log('[xcode-stream] SSE target', abs);
    return abs;
  } catch (e) {
    console.warn('[xcode-stream] ignore path:', e.message);
    return null;
  }
}

module.exports = { resolveXcodeStreamAbsPath, shouldLiveStreamToXcode, IS_DARWIN };
