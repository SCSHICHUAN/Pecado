/**
 * @file project-path.js
 *
 * 将相对/绝对路径解析到 MCP 工程根目录之下（防止写出 sandbox）。
 */
const path = require('path');

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @returns {string} 绝对路径
 */
function resolveUnderProject(projectRoot, filePath) {
  if (!projectRoot) throw new Error('工程未打开');
  const root = path.resolve(String(projectRoot));
  const raw = String(filePath || '').trim();
  if (!raw) throw new Error('文件路径不能为空');
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`路径超出工程目录：${filePath}`);
  }
  return abs;
}

module.exports = { resolveUnderProject };
