/**
 * @file git-runner.js
 *
 * 【功能】在工程目录内执行 git 命令（status / log / pull / push / commit）。
 */
const { execFile } = require('child_process');
const { promisify } = require('util');
const { buildGit2Json } = require('./log-parser');
const { resolveGitGraphCommitLimit } = require('../../settings/js/volc-user-config');

const execFileAsync = promisify(execFile);

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {{ maxBuffer?: number }} [opts]
 */
async function runGit(cwd, args, opts) {
  if (!cwd) throw new Error('未打开工程目录，请通过 File → Open Folder 选择项目');
  const { stdout, stderr } = await execFileAsync('git', ['-C', cwd, ...args], {
    maxBuffer: opts?.maxBuffer ?? 10 * 1024 * 1024,
    encoding: 'utf8',
  });
  return { stdout: stdout || '', stderr: stderr || '' };
}

async function isGitRepo(cwd) {
  try {
    const { stdout } = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

async function getCurrentBranch(cwd) {
  try {
    const { stdout } = await runGit(cwd, ['branch', '--show-current']);
    return stdout.trim();
  } catch {
    return '';
  }
}

async function getStatus(cwd) {
  const { stdout } = await runGit(cwd, ['status', '--porcelain', '-b']);
  const lines = stdout.trim().split('\n').filter(Boolean);
  const branchLine = lines[0]?.startsWith('##') ? lines[0] : '';
  const fileLines = branchLine ? lines.slice(1) : lines;
  return { branchLine, fileLines, raw: stdout.trim() };
}

async function getGraphData(cwd, limit) {
  const commitLimit = limit ?? resolveGitGraphCommitLimit();
  const { stdout } = await runGit(cwd, [
    'log',
    '--all',
    '--reverse',
    '--pretty=format:%H%x09%P%x09%s%x09%an%x09%ae%x09%ci%x09%D',
    '-n',
    String(commitLimit),
  ]);
  return buildGit2Json(stdout);
}

async function pull(cwd) {
  return runGit(cwd, ['pull', '--ff-only'], { maxBuffer: 20 * 1024 * 1024 });
}

async function push(cwd) {
  return runGit(cwd, ['push'], { maxBuffer: 20 * 1024 * 1024 });
}

async function commitAll(cwd, message) {
  const msg = String(message || '').trim();
  if (!msg) throw new Error('Commit 信息不能为空');
  await runGit(cwd, ['add', '-A']);
  return runGit(cwd, ['commit', '-m', msg]);
}

async function getRepoState(cwd) {
  const repo = await isGitRepo(cwd);
  if (!repo) {
    return {
      ok: true,
      isRepo: false,
      projectRoot: cwd,
      branch: '',
      status: null,
      graphData: [],
    };
  }
  const [branch, status, graphData] = await Promise.all([
    getCurrentBranch(cwd),
    getStatus(cwd),
    getGraphData(cwd),
  ]);
  return {
    ok: true,
    isRepo: true,
    projectRoot: cwd,
    branch,
    status,
    graphData,
  };
}

module.exports = {
  runGit,
  isGitRepo,
  getCurrentBranch,
  getStatus,
  getGraphData,
  getRepoState,
  pull,
  push,
  commitAll,
};
