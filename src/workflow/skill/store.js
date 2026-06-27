/**
 * @file store.js
 * 【功能】Skill 磁盘存储：索引（workflows.json → devDocs）、SKILL.md、Layer JSON
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { readStore, writeStore } = require('../config-store');
const { buildMarkdownLayerTree, stripLayerSection } = require('../../markdown/skill-layer');

const DOCS_DIR_NAME = 'workflow-dev-docs';

function getDevDocsDir() {
  return path.join(app.getPath('userData'), DOCS_DIR_NAME);
}

function ensureDevDocsDir() {
  const dir = getDevDocsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listDevDocMeta() {
  const store = readStore();
  return Array.isArray(store.devDocs) ? store.devDocs : [];
}

function saveDevDocMetaList(list) {
  const store = readStore();
  store.devDocs = Array.isArray(list) ? list : [];
  writeStore(store);
  return store.devDocs;
}

function skillFileBase(skillName, docId) {
  let s = String(skillName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!s) s = String(docId || 'skill').trim();
  return s.slice(0, 64);
}

function getSkillMdPath(skillName, docId) {
  return path.join(ensureDevDocsDir(), `${skillFileBase(skillName, docId)}.md`);
}

function getLayerJsonPath(skillName, docId) {
  return path.join(ensureDevDocsDir(), `${skillFileBase(skillName, docId)}.json`);
}

function layerJsonBasename(skillName, docId) {
  return `${skillFileBase(skillName, docId)}.json`;
}

function readSkillMarkdown(meta) {
  const skillName = typeof meta === 'string' ? '' : meta?.skillName;
  const docId = typeof meta === 'string' ? meta : meta?.id;
  if (!docId) return '';

  const primary = getSkillMdPath(skillName, docId);
  if (fs.existsSync(primary)) return fs.readFileSync(primary, 'utf8');

  const legacySkill = path.join(ensureDevDocsDir(), `${docId}.skill.md`);
  if (fs.existsSync(legacySkill)) return fs.readFileSync(legacySkill, 'utf8');

  const legacyDoc = path.join(ensureDevDocsDir(), `${docId}.md`);
  if (fs.existsSync(legacyDoc)) return fs.readFileSync(legacyDoc, 'utf8');

  return '';
}

function writeSkillMarkdown(meta, markdown) {
  ensureDevDocsDir();
  const p = getSkillMdPath(meta.skillName, meta.id);
  fs.writeFileSync(p, String(markdown ?? ''), 'utf8');
  return p;
}

function readLayerJson(skillName, docId) {
  const p = getLayerJsonPath(skillName, docId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeLayerJson(skillName, docId, treeObj) {
  ensureDevDocsDir();
  const p = getLayerJsonPath(skillName, docId);
  fs.writeFileSync(p, JSON.stringify(treeObj, null, 2), 'utf8');
  return p;
}

function removeSkillArtifacts(skillName, docId) {
  const md = getSkillMdPath(skillName, docId);
  const json = getLayerJsonPath(skillName, docId);
  if (fs.existsSync(md)) fs.unlinkSync(md);
  if (fs.existsSync(json)) fs.unlinkSync(json);
  try {
    const { removeSkillResourcesDir } = require('./resources');
    removeSkillResourcesDir(skillName, docId);
  } catch {
    /* resources optional during partial load */
  }
}

function removeLegacyDocArtifacts(docId) {
  if (!docId) return;
  const dir = ensureDevDocsDir();
  for (const name of [`${docId}.md`, `${docId}.skill.md`]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

function deleteDocFile(meta) {
  const docId = typeof meta === 'string' ? meta : meta?.id;
  const skillName = typeof meta === 'string' ? '' : meta?.skillName;
  if (!docId) return;
  removeSkillArtifacts(skillName, docId);
  removeLegacyDocArtifacts(docId);
}

function newDocId() {
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readLayerTreeForMeta(meta) {
  const skillName = meta.skillName || meta.id;
  let tree = readLayerJson(skillName, meta.id);
  if (!tree) {
    const skillMd = String(readSkillMarkdown(meta) || '').trim();
    if (!skillMd) return null;
    tree = buildMarkdownLayerTree(stripLayerSection(skillMd), skillName);
    if (tree) writeLayerJson(skillName, meta.id, tree);
  }
  return tree;
}

module.exports = {
  getSkillStorageDir: getDevDocsDir,
  getDevDocsDir,
  ensureDevDocsDir,
  listDevDocMeta,
  listSkillMeta: listDevDocMeta,
  saveDevDocMetaList,
  saveSkillMetaList: saveDevDocMetaList,
  readSkillMarkdown,
  writeSkillMarkdown,
  getSkillMdPath,
  layerJsonBasename,
  getLayerJsonPath,
  writeLayerJson,
  readLayerJson,
  readLayerTreeForMeta,
  removeSkillArtifacts,
  removeLegacyDocArtifacts,
  deleteDocFile,
  skillFileBase,
  newDocId,
};
