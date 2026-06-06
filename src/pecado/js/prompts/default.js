/**
 * @file default.js
 *
 * 【功能】plain / context 聊天模式的 system 角色提示词（无 MCP tools 时使用）。
 *   - plain：无工程上下文，纯对话
 *   - context：router 将 project-context 拼接到 system 末尾后再使用本 prompt
 *
 * 【调用方】pecado/js/agent/router.js → buildChatMessages
 *
 * 【对外能力】SYSTEM_PROMPT 常量（当前为简短英文助手人设）
 */

const SYSTEM_PROMPT = 'You are a helpful assistant.';

module.exports = { SYSTEM_PROMPT };
