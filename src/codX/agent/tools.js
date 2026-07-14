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
  PECADO_BLOCK_END,
  PLAN_OPS,
} = require('../../shared/codx-edit-plan');
const projectIo = require('../../mcp-filesystem');
const fs = require('fs');
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

const OP_STREAM_HINT =
  `段格式（与 plan 段序一致，段末 ${PECADO_BLOCK_END}）：` +
  `insert_code\\n代码\\n${PECADO_BLOCK_END}；` +
  `edit_code\\n代码\\n${PECADO_BLOCK_END}；` +
  `del_code\\n${PECADO_BLOCK_END}（无代码，区间 plan 取）；` +
  `insert_blanks\\n${PECADO_BLOCK_END}（无代码，区间 plan 取）。从 line_start 本行开始`;

const EMPTY_FILE_WRITE_HINT =
  '该文件为空或不存在，请改用 write_file 流式写入完整内容，勿用 codx_edit_plan / codx_edit。';

function isEmptyCodeFile(relPath) {
  const root = projectIo.getStatus()?.projectRoot;
  if (!root || !relPath) return false;
  try {
    const absPath = projectIo.resolveUnderProject(root, relPath);
    if (!fs.existsSync(absPath)) return true;
    if (!fs.statSync(absPath).isFile()) return false;
    return fs.readFileSync(absPath, 'utf8').trim().length === 0;
  } catch {
    return false;
  }
}

const CODX_EDIT_PLAN_TOOL = {
  name: CODX_EDIT_PLAN_TOOL_NAME,
  description:
    '【第一轮】改已有非空代码（须先 read_text_file）。空文件/新文件请用 write_file，勿调本工具。' +
    'path + edits[]，大行号在前。' +
    `每项：line_start、op（${PLAN_OPS.join(' | ')}）、line_end（del_code/edit_code/insert_blanks 必填）。` +
    '均从 line_start 本行开始。不含真实代码。',
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
            line_start: { type: 'integer', description: '起始行号（从 1 开始）' },
            op: {
              type: 'string',
              enum: PLAN_OPS,
              description:
                'insert_code=本行插入；edit_code=本行编辑；del_code=删行；insert_blanks=本行插空行',
            },
            line_end: {
              type: 'integer',
              description: 'del_code/edit_code/insert_blanks 的结束行号（含）',
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
    '【第二轮】改已有非空代码（须先 codx_edit_plan）。空文件/新文件请用 write_file。path + text。' +
    `与 plan 段序一致，段末 ${PECADO_BLOCK_END}。` +
    OP_STREAM_HINT,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '与 plan 相同路径' },
      text: {
        type: 'string',
        description:
          `insert_code\\n代码\\n${PECADO_BLOCK_END}；edit_code\\n代码\\n${PECADO_BLOCK_END}；` +
          `del_code\\n${PECADO_BLOCK_END}；insert_blanks\\n${PECADO_BLOCK_END}`,
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
    if (isEmptyCodeFile(relPath)) {
      return {
        isError: true,
        content: [{ type: 'text', text: `codx_edit_plan：${EMPTY_FILE_WRITE_HINT}` }],
      };
    }
    const lines = validated.edits
      .map((ed) => {
        const end =
          ed.endLine != null && ed.op !== 'insert_code' ? `-${ed.endLine}` : '';
        return `L${ed.startLine}${end} ${ed.op}`;
      })
      .join(' → ');
    return {
      content: [
        {
          type: 'text',
          text:
            `plan OK：${relPath}（${validated.edits.length} 处：${lines}）。` +
            `【必须】立刻 codx_edit path="${relPath}"；${OP_STREAM_HINT}`,
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
  if (isEmptyCodeFile(relPath)) {
    return {
      isError: true,
      content: [{ type: 'text', text: `codx_edit：${EMPTY_FILE_WRITE_HINT}` }],
    };
  }
  const target = execOpts.streamContext?.codxEditTargets?.get(index ?? 0);
  const streamed = target?.streamed || (target?.textLen ?? 0) > 0;

  if (streamed) {
    return {
      content: [
        {
          type: 'text',
          text: `已在 CodX 编辑器更新 ${relPath}，请 ⌘S 保存或点 ↥ 写入磁盘。`,
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
  PECADO_BLOCK_END,
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
