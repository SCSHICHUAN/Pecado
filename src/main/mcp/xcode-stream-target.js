/**
 * @file xcode-stream-target.js
 *
 * 将渲染进程传入的相对路径解析为工程内绝对路径（macOS Xcode 流式写入）。
 */
const mcpFs = require('./filesystem-client');
const { resolveUnderProject } = require('./project-path');

const IS_DARWIN = process.platform === 'darwin';

/**
 * 是否对该路径做 Xcode 流式落盘（macOS）。
 * @param {string} absPath
 */
function shouldLiveStreamToXcode(absPath) {
  if (!IS_DARWIN || !absPath) return false;
  return true;
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
