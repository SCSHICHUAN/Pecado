/**
 * @file service.js
 * 【功能】Skill CRUD、保存生成、资源文件夹同步（IPC 业务层）
 */
const fs = require('fs');
const path = require('path');
const {
  normalizeDocMeta,
  parseAiContextMode,
  parseSkillFrontmatter,
  migrateLegacySkillHeadings,
  cleanSkillDescription,
  stripSkillFrontmatter,
  extractResourcesFromSkill,
  slugifySkillName,
} = require('./document');
const {
  stripLayerSection,
  LAYER_HEADING_RE,
  isStructuredSkillMarkdown,
  buildMarkdownLayerTree,
} = require('../../markdown/skill-layer');
const { readResourceData, generateSkillFromData } = require('./generate');
const {
  listDevDocMeta,
  saveDevDocMetaList,
  readSkillMarkdown,
  deleteDocFile,
  newDocId,
  getDevDocsDir,
  readLayerJson,
  writeLayerJson,
  layerJsonBasename,
  getLayerJsonPath,
  writeSkillMarkdown,
} = require('./store');
const {
  readResourceTreeJson,
  syncSkillResources,
  getSkillResourcesDir,
  getResourceTreeJsonPath,
} = require('./resources');

const MAX_PREVIEW = 12000;

function applySkillResourceFolder(meta, docId, resourceFolderPath) {
  const folder = String(resourceFolderPath ?? meta.resourceFolderSource ?? '').trim();
  if (!folder) return { ok: true, meta };
  const skillName = meta.skillName || slugifySkillName(meta.title) || meta.id;
  const sync = syncSkillResources(skillName, docId, folder);
  if (!sync.ok) return sync;
  return {
    ok: true,
    meta: {
      ...meta,
      resourceFolderSource: folder,
      hasResourceFiles: Boolean(sync.tree?.nodes?.length),
    },
    resourceSync: sync,
  };
}

function layerTreeNeedsRefresh(layerTree, skillMarkdown) {
  if (!String(skillMarkdown || '').trim()) return false;
  if (!layerTree) return true;
  const hasStaleUntitledResource = (nodes) => {
    for (const n of nodes || []) {
      const path = String(n.path || '');
      const label = String(n.label || '');
      if (
        path.startsWith('resources/') &&
        (label === '(untitled)' || path.endsWith('/untitled') || path.endsWith('/section'))
      ) {
        return true;
      }
      if (hasStaleUntitledResource(n.children)) return true;
    }
    return false;
  };
  if (hasStaleUntitledResource(layerTree.nodes)) return true;
  const hasFrontmatter = /^---\r?\n[\s\S]*?\r?\n---/.test(String(skillMarkdown || ''));
  if (!hasFrontmatter) return false;
  const metaNode = (layerTree.nodes || []).find((n) => n.path === 'metadata');
  if (!metaNode || !metaNode.available) return true;
  const parsed = parseSkillFrontmatter(skillMarkdown);
  const hasFields = Boolean(parsed.name || parsed.description);
  if (hasFields && !(metaNode.children || []).length) return true;
  return false;
}

function enrichDocWithLayer(meta, skillMarkdown) {
  const parsed = parseSkillFrontmatter(skillMarkdown);
  const skillName = parsed.name || meta.skillName || meta.id;
  const clean = stripLayerSection(String(skillMarkdown || ''));
  let layerTree = readLayerJson(skillName, meta.id);
  if (!layerTree && meta.skillName && meta.skillName !== skillName) {
    layerTree = readLayerJson(meta.skillName, meta.id);
  }
  if (layerTreeNeedsRefresh(layerTree, clean)) {
    layerTree = buildMarkdownLayerTree(clean, skillName);
    writeLayerJson(skillName, meta.id, layerTree);
  } else if (layerTree && !layerTree.skillName) {
    layerTree = { ...layerTree, skillName };
  }

  const skillDisplayMarkdown = isStructuredSkillMarkdown(clean)
    ? clean
    : stripSkillFrontmatter(clean) || clean;

  return {
    layerTree,
    layerJsonFile: layerJsonBasename(skillName, meta.id),
    layerJsonPath: getLayerJsonPath(skillName, meta.id),
    skillDisplayMarkdown,
    resourceTree: readResourceTreeJson(skillName, meta.id),
    resourcesDir: fs.existsSync(getSkillResourcesDir(skillName, meta.id))
      ? getSkillResourcesDir(skillName, meta.id)
      : null,
    resourceTreeFile: path.basename(getResourceTreeJsonPath(skillName, meta.id)),
  };
}

function docContentFromSkill(meta, skillMarkdown) {
  const clean = stripLayerSection(String(skillMarkdown || ''));
  if (isStructuredSkillMarkdown(clean)) {
    return extractResourcesFromSkill(clean) || stripSkillFrontmatter(clean);
  }
  return stripSkillFrontmatter(clean) || clean;
}

function openDevDocsDir() {
  return { ok: true, dir: getDevDocsDir() };
}

