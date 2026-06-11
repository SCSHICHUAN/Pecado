/**
 * @file post-write-xcode.js
 * 【功能】写代码后自动编译一次；xcode_run 仅在用户明确要运行时执行。
 */
const { findXcodeProject, IS_DARWIN } = require('../xcode/project');
const {
  EXECUTE_execute_tool: EXECUTE_xcode_tool,
  FEED_tool_result: FEED_xcode_tool_result,
} = require('../xcode/tool-executor');

const CODE_WRITE_TOOLS = new Set(['write_file', 'edit_file']);
const XCODE_USER_TOOLS = new Set(['xcode_build', 'xcode_run', 'xcode_test']);

function userWantsXcodeRun(userText) {
  return /运行|跑起来|跑一下|启动|试跑|执行\s*run|xcode_run|按\s*⌘r|cmd\+r|\brun\b/i.test(String(userText || ''));
}

function isCodeWriteTool(name) {
  return CODE_WRITE_TOOLS.has(String(name || ''));
}

function isXcodeUserTool(name) {
  return XCODE_USER_TOOLS.has(String(name || ''));
}

function hasXcodeProject(projectRoot) {
  return IS_DARWIN && Boolean(findXcodeProject(projectRoot));
}

/**
 * @param {Array<{ name: string, args?: object }>} tasks
 */
function summarizeWriteTasks(tasks) {
  const paths = (tasks || [])
    .filter((t) => isCodeWriteTool(t.name))
    .map((t) => (t.args?.path != null ? String(t.args.path).trim() : ''))
    .filter(Boolean);
  if (!paths.length) return '代码已更新。';
  return `已写入/更新：\n${paths.map((p) => `· ${p}`).join('\n')}`;
}

/**
 * @param {object} uiSink
 * @param {string} projectRoot
 */
async function runAutoBuild(uiSink, projectRoot) {
  if (!hasXcodeProject(projectRoot)) {
    return { ok: true, observation: '未找到 Xcode 工程，已跳过自动编译。' };
  }
  const feed = await invokeXcodeTool(uiSink, 'xcode_build', {});
  return { ok: feed.ok, observation: feed.observation };
}

/**
 * @param {object} uiSink
 */
async function runAutoRun(uiSink) {
  const feed = await invokeXcodeTool(uiSink, 'xcode_run', {});
  return { ok: feed.ok, observation: feed.observation };
}

/**
 * @param {object} uiSink
 * @param {string} name
 * @param {object} [args]
 */
async function invokeXcodeTool(uiSink, name, args = {}) {
  const execRaw = await EXECUTE_xcode_tool(
    { module: 'xcode', task: { name, args: args || {} } },
    { uiSink }
  );
  return FEED_xcode_tool_result(execRaw);
}

/**
 * @param {{
 *   leadText?: string,
 *   writeSummary?: string,
 *   buildObservation?: string,
 *   runObservation?: string,
 *   toolObservations?: string[],
 * }} parts
 */
function composeAgentReply(parts) {
  const lines = [];
  const lead = String(parts.leadText || '').trim();
  if (lead) lines.push(lead);

  const writeSummary = String(parts.writeSummary || '').trim();
  if (writeSummary) {
    if (lines.length) lines.push('');
    lines.push(writeSummary);
  }

  if (parts.buildObservation) {
    if (lines.length) lines.push('');
    lines.push('--- 自动编译 ---', String(parts.buildObservation).trim());
  }

  if (parts.runObservation) {
    if (lines.length) lines.push('');
    lines.push('--- Run ---', String(parts.runObservation).trim());
  }

  const toolObs = (parts.toolObservations || []).map((t) => String(t || '').trim()).filter(Boolean);
  if (toolObs.length) {
    if (lines.length) lines.push('');
    lines.push(...toolObs);
  }

  return lines.join('\n').trim() || '完成。';
}

module.exports = {
  CODE_WRITE_TOOLS,
  XCODE_USER_TOOLS,
  userWantsXcodeRun,
  isCodeWriteTool,
  isXcodeUserTool,
  summarizeWriteTasks,
  runAutoBuild,
  runAutoRun,
  invokeXcodeTool,
  composeAgentReply,
};
