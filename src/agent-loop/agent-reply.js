/**
 * @file agent-reply.js
 * 【功能】写代码后拼装 Agent 回复。
 */

const CODE_WRITE_TOOLS = new Set(['write_file', 'edit_file', 'codx_edit']);
const DISK_WRITE_TOOLS = new Set(['write_file', 'edit_file']);

function isCodeWriteTool(name) {
  return CODE_WRITE_TOOLS.has(String(name || ''));
}

/** 直接写磁盘（write-guard 仅约束此类；codx_edit 只流式进编辑器） */
function isDiskWriteTool(name) {
  return DISK_WRITE_TOOLS.has(String(name || ''));
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
 * @param {{
 *   leadText?: string,
 *   writeSummary?: string,
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

  const toolObs = (parts.toolObservations || []).map((t) => String(t || '').trim()).filter(Boolean);
  if (toolObs.length) {
    if (lines.length) lines.push('');
    lines.push(...toolObs);
  }

  return lines.join('\n').trim() || '完成。';
}

module.exports = {
  isCodeWriteTool,
  isDiskWriteTool,
  summarizeWriteTasks,
  composeAgentReply,
};
