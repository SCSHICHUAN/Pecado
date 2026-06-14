/**
 * @file context.js
 * 【功能】Skill 注入 Agent system
 *   - 默认：Instructions（若有）+ Layer 树常驻；正文与资源脚本 path 不进 system
 *   - 跑脚本：run_skill_resource_script（path 按 Skill 正文；exec 层用磁盘资源树解析）
 */
const { listDevDocMeta, readSkillMarkdown, readLayerJson, writeLayerJson } = require('../store');
const { normalizeDocMeta, buildSkillInstructionsContext } = require('../document');
const {
  isStructuredSkillMarkdown,
  buildMarkdownLayerTree,
  stripLayerSection,
} = require('../../../markdown/skill-layer');

const MAX_TOTAL = 48000;
const MAX_PER_DOC_SKILL = 6000;
const MAX_PER_DOC_LAYER = 8000;
const MAX_PER_DOC_FULL = 120000;

function readFullSkillMarkdown(meta) {
  return String(readSkillMarkdown(meta) || '').trim();
}

function readLayerTreeForMeta(meta) {
  const skillName = meta.skillName || meta.id;
  let tree = readLayerJson(skillName, meta.id);
  if (!tree) {
    const skillMd = readFullSkillMarkdown(meta);
    if (!skillMd) return null;
    tree = buildMarkdownLayerTree(stripLayerSection(skillMd), skillName);
    if (tree) writeLayerJson(skillName, meta.id, tree);
  }
  return tree;
}

function isResourcesPinned(meta) {
  return meta.aiContextMode === 'full';
}

function appendInstructionsBlock(lines, meta, budget) {
  const skillMd = readFullSkillMarkdown(meta);
  if (!skillMd || !isStructuredSkillMarkdown(skillMd)) return budget;

  let instr = String(buildSkillInstructionsContext(skillMd) || '').trim();
  if (!instr) return budget;

  const cap = Math.min(MAX_PER_DOC_SKILL, budget - 200);
  if (cap <= 0) return budget;
  if (instr.length > cap) instr = `${instr.slice(0, cap)}\n…(已截断)`;

  lines.push(
    '',
    `#### ${meta.title}（Instructions · ${meta.skillName || '—'}）`,
    '```markdown',
    instr,
    '```'
  );
  return budget - instr.length - meta.title.length - 80;
}

function appendLayerTreeBlock(lines, meta, budget) {
  const tree = readLayerTreeForMeta(meta);
  if (!tree?.nodes?.length) return budget;

  let json = JSON.stringify(tree, null, 2);
  const cap = Math.min(MAX_PER_DOC_LAYER, budget - 200);
  if (cap <= 0) return budget;
  if (json.length > cap) json = `${json.slice(0, cap)}\n…(已截断)`;

  lines.push(
    '',
    `#### ${meta.title}（Layer 树 · ${meta.skillName || '—'}）`,
    '树为正文目录（path → 标题）；正文不在 system，请用 read_skill_section(skill_name, path) 按 path 读取。',
    '```json',
    json,
    '```'
  );
  return budget - json.length - meta.title.length - 120;
}

function buildDevDocsContextForAi() {
  const metas = listDevDocMeta()
    .map(normalizeDocMeta)
    .filter((d) => d.aiEnabled === true);
  if (!metas.length) return '';

  const lines = [
    '【Workflow 开发文档 / Skill】以下为已启用文档。按任务匹配 Skill；跑脚本用 run_skill_resource_script（path 按 Skill 正文 Quick Start）。',
    'system 已含 Instructions 与 Layer 树；资源脚本不在 system。Skill 多步流程须逐步 run_skill_resource_script，勿执行一步就结束。',
    '',
    '### 已启用文档',
    ...metas.map(
      (m) =>
        `- **${m.skillName || m.id}** (${m.title})${isResourcesPinned(m) ? ' · 全文已勾选' : ' · Layer 树 + 正文按需读'}`
    ),
  ];
  let budget = MAX_TOTAL;

  for (const meta of metas) {
    if (budget <= 400) break;

    if (isResourcesPinned(meta)) {
      let full = readFullSkillMarkdown(meta);
      if (full) {
        const cap = Math.min(MAX_PER_DOC_FULL, budget - 200);
        if (full.length > cap) full = `${full.slice(0, cap)}\n…(已截断)`;
        lines.push(
          '',
          `#### ${meta.title}（全文 · ${meta.skillName || '—'}）`,
          '```markdown',
          full,
          '```'
        );
        budget -= full.length + meta.title.length + 80;
      }
      continue;
    }

    budget = appendInstructionsBlock(lines, meta, budget);
    budget = appendLayerTreeBlock(lines, meta, budget);
  }

  return lines.join('\n');
}

module.exports = { buildDevDocsContextForAi, isResourcesPinned, readLayerTreeForMeta };