function metaWithPreview(meta) {
  const normalized = normalizeDocMeta(meta);
  const skillMarkdown = readSkillMarkdown(normalized);
  const preview = docContentFromSkill(normalized, skillMarkdown).slice(0, 400);
  return {
    ...normalized,
    preview,
    skillPreview: skillMarkdown.slice(0, 280),
    contentLength: preview.length,
  };
}

function upsertMeta(entry) {
  const list = listDevDocMeta().map(normalizeDocMeta);
  const normalized = normalizeDocMeta(entry);
  const idx = list.findIndex((d) => d.id === normalized.id);
  if (idx >= 0) list[idx] = normalized;
  else list.unshift(normalized);
  saveDevDocMetaList(list);
  return normalized;
}

function listDevDocs() {
  const items = listDevDocMeta()
    .map(normalizeDocMeta)
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return { ok: true, docs: items.map(metaWithPreview), devDocsDir: getDevDocsDir() };
}

function getDevDoc(id) {
  const docId = String(id || '').trim();
  if (!docId) return { ok: false, error: '缺少文档 id' };
  const raw = listDevDocMeta().find((d) => d.id === docId);
  if (!raw) return { ok: false, error: '文档不存在' };

  let meta = normalizeDocMeta(raw);
  let skillMarkdown = readSkillMarkdown(meta);

  const migratedSkill = migrateLegacySkillHeadings(skillMarkdown);
  if (migratedSkill !== skillMarkdown) {
    skillMarkdown = migratedSkill;
    const { writeSkillMarkdown } = require('./store');
    if (meta.skillName) writeSkillMarkdown(meta, skillMarkdown);
  }

  if (LAYER_HEADING_RE.test(skillMarkdown)) {
    skillMarkdown = stripLayerSection(skillMarkdown);
    const { writeSkillMarkdown } = require('./store');
    if (meta.skillName) writeSkillMarkdown(meta, skillMarkdown);
  }

  const parsedSkill = parseSkillFrontmatter(skillMarkdown);
  if (parsedSkill.description && !meta.skillDescription) {
    meta = {
      ...meta,
      skillDescription: cleanSkillDescription(parsedSkill.description).slice(0, 1024),
    };
    upsertMeta(meta);
  }

  const content = docContentFromSkill(meta, skillMarkdown);
  const layerInfo = enrichDocWithLayer(meta, skillMarkdown);

  return {
    ok: true,
    doc: { ...meta, content, skillMarkdown, ...layerInfo },
  };
}

function createManual(payload) {
  const title = String(payload?.title || '').trim() || '未命名 skill';
  const now = new Date().toISOString();
  const meta = normalizeDocMeta({
    id: newDocId(),
    title,
    sourceType: 'manual',
    aiEnabled: payload?.aiEnabled !== false,
    aiContextMode: parseAiContextMode(payload?.aiContextMode, 'skill'),
    createdAt: now,
    updatedAt: now,
  });
  upsertMeta(meta);
  return {
    ok: true,
    doc: { ...meta, content: '', skillMarkdown: '', layerTree: null },
  };
}

/** 第一步：读取 data（内存，不写盘） */
async function readDevDocResource(payload) {
  const id = String(payload?.id || '').trim();
  if (!id) return { ok: false, error: '缺少 id' };
  const raw = listDevDocMeta().find((d) => d.id === id);
  if (!raw) return { ok: false, error: '文档不存在' };
  const meta = normalizeDocMeta(raw);
  const read = await readResourceData(payload, meta);
  if (!read.ok) return read;
  return {
    ok: true,
    data: read.data,
    sourceType: read.sourceType,
    sourceUrl: read.sourceUrl || '',
    sourcePath: read.sourcePath || '',
  };
}

/** 第二步：由 data 生成 skill（写 {skillName}.md + {skillName}.json） */
async function generateDevDocSkill(payload) {
  const id = String(payload?.id || '').trim();
  if (!id) return { ok: false, error: '缺少 id' };
  const raw = listDevDocMeta().find((d) => d.id === id);
  if (!raw) return { ok: false, error: '文档不存在' };

  const mode =
    payload.editSourceMode === 'other'
      ? 'other'
      : payload.editSourceMode === 'markdown'
        ? 'markdown'
        : null;
  if (!mode) return { ok: false, error: '请先选择 markdown 或 其他' };

  const data = payload.data != null ? String(payload.data) : '';

  let meta = { ...normalizeDocMeta(raw), updatedAt: new Date().toISOString() };
  if (payload.title != null) meta.title = String(payload.title).trim() || meta.title;

  if (payload.sourceUrl) {
    meta.sourceUrl = String(payload.sourceUrl).trim();
    meta.sourceType = 'url';
  } else if (payload.sourcePath) {
    meta.sourcePath = String(payload.sourcePath).trim();
    meta.sourceType = 'file';
  } else if (payload.sourceType === 'manual') {
    meta.sourceType = 'manual';
  }

  const generated = await generateSkillFromData(
    meta,
    id,
    data,
    mode,
    meta.title
  );
  if (!generated.ok) return generated;

  let nextMeta = generated.meta;
  const resourceFolderPath = payload.resourceFolderPath ?? payload.resourceFolderSource;
  if (resourceFolderPath != null && String(resourceFolderPath).trim()) {
    const applied = applySkillResourceFolder(nextMeta, id, resourceFolderPath);
    if (!applied.ok) return applied;
    nextMeta = applied.meta;
  }

  upsertMeta(nextMeta);
  const docRes = getDevDoc(id);
  if (!docRes.ok) return docRes;
  return { ok: true, doc: docRes.doc, skillName: generated.skillName, title: generated.title, name: generated.name || generated.title };
}

