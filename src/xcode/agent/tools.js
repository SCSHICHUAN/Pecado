/**
 * @file tools.js
 * 【功能】Agent Xcode 工具定义与执行（当前仅 xcode_project_status）
 */
const projectIo = require('../../mcp-filesystem');
const { IS_DARWIN, getProjectStatus, formatProjectStatusObservation } = require('../project');

const XCODE_TOOL_NAMES = new Set(['xcode_project_status']);

/** @returns {Array<{ name: string, description: string, inputSchema: object }>} */
function getXcodeTools() {
  if (!IS_DARWIN) return [];

  return [
    {
      name: 'xcode_project_status',
      description:
        '读取当前打开的 Xcode 工程 scheme 与路径。仅在用户明确问 iOS 工程结构或按 Skill 编译前需确认 scheme 时使用；PDF/文档/其它 Skill 任务勿调用。',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];
}

function isXcodeToolName(name) {
  return XCODE_TOOL_NAMES.has(String(name || '').trim());
}

/**
 * @param {{ module: string, task: { name: string, args?: object } }} routedTask
 */
async function EXECUTE_execute_tool(routedTask) {
  if (routedTask.module !== 'xcode') {
    return {
      isError: true,
      content: [{ type: 'text', text: `EXEC：未支持的模块 ${routedTask.module}` }],
    };
  }

  const { name } = routedTask.task;
  if (!isXcodeToolName(name)) {
    return {
      isError: true,
      content: [{ type: 'text', text: `EXEC：未知 Xcode tool「${name}」` }],
    };
  }

  if (!projectIo.getStatus().connected) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'MCP 未连接，请先用 File → Open Folder 打开工程目录' }],
    };
  }

  const projectRoot = projectIo.getStatus().projectRoot;

  if (name === 'xcode_project_status') {
    const status = await getProjectStatus(projectRoot);
    const text = formatProjectStatusObservation(status);
    return {
      isError: !status.ok,
      content: [{ type: 'text', text }],
    };
  }

  return {
    isError: true,
    content: [{ type: 'text', text: `EXEC：未实现的 Xcode tool「${name}」` }],
  };
}

/**
 * @param {Awaited<ReturnType<typeof EXECUTE_execute_tool>>} execRaw
 */
function FEED_tool_result(execRaw) {
  const parts = Array.isArray(execRaw?.content) ? execRaw.content : [];
  const observation = parts
    .filter((p) => p && p.type === 'text' && p.text != null)
    .map((p) => String(p.text))
    .join('\n');
  return {
    ok: !execRaw?.isError,
    source: 'xcode/exec',
    observation: observation || (execRaw?.isError ? 'Xcode tool error' : ''),
    raw: execRaw,
  };
}

module.exports = {
  getXcodeTools,
  isXcodeToolName,
  XCODE_TOOL_NAMES,
  EXECUTE_execute_tool,
  FEED_tool_result,
};
