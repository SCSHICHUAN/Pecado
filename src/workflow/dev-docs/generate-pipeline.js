/**
 * @file generate-pipeline.js
 * 【流程】
 *   1. readResourceData — 链接/文件/手动 → 原始 data（内存，不写盘）
 *   2. generateSkillFromData — markdown / 其他 → 写 {skillName}.md + {skillName}.json
 */
const fs = require('fs');
const path = require('path');
const { fetchUrlText } = require('./fetch-url');
const { htmlToMarkdown } = require('../../markdown/html-markdown');
const { normalizeResourcesMarkdown } = require('../../markdown/normalize-markdown');
const { buildMarkdownLayerTree } = require('../../markdown/skill-layer');
const {
  buildSkillDocument,
  buildMarkdownModeSkillMarkdown,
  extractTitleFromMarkdown,
  slugifySkillName,
  isGenericSkillTitle,
  appendSkillLayerDescHint,
  stripSkillFrontmatter,
  extractMetaFromMarkdownData,
  inferTitleFromSummary,
  stripGenericTitleHeadings,
} = require('./skill-summary');
const {
  ensureMarkdownModeMeta,
  analyzeImportMetaWithLlm,
  buildImportSkillDescription,
} = require('./skill-llm-meta');
const {
  writeSkillMarkdown,
  writeLayerJson,
  removeSkillArtifacts,
  removeLegacyDocArtifacts,
} = require('./store');

function looksLikeHtml(text) {
  const trimmed = String(text || '').trim();
  return (
    /^\s*</.test(trimmed) &&
    (/<html[\s>]/i.test(trimmed) ||
      /<!DOCTYPE/i.test(trimmed) ||
      /<(div|p|table|body|head|section|article|span|h[1-6])\b/i.test(trimmed))
  );
}

async function fetchUrlRawData(url) {
  const u = String(url || '').trim();
  if (!u) return { ok: false, error: '请填写 URL' };

  let fetched;
  try {
    fetched = await fetchUrlText(u);
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }

  const ct = String(fetched.contentType || '').toLowerCase();
  let data = fetched.text || '';
  if (ct.includes('text/html') || data.trim().startsWith('<!')) {
    data = htmlToMarkdown(fetched.text, { sourceUrl: u }).markdown;
  }

  if (!String(data).trim()) return { ok: false, error: '未能从链接提取正文' };
  return { ok: true, data, sourceType: 'url', sourceUrl: u };
}

function readFileRawData(filePath) {
  const p = String(filePath || '').trim();
  if (!p || !fs.existsSync(p)) return { ok: false, error: '文件不存在' };

  const ext = path.extname(p).toLowerCase();
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (e) {
    return { ok: false, error: '无法读取文件（可能为二进制或编码不支持）' };
  }

  let data = raw;
  if (ext !== '.md' && ext !== '.markdown' && looksLikeHtml(raw)) {
    data = htmlToMarkdown(raw, { sourceUrl: `file://${p}` }).markdown;
  }

  if (!String(data).trim()) return { ok: false, error: '文件内容为空' };
  return { ok: true, data, sourceType: 'file', sourcePath: p };
}

/**
 * 第一步：读取原始 data（仅内存，不写磁盘）
 */
async function readResourceData(payload, meta = {}) {
  const sourceUrl = String(payload?.sourceUrl || '').trim();
  const sourcePath = String(payload?.sourcePath || '').trim();
  const manual = payload?.content != null ? String(payload.content) : '';

  if (sourceUrl) return fetchUrlRawData(sourceUrl);
  if (sourcePath) return readFileRawData(sourcePath);
  if (payload?.content != null) {
    return { ok: true, data: manual, sourceType: 'manual' };
  }

  return { ok: false, error: '请先选择 链接、文件 或 手动，并填写内容' };
}

function prepareOtherModeData(data, meta, userTitle) {
  const raw = String(data ?? '');
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const title = String(userTitle || meta.title || '').trim();
  const ext = meta.sourcePath ? path.extname(meta.sourcePath).toLowerCase() : '';

  if (ext === '.md' || ext === '.markdown') return raw;
  if (looksLikeHtml(raw)) {
    return htmlToMarkdown(raw, {
      sourceUrl: meta.sourceUrl || (meta.sourcePath ? `file://${meta.sourcePath}` : ''),
    }).markdown;
  }
  if (trimmed.startsWith('#')) return trimmed;

  if (meta.sourceUrl) {
    return `> 原文：[${meta.sourceUrl}](${meta.sourceUrl})\n\n${trimmed}`;
  }
  if (meta.sourcePath) {
    return `> 原文：\`${meta.sourcePath}\`\n\n${trimmed}`;
  }
  return trimmed;
}

