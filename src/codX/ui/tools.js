/**
 * @file tools.js
 * CodX UI 设计稿工具（read_design_summary）
 */
const projectIo = require('../../mcp-filesystem');
const { readDesignSummary } = require('./read-design-summary');

const READ_DESIGN_SUMMARY_TOOL_NAME = 'read_design_summary';

const READ_DESIGN_SUMMARY_TOOL = {
  name: READ_DESIGN_SUMMARY_TOOL_NAME,
  description:
    '读取 DesignImports/ 下 Framelink 导出的 UI 设计稿，返回精简 layout/tree 摘要（省 token）。' +
    '禁止对同一 JSON 使用无 head/tail 的 read_text_file。' +
    '实现界面前先调本工具；需要视觉参考再 read_media_file 读 summary 里的 previewAssets。',
  inputSchema: {
    type: 'object',
    properties: {
      bundlePath: {
        type: 'string',
        description: '相对工程路径，如 DesignImports/apple_ios_16_ui_kit__… 或其下 .json',
      },
      depth: {
        type: 'integer',
        description: '节点树深度，默认 4，最大 8',
      },
      nodeId: {
        type: 'string',
        description: '可选，只摘要指定 Figma node id（如 2:1993）',
      },
    },
    required: ['bundlePath'],
  },
};

function isCodxUiToolName(name) {
  return String(name || '') === READ_DESIGN_SUMMARY_TOOL_NAME;
}

function getCodxUiTools() {
  return [{ ...READ_DESIGN_SUMMARY_TOOL }];
}

async function EXECUTE_codx_ui_tool(routedTask) {
  const { name, args } = routedTask.task;
  if (name !== READ_DESIGN_SUMMARY_TOOL_NAME) {
    return {
      isError: true,
      content: [{ type: 'text', text: `未知 CodX UI 工具：${name}` }],
    };
  }

  const status = projectIo.getStatus();
  if (!status.connected || !status.projectRoot) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'read_design_summary：请先 Open Folder 打开工程' }],
    };
  }

  const result = readDesignSummary(status.projectRoot, args || {});
  if (!result.ok) {
    return {
      isError: true,
      content: [{ type: 'text', text: `read_design_summary：${result.error}` }],
    };
  }

  const header = [
    `bundle: ${result.bundlePath}`,
    `json: ${result.jsonRel}`,
    `nodes: ${result.nodeCount}${result.truncated ? ' (truncated)' : ''} · ${result.charCount} chars`,
    result.hint,
    '',
    '---',
    result.summary,
  ].join('\n');

  return {
    content: [{ type: 'text', text: header }],
  };
}

function FEED_codx_ui_tool_result(execRaw) {
  const parts = Array.isArray(execRaw?.content) ? execRaw.content : [];
  const observation = parts
    .filter((p) => p?.type === 'text' && p.text != null)
    .map((p) => String(p.text))
    .join('\n');
  return {
    ok: !execRaw?.isError,
    source: 'codx/ui',
    observation: observation || String(execRaw ?? ''),
    raw: execRaw,
  };
}

module.exports = {
  READ_DESIGN_SUMMARY_TOOL_NAME,
  isCodxUiToolName,
  getCodxUiTools,
  EXECUTE_codx_ui_tool,
  FEED_codx_ui_tool_result,
};
