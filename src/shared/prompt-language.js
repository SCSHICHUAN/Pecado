/**
 * @file prompt-language.js
 * 全项目 LLM 语言约束（主进程 require；与 renderer 无关）
 */

/** Agent / 编程对话 system 首段：优先约束 reasoning 中文 */
const AGENT_LANGUAGE_PREAMBLE = [
  '【最高优先级 · 语言】',
  '你必须使用简体中文与用户交流。',
  '若模型支持 reasoning / 思考链（reasoning_content 字段）：',
  '· 思考过程**必须**用简体中文书写（例如：「先读取当前文件…」「用户要改背景色…」）。',
  '· **禁止**在思考链里用英文做内心推理（Do not think in English）。',
  '· 仅代码、路径、API/工具名、编译器原文可保留英文。',
  '给用户的正文与 finish_task(summary) 同样使用简体中文。',
].join('\n');

/** CodX 底栏编程对话额外强调（router 注入 system 末尾，靠近 user 消息） */
const CODX_CHAT_LANGUAGE_BLOCK = [
  '【CodX 编程对话 · 语言提醒】',
  '用户正在 CodX 代码编辑器底栏与你对话；界面「思考」区会直接展示 reasoning 流。',
  '因此 reasoning 思考链务必全程简体中文，勿输出英文推理段落。',
  '✓ 正确示例：「用户想改 ViewController 背景色，我先 read_text_file 确认当前代码…」',
  '✗ 错误示例：「The user wants to change the background color, I should read the file first…」',
].join('\n');

/** CodX 用户消息前缀（比 system 更易约束 reasoning 语言） */
const CODX_USER_TEXT_PREFIX = '【请用简体中文进行 reasoning 思考，并用简体中文回复】';

/** Agent 多轮继续时 ephemeral 提醒（仅当次 INFER，不写入 conv） */
const CODX_REASONING_ROUND_NUDGE =
  '【系统】继续编排 tools 时，reasoning 思考链仍须全程简体中文（界面会直接展示）。';

/**
 * CodX 底栏：给用户消息加语言前缀（幂等）
 * @param {string} userText
 * @returns {string}
 */
function wrapCodxUserTextForAi(userText) {
  const text = String(userText ?? '').trim();
  if (!text) return text;
  if (text.includes(CODX_USER_TEXT_PREFIX)) return text;
  return `${CODX_USER_TEXT_PREFIX}\n\n${text}`;
}

module.exports = {
  AGENT_LANGUAGE_PREAMBLE,
  CODX_CHAT_LANGUAGE_BLOCK,
  CODX_USER_TEXT_PREFIX,
  CODX_REASONING_ROUND_NUDGE,
  wrapCodxUserTextForAi,
};
