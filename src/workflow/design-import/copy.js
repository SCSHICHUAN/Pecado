/**
 * @file copy.js
 * 【功能】将 Figma Framelink 导出目录复制到工程的 DesignImports/
 */
const fs = require('fs');
const path = require('path');

const DESIGN_IMPORTS_DIR = 'DesignImports';

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name.startsWith('.')) continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const stat = fs.statSync(from);
    if (stat.isDirectory()) copyDirRecursive(from, to);
    else fs.copyFileSync(from, to);
  }
}

function uniqueDestDir(projectRoot, folderName) {
  const base = path.join(projectRoot, DESIGN_IMPORTS_DIR, folderName);
  if (!fs.existsSync(base)) return base;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(projectRoot, DESIGN_IMPORTS_DIR, `${folderName}_${stamp}`);
}

function detectFramelinkExport(destDir) {
  let jsonName = '';
  try {
    for (const name of fs.readdirSync(destDir)) {
      if (!name.endsWith('.json')) continue;
      const full = path.join(destDir, name);
      if (!fs.statSync(full).isFile()) continue;
      const raw = fs.readFileSync(full, 'utf8');
      const data = JSON.parse(raw);
      if (data && data.framelinkExport) {
        jsonName = name;
        break;
      }
    }
  } catch {
    return { hasFramelink: false, jsonName: '' };
  }
  return { hasFramelink: Boolean(jsonName), jsonName };
}

/**
 * @param {string} projectRoot Open Folder 工程根
 * @param {string} sourceFolder 用户选择的导出目录
 */
function importUiDesignFolder(projectRoot, sourceFolder) {
  const root = path.resolve(String(projectRoot || '').trim());
  const src = path.resolve(String(sourceFolder || '').trim());
  if (!root) return { ok: false, error: '请先 File → Open Folder 打开工程' };
  if (!src) return { ok: false, error: '未选择文件夹' };
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    return { ok: false, error: '所选路径不是有效文件夹' };
  }

  const relRoot = path.relative(root, src);
  if (!relRoot.startsWith('..') && !path.isAbsolute(relRoot)) {
    return { ok: false, error: '该文件夹已在当前工程内，无需复制' };
  }

  const folderName = path.basename(src);
  const dest = uniqueDestDir(root, folderName);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copyDirRecursive(src, dest);

  const { hasFramelink, jsonName } = detectFramelinkExport(dest);
  const relPath = path.relative(root, dest).split(path.sep).join('/');

  return {
    ok: true,
    relPath,
    destPath: dest,
    folderName: path.basename(dest),
    hasFramelink,
    jsonName,
    renamed: dest !== path.join(root, DESIGN_IMPORTS_DIR, folderName),
  };
}

/**
 * @param {string} projectRoot
 */
function listUiDesignImports(projectRoot) {
  const root = path.resolve(String(projectRoot || '').trim());
  if (!root) return { ok: false, error: '请先 Open Folder 打开工程', items: [] };

  const importsDir = path.join(root, DESIGN_IMPORTS_DIR);
  if (!fs.existsSync(importsDir) || !fs.statSync(importsDir).isDirectory()) {
    return { ok: true, items: [], importsDir: DESIGN_IMPORTS_DIR };
  }

  /** @type {Array<{ name: string, relPath: string, jsonName: string, hasFramelink: boolean, mtime: string }>} */
  const items = [];
  for (const name of fs.readdirSync(importsDir)) {
    if (name.startsWith('.')) continue;
    const full = path.join(importsDir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const { hasFramelink, jsonName } = detectFramelinkExport(full);
    items.push({
      name,
      relPath: `${DESIGN_IMPORTS_DIR}/${name}`.split(path.sep).join('/'),
      jsonName,
      hasFramelink,
      mtime: stat.mtime.toISOString(),
    });
  }

  items.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return { ok: true, items, importsDir: DESIGN_IMPORTS_DIR };
}

/**
 * @param {string} projectRoot
 * @param {string} relPath 相对工程根，如 DesignImports/foo
 */
function resolveUiDesignImportPath(projectRoot, relPath) {
  const root = path.resolve(String(projectRoot || '').trim());
  const rel = String(relPath || '').trim().replace(/\\/g, '/');
  if (!root || !rel) return { ok: false, error: '路径无效' };

  const abs = path.resolve(root, rel);
  const relCheck = path.relative(root, abs);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    return { ok: false, error: '路径超出工程目录' };
  }
  if (!rel.startsWith(`${DESIGN_IMPORTS_DIR}/`)) {
    return { ok: false, error: '只能打开 DesignImports 下的设计稿' };
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    return { ok: false, error: '设计稿文件夹不存在' };
  }
  return { ok: true, absPath: abs, relPath: rel.split(path.sep).join('/') };
}

module.exports = {
  DESIGN_IMPORTS_DIR,
  importUiDesignFolder,
  listUiDesignImports,
  resolveUiDesignImportPath,
  copyDirRecursive,
};
