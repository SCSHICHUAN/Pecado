/**
 * @file register.js
 * @module pecado
 *
 * 【职责】对话模块主进程入口（仅对话层，不含 Agent 编排与 tool 执行）。
 *   · IPC：VOLC_ARK.BOTS_CHAT_COMPLETION
 *   · 模式路由：plain | context | agent → agent/router.js
 *   · agent 模式：创建 uiSink 后调用 agent-loop/runAppAgentLoop
 *   · plain/context：调用 plain-stream → llm-server/collectPlainChat
 *
 * 【注册】main/js/main.js → pecado.register(ipcMain)
 *
 * 【不负责】MCP 连接、tool 执行、LLM HTTP、Git、本地 JSON 指令（见各 sibling 模块）
 */
const router = require('./agent/router');

function register(ipcMain) {
  router.register(ipcMain);
}

module.exports = { register };
