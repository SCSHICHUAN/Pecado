/**
 * @file context.js
 * CodX 编程视图 → Agent 上下文（当前编辑文件 + 语言）
 */
const { CODX_CHAT_LANGUAGE_BLOCK } = require('../../shared/prompt-language');

/**
 * CodX 底栏对话：system 末尾再提醒一次（提高 reasoning 中文命中率）
 * @returns {string}
 */
function buildCodxChatLanguageBlockForAi() {
  return CODX_CHAT_LANGUAGE_BLOCK;
}

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
    '用户说「当前文件」「这个文件」「此文件」「选中的文件」「打开的文件」时，path 须用上述相对路径。',
    '若 read_text_file 后该文件为空或不存在 → 用 write_file 写完整内容；',
    '若已有代码 → 用 codx_edit_plan → codx_edit，勿 write_file 覆盖。',
  ].join('\n');
}

module.exports = { buildCodxEditorContextForAi, buildCodxChatLanguageBlockForAi };
