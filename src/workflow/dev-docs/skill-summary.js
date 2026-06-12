/**
 * @file skill-summary.js
 * 【功能】按 Cursor Skill 三层结构生成 SKILL.md
 *   - Metadata：frontmatter（name + description）
 *   - Instructions：默认注入 LLM（Skill 模式）
 *   - Resources：完整原文
 *   - Layer：独立 {skillName}.json（不在 SKILL.md 内）
 */
const {
  stripMarkdownToPlain,
  getSectionContent,
} = require('../../markdown/read-markdown');
const { normalizeResourcesMarkdown } = require('../../markdown/normalize-markdown');
const {
  LAYER_READ_HINT,
  extractH2SectionBody,
  buildLayerTreeObject,
  stripLayerSection,
} = require('../../markdown/skill-layer');
const LAYER_HEADING_RE = /^## Layer\s*$/m;
const MAX_NAME_LEN = 64;
const MAX_DESC_LEN = 1024;
const MAX_SUMMARY_BODY = 2500;
const AI_CONTEXT_MODES = ['skill', 'full'];
const RESOURCES_SECTION_HEADING = '## Resources';
const RESOURCES_HEADING_RE = /^## (Resources|原文)\s*$/m;
const LEGACY_SOURCE_HEADING_RE = /^## 来源\s*$/m;

function slugifySkillName(title) {
  const raw = String(title || '').trim();
  let s = raw
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const generic = new Set(['skill', 'dev-doc', 'doc', 'untitled', '未命名', '未命名-skill']);
  if (!s || generic.has(s) || isGenericSkillTitle(raw)) {
    const ascii = (raw.match(/[a-z0-9]{2,}/gi) || [])
      .map((w) => w.toLowerCase())
      .filter((w) => !generic.has(w))
      .join('-');
    if (ascii) s = ascii;
  }
  if (!s || generic.has(s)) {
    s = raw
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\u4e00-\u9fff-]+/g, '')
      .replace(/^-+|-+$/g, '');
  }
  if (!s || generic.has(s)) s = 'dev-doc';
  return s.slice(0, MAX_NAME_LEN);
}

function stripMarkdown(md) {
  return stripMarkdownToPlain(md);
}

