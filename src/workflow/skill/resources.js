/**
 * @file resources.js
 * 【功能】Skill 附属资源：拷贝目录、文件树、读文件、执行脚本（run_skill_resource_script）
 */
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const { ensureDevDocsDir, skillFileBase } = require('./store');

const execFileAsync = promisify(execFile);
const projectIo = require('../../mcp-filesystem');

const SKILLS_DIR_NAME = 'skills';
const MAX_RESOURCE_FILE = 120000;
const RUN_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_RUN_OUTPUT = 512 * 1024;
const MAX_RUN_OBSERVATION = 12000;
const SKILL_PROGRESS_LINE_MAX = 160;
const SCRIPT_RUNNERS = {
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'zsh',
  '.py': 'python3',
};
const TEXT_EXT = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.py',
  '.sh',
  '.bash',
  '.zsh',
  '.yaml',
  '.yml',
  '.xml',
  '.html',
  '.css',
  '.scss',
  '.sql',
  '.env',
  '.ini',
  '.toml',
  '.csv',
  '.swift',
  '.m',
  '.mm',
  '.h',
  '.c',
  '.cpp',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.java',
  '.kt',
]);

function getSkillsRootDir() {
  return path.join(ensureDevDocsDir(), SKILLS_DIR_NAME);
}

function getSkillResourcesDir(skillName, docId) {
  const base = skillFileBase(skillName, docId);
  return path.join(getSkillsRootDir(), base);
}

function getResourceTreeJsonPath(skillName, docId) {
  return path.join(ensureDevDocsDir(), `${skillFileBase(skillName, docId)}.files.json`);
}

function slugFilePathSegment(name) {
  let s = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff._-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  if (!s) s = 'file';
  return s.slice(0, 64);
}

function buildResourceNodes(absDir, relPrefix = '') {
  const nodes = [];
  let entries = [];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return nodes;
  }

  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
    const abs = path.join(absDir, ent.name);
    if (ent.isDirectory()) {
      const children = buildResourceNodes(abs, rel);
      nodes.push({
        path: rel.split('/').map(slugFilePathSegment).join('/'),
        label: ent.name,
        kind: 'dir',
        relPath: rel,
        children,
      });
    } else if (ent.isFile()) {
      nodes.push({
        path: rel.split('/').map(slugFilePathSegment).join('/'),
        label: ent.name,
        kind: 'file',
        relPath: rel,
      });
    }
  }
  return nodes;
}

function buildResourceFileTree(skillName, resourcesDir) {
  const base = skillFileBase(skillName);
  return {
    version: 1,
    kind: 'skill-resource-tree',
    skillName: String(skillName || '').trim(),
    root: `${SKILLS_DIR_NAME}/${base}`,
    hint: 'Use read_skill_resource_file(skill_name, path) to read files; run_skill_resource_script(skill_name, path) to execute .sh/.py scripts under this tree.',
    tools: {
      file: 'read_skill_resource_file(skill_name, path)',
      run: 'run_skill_resource_script(skill_name, path, args?)',
    },
    nodes: buildResourceNodes(resourcesDir),
  };
}

function writeResourceTreeJson(skillName, docId, treeObj) {
  const p = getResourceTreeJsonPath(skillName, docId);
  fs.writeFileSync(p, JSON.stringify(treeObj, null, 2), 'utf8');
  return p;
}

