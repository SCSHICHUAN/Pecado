/**
 * @file read.js
 *
 * 【功能】工程读操作 + 路径沙箱（防止 MCP 路径逃逸 projectRoot）。
 *   - resolveUnderProject：相对/绝对路径归一化，超出 .. 则 throw
 *   - readText：MCP read_text_file，可选 head/tail 截断
 *   - readDirectoryTree：MCP directory_tree，默认排除 node_modules/.git/dist 等，返回 JSON 树
 *   - listAllowedDirectories：MCP list_allowed_directories
 *
 * 【调用方】mcp-filesystem/index.js；mcp-filesystem/project-context.js；xcode/stream.js
 *   resolveUnderProject(projectRoot, filePath) → absPath
 *   readText(relPath, { head?, tail? }) → string
 *   readDirectoryTree({ path?, excludePatterns?, directoriesOnly? }) → tree JSON
 *   listAllowedDirectories() / DEFAULT_TREE_EXCLUDES
 */
const path = require('path');
const transport = require('./mcp-transport');
const { DEFAULT_TREE_EXCLUDES, filterDirectoryTree } = require('./tree-filter');
const { normalizeDirectoryTreeNodes } = require('../shared/format-tree');

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
 * MCP tool path：修正 LLM 拼错根路径；相对保留；越界回退 "."。
 * @param {string} pathArg
 * @param {string} projectRoot
 * @returns {string}
 */
function prepareMcpToolPath(pathArg, projectRoot) {
  const raw = String(pathArg ?? '').trim();
  if (!raw || raw === '.') return raw || '.';
  const root = path.resolve(String(projectRoot || ''));
  if (!root) return raw;

  let candidate = raw;
  if (path.isAbsolute(raw.replace(/\\/g, '/'))) {
    const rootNorm = root.replace(/\\/g, '/');
    const rawNorm = raw.replace(/\\/g, '/');
    if (
      (rawNorm.startsWith(rootNorm) && rawNorm !== rootNorm && !rawNorm.startsWith(`${rootNorm}/`)) ||
      (!rawNorm.startsWith(`${rootNorm}/`) && rawNorm !== rootNorm)
    ) {
      candidate = '.';
    }
  }

  if (!candidate || candidate === '.') return '.';
  if (!path.isAbsolute(candidate)) return candidate;
  try {
    resolveUnderProject(projectRoot, candidate);
    return candidate;
  } catch {
    return '.';
  }
}

/** directory_tree 等需要绝对路径的 MCP 调用 */
function resolveMcpDirectoryPath(pathArg, projectRoot) {
  const root = path.resolve(String(projectRoot || ''));
  if (!root) return String(pathArg || '').trim();
  if (pathArg == null || String(pathArg).trim() === '') return root;
  const prepared = prepareMcpToolPath(pathArg, projectRoot);
  if (!prepared || prepared === '.') return root;
  if (path.isAbsolute(prepared)) return path.resolve(prepared);
  return resolveUnderProject(root, prepared);
}

/**
 * 工程内相对路径（绝对/相对输入均可）
 * @param {string} projectRoot
 * @param {string} filePath
 * @returns {string}
 */
function toProjectRelPath(projectRoot, filePath) {
  const abs = resolveUnderProject(projectRoot, filePath);
  const root = path.resolve(String(projectRoot));
  return path.relative(root, abs).replace(/\\/g, '/');
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
  const resolvedTreePath = resolveMcpDirectoryPath(opts.path, status.projectRoot);
  const text = await transport.callToolText('directory_tree', {
    path: resolvedTreePath,
    excludePatterns,
  });
  let tree;
  try {
    tree = JSON.parse(text);
  } catch {
    tree = text;
  }
  const nodes = normalizeDirectoryTreeNodes(tree);
  const directoriesOnly = opts.directoriesOnly !== false;
  return filterDirectoryTree(nodes, { directoriesOnly });
}

async function listAllowedDirectories() {
  return transport.callToolText('list_allowed_directories', {});
}

module.exports = {
  DEFAULT_TREE_EXCLUDES,
  resolveUnderProject,
  prepareMcpToolPath,
  resolveMcpDirectoryPath,
  toProjectRelPath,
  readText,
  readDirectoryTree,
  listAllowedDirectories,
};
