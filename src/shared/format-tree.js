/**
 * @file format-tree.js
 *
 * MCP directory_tree → ASCII 目录树（主进程 require / 渲染进程 script 共用）。
 */
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
  if (Array.isArray(tree) && tree.length) {
    formatMcpTreeBox(tree, '', lines, maxLines);
  }
  if (lines.length >= maxLines) {
    lines.push('…（目录过多，已截断）');
  }
  return lines.join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatMcpTreeBox, formatMcpTreeAscii };
}
if (typeof window !== 'undefined') {
  window.formatMcpTree = { formatMcpTreeAscii };
}
