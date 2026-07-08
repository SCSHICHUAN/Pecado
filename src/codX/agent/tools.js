/**
 * @file tools.js
 * CodX 行级编辑工具（两轮：plan → content）
 */
const { formatWithLineNumbers } = require('../../shared/line-numbers');
const {
  inferCodxOp,
  applyCodxEditOp,
  computeCodxEditDelta,
  mapOriginalLineToCurrent,
} = require('../../shared/codx-edit-ops');
const {
  validateCodxEditPlan,
  PECADO_LLM_LINE_END,
} = require('../../shared/codx-edit-plan');
const projectIo = require('../../mcp-filesystem');
const {
  isCodxUiToolName,
  getCodxUiTools,
  EXECUTE_codx_ui_tool,
} = require('../ui/tools');

function normalizeCodxRelPath(inputPath) {
  const raw = String(inputPath || '').trim();
  if (!raw) return '';
  const root = projectIo.getStatus()?.projectRoot;
  if (root) {
    try {
      return projectIo.toProjectRelPath(root, raw);
    } catch (_) {
      /* fall through */
    }
  }
  return raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

const CODX_EDIT_PLAN_TOOL_NAME = 'codx_edit_plan';
const CODX_EDIT_TOOL_NAME = 'codx_edit';

const CODX_EDIT_PLAN_TOOL = {
  name: CODX_EDIT_PLAN_TOOL_NAME,
  description:
    '【第一轮】提交修改计划（须先 read_text_file）。path + edits[]，大行号在前。' +
    '每项：line_start、op（insert_below | replace | delete）、line_end（replace/delete 必填）。不含真实代码。',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '工程内相对路径（勿用绝对路径）' },
      edits: {
        type: 'array',
        description: '修改点位列表，大行号在前',
        items: {
          type: 'object',
          properties: {
            line_start: { type: 'integer', description: '锚点行号（从 1 开始）' },
            op: {
              type: 'string',
              enum: ['insert_below', 'replace', 'delete'],
              description: 'insert_below=行末下插入；replace=替换行块；delete=删除行块',
            },
            line_end: {
              type: 'integer',
              description: 'replace/delete 的结束行号（含）；insert_below 可省略',
            },
          },
          required: ['line_start', 'op'],
        },
      },
    },
    required: ['path', 'edits'],
  },
};

const CODX_EDIT_TOOL = {
  name: CODX_EDIT_TOOL_NAME,
  description:
    '【第二轮】流式写入真实修改内容（须先 codx_edit_plan）。仅 path + text。' +
    `按 plan 顺序（大行号→小行号）写入各段，段末 ${PECADO_LLM_LINE_END}。` +
    'insert_below 段只写新代码；replace 段只写替换后的新代码；delete 段可空或省略内容。',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '与 plan 相同路径' },
      text: {
        type: 'string',
        description: `各段按 plan 顺序拼接，段间用 ${PECADO_LLM_LINE_END} 分隔`,
      },
    },
    required: ['path', 'text'],
  },
};

function isCodxToolName(name) {
  const n = String(name || '');
  return n === CODX_EDIT_TOOL_NAME || n === CODX_EDIT_PLAN_TOOL_NAME || isCodxUiToolName(n);
}

function getCodxTools() {
  return [{ ...CODX_EDIT_PLAN_TOOL }, { ...CODX_EDIT_TOOL }, ...getCodxUiTools()];
}

/**
 * @param {import('../../agent-loop/task-dispatcher').RoutedTask} routedTask
 * @param {{ streamContext?: { codxEditTargets?: Map } }} [execOpts]
 */
async function EXECUTE_codx_tool(routedTask, execOpts = {}) {
  const { name, args, index } = routedTask.task;

  if (isCodxUiToolName(name)) {
    return EXECUTE_codx_ui_tool(routedTask, execOpts);
  }

  if (name === CODX_EDIT_PLAN_TOOL_NAME) {
    const relPath = normalizeCodxRelPath(args?.path);
    const validated = validateCodxEditPlan(args?.edits);
    if (!relPath) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'codx_edit_plan：缺少 path' }],
      };
    }
    if (!validated.ok) {
      return {
        isError: true,
        content: [{ type: 'text', text: `codx_edit_plan：${validated.error}` }],
      };
    }
    const lines = validated.edits
      .map((ed) => {
        const end =
          ed.endLine != null && ed.op !== 'insert_below' ? `-${ed.endLine}` : '';
        return `L${ed.startLine}${end} ${ed.op}`;
      })
      .join(' → ');
    return {
      content: [
        {
          type: 'text',
          text:
            `plan OK：${relPath}（${validated.edits.length} 处：${lines}）。` +
            `【必须】立刻调用 codx_edit，path="${relPath}"，text 按上述顺序流式写入，段末 ${PECADO_LLM_LINE_END}。`,
        },
      ],
      codxPlan: { path: relPath, edits: validated.edits },
    };
  }

  if (name !== CODX_EDIT_TOOL_NAME) {
    return {
      isError: true,
      content: [{ type: 'text', text: `未知 CodX 工具：${name}` }],
    };
  }

  const relPath = normalizeCodxRelPath(args?.path);
  const target = execOpts.streamContext?.codxEditTargets?.get(index ?? 0);
  const streamed = target?.streamed || (target?.textLen ?? 0) > 0;

  if (streamed) {
    return {
      content: [
        {
          type: 'text',
          text: `已在 CodX 编辑器更新 ${relPath}，请 ⌘S 保存或点 ↥ 同步到 Xcode。`,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text:
          `codx_edit(${relPath}) 未收到流式 text。请先 codx_edit_plan，再单独一轮 codx_edit 写入内容。`,
      },
    ],
    isError: true,
  };
}

function FEED_codx_tool_result(execRaw) {
  const parts = Array.isArray(execRaw?.content) ? execRaw.content : [];
  const observation = parts
    .filter((p) => p?.type === 'text' && p.text != null)
    .map((p) => String(p.text))
    .join('\n');
  return {
    ok: !execRaw?.isError,
    source: 'codx/exec',
    observation: observation || String(execRaw ?? ''),
    raw: execRaw,
  };
}

module.exports = {
  CODX_EDIT_PLAN_TOOL_NAME,
  CODX_EDIT_TOOL_NAME,
  PECADO_LLM_LINE_END,
  normalizeCodxRelPath,
  isCodxToolName,
  getCodxTools,
  applyCodxEditOp,
  inferCodxOp,
  computeCodxEditDelta,
  mapOriginalLineToCurrent,
  formatWithLineNumbers,
  EXECUTE_codx_tool,
  FEED_codx_tool_result,
};
