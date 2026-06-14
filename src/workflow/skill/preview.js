/**
 * @file preview.js
 * 【功能】Log 面板浮层预览：Skill Layer 节点 / 资源文件正文
 */
const { listDevDocMeta, readSkillMarkdown, readLayerJson } = require('./store');
const { normalizeDocMeta } = require('./document');
const { readSkillSectionByPath } = require('../../markdown/skill-layer');
const { readResourceFileContent } = require('./resources');

function findDoc(skillName, skillDocId) {
  const metas = listDevDocMeta().map(normalizeDocMeta).filter((d) => d.aiEnabled === true);
  const docId = String(skillDocId || '').trim();
  if (docId) {
    const byId = metas.find((d) => String(d.id || '') === docId);
    if (byId) return byId;
  }
  const key = String(skillName || '').trim().toLowerCase();
  if (!key) return null;
  return (
    metas.find((d) => String(d.skillName || '').toLowerCase() === key) ||
    metas.find((d) => String(d.title || '').toLowerCase() === key) ||
    metas.find((d) => String(d.id || '').toLowerCase() === key) ||
    null
  );
}

function readSectionPreview(skillName, sectionPath, skillDocId) {
  const meta = findDoc(skillName, skillDocId);
  if (!meta) return { ok: false, error: `未找到 skill「${skillName || skillDocId || ''}」` };

  const path = String(sectionPath || '').trim();
  if (!path) return { ok: false, error: '缺少 section path' };

  if (path === '__layer__') {
    const tree = readLayerJson(meta.skillName || meta.id, meta.id);
    if (!tree?.nodes?.length) return { ok: false, error: '无 Layer 树' };
    return {
      ok: true,
      title: 'Layer tree',
      body: JSON.stringify(tree, null, 2),
    };
  }

  const md = readSkillMarkdown(meta);
  const res = readSkillSectionByPath(md, path);
  if (!res.ok) return { ok: false, error: res.error || `无法读取「${path}」` };
  return { ok: true, title: path, body: String(res.body || '') };
}

function readResourcePreview(skillName, resourcePath, skillDocId) {
  const meta = findDoc(skillName, skillDocId);
  if (!meta) return { ok: false, error: `未找到 skill「${skillName || skillDocId || ''}」` };
  const res = readResourceFileContent(meta.skillName || meta.id, meta.id, resourcePath);
  if (!res.ok) return { ok: false, error: res.error || '无法读取资源' };
  return {
    ok: true,
    title: res.relPath || resourcePath,
    body: String(res.body || ''),
    absPath: res.absPath || '',
  };
}

module.exports = { readSectionPreview, readResourcePreview, findDoc };
