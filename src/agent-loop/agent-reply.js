/**
 * @file agent-reply.js
 * 【功能】Agent 回复拼装（直调 Xcode 工具等场景）。
 */

const DISK_WRITE_TOOLS = new Set(['write_file', 'edit_file']);

/** 直接写磁盘（write-guard 仅约束此类；codx_edit 只流式进编辑器） */
function isDiskWriteTool(name) {
  return DISK_WRITE_TOOLS.has(String(name || ''));
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
  isDiskWriteTool,
  composeAgentReply,
};
