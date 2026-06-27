/**
 * @file format-tree.js
 *
 * 【功能】MCP directory_tree JSON 转为 ASCII 目录树文本（双端共用：Node require + 浏览器 script）。
 *   - formatMcpTreeBox：递归 ├── / └── 前缀，maxLines 截断
 *   - formatMcpTreeAscii：根为 '.'，超长追加「…（目录过多，已截断）」
 *   - 浏览器端挂载 window.formatMcpTree；Node 端 module.exports
 *
 * 【调用方】
 *   mcp-filesystem/project-context.js（拼 AI context，maxLines=400）
 *   pecado/js/index.js（Open Folder 气泡展示，经 window.formatMcpTree）
 *   main/html/index.html 以 script src 加载
 *
 * 【对外能力】formatMcpTreeAscii(tree, maxLines?) / formatMcpTreeBox（内部）
 */
function normalizeDirectoryTreeNodes(tree) {
  if (!tree) return [];
  if (Array.isArray(tree)) return tree;
  if (typeof tree === 'object') {
    const name = String(tree.name ?? '').trim();
    const isDir = tree.type === 'directory';
    if (isDir && (name === '.' || name === '') && Array.isArray(tree.children)) {
      return tree.children;
    }
    return [tree];
  }
  return [];
}

function formatMcpTreeBox(nodes, prefix, lines, maxLines) {
  if (!Array.isArray(nodes) || lines.length >= maxLines) return;
  for (let i = 0; i < nodes.length; i += 1) {
    if (lines.length >= maxLines) break;
    const node = nodes[i];
    const isLast = i === nodes.length - 1;
    const branch = isLast ? '└── ' : '├── ';
    lines.push(`${prefix}${branch}${node.name}`);
    if (node.type === 'directory' && Array.isArray(node.children) && node.children.length) {
      const childPrefix = prefix + (isLast ? '    ' : '│   ');
      formatMcpTreeBox(node.children, childPrefix, lines, maxLines);
    }
  }
}

function formatMcpTreeAscii(tree, maxLines = 400) {
  const lines = ['.'];
  const nodes = normalizeDirectoryTreeNodes(tree);
  if (nodes.length) {
    formatMcpTreeBox(nodes, '', lines, maxLines);
  }
  if (lines.length >= maxLines) {
    lines.push('…（目录过多，已截断）');
  }
  return lines.join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatMcpTreeBox, formatMcpTreeAscii, normalizeDirectoryTreeNodes };
}
if (typeof window !== 'undefined') {
  window.formatMcpTree = { formatMcpTreeAscii, normalizeDirectoryTreeNodes };
}
