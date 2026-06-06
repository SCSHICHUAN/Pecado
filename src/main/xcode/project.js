/**
 * @file project.js
 *
 * 【功能】Xcode 工程发现与 project.pbxproj 修改（node-xcode）。
 *   - findXcodeProject：自 projectRoot 向下扫描深度≤4 找首个 .xcodeproj
 *   - findXcodeWorkspace：同上找首个 .xcworkspace（跳过 xcodeproj 内嵌的 project.xcworkspace）
 *   - openXcodeForProjectRoot：优先打开 workspace，否则 .xcodeproj
 *   - pathExistsUnderRoot / toXcodeRelPath：路径是否在 xcodeRoot 内及相对路径
 *   - addFileToProject：按扩展名 .swift/.m/.h 等加入 PBXGroup + PBXBuildFile（Sources/Headers）
 *   - addDirectoryToProject：PBXGroup 递归或单层目录
 *   - openXcodeProject：macOS execFile `open` .xcodeproj
 *   仅 IS_DARWIN 有效；读写 pbxproj 前备份逻辑在函数内部
 *
 * 【调用方】xcode/prompt.js；agent/tool-executor.js（pathExistsUnderRoot 判断新文件）
 *
 * 【对外能力】
 *   findXcodeProject(projectRoot) → { xcodeProjDir, pbxPath, xcodeRoot, name } | null
 *   openXcodeForProjectRoot(projectRoot) → { kind, name, path } | null
 *   pathExistsUnderRoot / toXcodeRelPath
 *   addFileToProject(pbxPath, xcodeRel, absPath) / addDirectoryToProject(pbxPath, xcodeRel)
 *   openXcodeProject(xcodeProjDir)
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const xcode = require('xcode');

const IS_DARWIN = process.platform === 'darwin';
const SOURCE_EXTS = new Set(['.swift', '.m', '.mm', '.c', '.cpp', '.cc']);
const HEADER_EXTS = new Set(['.h', '.hpp']);

/**
 * @param {string} projectRoot MCP 打开的目录
 * @returns {{ xcodeProjDir: string, pbxPath: string, xcodeRoot: string, name: string } | null}
 */
function findXcodeProject(projectRoot) {
  if (!IS_DARWIN || !projectRoot) return null;

  function scanDir(dir, depth) {
    if (depth > 4) return null;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      if (e.isDirectory() && e.name.endsWith('.xcodeproj')) {
        const xcodeProjDir = path.join(dir, e.name);
        const pbxPath = path.join(xcodeProjDir, 'project.pbxproj');
        if (fs.existsSync(pbxPath)) {
          return {
            xcodeProjDir,
            pbxPath,
            xcodeRoot: dir,
            name: e.name.replace(/\.xcodeproj$/, ''),
          };
        }
      }
    }
    if (depth >= 4) return null;
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const found = scanDir(path.join(dir, e.name), depth + 1);
      if (found) return found;
    }
    return null;
  }

  return scanDir(path.resolve(projectRoot), 0);
}

/**
 * @param {string} projectRoot
 * @returns {{ workspaceDir: string, name: string } | null}
 */
function findXcodeWorkspace(projectRoot) {
  if (!IS_DARWIN || !projectRoot) return null;

  function scanDir(dir, depth) {
    if (depth > 4) return null;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      if (!e.isDirectory() || !e.name.endsWith('.xcworkspace')) continue;
      if (e.name === 'project.xcworkspace') continue;
      const workspaceDir = path.join(dir, e.name);
      if (workspaceDir.includes(`${path.sep}.xcodeproj${path.sep}`)) continue;
      return {
        workspaceDir,
        name: e.name.replace(/\.xcworkspace$/, ''),
      };
    }
    if (depth >= 4) return null;
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const found = scanDir(path.join(dir, e.name), depth + 1);
      if (found) return found;
    }
    return null;
  }

  return scanDir(path.resolve(projectRoot), 0);
}

/**
 * Open Folder 后自动在 Xcode 中打开对应工程（macOS）。
 * @param {string} projectRoot
 * @returns {{ kind: 'workspace'|'project', name: string, path: string } | null}
 */
function openXcodeForProjectRoot(projectRoot) {
  if (!IS_DARWIN || !projectRoot) return null;

  const workspace = findXcodeWorkspace(projectRoot);
  if (workspace) {
    openXcodeProject(workspace.workspaceDir);
    return { kind: 'workspace', name: workspace.name, path: workspace.workspaceDir };
  }

  const meta = findXcodeProject(projectRoot);
  if (meta) {
    openXcodeProject(meta.xcodeProjDir);
    return { kind: 'project', name: meta.name, path: meta.xcodeProjDir };
  }

  return null;
}

function getMainGroupKey(proj) {
  const section = proj.hash?.project?.objects?.PBXProject;
  if (!section) return null;
  for (const key of Object.keys(section)) {
    if (key.endsWith('_comment')) continue;
    const entry = section[key];
    if (entry?.mainGroup) return entry.mainGroup;
  }
  return null;
}

