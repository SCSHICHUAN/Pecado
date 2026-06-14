/**
 * @file paths.js
 * 【功能】从用户输入识别 @path 与 Xcode 源码流式写目标
 */

const path = require('path');
const os = require('os');

/** 规范化 @ 提及的路径（保留绝对路径） */
function normalizeMentionPath(raw) {
  let p = String(raw || '').trim();
  if (!p) return '';
  if (p.startsWith('~')) {
    p = path.join(os.homedir(), p.slice(1).replace(/^\/+/, ''));
    return path.normalize(p);
  }
  if (path.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p)) {
    return path.normalize(p);
  }
  return p.replace(/^\/+/, '');
}

/** 从用户输入提取 @path 或 `path.ext` */
function extractRequestedPaths(userText) {
  const paths = new Set();
  const s = String(userText || '');
  for (const m of s.matchAll(/@([^\s@,，。；;]+)/g)) {
    paths.add(normalizeMentionPath(m[1]));
  }
  for (const m of s.matchAll(/`([^`\n]+\.[a-zA-Z0-9]+)`/g)) {
    const p = normalizeMentionPath(m[1]);
    if (p && !/\s/.test(p)) paths.add(p);
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

module.exports = { extractRequestedPaths, pickXcodeStreamTarget, normalizeMentionPath };
