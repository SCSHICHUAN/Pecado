/**
 * @file path-parse.js
 * @module xcode
 *
 * 【功能】从用户输入识别 @path、`path.ext` 及 Xcode 源码流式写目标。
 */

/** 从用户输入提取 @path 或 `path.ext` */
function extractRequestedPaths(userText) {
  const paths = new Set();
  const s = String(userText || '');
  for (const m of s.matchAll(/@([^\s@,，。；;]+)/g)) {
    paths.add(m[1].replace(/^\/+/, ''));
  }
  for (const m of s.matchAll(/`([^`\n]+\.[a-zA-Z0-9]+)`/g)) {
    const p = m[1].trim();
    if (p && !/\s/.test(p)) paths.add(p.replace(/^\/+/, ''));
  }
  return paths;
}

/** 从用户输入提取 Xcode 流式写入目标（.swift / .m 等） */
function pickXcodeStreamTarget(userText) {
  const codeExt = /\.(swift|m|mm|h|hpp|c|cpp|cc)$/i;
  for (const p of extractRequestedPaths(userText)) {
    if (codeExt.test(p)) return p;
  }
  return null;
}

module.exports = { extractRequestedPaths, pickXcodeStreamTarget };
