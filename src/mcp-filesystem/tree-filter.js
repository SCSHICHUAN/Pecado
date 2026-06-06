/**
 * @file tree-filter.js
 *
 * 【功能】directory_tree 结果过滤：排除依赖/构建/工具缓存等无用目录。
 * 【调用方】mcp-filesystem/read.js → readDirectoryTree
 */

/** MCP directory_tree 的 excludePatterns（目录名匹配，任意层级） */
const DEFAULT_TREE_EXCLUDES = [
  'node_modules',
  '.git',
  '.dev',
  'dist',
  'release',
  'build',
  'out',
  '.cursor',
  'coverage',
  '.vscode',
  '.idea',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.cache',
  '.npm',
  '.yarn',
  '.pnpm-store',
  '.turbo',
  '.nx',
  'Pods',
  'DerivedData',
  '.next',
  'target',
  'vendor',
  'bower_components',
  'tmp',
  'temp',
  'logs',
  '.tox',
  '.eggs',
  'venv',
  '.venv',
  'htmlcov',
  '.sass-cache',
  '.electron-gyp',
];

const EXCLUDE_NAME_SET = new Set(DEFAULT_TREE_EXCLUDES.map((s) => s.toLowerCase()));

/**
 * @param {string} name
 * @returns {boolean}
 */
function shouldExcludeTreeNode(name) {
  const n = String(name || '').trim();
  if (!n) return true;
  const lower = n.toLowerCase();
  if (EXCLUDE_NAME_SET.has(lower)) return true;
  // 隐藏其它点目录（.git / .dev 等已在列表中）
  if (n.startsWith('.') && n !== '.') return true;
  return false;
}

/**
 * @param {unknown} nodes
 * @param {{ directoriesOnly?: boolean }} [opts]
 * @returns {Array<object>}
 */
function filterDirectoryTree(nodes, opts = {}) {
  const { directoriesOnly = true } = opts;
  if (!Array.isArray(nodes)) return [];

  /** @type {Array<object>} */
  const out = [];

  for (const node of nodes) {
    if (!node || typeof node !== 'object' || !node.name) continue;
    if (shouldExcludeTreeNode(node.name)) continue;
    if (directoriesOnly && node.type !== 'directory') continue;

    /** @type {object} */
    const next = { ...node };
    if (node.type === 'directory' && Array.isArray(node.children)) {
      next.children = filterDirectoryTree(node.children, opts);
    }
    out.push(next);
  }

  out.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
  return out;
}

module.exports = {
  DEFAULT_TREE_EXCLUDES,
  shouldExcludeTreeNode,
  filterDirectoryTree,
};