function splitSentences(text) {
  const parts = String(text || '')
    .split(/(?<=[。！？.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [text].filter(Boolean);
}

function extractTriggerTerms(title, markdown) {
  /** @type {Set<string>} */
  const terms = new Set();
  String(title || '')
    .split(/[\s\-_/、，,|+]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2)
    .slice(0, 5)
    .forEach((w) => terms.add(w));

  const plain = stripMarkdown(markdown);
  const apiLike =
    plain.match(/\b(gl[A-Z][a-zA-Z]+|xcode_[a-z_]+|[A-Z]{2,}[a-zA-Z]*)\b/g) || [];
  apiLike.slice(0, 6).forEach((t) => terms.add(t));

  return [...terms].slice(0, 6);
}

/** 去掉 description 中的 Source / Source file 后缀（旧版遗留） */
function cleanSkillDescription(desc) {
  return String(desc || '')
    .replace(/\s+Source:\s+\S+/gi, '')
    .replace(/\s+Source file:\s*[^.]+\./gi, '')
    .trim();
}

/**
 * Skill Metadata：description（WHAT + WHEN，第三人称）
 */
function buildSkillDescription(title, markdown, opts = {}) {
  const topic = String(title || '该主题').trim();
  const plain = stripMarkdown(markdown);
  const first = splitSentences(plain)[0]?.slice(0, 160) || topic;
  const triggers = extractTriggerTerms(title, markdown);
  const whenPart =
    triggers.length > 0
      ? `Use when the user mentions ${triggers.join(', ')}, or when implementing code from this document.`
      : 'Use when implementing code or answering questions that require this document.';
  let desc = `Covers ${topic}: ${first}. ${whenPart}`;
  const hint = ' skill分层读取,读Layer分层树,按照你的需要读对应的信息';
  if (!desc.includes('分层读取') && desc.length + hint.length <= MAX_DESC_LEN) {
    desc += hint;
  } else if (!desc.includes('Layer') && desc.length + 20 <= MAX_DESC_LEN) {
    desc += ` ${LAYER_READ_HINT}`.slice(0, MAX_DESC_LEN - desc.length);
  }
  return cleanSkillDescription(desc).slice(0, MAX_DESC_LEN);
}

const SKILL_LAYER_DESC_HINT =
  'skill内容分层,markdown-layer-tree,按照你的需要获取对应的信息';

/** @deprecated 兼容旧常量名 */
const IMPORT_SKILL_DESC_SUFFIX = SKILL_LAYER_DESC_HINT;

function hasSkillLayerDescHint(desc) {
  const t = String(desc || '');
  if (t.includes('markdown-layer-tree') && /skill内容分层/.test(t)) return true;
  return t.includes('Layer分层树') && /skill的内容分层/.test(t);
}

function appendSkillLayerDescHint(desc) {
  let summary = cleanSkillDescription(String(desc || '').trim());
  if (!summary) return SKILL_LAYER_DESC_HINT.slice(0, MAX_DESC_LEN);
  if (hasSkillLayerDescHint(summary)) {
    return summary.slice(0, MAX_DESC_LEN);
  }
  const sep = /[。！？.!?]$/.test(summary) ? '' : '。';
  return cleanSkillDescription(`${summary}${sep}${SKILL_LAYER_DESC_HINT}`).slice(0, MAX_DESC_LEN);
}

/** 其他模式：LLM 摘要 + Layer 分层说明 */
function buildImportSkillDescription(llmDescription) {
  return appendSkillLayerDescHint(llmDescription);
}

function finalizeImportSkillDescriptionFromLlm(llmDescription) {
  return appendSkillLayerDescHint(llmDescription);
}

function extractInstructionBullets(markdown) {
  const lines = String(markdown || '').split('\n');
  /** @type {string[]} */
  const bullets = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^[-*]\s+/.test(t)) bullets.push(t.replace(/^[-*]\s+/, '').slice(0, 200));
    if (/^\d+[、.)]\s*/.test(t)) bullets.push(t.replace(/^\d+[、.)]\s*/, '').slice(0, 200));
    if (bullets.length >= 8) break;
  }
  if (bullets.length >= 2) return bullets.slice(0, 8);

  const plain = stripMarkdown(markdown);
  return splitSentences(plain)
    .slice(0, 5)
    .map((s) => s.slice(0, 180))
    .filter(Boolean);
}

function findResourcesSection(markdown) {
  const s = String(markdown || '');
  const match = RESOURCES_HEADING_RE.exec(s);
  if (!match) return null;
  return { index: match.index, length: match[0].length };
}

/**
 * 生成 SKILL.md：Metadata + Instructions + Resources（原文）
 */