function resolveDisplayTitle(userTitle, body, mdParsed, filledName) {
  const fromUser = String(userTitle || '').trim();
  const h1 = extractTitleFromMarkdown(body);
  if (!isGenericSkillTitle(fromUser)) return fromUser;
  if (!isGenericSkillTitle(h1)) return h1;
  if (!isGenericSkillTitle(mdParsed.name)) return String(mdParsed.name).trim();
  if (!isGenericSkillTitle(filledName)) return filledName;
  const inferred = inferTitleFromSummary(body);
  if (!isGenericSkillTitle(inferred)) return inferred;
  return fromUser || h1 || filledName || inferred || '';
}

function persistSkillOutput(meta, docId, output) {
  const { skillName, skillMarkdown, layerTree, title, skillDescription } = output;
  const prevSkillName = meta.skillName;

  if (prevSkillName && prevSkillName !== skillName) {
    removeSkillArtifacts(prevSkillName, docId);
  }
  removeLegacyDocArtifacts(docId);

  const nextMeta = {
    ...meta,
    id: docId,
    title,
    skillName,
    skillDescription,
    updatedAt: new Date().toISOString(),
  };

  writeSkillMarkdown(nextMeta, skillMarkdown);
  writeLayerJson(skillName, docId, layerTree);

  return nextMeta;
}

/** markdown 路径（5 步） */
async function runMarkdownPath(meta, docId, data, userTitle) {
  const md = String(data ?? '');
  const body = stripSkillFrontmatter(md);

  // 1. 检查 data frontmatter 是否含 name / description
  const fromData = extractMetaFromMarkdownData(md);

  // 2. 缺哪个 LLM 补哪个（LLM 失败时本地兜底）
  const filled = await ensureMarkdownModeMeta(md);
  if (!filled.ok) return filled;

  const displayName = String(filled.name || '').trim() || resolveDisplayTitle(userTitle, body, {}, '');
  if (!displayName || isGenericSkillTitle(displayName)) {
    return { ok: false, error: '无法确定 skill 名称' };
  }
  const title = displayName;

  // 3. description 不含 layerDescription 则追加
  const skillDescription = appendSkillLayerDescHint(filled.description);

  const skillName = slugifySkillName(displayName);
  const cleanedBody = stripGenericTitleHeadings(body, displayName);
  const skillMarkdown = buildMarkdownModeSkillMarkdown(cleanedBody, { skillName, skillDescription });

  // 4. 生成 markdown-layer-tree
  const layerTree = buildMarkdownLayerTree(skillMarkdown, skillName);

  if (!String(skillMarkdown).trim()) {
    return { ok: false, error: 'Skill 内容不能为空' };
  }

  // 5. 写入磁盘
  const nextMeta = persistSkillOutput(meta, docId, {
    skillName,
    skillMarkdown,
    layerTree,
    title,
    skillDescription,
  });

  return {
    ok: true,
    meta: nextMeta,
    skillName,
    title,
    name: displayName,
    usedLlm: filled.usedLlm,
    usedFallback: Boolean(filled.usedFallback),
    hadName: fromData.hasName,
    hadDesc: fromData.hasDesc,
  };
}

/** 其他 路径 */
async function runOtherPath(meta, docId, data, userTitle) {
  const prepared = prepareOtherModeData(data, meta, userTitle);
  const normalized = normalizeResourcesMarkdown(prepared);

  const analyzed = await analyzeImportMetaWithLlm(normalized);
  if (!analyzed.ok) return analyzed;

  const fromUser = String(userTitle || meta.title || '').trim();
  const title = !isGenericSkillTitle(fromUser) ? fromUser : analyzed.name;
  if (!title || isGenericSkillTitle(title)) {
    return { ok: false, error: 'LLM 未返回有效的 name' };
  }
  const skillDescription = buildImportSkillDescription(analyzed.description);

  const cleaned = stripGenericTitleHeadings(normalized, title);
  const built = buildSkillDocument(title, cleaned, {
    sourceUrl: meta.sourceUrl,
    sourcePath: meta.sourcePath,
    skillDescription,
  });

  const layerTree = buildMarkdownLayerTree(built.skillMarkdown, built.name);

  if (!String(built.skillMarkdown).trim()) {
    return { ok: false, error: 'Skill 内容不能为空' };
  }

  const nextMeta = persistSkillOutput(meta, docId, {
    skillName: built.name,
    skillMarkdown: built.skillMarkdown,
    layerTree,
    title,
    skillDescription: built.description,
  });

  return { ok: true, meta: nextMeta, skillName: built.name, title };
}

/**
 * 第二步：由 data 生成 skill（写盘）
 * @param {'markdown'|'other'} mode
 */
async function generateSkillFromData(meta, docId, data, mode, userTitle) {
  if (mode === 'markdown') {
    return runMarkdownPath(meta, docId, data, userTitle);
  }
  if (mode === 'other') {
    return runOtherPath(meta, docId, data, userTitle);
  }
  return { ok: false, error: '缺少生成模式' };
}

module.exports = {
  readResourceData,
  generateSkillFromData,
};
