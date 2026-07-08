/**
 * @file write-guard.js
 * 【功能】已有文件写入前须先 read_file；同轮 read+write 的 write 延后到下一轮（避免用过期 tool args）
 */
const projectIo = require('../mcp-filesystem');
const { isDiskWriteTool } = require('./agent-reply');
const { isReadTextFileToolName } = require('./read-text-file');

function pathKey(projectRoot, filePath) {
  const raw = String(filePath || '').trim();
  if (!raw || !projectRoot) return raw.replace(/\\/g, '/');
  try {
    return projectIo.toProjectRelPath(projectRoot, raw);
  } catch {
    return raw.replace(/\\/g, '/').replace(/^\.\//, '');
  }
}

function pathExistsInProject(projectRoot, relPath) {
  const key = pathKey(projectRoot, relPath);
  if (!key || !projectRoot) return false;
  try {
    const xcodeProject = require('../xcode/project');
    return xcodeProject.pathExistsUnderRoot(projectRoot, key);
  } catch {
    return false;
  }
}

function isExistingPathWrite(task, projectRoot) {
  if (!isDiskWriteTool(task?.name)) return false;
  const relPath = task?.args?.path != null ? String(task.args.path).trim() : '';
  return Boolean(relPath && pathExistsInProject(projectRoot, relPath));
}

function createSyntheticReadTask(relPath, index = 9000) {
  const safe = String(relPath || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 48);
  return {
    id: `call_preread_${safe}_${index}`,
    index,
    type: 'mcp_tool',
    name: 'read_text_file',
    args: { path: String(relPath || '').trim() },
    synthetic: true,
  };
}

/**
 * 为自动插入的 read_file 补全 assistant.tool_calls，避免 tool 结果 id 对不上。
 * @param {Array<object>} conv
 * @param {Array<object>} tasks
 */
function attachSyntheticToolCallsToConv(conv, tasks) {
  const synth = (tasks || []).filter((t) => t.synthetic && t.id && t.name);
  if (!synth.length || !Array.isArray(conv)) return;

  for (let i = conv.length - 1; i >= 0; i -= 1) {
    const msg = conv[i];
    if (msg?.role !== 'assistant') continue;
    if (!Array.isArray(msg.tool_calls)) msg.tool_calls = [];
    for (const t of synth) {
      if (msg.tool_calls.some((tc) => tc.id === t.id)) continue;
      msg.tool_calls.push({
        id: t.id,
        type: 'function',
        index: t.index ?? msg.tool_calls.length,
        function: {
          name: t.name,
          arguments: JSON.stringify(t.args || {}),
        },
      });
    }
    break;
  }
}

/**
 * @param {Array<object>} tasks
 * @param {string} projectRoot
 * @param {Set<string>} diskFreshReadPaths 本轮对话中已成功 read_file 的路径（工程相对路径）
 */
function planTasksWithWriteGuard(tasks, projectRoot, diskFreshReadPaths) {
  const list = Array.isArray(tasks) ? [...tasks] : [];
  const existingWrites = list.filter((t) => isExistingPathWrite(t, projectRoot));
  if (!existingWrites.length) return { tasks: list, deferredWrites: [] };

  const writePaths = [
    ...new Set(existingWrites.map((t) => pathKey(projectRoot, String(t.args.path).trim()))),
  ];
  const readPathsInBatch = new Set(
    list
      .filter((t) => isReadTextFileToolName(t.name))
      .map((t) => pathKey(projectRoot, String(t.args?.path || '').trim()))
      .filter(Boolean)
  );

  const deferPaths = new Set(
    writePaths.filter(
      (p) => !diskFreshReadPaths.has(p) || (diskFreshReadPaths.has(p) && readPathsInBatch.has(p))
    )
  );

  if (!deferPaths.size) return { tasks: list, deferredWrites: [] };

  const deferredWrites = existingWrites.filter((t) =>
    deferPaths.has(pathKey(projectRoot, String(t.args.path).trim()))
  );
  let planned = list.filter((t) => !deferredWrites.includes(t));

  for (const p of writePaths) {
    if (!deferPaths.has(p)) continue;
    if (
      planned.some(
        (t) =>
          isReadTextFileToolName(t.name) &&
          pathKey(projectRoot, String(t.args?.path || '').trim()) === p
      )
    ) {
      continue;
    }
    planned.unshift(createSyntheticReadTask(p, 9000 + planned.length));
  }

  const reads = planned.filter((t) => isReadTextFileToolName(t.name));
  const rest = planned.filter((t) => !isReadTextFileToolName(t.name));
  return { tasks: [...reads, ...rest], deferredWrites };
}

module.exports = {
  planTasksWithWriteGuard,
  attachSyntheticToolCallsToConv,
  pathExistsInProject,
  isExistingPathWrite,
  pathKey,
};
