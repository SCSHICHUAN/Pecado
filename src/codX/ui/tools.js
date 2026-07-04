/**
 * @file tools.js
 * CodX UI 设计稿工具（read_UI_layer）
 */
const projectIo = require('../../mcp-filesystem');
const { readUiLayer } = require('./read-ui-layer');

const READ_UI_LAYER_TOOL_NAME = 'read_UI_layer';

const READ_UI_LAYER_TOOL = {
  name: READ_UI_LAYER_TOOL_NAME,
  description:
    '分层读取压缩后的 Figma 设计稿 JSON。' +
    '首次调用不传 layer：返回前3层完整节点数据（骨架），含每个子节点的 id/type/name/size/childCount。' +
    '需要深入时，传 nodeId + layer（建议+2）获取该节点往下的完整数据。' +
    'JSON 中的 key 已被压缩为 S0/S1/... 短Key，需参考 __keyMap 还原真实含义。' +
    '优先使用本工具代替 read_text_file 读 Figma JSON。',
  inputSchema: {
    type: 'object',
    properties: {
      bundlePath: {
        type: 'string',
        description: '相对工程路径，如 DesignImports/apple_ios_16_ui_kit__…',
      },
      layer: {
        type: 'integer',
        description: '返回哪一层的完整数据，默认3（骨架）。深入某个子节点时传更大值（如5）',
      },
      nodeId: {
        type: 'string',
        description: '可选，指定从哪个节点的下一层开始读取（配合layer使用）',
      },
    },
    required: ['bundlePath'],
  },
};

function isCodxUiToolName(name) {
  return String(name || '') === READ_UI_LAYER_TOOL_NAME;
}

function getCodxUiTools() {
  return [{ ...READ_UI_LAYER_TOOL }];
}

async function EXECUTE_codx_ui_tool(routedTask) {
  const { name, args } = routedTask.task;

  const status = projectIo.getStatus();
  if (!status.connected || !status.projectRoot) {
    return {
      isError: true,
      content: [{ type: 'text', text: `${name}：请先 Open Folder 打开工程` }],
    };
  }

  if (name === READ_UI_LAYER_TOOL_NAME) {
    const result = readUiLayer(status.projectRoot, args || {});
    if (!result.ok) {
      return {
        isError: true,
        content: [{ type: 'text', text: `read_UI_layer：${result.error}` }],
      };
    }

    const keyMapNote = result.compressed
      ? '注意：JSON 中长 key 已压缩为 S0,S1,... 短Key，参考顶部 __keyMap 字典还原'
      : '（JSON 未压缩，使用原始 key 名称）';

    const header = [
      `bundle: ${args.bundlePath}`,
      `layer: ${result.layer} · nodeId: ${result.nodeId} · totalNodes: ${result.totalNodes}`,
      result.hint,
      keyMapNote,
      '',
      '---',
      JSON.stringify(result.data, null, 2),
      '',
      '--- childSummary ---',
      JSON.stringify(result.childSummary, null, 2),
    ].join('\n');

    return { content: [{ type: 'text', text: header }] };
  }

  return {
    isError: true,
    content: [{ type: 'text', text: `未知 CodX UI 工具：${name}` }],
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
  READ_UI_LAYER_TOOL_NAME,
  isCodxUiToolName,
  getCodxUiTools,
  EXECUTE_codx_ui_tool,
  FEED_codx_ui_tool_result,
};
