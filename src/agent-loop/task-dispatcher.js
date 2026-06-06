/**
 * @file task-dispatcher.js
 * @module agent-loop / TaskDispatcher (DISPATCH)
 *
 * 【节点】route_task — Loop 内部编排，非业务模块入口
 */
const projectIo = require('../mcp-filesystem');

/**
 * @param {object} parsedTask
 * @returns {{ module: string, task: object } | { error: string }}
 */
function route_task(parsedTask) {
  if (!parsedTask || !parsedTask.type) {
    return { error: 'DISPATCH：缺少任务 type' };
  }

  switch (parsedTask.type) {
    case 'mcp_tool': {
      if (!projectIo.getStatus().connected) {
        return { error: 'DISPATCH：MCP 未连接' };
      }
      return {
        module: 'mcp-filesystem',
        task: parsedTask,
      };
    }
    default:
      return { error: `DISPATCH：未知任务 type「${parsedTask.type}」` };
  }
}

const TaskDispatcher = { route_task };

module.exports = { TaskDispatcher, route_task };
