/**
 * @file register.js
 * @module commands
 *
 * 【职责】助手回复后置本地 JSON 指令（与 Agent Loop / MCP 无关）。
 *   · IPC：QQ_MUSIC.HANDLE_BOT_COMMAND
 *   · 渲染进程在回合结束后 invoke handleBotCommand(displayText)
 *
 * 【注册】main/js/main.js → commands.register(ipcMain)
 */
const localCommands = require('./local-commands');

function register(ipcMain) {
  localCommands.register(ipcMain);
}

module.exports = { register };