function buildSkillDocument(title, markdown, opts = {}) {
  const displayTitle = isGenericSkillTitle(title) ? '' : String(title || '').trim();
  const effectiveTitle =
    displayTitle ||
    String(opts.fallbackTitle || opts.displayName || '').trim() ||
    String(opts.skillName || '').trim();
  const name = (opts.skillName || slugifySkillName(effectiveTitle || title)).slice(0, MAX_NAME_LEN);
  const headingTitle = effectiveTitle || name;
  const sourceMd = stripGenericTitleHeadings(normalizeResourcesMarkdown(markdown), headingTitle);
  const description = cleanSkillDescription(
    opts.skillDescription || buildSkillDescription(headingTitle, sourceMd, opts)
  ).slice(0, MAX_DESC_LEN);
  const bullets = extractInstructionBullets(sourceMd);

  const instructionsPart = [
    `# ${headingTitle}`,
    '',
    '## Instructions',
    ...bullets.map((b) => `- ${b}`),
  ]
    .join('\n')
    .trim();

  let instructionsBody = instructionsPart;
  if (instructionsBody.length > MAX_SUMMARY_BODY) {
    instructionsBody = `${instructionsBody.slice(0, MAX_SUMMARY_BODY)}\n…(Instructions 已截断)`;
  }

  const body = appendResourcesSection(instructionsBody, sourceMd);

  const escDesc = description.replace(/\n/g, ' ').replace(/"/g, '\\"');
  const skillMarkdown = `---\nname: ${name}\ndescription: "${escDesc}"\n---\n\n${body}\n`;
  const layerTree = buildLayerTreeObject(skillMarkdown, name);

  return {
    name,
    description,
    skillMarkdown,
    instructionsMarkdown: instructionsBody,
    layerTree,
  };
}

function appendResourcesSection(instructionsPart, markdown) {
  const resources = normalizeResourcesMarkdown(markdown);
  if (!resources) return String(instructionsPart || '').trim();
  return `${String(instructionsPart || '').trim()}\n\n${RESOURCES_SECTION_HEADING}\n\n${resources}\n`;
}

function extractResourcesFromSkill(skillMd) {
  const fromH2 =
    extractH2SectionBody(skillMd, 'Resources', ['Layer']) ||
    extractH2SectionBody(skillMd, '原文', ['Layer']);
  if (fromH2.trim()) return fromH2.trim();
  const fromTree =
    getSectionContent(skillMd, 'Resources') || getSectionContent(skillMd, '原文');
  if (fromTree.trim()) return fromTree.trim();
  const found = findResourcesSection(skillMd);
  if (!found) return '';
  let rest = String(skillMd || '').slice(found.index + found.length);
  const layerIdx = rest.search(LAYER_HEADING_RE);
  if (layerIdx >= 0) rest = rest.slice(0, layerIdx);
  return rest.trim();
}

function stripResourcesSection(markdown) {
  const found = findResourcesSection(markdown);
  if (!found) return String(markdown || '').trim();
  return String(markdown || '')
    .slice(0, found.index)
    .trim();
}

/** 去掉旧版 Pecado 自定义的 ## 来源 段 */
function stripLegacySourceSection(markdown) {
  const s = String(markdown || '');
  const match = LEGACY_SOURCE_HEADING_RE.exec(s);
  if (!match) return s.trim();
  const after = s.slice(match.index + match[0].length);
  const nextHeading = after.search(/^## /m);
  const before = s.slice(0, match.index);
  if (nextHeading >= 0) return `${before}${after.slice(nextHeading)}`.trim();
  return before.trim();
}

/** Skill 模式：Metadata + Instructions（规范 SKILL.md，不含 Resources / Layer） */
function buildSkillInstructionsContext(skillMd) {
  let body = stripLayerSection(String(skillMd || '').trim());
  body = stripResourcesSection(body);
  body = stripLegacySourceSection(body);
  return body.trim();
}

/** 旧文档 ## 原文 → ## Resources */
function migrateLegacySkillHeadings(skillMd) {
  return String(skillMd || '').replace(/^## 原文\s*$/m, RESOURCES_SECTION_HEADING);
}

function parseAiContextMode(value, fallback = 'skill') {
  const v = String(value || '').trim();
  if (AI_CONTEXT_MODES.includes(v)) return v;
  if (v === 'full') return 'full';
  if (v === 'description' || v === 'summary' || v === 'skill') return 'skill';
  return fallback;
}

function normalizeDocMeta(meta = {}) {
  const next = { ...meta };
  if (next.aiEnabled == null) {
    next.aiEnabled = next.includeInAi !== false;
  }
  next.aiContextMode = parseAiContextMode(next.aiContextMode, 'skill');
  if (!next.skillName) next.skillName = slugifySkillName(next.title);
  if (next.skillDescription) {
    next.skillDescription = cleanSkillDescription(next.skillDescription).slice(0, MAX_DESC_LEN);
  }
  delete next.includeInAi;
  return next;
}

function stripSkillFrontmatter(skillMd) {
  return String(skillMd || '')
    .replace(/^---[\s\S]*?---\n?/m, '')
    .trim();
}

function parseSkillFrontmatter(skillMd) {
  const m = String(skillMd || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const block = m[1];
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
  const descMatch = block.match(/^description:\s*("([^"]*)"|'([^']*)'|(.+))$/m);
  const description = (descMatch?.[2] || descMatch?.[3] || descMatch?.[4] || '').trim();
  return { name, description };
}

function extractTitleFromMarkdown(markdown) {
  let s = String(markdown || '').replace(/^---[\s\S]*?---\n?/m, '').trim();
  const h1 = s.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  const hx = s.match(/^#{1,6}\s+(.+)$/m);
  return hx ? hx[1].trim() : '';
}

function isGenericSkillTitle(title) {
  const t = String(title || '').trim();
  return !t || t === '未命名 skill' || t === '未命名文档';
}

/** 去掉正文中的占位标题（未命名 skill），必要时替换为最终 name */
function stripGenericTitleHeadings(markdown, preferredTitle) {
  let s = String(markdown || '');
  const preferred = String(preferredTitle || '').trim();
  const replacement = preferred && !isGenericSkillTitle(preferred) ? preferred : '';

  s = s.replace(/^#{1,6}\s+(未命名 skill|未命名文档)\s*$/gm, () =>
    replacement ? `# ${replacement}` : ''
  );

  if (replacement) {
    const esc = replacement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`^(# ${esc}\\s*\\n+){2,}`, 'm'), `# ${replacement}\n\n`);
  }

  return s
    .split('\n')
    .filter((line) => line.trim() !== '' || line === '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 从 data 提取 name / description（仅 frontmatter；正文标题不算 metadata）
 * @returns {{ name: string, description: string, hasName: boolean, hasDesc: boolean }}
 */
function extractMetaFromMarkdownData(markdown) {
  const parsed = parseSkillFrontmatter(String(markdown || ''));
  const name = String(parsed.name || '').trim();
  const description = String(parsed.description || '').trim();
  const hasName = Boolean(name && !isGenericSkillTitle(name));
  const hasDesc = hasUsableSkillDescription(description);

  return { name, description, hasName, hasDesc };
}

/** 去掉导入包装（frontmatter、原文引用行等） */
function stripImportBoilerplate(markdown) {
  let s = String(markdown || '').replace(/^---[\s\S]*?---\n?/m, '').trim();
  return s
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/^>\s*原文/i.test(t)) return false;
      if (/^>\s*https?:\/\//i.test(t)) return false;
      if (/^>\s*file:\/\//i.test(t)) return false;
      return true;
    })
    .join('\n');
}

/** 用于摘要 / 标题推断的正文（跳过标题行） */
function contentForSummaryInference(markdown) {
  let s = stripImportBoilerplate(markdown);
  s = s.replace(/^#{1,6}\s+.+$/gm, '').trim();
  return s;
}

const MAX_IMPORT_TITLE_LEN = 48;

function shortenSummaryTitle(text) {
  let t = String(text || '').trim();
  if (!t) return '';

  const stopMatch = t.match(
    /^(.{2,40}?)(?:介绍|说明|讲解|涵盖|描述|讲解了|介绍了|是一|用于|帮助|本文|该文|将会|将会介绍)/
  );
  if (stopMatch && stopMatch[1].trim().length >= 4) {
    t = stopMatch[1].trim();
  }

  if (t.length > MAX_IMPORT_TITLE_LEN) {
    const seg = t.split(/[，,；;：:]/)[0].trim();
    t = seg.length >= 4 && seg.length <= MAX_IMPORT_TITLE_LEN ? seg : t.slice(0, MAX_IMPORT_TITLE_LEN);
  }

  return t
    .replace(/[了着的]$/, '')
    .trim()
    .slice(0, MAX_IMPORT_TITLE_LEN)
    .replace(/[。！？.!?，,；;：:\s]+$/g, '')
    .trim();
}

/** 从正文摘要主动推断展示名称 */
function inferTitleFromSummary(markdown) {
  const body = contentForSummaryInference(markdown);
  if (!body) return '';

  const plain = stripMarkdown(body);
  const sentences = splitSentences(plain).filter((s) => {
    const t = String(s || '').trim();
    if (t.length < 4) return false;
    if (/^原文[：:]/.test(t)) return false;
    if (/^https?:\/\//i.test(t)) return false;
    if (/^`.+`$/.test(t)) return false;
    return true;
  });

  if (!sentences.length) {
    const line = plain
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length >= 4 && !/^https?:\/\//i.test(l));
    return line ? shortenSummaryTitle(line) : '';
  }

  let title = shortenSummaryTitle(sentences[0]);
  if (title.length < 4 && sentences[1]) {
    title = shortenSummaryTitle(sentences[1]);
  }
  return title;
}

/** 从正文 / 解析结果识别展示标题（其他模式导入） */
function resolveImportTitle(metaTitle, parsedTitle, markdown) {
  const fromUser = String(metaTitle || '').trim();
  if (!isGenericSkillTitle(fromUser)) return fromUser;

  const fromSummary = inferTitleFromSummary(markdown);
  if (fromSummary && !isGenericSkillTitle(fromSummary)) return fromSummary;

  const h1 = extractTitleFromMarkdown(markdown);
  if (h1 && !isGenericSkillTitle(h1)) return h1;

  const fromParsed = String(parsedTitle || '').trim();
  if (fromParsed && !isGenericSkillTitle(fromParsed)) return fromParsed;

  return fromSummary || h1 || fromParsed || fromUser || '未命名 skill';
}

function patchSkillFrontmatterName(skillMd, title) {
  const name = slugifySkillName(title);
  const s = String(skillMd || '');
  const m = s.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return s;
  let block = m[1];
  if (/^name:/m.test(block)) {
    block = block.replace(/^name:\s*.+$/m, `name: ${name}`);
  } else {
    block = `name: ${name}\n${block}`;
  }
  return s.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${block}\n---`);
}

function patchSkillFrontmatterDescription(skillMd, description) {
  const desc = String(description || '')
    .replace(/\n/g, ' ')
    .replace(/"/g, '\\"')
    .trim();
  const s = String(skillMd || '');
  const m = s.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return s;
  let block = m[1];
  if (/^description:/m.test(block)) {
    block = block.replace(/^description:\s*.+$/m, `description: "${desc}"`);
  } else {
    block = `${block}\ndescription: "${desc}"`;
  }
  return s.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${block}\n---`);
}

/** 更新 skill frontmatter；无 frontmatter 时在正文前插入，不改正文 */
function applySkillFrontmatterMeta(skillMd, title, description) {
  const s = String(skillMd || '');
  if (/^---\r?\n[\s\S]*?\r?\n---/.test(s)) {
    return patchSkillFrontmatterDescription(patchSkillFrontmatterName(s, title), description);
  }
  return buildMarkdownModeSkillMarkdown(s, {
    skillName: slugifySkillName(title),
    skillDescription: description,
  });
}

/** markdown 模式：正文原样 + 独立 frontmatter（去掉资源里原有 YAML，避免双 frontmatter） */
function buildMarkdownModeSkillMarkdown(body, { skillName, skillDescription } = {}) {
  const name = String(skillName || 'skill')
    .trim()
    .slice(0, MAX_NAME_LEN);
  const desc = String(skillDescription || '')
    .replace(/\n/g, ' ')
    .replace(/"/g, '\\"')
    .trim();
  const trimmedBody = String(body ?? '').trim();
  if (!trimmedBody) {
    return `---\nname: ${name}\ndescription: "${desc}"\n---\n`;
  }
  return `---\nname: ${name}\ndescription: "${desc}"\n---\n\n${trimmedBody}\n`;
}

function hasUsableSkillDescription(desc) {
  const t = cleanSkillDescription(String(desc || '')).trim();
  if (!t) return false;
  if (t === SKILL_LAYER_DESC_HINT) return false;
  const core = t
    .replace(SKILL_LAYER_DESC_HINT, '')
    .replace(/skill内容分层[^。]*markdown-layer-tree[^。]*/g, '')
    .replace(/skill的内容分层[^。]*Layer分层树[^。]*/g, '')
    .trim();
  return core.length >= 8;
}

module.exports = {
  AI_CONTEXT_MODES,
  slugifySkillName,
  buildSkillDescription,
  buildImportSkillDescription,
  finalizeImportSkillDescriptionFromLlm,
  appendSkillLayerDescHint,
  hasSkillLayerDescHint,
  hasUsableSkillDescription,
  cleanSkillDescription,
  buildSkillDocument,
  parseAiContextMode,
  normalizeDocMeta,
  stripSkillFrontmatter,
  stripResourcesSection,
  extractResourcesFromSkill,
  appendResourcesSection,
  buildSkillInstructionsContext,
  stripLegacySourceSection,
  migrateLegacySkillHeadings,
  stripLayerSection,
  parseSkillFrontmatter,
  patchSkillFrontmatterName,
  patchSkillFrontmatterDescription,
  applySkillFrontmatterMeta,
  buildMarkdownModeSkillMarkdown,
  extractMetaFromMarkdownData,
  extractTitleFromMarkdown,
  resolveImportTitle,
  inferTitleFromSummary,
  isGenericSkillTitle,
  stripGenericTitleHeadings,
  contentForSummaryInference,
  IMPORT_SKILL_DESC_SUFFIX,
  SKILL_LAYER_DESC_HINT,
  RESOURCES_SECTION_HEADING,
  MAX_DESC_LEN,
};