function readResourceTreeJson(skillName, docId) {
  const p = getResourceTreeJsonPath(skillName, docId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function removeSkillResourcesDir(skillName, docId) {
  const dir = getSkillResourcesDir(skillName, docId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  const json = getResourceTreeJsonPath(skillName, docId);
  if (fs.existsSync(json)) fs.unlinkSync(json);
}

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

/**
 * @param {string} sourceFolderPath 用户选择的本地资源文件夹
 */
function syncSkillResources(skillName, docId, sourceFolderPath) {
  const src = String(sourceFolderPath || '').trim();
  if (!src) {
    return { ok: true, skipped: true, tree: null };
  }
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    return { ok: false, error: '资源文件夹不存在或不是目录' };
  }

  const dest = getSkillResourcesDir(skillName, docId);
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  copyDirRecursive(src, dest);

  const tree = buildResourceFileTree(skillName, dest);
  writeResourceTreeJson(skillName, docId, tree);

  return {
    ok: true,
    tree,
    resourcesDir: dest,
    resourceTreeFile: path.basename(getResourceTreeJsonPath(skillName, docId)),
  };
}

function findResourceFileByBasename(nodes, baseName) {
  const key = String(baseName || '').toLowerCase();
  if (!key) return null;
  for (const n of nodes || []) {
    if (n.kind === 'file') {
      const label = String(n.label || '').toLowerCase();
      const rel = String(n.relPath || '').split('/').pop()?.toLowerCase();
      if (label === key || rel === key) return n;
    }
    const child = findResourceFileByBasename(n.children, baseName);
    if (child) return child;
  }
  return null;
}

function flattenResourceFileNodes(nodes, out = []) {
  for (const n of nodes || []) {
    if (n.kind === 'file' && n.relPath) out.push(n);
    if (n.children?.length) flattenResourceFileNodes(n.children, out);
  }
  return out;
}

/** 在资源树中按 relPath / 后缀 / basename 解析（树为权威索引） */
function lookupResourceInTree(tree, rawPath) {
  const request = String(rawPath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!request || !tree?.nodes?.length) return null;

  const files = flattenResourceFileNodes(tree.nodes);
  const reqLower = request.toLowerCase();

  const exact = files.find((f) => String(f.relPath || '').toLowerCase() === reqLower);
  if (exact) return { node: exact, matchKind: 'exact' };

  const suffixMatches = files.filter((f) => {
    const rel = String(f.relPath || '').toLowerCase();
    return rel === reqLower || rel.endsWith(`/${reqLower}`);
  });
  if (suffixMatches.length === 1) {
    return { node: suffixMatches[0], matchKind: 'suffix' };
  }

  const base = request.split('/').pop()?.toLowerCase();
  if (base) {
    const baseMatches = files.filter((f) => {
      const rel = String(f.relPath || '').toLowerCase();
      const label = String(f.label || '').toLowerCase();
      return rel.endsWith(`/${base}`) || rel === base || label === base;
    });
    if (baseMatches.length === 1) {
      return { node: baseMatches[0], matchKind: 'basename' };
    }
    if (baseMatches.length > 1) {
      return {
        ambiguous: true,
        candidates: baseMatches.map((f) => f.relPath),
      };
    }
  }

  if (suffixMatches.length > 1) {
    return {
      ambiguous: true,
      candidates: suffixMatches.map((f) => f.relPath),
    };
  }

  return null;
}

function walkResourceTreeBySegments(tree, segments) {
  if (!tree?.nodes?.length || !segments.length) return null;
  let list = tree.nodes;
  let found = null;
  for (const seg of segments) {
    const key = seg.toLowerCase();
    found = list.find((n) => {
      const slug = String(n.path || '').split('/').pop()?.toLowerCase();
      const label = String(n.label || '').toLowerCase();
      const rel = String(n.relPath || '').split('/').pop()?.toLowerCase();
      return slug === key || label === key || rel === key;
    });
    if (!found) return null;
    list = found.children || [];
  }
  return found?.kind === 'file' ? found : null;
}

function resolveResourceRelPath(skillName, docId, rawPath) {
  const resourcesDir = getSkillResourcesDir(skillName, docId);
  if (!fs.existsSync(resourcesDir)) {
    return { ok: false, error: '该 skill 无资源文件夹' };
  }

  const segments = String(rawPath || '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
  if (!segments.length) return { ok: false, error: '缺少 path' };

  const tree = readResourceTreeJson(skillName, docId);
  let relPath = '';
  let matchKind = '';

  const treeHit = lookupResourceInTree(tree, rawPath);
  if (treeHit?.ambiguous) {
    return {
      ok: false,
      error: `path「${rawPath}」匹配多个资源：${treeHit.candidates.join(', ')}`,
    };
  }
  if (treeHit?.node?.relPath) {
    relPath = treeHit.node.relPath;
    matchKind = treeHit.matchKind;
  }

  if (!relPath && tree?.nodes?.length) {
    const walked = walkResourceTreeBySegments(tree, segments);
    if (walked?.relPath) {
      relPath = walked.relPath;
      matchKind = 'walk';
    }
  }

  if (!relPath) {
    relPath = segments.join('/');
  }

  let abs = path.resolve(resourcesDir, relPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    const byName = findResourceFileByBasename(tree?.nodes, segments[segments.length - 1]);
    if (byName?.relPath) {
      relPath = byName.relPath;
      matchKind = matchKind || 'basename-fallback';
      abs = path.resolve(resourcesDir, relPath);
    }
  }

  if (!abs.startsWith(path.resolve(resourcesDir) + path.sep) && abs !== path.resolve(resourcesDir)) {
    return { ok: false, error: '非法 path' };
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return { ok: false, error: `未找到资源文件「${rawPath}」` };
  }
  return {
    ok: true,
    relPath,
    absPath: abs,
    requestedPath: String(rawPath || '').trim(),
    matchKind: matchKind || 'direct',
  };
}

function looksLikeTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXT.has(ext)) return true;
  return !ext;
}

function readResourceFileContent(skillName, docId, rawPath) {
  const resolved = resolveResourceRelPath(skillName, docId, rawPath);
  if (!resolved.ok) return resolved;

  const { relPath, absPath } = resolved;
  if (!looksLikeTextFile(absPath)) {
    return { ok: false, error: '该资源不是文本文件，暂不支持读取' };
  }

  let body = '';
  try {
    body = fs.readFileSync(absPath, 'utf8');
  } catch (e) {
    return { ok: false, error: e.message || '无法读取资源文件' };
  }

  if (body.length > MAX_RESOURCE_FILE) {
    body = `${body.slice(0, MAX_RESOURCE_FILE)}\n…(已截断)`;
  }

  return { ok: true, path: rawPath, relPath, absPath, body };
}

function capRunOutput(text, maxLen = MAX_RUN_OUTPUT) {
  let s = String(text || '');
  if (s.length > maxLen) s = `${s.slice(0, maxLen)}\n…(输出已截断)`;
  return s;
}

function stripAnsi(text) {
  return String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function capSkillProgressLine(line) {
  const t = stripAnsi(line).trim();
  if (!t) return '';
  return t.length > SKILL_PROGRESS_LINE_MAX ? `${t.slice(0, SKILL_PROGRESS_LINE_MAX)}…` : t;
}

/**
 * @param {string} runner
 * @param {string[]} args
 * @param {{ cwd: string, env: object, onLine?: (line: string, isErr: boolean) => void }} opts
 */
function runScriptSpawn(runner, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(runner, args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
    });
    let stdout = '';
    let stderr = '';

    const feed = (chunk, isErr) => {
      const text = chunk.toString();
      if (isErr) stderr += text;
      else stdout += text;
      if (typeof opts.onLine !== 'function') return;
      for (const raw of text.split('\n')) {
        const line = capSkillProgressLine(raw);
        if (line) opts.onLine(line, isErr);
      }
    };

    child.stdout.on('data', (c) => feed(c, false));
    child.stderr.on('data', (c) => feed(c, true));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

/**
 * 在 skill 资源目录内执行附属脚本（.sh / .bash / .zsh / .py）
 * @param {string} skillName
 * @param {string} docId
 * @param {string} rawPath
 * @param {string[]} [extraArgs]
 * @param {{ onLine?: (line: string, isErr?: boolean) => void }} [opts]
 */
async function runResourceScript(skillName, docId, rawPath, extraArgs = [], opts = {}) {
  const resolved = resolveResourceRelPath(skillName, docId, rawPath);
  if (!resolved.ok) return resolved;

  const { absPath, relPath } = resolved;
  const ext = path.extname(absPath).toLowerCase();
  const runner = SCRIPT_RUNNERS[ext];
  if (!runner) {
    return {
      ok: false,
      error: `不支持执行该资源类型（仅 .sh .bash .zsh .py），path=${rawPath}`,
    };
  }

  const cwd = getSkillResourcesDir(skillName, docId);
  const scriptDir = path.dirname(absPath);
  const args = [absPath, ...extraArgs.map((a) => String(a))];
  const commandLine = `${runner} ${relPath}${extraArgs.length ? ` ${extraArgs.join(' ')}` : ''}`;

  const env = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONPATH: [scriptDir, cwd, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
  };
  if (projectIo.getStatus().connected && projectIo.getStatus().projectRoot) {
    env.PECADO_PROJECT_ROOT = projectIo.getStatus().projectRoot;
  }

  try {
    const runOpts = { cwd, env, onLine: opts.onLine };
    const { stdout, stderr, exitCode } = await runScriptSpawn(runner, args, runOpts);
    return {
      ok: true,
      path: rawPath,
      relPath,
      absPath,
      requestedPath: resolved.requestedPath,
      matchKind: resolved.matchKind,
      command: commandLine,
      exitCode: exitCode ?? 0,
      stdout: capRunOutput(stdout, MAX_RUN_OBSERVATION),
      stderr: capRunOutput(stderr, MAX_RUN_OBSERVATION),
    };
  } catch (e) {
    return {
      ok: true,
      path: rawPath,
      relPath,
      absPath,
      requestedPath: resolved.requestedPath,
      matchKind: resolved.matchKind,
      command: commandLine,
      exitCode: typeof e.code === 'number' ? e.code : 1,
      stdout: capRunOutput(e.stdout, MAX_RUN_OBSERVATION),
      stderr: capRunOutput(e.stderr || e.message, MAX_RUN_OBSERVATION),
    };
  }
}

module.exports = {
  SKILLS_DIR_NAME,
  getSkillsRootDir,
  getSkillResourcesDir,
  getResourceTreeJsonPath,
  buildResourceFileTree,
  writeResourceTreeJson,
  readResourceTreeJson,
  removeSkillResourcesDir,
  syncSkillResources,
  readResourceFileContent,
  resolveResourceRelPath,
  lookupResourceInTree,
  flattenResourceFileNodes,
  runResourceScript,
};
