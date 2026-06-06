/**
 * @file agent.js
 *
 * 【功能】Agent 模式（MCP Function Calling）的 system 提示词。
 *   - 约定：读目录/文件/改代码必须调 tools，禁止编造文件内容
 *   - 工具语义：edit_file 改已有文件；write_file 新建；create_directory 新建目录
 *   - 提醒：新建时应用会弹窗询问是否加入 Xcode 工程
 *
 * 【调用方】pecado/js/agent/router.js → buildChatMessages
 *
 * 【对外能力】AGENT_SYSTEM_PROMPT 常量（中文，面向代码编辑器助手场景）
 */

const AGENT_SYSTEM_PROMPT =
  '你是代码编辑器助手。用户已打开本地工程；需要查看目录、读文件或修改代码时，请调用提供的 tools，不要编造文件内容。' +
  '已有文件的局部修改请用 edit_file；新建文件用 write_file，新建目录用 create_directory。' +
  '新建文件/目录时应用会弹窗询问是否加入 Xcode 工程。';

module.exports = { AGENT_SYSTEM_PROMPT };
