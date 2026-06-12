/**
 * @file agent-tools.js
 * 【功能】Agent 按需读取 Skill Layer / Resources / 分层节点
 */
const {
  listDevDocMeta,
  readSkillMarkdown,
  readLayerJson,
  writeLayerJson,
  layerJsonBasename,
} = require('./store');
const {
  normalizeDocMeta,
  extractResourcesFromSkill,
} = require('./skill-summary');
const {
  buildMarkdownLayerTree,
  stripLayerSection,
  readSkillSectionByPath,
} = require('../../markdown/skill-layer');

const DEV_DOC_TOOL_NAMES = new Set([
  'read_dev_doc_resources',
  'read_skill_layer',
  'read_skill_section',
]);
const MAX_TOOL_BODY = 12000;

function getDevDocTools() {
  return [
    {
      name: 'read_skill_layer',
      description:
        '读取 Skill Layer 分层树 JSON（{skillName}.json）。先读树再按 path 调用 read_skill_section。',
      inputSchema: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: 'Skill name 或文档标题' },
        },
        required: ['skill_name'],
      },
    },
    {
      name: 'read_skill_section',
      description:
        '按 Layer 树 path 读取 Skill 分层内容。path 示例：metadata | instructions | resources | resources/子标题-slug。',
      inputSchema: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: 'Skill name 或文档标题' },
          path: {
            type: 'string',
            description: 'Layer 节点 path',
          },
        },
        required: ['skill_name', 'path'],
      },
    },
    {
      name: 'read_dev_doc_resources',
      description: '读取 Skill 的 Resources 全文。需要整篇原文时用；若只需一节请优先 read_skill_section。',
      inputSchema: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: 'Skill name 或文档标题' },
        },
        required: ['skill_name'],
      },
    },
  ];
}

function isDevDocToolName(name) {
  return DEV_DOC_TOOL_NAMES.has(String(name || '').trim());
}

function findEnabledDocBySkillName(skillName) {
  const key = String(skillName || '').trim().toLowerCase();
  if (!key) return null;
  const metas = listDevDocMeta().map(normalizeDocMeta).filter((d) => d.aiEnabled === true);
  return (
    metas.find((d) => String(d.skillName || '').toLowerCase() === key) ||
    metas.find((d) => String(d.title || '').toLowerCase() === key) ||
    metas.find((d) => String(d.id || '').toLowerCase() === key) ||
    null
  );
}

function readLayerTreeForMeta(meta) {
  const skillName = meta.skillName || meta.id;
  let tree = readLayerJson(skillName, meta.id);
  if (!tree) {
    const skillMd = readSkillMarkdown(meta);
    tree = buildMarkdownLayerTree(stripLayerSection(skillMd), skillName);
    writeLayerJson(skillName, meta.id, tree);
  }
  return tree;
}

function readResourcesForMeta(meta) {
  const skillMd = readSkillMarkdown(meta);
  let body = extractResourcesFromSkill(skillMd);
  if (!body.trim()) {
    const { stripSkillFrontmatter } = require('./skill-summary');
    body = stripSkillFrontmatter(skillMd);
  }
  return String(body || '').trim();
}

function capBody(body) {
  let text = String(body || '').trim();
  if (text.length > MAX_TOOL_BODY) text = `${text.slice(0, MAX_TOOL_BODY)}\n…(已截断)`;
  return text;
}

async function EXECUTE_execute_tool(routedTask) {
  if (routedTask.module !== 'dev-docs') {
    return {
      isError: true,
      content: [{ type: 'text', text: `EXEC：未支持的模块 ${routedTask.module}` }],
    };
  }

  const { name, args = {} } = routedTask.task;
  const meta = findEnabledDocBySkillName(args.skill_name);
  if (!meta) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `未找到已启用 skill 的开发文档「${args.skill_name || ''}」。请确认 Workflow 中已勾选 skill。`,
        },
      ],
    };
  }

  const skillMd = readSkillMarkdown(meta);
  const label = meta.title;
  const jsonFile = layerJsonBasename(meta.skillName || meta.id, meta.id);

  if (name === 'read_skill_layer') {
    const tree = readLayerTreeForMeta(meta);
    if (!tree?.nodes?.length) {
      return {
        isError: true,
        content: [{ type: 'text', text: `文档「${label}」无 Layer 分层树。` }],
      };
    }
    const body = `Layer JSON 文件：${jsonFile}\n\n${JSON.stringify(tree, null, 2)}`;
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: `【${label} · Layer · ${meta.skillName || meta.id}】\n\n${capBody(body)}`,
        },
      ],
    };
  }

  if (name === 'read_skill_section') {
    const res = readSkillSectionByPath(skillMd, args.path);
    if (!res.ok) {
      return {
        isError: true,
        content: [{ type: 'text', text: res.error || `无法读取 path「${args.path}」` }],
      };
    }
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: `【${label} · ${args.path} · ${meta.skillName || meta.id}】\n\n${capBody(res.body)}`,
        },
      ],
    };
  }

  if (name === 'read_dev_doc_resources') {
    let body = readResourcesForMeta(meta);
    if (!body) {
      return {
        isError: true,
        content: [{ type: 'text', text: `文档「${label}」无 Resources 内容。` }],
      };
    }
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: `【${label} · Resources · ${meta.skillName || meta.id}】\n\n${capBody(body)}`,
        },
      ],
    };
  }

  return {
    isError: true,
    content: [{ type: 'text', text: `EXEC：未知 dev-doc tool「${name}」` }],
  };
}

function formatObservationText(result) {
  if (!result || typeof result !== 'object') return String(result ?? '');
  const parts = Array.isArray(result.content) ? result.content : [];
  return parts
    .filter((p) => p && p.type === 'text' && p.text != null)
    .map((p) => String(p.text))
    .join('\n');
}

function FEED_tool_result(execRaw) {
  const observation = formatObservationText(execRaw);
  return { observation: observation || '(empty dev-doc tool result)' };
}

module.exports = {
  getDevDocTools,
  isDevDocToolName,
  DEV_DOC_TOOL_NAMES,
  EXECUTE_execute_tool,
  FEED_tool_result,
  findEnabledDocBySkillName,
};
