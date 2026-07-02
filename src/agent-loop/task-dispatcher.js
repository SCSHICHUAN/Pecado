/**
 * @file task-dispatcher.js
 * @module agent-loop / TaskDispatcher (DISPATCH)
 *
 * 【节点】route_task — Loop 内部编排，非业务模块入口
 */
const projectIo = require('../mcp-filesystem');
const { IS_DARWIN } = require('../xcode/project');
const { isCodxToolName } = require('../codX/agent/tools');
const { isReadMediaFileToolName } = require('../mcp-filesystem/read-media');

/**
 * @param {object} parsedTask
 * @returns {{ module: string, task: object } | { error: string }}
 */
function route_task(parsedTask) {
  if (!parsedTask || !parsedTask.type) {
    return { error: 'DISPATCH：缺少任务 type' };
  }

  switch (parsedTask.type) {
    case 'xcode_tool': {
      if (!IS_DARWIN) {
        return { error: 'DISPATCH：Xcode 工具仅支持 macOS' };
      }
      if (!projectIo.getStatus().connected) {
        return { error: 'DISPATCH：MCP 未连接' };
      }
      return {
        module: 'xcode',
        task: parsedTask,
      };
    }
    case 'dev_docs_tool':
      return {
        module: 'skill',
        task: parsedTask,
      };
    case 'codx_tool': {
      if (!isCodxToolName(parsedTask.name)) {
        return { error: `DISPATCH：未知 CodX 工具「${parsedTask.name}」` };
      }
      return {
        module: 'codx',
        task: parsedTask,
      };
    }
    case 'mcp_tool': {
      if (!projectIo.getStatus().connected) {
        return { error: 'DISPATCH：MCP 未连接' };
      }
      // read_media_file 走本地读盘（在 app-agent-loop 里内联调度）
      if (isReadMediaFileToolName(parsedTask.name)) {
        return { module: 'mcp-filesystem', task: parsedTask };
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
