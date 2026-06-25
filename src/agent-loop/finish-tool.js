/**
 * @file finish-tool.js
 * LLM 自行判断任务完成时调用；本地不编排步骤，只认此信号结束。
 */
const FINISH_TASK_NAME = 'finish_task';

const FINISH_NUDGE =
  '【系统】请根据用户意图自行编排并选用 tools。未完成则继续执行；全部完成时请调用 finish_task(summary)，勿仅用文字结束。';

function getFinishTaskTool() {
  return {
    name: FINISH_TASK_NAME,
    description:
      '当用户意图已全部完成时调用（改码、运行、脚本、咨询等均可）。' +
      'summary 为给用户的简短结果说明。未完成前勿调用。',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '任务结果摘要' },
      },
      required: ['summary'],
    },
  };
}

function isFinishTaskName(name) {
  return String(name || '') === FINISH_TASK_NAME;
}

/** @param {Array<{ name: string, args?: object }>} tasks */
function extractFinishSummary(tasks, fallbackText = '') {
  const parts = (tasks || [])
    .filter((t) => isFinishTaskName(t.name))
    .map((t) => String(t.args?.summary || '').trim())
    .filter(Boolean);
  if (parts.length) return parts.join('\n');
  return String(fallbackText || '').trim() || '完成。';
}

module.exports = {
  FINISH_TASK_NAME,
  FINISH_NUDGE,
  getFinishTaskTool,
  isFinishTaskName,
  extractFinishSummary,
};
