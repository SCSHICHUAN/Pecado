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

/** 用户是否指「当前/这个/选中的文件」（CodX 编辑器激活 tab） */
function userRefersToCurrentFile(userText) {
  const s = String(userText || '');
  return (
    /(?:在|对|向|于)?(?:当前|这个|此|该|选中(?:中)?|打开(?:着)?|正在编辑(?:的)?)(?:的)?(?:文件|标签|tab)/i.test(s) ||
    /(?:current|this)\s+file/i.test(s) ||
    /在当前文件/i.test(s)
  );
}

/** 从用户输入提取 Xcode 流式写入目标（.swift / .m 等）；无显式路径时可回落 CodX 当前文件 */
function pickXcodeStreamTarget(userText, codxActiveFile) {
  const codeExt = /\.(swift|m|mm|h|hpp|c|cpp|cc)$/i;
  for (const p of extractRequestedPaths(userText)) {
    if (codeExt.test(p)) return p;
  }
  const active = String(codxActiveFile || '').trim();
  if (active && userRefersToCurrentFile(userText)) return active;
  return null;
}

module.exports = { extractRequestedPaths, pickXcodeStreamTarget, normalizeMentionPath, userRefersToCurrentFile };
