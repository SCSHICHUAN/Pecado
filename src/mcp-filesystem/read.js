/**
 * @file read.js
 *
 * 【功能】工程读操作 + 路径沙箱（防止 MCP 路径逃逸 projectRoot）。
 *   - resolveUnderProject：相对/绝对路径归一化，超出 .. 则 throw
 *   - readText：MCP read_text_file，可选 head/tail 截断
 *   - readDirectoryTree：MCP directory_tree，默认排除 node_modules/.git/dist 等，返回 JSON 树
 *   - listAllowedDirectories：MCP list_allowed_directories
 *
 * 【调用方】mcp-filesystem/index.js；mcp-filesystem/project-context.js；xcode/live-stream.js
 *   resolveUnderProject(projectRoot, filePath) → absPath
 *   readText(relPath, { head?, tail? }) → string
 *   readDirectoryTree({ path?, excludePatterns? }) → tree JSON
 *   listAllowedDirectories() / DEFAULT_TREE_EXCLUDES
 */
const path = require('path');
const transport = require('./mcp-transport');

const DEFAULT_TREE_EXCLUDES = ['node_modules', '.git', 'dist', 'release', 'build', '.cursor', 'coverage'];

/**
 * @param {string} projectRoot
 * @param {string} filePath
 * @returns {string}
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

/**
 * @param {string} relPath
 * @param {{ head?: number, tail?: number }} [opts]
 */
async function readText(relPath, opts = {}) {
  const args = { path: String(relPath) };
  if (opts.head != null) args.head = opts.head;
  if (opts.tail != null) args.tail = opts.tail;
  return transport.callToolText('read_text_file', args);
}

/**
 * @param {{ path?: string, excludePatterns?: string[] }} [opts]
 */
async function readDirectoryTree(opts = {}) {
  const status = transport.getStatus();
  if (!status.connected) throw new Error('工程未连接');
  const excludePatterns = Array.isArray(opts.excludePatterns)
    ? opts.excludePatterns
    : DEFAULT_TREE_EXCLUDES;
  const treePath = opts.path ? path.resolve(String(opts.path)) : status.projectRoot;
  const text = await transport.callToolText('directory_tree', { path: treePath, excludePatterns });
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function listAllowedDirectories() {
  return transport.callToolText('list_allowed_directories', {});
}

module.exports = {
  DEFAULT_TREE_EXCLUDES,
  resolveUnderProject,
  readText,
  readDirectoryTree,
  listAllowedDirectories,
};