function normalizeRelPath(relPath) {
  return String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

function toXcodeRelPath(xcodeRoot, absPath) {
  const rel = path.relative(xcodeRoot, absPath).replace(/\\/g, '/');
  if (rel.startsWith('..')) return null;
  return rel;
}

function groupDisplayName(group) {
  if (!group) return '';
  const n = group.name || group.path || '';
  return String(n).replace(/^"|"$/g, '');
}

function findChildGroupKey(proj, parentKey, name) {
  const groups = proj.hash.project.objects.PBXGroup;
  const parent = groups[parentKey];
  if (!parent?.children) return null;
  for (const child of parent.children) {
    const g = groups[child.value];
    if (g && groupDisplayName(g) === name) return child.value;
  }
  return null;
}

function ensureGroupPath(proj, parentKey, relDirPath) {
  const parts = normalizeRelPath(relDirPath).split('/').filter(Boolean);
  let current = parentKey;
  for (const part of parts) {
    const existing = findChildGroupKey(proj, current, part);
    if (existing) {
      current = existing;
      continue;
    }
    // name + path 与 Xcode 默认分组一致，便于解析磁盘路径
    const created = proj.addPbxGroup([], part, part);
    const parent = proj.hash.project.objects.PBXGroup[current];
    if (parent?.children) {
      parent.children.push({ value: created.uuid, comment: part });
    }
    current = created.uuid;
  }
  return current;
}

function groupExistsForPath(proj, relDirPath) {
  const mainKey = getMainGroupKey(proj);
  if (!mainKey) return false;
  const parts = normalizeRelPath(relDirPath).split('/').filter(Boolean);
  let current = mainKey;
  for (const part of parts) {
    const next = findChildGroupKey(proj, current, part);
    if (!next) return false;
    current = next;
  }
  return parts.length > 0;
}

function stripQuotes(s) {
  return String(s || '').replace(/^"|"$/g, '');
}

function groupHasPathSet(groupKey, proj) {
  const groups = proj.hash.project.objects.PBXGroup;
  const group = groups[groupKey];
  return !!(group && stripQuotes(group.path || ''));
}

/** 分组若带 path，文件引用只能用 basename，否则 Xcode 路径会叠两层变红 */
function fileRefPathForGroup(relFilePath, groupKey, proj) {
  const rel = normalizeRelPath(relFilePath);
  const fileName = path.basename(rel);
  if (groupHasPathSet(groupKey, proj)) {
    return fileName;
  }
  const dir = path.dirname(rel);
  if (dir && dir !== '.') {
    return rel;
  }
  return fileName;
}

/**
 * @param {string} pbxPath
 * @param {string} relFilePath 相对 xcodeRoot
 * @param {string} [absFilePath] 磁盘绝对路径（用于校验）
 */
function addFileToProject(pbxPath, relFilePath, absFilePath) {
  const rel = normalizeRelPath(relFilePath);
  const ext = path.extname(rel).toLowerCase();
  if (!SOURCE_EXTS.has(ext) && !HEADER_EXTS.has(ext)) {
    return { ok: false, skipped: true, reason: `暂不自动引入 ${ext || '该类型'} 文件，请在 Xcode 中手动添加` };
  }

  if (absFilePath && !fs.existsSync(absFilePath)) {
    return { ok: false, reason: `磁盘上找不到文件：${absFilePath}` };
  }

  const proj = xcode.project(pbxPath);
  proj.parseSync();

  const dir = path.dirname(rel);
  const mainGroupKey = getMainGroupKey(proj);
  if (!mainGroupKey) return { ok: false, reason: '无法解析 PBXProject mainGroup' };

  const groupKey = dir && dir !== '.' ? ensureGroupPath(proj, mainGroupKey, dir) : mainGroupKey;
  const refPath = fileRefPathForGroup(rel, groupKey, proj);

  if (proj.hasFile(rel) || proj.hasFile(refPath)) {
    return { ok: true, already: true, path: rel };
  }

  const targetUuid = proj.getFirstTarget().uuid;

  let added;
  if (SOURCE_EXTS.has(ext)) {
    added = proj.addSourceFile(refPath, { target: targetUuid }, groupKey);
  } else {
    added = proj.addHeaderFile(refPath, {}, groupKey);
  }
  if (!added) return { ok: false, reason: 'addSourceFile/addHeaderFile 失败' };

  fs.writeFileSync(pbxPath, proj.writeSync());
  console.log('[xcode-project] added file ref', refPath, 'group', dir || '.', 'disk', rel);
  return { ok: true, path: rel, refPath };
}

/**
 * @param {string} pbxPath
 * @param {string} relDirPath 相对 xcodeRoot
 */
function addDirectoryToProject(pbxPath, relDirPath) {
  const rel = normalizeRelPath(relDirPath).replace(/\/$/, '');
  if (!rel) return { ok: false, reason: '目录路径为空' };

  const proj = xcode.project(pbxPath);
  proj.parseSync();

  if (groupExistsForPath(proj, rel)) {
    return { ok: true, already: true, path: rel };
  }

  const mainGroupKey = getMainGroupKey(proj);
  if (!mainGroupKey) return { ok: false, reason: '无法解析 PBXProject mainGroup' };

  ensureGroupPath(proj, mainGroupKey, rel);
  fs.writeFileSync(pbxPath, proj.writeSync());
  return { ok: true, path: rel };
}

function openXcodeProject(xcodeProjDir) {
  if (!IS_DARWIN || !xcodeProjDir) return;
  execFile('open', [xcodeProjDir], (err) => {
    if (err) console.warn('[xcode-project] open', err.message);
  });
}

function pathExistsUnderRoot(projectRoot, relPath) {
  try {
    return fs.existsSync(path.resolve(projectRoot, relPath));
  } catch {
    return false;
  }
}

module.exports = {
  IS_DARWIN,
  findXcodeProject,
  findXcodeWorkspace,
  openXcodeForProjectRoot,
  addFileToProject,
  addDirectoryToProject,
  openXcodeProject,
  pathExistsUnderRoot,
  toXcodeRelPath,
  SOURCE_EXTS,
};
