/**
 * @file context.js
 * CodX 编程视图 → Agent 上下文（当前编辑文件）
 */

/**
 * @param {string} relPath 工程内相对路径
 * @returns {string}
 */
function buildCodxEditorContextForAi(relPath) {
  const p = String(relPath || '').trim();
  if (!p) return '';
  return [
    '【CodX 当前编辑文件】',
    `相对路径: ${p}`,
    '用户说「当前文件」「这个文件」「此文件」「选中的文件」「打开的文件」时，',
    'codx_edit_plan 与 codx_edit 的 path 须用上述相对路径；修改前仍须 read_text_file 读取磁盘内容。' +
    'plan 每项仅 line_start；流式 text 段末用 pecado_LLM_line_end 分隔。',
  ].join('\n');
}

module.exports = { buildCodxEditorContextForAi };
