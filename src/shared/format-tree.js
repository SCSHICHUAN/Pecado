/**
 * @file format-tree.js
 *
 * 【功能】MCP directory_tree JSON 转为 ASCII 目录树文本（双端共用：Node require + 浏览器 script）。
 *   - formatMcpTreeBox：递归 ├── / └── 前缀，maxLines 截断
 *   - formatMcpTreeAscii：根为 '.'，超长追加「…（目录过多，已截断）」
 *   - 浏览器端挂载 window.formatMcpTree；Node 端 module.exports
 *
 * 【调用方】
 *   main/mcp-filesystem/project-context.js（拼 AI context，maxLines=400）
 *   renderer/js/index.js（Open Folder 气泡展示，经 window.formatMcpTree）
 *   renderer/html/app.html 以 script src 加载（路径 ../../shared/format-tree.js）
 *
 * 【对外能力】formatMcpTreeAscii(tree, maxLines?) / formatMcpTreeBox（内部）
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