async function updateDevDocAsync(payload) {
  const id = String(payload?.id || '').trim();
  if (!id) return { ok: false, error: '缺少 id' };
  const raw = listDevDocMeta().find((d) => d.id === id);
  if (!raw) return { ok: false, error: '文档不存在' };

  let next = { ...normalizeDocMeta(raw), updatedAt: new Date().toISOString() };
  if (payload.title != null) next.title = String(payload.title).trim() || next.title;
  if (payload.aiEnabled != null) next.aiEnabled = Boolean(payload.aiEnabled);
  if (payload.aiContextMode != null) {
    next.aiContextMode = parseAiContextMode(payload.aiContextMode, next.aiContextMode);
  }

  const editSourceMode =
    payload.editSourceMode === 'other'
      ? 'other'
      : payload.editSourceMode === 'markdown'
        ? 'markdown'
        : null;

  if (editSourceMode) {
    const read = await readResourceData(payload, next);
    if (!read.ok) return read;
    if (read.sourceUrl) {
      next.sourceUrl = read.sourceUrl;
      next.sourceType = 'url';
    } else if (read.sourcePath) {
      next.sourcePath = read.sourcePath;
      next.sourceType = 'file';
    } else {
      next.sourceType = read.sourceType || 'manual';
    }
    const generated = await generateSkillFromData(
      next,
      id,
      read.data,
      editSourceMode,
      next.title
    );
    if (!generated.ok) return generated;
    let nextMeta = generated.meta;
    const resourceFolderPath = payload.resourceFolderPath ?? payload.resourceFolderSource;
    if (resourceFolderPath != null && String(resourceFolderPath).trim()) {
      const applied = applySkillResourceFolder(nextMeta, id, resourceFolderPath);
      if (!applied.ok) return applied;
      nextMeta = applied.meta;
    }
    upsertMeta(nextMeta);
    return getDevDoc(id);
  }

  if (payload.skillMarkdown != null) {
    const skillMarkdown = String(payload.skillMarkdown);
    if (!skillMarkdown.trim()) return { ok: false, error: 'Skill 内容不能为空' };

    const parsed = parseSkillFrontmatter(skillMarkdown);
    if (parsed.name) next.skillName = slugifySkillName(parsed.name);
    if (parsed.description) {
      next.skillDescription = cleanSkillDescription(parsed.description).slice(0, 1024);
    }

    writeSkillMarkdown(next, skillMarkdown);
    const clean = stripLayerSection(skillMarkdown);
    const skillName = parsed.name ? slugifySkillName(parsed.name) : next.skillName;
    const layerTree = buildMarkdownLayerTree(clean, skillName);
    writeLayerJson(skillName, id, layerTree);
    let nextMeta = next;
    const resourceFolderPath = payload.resourceFolderPath ?? payload.resourceFolderSource;
    if (resourceFolderPath != null && String(resourceFolderPath).trim()) {
      const applied = applySkillResourceFolder(nextMeta, id, resourceFolderPath);
      if (!applied.ok) return applied;
      nextMeta = applied.meta;
    }
    upsertMeta(nextMeta);
    return getDevDoc(id);
  }

  upsertMeta(next);
  return getDevDoc(id);
}

function deleteDevDoc(payload) {
  const ids = Array.isArray(payload?.ids)
    ? payload.ids.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const single = String(payload?.id || '').trim();
  if (single) ids.push(single);
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return { ok: false, error: '缺少 id' };

  const metas = listDevDocMeta();
  const toDelete = uniqueIds.filter((id) => metas.some((d) => d.id === id));
  if (!toDelete.length) return { ok: false, error: '文档不存在' };

  for (const id of toDelete) {
    const raw = metas.find((d) => d.id === id);
    if (raw) deleteDocFile(raw);
  }

  const list = metas.filter((d) => !toDelete.includes(d.id));
  saveDevDocMetaList(list.map(normalizeDocMeta));
  return {
    ok: true,
    docs: list.map(normalizeDocMeta).map(metaWithPreview),
    deleted: toDelete.length,
  };
}

module.exports = {
  listSkills: listDevDocs,
  getSkill: getDevDoc,
  readSkillResource: readDevDocResource,
  saveSkill: generateDevDocSkill,
  updateSkill: updateDevDocAsync,
  deleteSkill: deleteDevDoc,
  openSkillStorageDir: openDevDocsDir,
  createManual,
  listDevDocs,
  getDevDoc,
  readDevDocResource,
  generateDevDocSkill,
  updateDevDoc: updateDevDocAsync,
  deleteDevDoc,
  openDevDocsDir,
  MAX_PREVIEW,
};
