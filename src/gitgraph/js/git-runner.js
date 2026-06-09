/**
 * @file git-runner.js
 *
 * 【功能】在 MCP 已打开的工程目录内执行 git 子进程命令。
 * 【调用方】gitgraph/js/register.js
 *
 * 【能力】
 * - getRepoState：isRepo、branch、porcelain status、graphData（log-parser）
 * - pull：--ff-only；push；commitAll：add -A + commit -m
 * - graphData 条数：settings/volc-user-config → resolveGitGraphCommitLimit()
 */
const { execFile, exec } = require('child_process');
const { promisify } = require('util');
const { buildGit2Json } = require('./log-parser');
const { resolveGitGraphCommitLimit } = require('../../settings/js/volc-user-config');

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

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

/**
 * 用户确认后执行的 shell 命令（仅限 git / cd / mkdir 等）。
 * @param {string} defaultCwd
 * @param {string} command
 */
async function runShellCommand(defaultCwd, command) {
  const cmd = String(command || '').trim();
  if (!cmd) throw new Error('命令为空');
  const allowed =
    /^(cd|git|mkdir|export|rm|cp|mv)\b/i.test(cmd) ||
    /\s&&\s*(git|cd|mkdir)\b/i.test(cmd);
  if (!allowed) throw new Error('暂不支持该类型命令，仅允许 git / cd / mkdir 等');
  const cwd = defaultCwd || process.cwd();
  const { stdout, stderr } = await execAsync(cmd, {
    cwd,
    shell: true,
    maxBuffer: 10 * 1024 * 1024,
    encoding: 'utf8',
  });
  return { stdout: (stdout || '').trim(), stderr: (stderr || '').trim() };
}

async function getRemoteOriginUrl(cwd) {
  try {
    const { stdout } = await runGit(cwd, ['remote', 'get-url', 'origin']);
    return stdout.trim();
  } catch {
    return '';
  }
}

/** @param {string} remoteUrl @param {string} hash */
function buildRemoteCommitLink(remoteUrl, hash) {
  if (!remoteUrl || !hash) return '';
  const scp = remoteUrl.trim().match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (scp) {
    const path = scp[2].replace(/\.git$/, '');
    return `https://${scp[1]}/${path}/commit/${hash}`;
  }
  const base = remoteUrl.trim().replace(/\.git$/, '');
  if (/^https?:\/\//i.test(base)) return `${base}/commit/${hash}`;
  return '';
}

async function checkoutNewBranch(cwd, branchName) {
  const name = String(branchName || '').trim();
  if (!name) throw new Error('分支名不能为空');
  return runGit(cwd, ['checkout', '-b', name]);
}

async function checkoutCommit(cwd, hash) {
  return runGit(cwd, ['checkout', hash]);
}

async function createBranchAt(cwd, branchName, hash) {
  const name = String(branchName || '').trim();
  if (!name) throw new Error('分支名不能为空');
  return runGit(cwd, ['branch', name, hash]);
}

async function cherryPickCommit(cwd, hash) {
  return runGit(cwd, ['cherry-pick', hash]);
}

async function resetToCommit(cwd, hash, mode) {
  const m = mode === 'soft' || mode === 'hard' ? mode : 'mixed';
  return runGit(cwd, ['reset', `--${m}`, hash]);
}

async function revertCommit(cwd, hash) {
  return runGit(cwd, ['revert', '--no-edit', hash]);
}

async function formatPatchForCommit(cwd, hash) {
  return runGit(cwd, ['format-patch', '-1', hash, '--stdout'], { maxBuffer: 50 * 1024 * 1024 });
}

async function createTagAt(cwd, hash, tagName, annotated, message) {
  const name = String(tagName || '').trim();
  if (!name) throw new Error('标签名不能为空');
  if (annotated) {
    const msg = String(message || name).trim() || name;
    return runGit(cwd, ['tag', '-a', name, hash, '-m', msg]);
  }
  return runGit(cwd, ['tag', name, hash]);
}

/**
 * @param {string} cwd
 * @param {{ action: string, hash: string, branchName?: string, resetMode?: string, tagName?: string, tagMessage?: string }} payload
 */
async function runNodeAction(cwd, payload) {
  if (payload?.action === 'checkout-new-branch') {
    return checkoutNewBranch(cwd, payload.branchName);
  }
  const hash = String(payload?.hash || '').trim();
  if (!hash) throw new Error('缺少 commit hash');
  switch (payload.action) {
    case 'checkout':
      return checkoutCommit(cwd, hash);
    case 'branch':
      return createBranchAt(cwd, payload.branchName, hash);
    case 'cherry-pick':
      return cherryPickCommit(cwd, hash);
    case 'reset':
      return resetToCommit(cwd, hash, payload.resetMode);
    case 'revert':
      return revertCommit(cwd, hash);
    case 'format-patch':
      return formatPatchForCommit(cwd, hash);
    case 'tag':
      return createTagAt(cwd, hash, payload.tagName, false);
    case 'tag-annotated':
      return createTagAt(cwd, hash, payload.tagName, true, payload.tagMessage);
    default:
      throw new Error(`未知 Git 操作：${payload.action}`);
  }
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
  const [branch, status, graphData, remoteOriginUrl] = await Promise.all([
    getCurrentBranch(cwd),
    getStatus(cwd),
    getGraphData(cwd),
    getRemoteOriginUrl(cwd),
  ]);
  return {
    ok: true,
    isRepo: true,
    projectRoot: cwd,
    branch,
    status,
    graphData,
    remoteOriginUrl,
  };
}

module.exports = {
  runGit,
  isGitRepo,
  getCurrentBranch,
  getStatus,
  getGraphData,
  getRepoState,
  getRemoteOriginUrl,
  buildRemoteCommitLink,
  runNodeAction,
  pull,
  push,
  commitAll,
  runShellCommand,
};
