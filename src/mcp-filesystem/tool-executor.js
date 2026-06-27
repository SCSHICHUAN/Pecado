/**
 * @file tool-executor.js
 * @module mcp-filesystem / ToolExecutor (EXEC)
 *
 * 【节点】execute_tool
 * 【入口】EXECUTE_execute_tool — Loop 调用本模块时使用的执行方法
 * 【出口】FEED_tool_result    — 本模块向 Loop 反馈 tool 执行 Observation
 */
const projectIo = require('./index');
const { prepareMcpToolPath, resolveMcpDirectoryPath } = require('./read');
const { getMainWindow } = require('./ipc');
const { confirmCreateOperation, integrateAfterCreate } = require('../xcode/prompt');
const xcodeProject = require('../xcode/project');
const { formatWithLineNumbers } = require('../shared/line-numbers');

const IS_DARWIN = process.platform === 'darwin';

function appendXcodeIntegrateNote(result, kind, relPath, projectRoot, xcodeMeta) {
  if (!xcodeMeta || !relPath) return result;
  const r = integrateAfterCreate(xcodeMeta, kind, relPath, projectRoot);
  let suffix = '';
  if (r.ok && !r.already) suffix = `\n已加入 Xcode 工程（${r.path}）。`;
  else if (r.already) suffix = '\n已在 Xcode 工程中。';
  else if (r.skipped) suffix = `\n${r.reason}`;
  else if (!r.ok) suffix = `\n加入 Xcode 失败：${r.reason}`;

  if (!suffix) return result;
  if (result?.content?.[0]?.text != null) {
    result.content[0].text += suffix;
  } else if (typeof result === 'object' && result.content) {
    result.content.push({ type: 'text', text: suffix.trim() });
  }
  return result;
}

function formatObservationText(result) {
  if (!result || typeof result !== 'object') return String(result ?? '');
  const parts = Array.isArray(result.content) ? result.content : [];
  const texts = parts
    .filter((p) => p && p.type === 'text' && p.text != null)
    .map((p) => String(p.text));
  const joined = texts.join('\n');
  if (joined) return joined;
  if (result.isError) return 'MCP tool error (no text payload)';
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function resolveExecHints(task, streamContext = {}) {
  const idx = task.index ?? 0;
  const name = task.name;
  const streamParser = streamContext.writeParsers?.get(idx);
  const streamTarget = streamContext.writeTargets?.get(idx);

  const alreadyStreamedToDisk =
    name === 'write_file' &&
    streamTarget?.absPath &&
    IS_DARWIN &&
    streamTarget.xcodeLiveStream &&
    (streamTarget.fileStarted || (streamParser?.streamedContentLen ?? 0) > 0);

  return {
    alreadyStreamedToDisk,
    xcodeIntegrate: streamTarget?.xcodeIntegrate,
    xcodeMeta: streamTarget?.xcodeMeta,
    cancelled: streamTarget?.cancelled,
    codxDeferred: !!streamTarget?.codxDeferred,
    skipPrompt: name === 'write_file' && !!streamTarget,
    streamAbsPath: alreadyStreamedToDisk ? streamTarget?.absPath : null,
  };
}

/**
 * @param {import('../agent-loop/task-dispatcher').RoutedTask} routedTask
 * @param {{ streamContext?: { writeParsers?: Map, writeTargets?: Map } }} [execOpts]
 */
async function EXECUTE_execute_tool(routedTask, execOpts = {}) {
  if (routedTask.module !== 'mcp-filesystem') {
    return {
      isError: true,
      content: [{ type: 'text', text: `EXEC：未支持的模块 ${routedTask.module}` }],
    };
  }

  const { name, args } = routedTask.task;
  const execHints = resolveExecHints(routedTask.task, execOpts.streamContext || {});
  const projectRoot = projectIo.getStatus().projectRoot;
  const relPath = args?.path != null ? String(args.path) : '';

  if (execHints.cancelled) {
    return {
      isError: true,
      content: [{ type: 'text', text: '用户取消了创建操作。' }],
    };
  }

  if (execHints.streamAbsPath && execHints.alreadyStreamedToDisk) {
    await projectIo.awaitWritePending(execHints.streamAbsPath);
    await projectIo.closeWriteFile(execHints.streamAbsPath);
  }

  if (execHints.alreadyStreamedToDisk && name === 'write_file') {
    let result = {
      content: [{ type: 'text', text: `Successfully wrote to ${args.path}` }],
    };
    if (execHints.xcodeIntegrate && execHints.xcodeMeta) {
      result = appendXcodeIntegrateNote(result, 'write_file', relPath, projectRoot, execHints.xcodeMeta);
    }
    return result;
  }

  if (execHints.codxDeferred && name === 'write_file') {
    return {
      content: [
        {
          type: 'text',
          text: `已在 CodX 编辑器生成 ${args.path}，请确认差异后同步到 Xcode。`,
        },
      ],
    };
  }

  const isCreateDir = name === 'create_directory';
  const isWriteFile = name === 'write_file';
  const isNewPath = relPath && !xcodeProject.pathExistsUnderRoot(projectRoot, relPath);

  let xcodeIntegrate = !!execHints.xcodeIntegrate;
  let xcodeMeta = execHints.xcodeMeta || null;

  if ((isCreateDir || isWriteFile) && isNewPath && !execHints.skipPrompt) {
    const confirm = confirmCreateOperation(getMainWindow(), name, projectRoot, relPath);
    if (!confirm.proceed) {
      return {
        isError: true,
        content: [{ type: 'text', text: confirm.message }],
      };
    }
    xcodeIntegrate = confirm.integrateXcode;
    xcodeMeta = confirm.xcodeMeta;
    console.log('[xcode-prompt]', confirm.message);
  }

  let result;
  if (IS_DARWIN && isWriteFile && relPath) {
    const abs = projectIo.resolveUnderProject(projectRoot, relPath);
    await projectIo.writeWholeFileToDisk(abs, args.content);
    result = {
      content: [{ type: 'text', text: `Successfully wrote to ${args.path}` }],
    };
  } else {
    const callArgs = { ...args };
    if (callArgs.path != null && projectRoot) {
      callArgs.path =
        name === 'directory_tree' || name === 'list_directory'
          ? resolveMcpDirectoryPath(callArgs.path, projectRoot)
          : prepareMcpToolPath(callArgs.path, projectRoot);
    }
    result = await projectIo.callTool(name, callArgs);
  }

  if ((name === 'read_text_file' || name === 'read_file') && result?.content?.[0]?.text != null) {
    result.content[0].text = formatWithLineNumbers(result.content[0].text);
  }

  if (xcodeIntegrate && xcodeMeta && (isCreateDir || isWriteFile) && relPath) {
    result = appendXcodeIntegrateNote(result, name, relPath, projectRoot, xcodeMeta);
  }

  return result;
}

/**
 * @param {Awaited<ReturnType<typeof EXECUTE_execute_tool>>} execRaw
 * @returns {{ ok: boolean, source: string, observation: string, raw: object }}
 */
function FEED_tool_result(execRaw) {
  const observation = formatObservationText(execRaw);
  return {
    ok: !execRaw?.isError,
    source: 'mcp-filesystem/exec',
    observation,
    raw: execRaw,
  };
}

const ToolExecutor = { EXECUTE_execute_tool, FEED_tool_result };

module.exports = { ToolExecutor, EXECUTE_execute_tool, FEED_tool_result };
