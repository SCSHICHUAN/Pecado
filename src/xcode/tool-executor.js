/**
 * @file tool-executor.js
 * @module xcode / ToolExecutor (EXEC)
 *
 * 【入口】EXECUTE_execute_tool — Agent loop 调用 xcode_build / xcode_test / xcode_project_status
 */
const projectIo = require('../mcp-filesystem');
const {
  runXcodeAction,
  runXcodeProject,
  formatBuildObservation,
  formatRunObservation,
  getProjectStatus,
  formatProjectStatusObservation,
} = require('./build-runner');
const { isXcodeToolName } = require('./tools');

/**
 * @param {{ module: string, task: { name: string, args?: object } }} routedTask
 * @param {{ uiSink?: { onBuildLog?: (info: object) => void } }} [execOpts]
 */
async function EXECUTE_execute_tool(routedTask, execOpts = {}) {
  if (routedTask.module !== 'xcode') {
    return {
      isError: true,
      content: [{ type: 'text', text: `EXEC：未支持的模块 ${routedTask.module}` }],
    };
  }

  const { name, args = {} } = routedTask.task;
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
  const uiSink = execOpts.uiSink;

  if (name === 'xcode_project_status') {
    const status = await getProjectStatus(projectRoot);
    const text = formatProjectStatusObservation(status);
    return {
      isError: !status.ok,
      content: [{ type: 'text', text }],
    };
  }

  const scheme = args.scheme != null ? String(args.scheme).trim() : '';
  const destination = args.destination != null ? String(args.destination).trim() : '';
  const simulator = args.simulator != null ? String(args.simulator).trim() : '';

  if (name === 'xcode_run') {
    uiSink?.onBuildLog?.({
      step: 'start',
      action: 'run',
      scheme: scheme || '(auto)',
    });

    const result = await runXcodeProject(projectRoot, {
      scheme: scheme || undefined,
      destination: destination || undefined,
      simulator: simulator || undefined,
      onLine: (line) => {
        uiSink?.onBuildLog?.({ step: 'line', action: 'run', line });
      },
    });

    uiSink?.onBuildLog?.({
      step: 'end',
      action: 'run',
      ok: result.ok,
      exitCode: result.exitCode,
    });

    const text = formatRunObservation(result);
    return {
      isError: !result.ok,
      content: [{ type: 'text', text }],
    };
  }

  const action = name === 'xcode_test' ? 'test' : 'build';

  uiSink?.onBuildLog?.({
    step: 'start',
    action,
    scheme: scheme || '(auto)',
  });

  const result = await runXcodeAction(projectRoot, {
    scheme: scheme || undefined,
    destination: destination || undefined,
    action,
    onLine: (line) => {
      uiSink?.onBuildLog?.({ step: 'line', action, line });
    },
  });

  uiSink?.onBuildLog?.({
    step: 'end',
    action,
    ok: result.ok,
    exitCode: result.exitCode,
  });

  const text = formatBuildObservation(result);
  return {
    isError: !result.ok,
    content: [{ type: 'text', text }],
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

module.exports = { EXECUTE_execute_tool, FEED_tool_result };
