/**
 * @file project-context.js
 *
 * 【功能】为 router 提供工程上下文与 Xcode 流式目标识别（主进程读文件，不经 renderer）。
 *   - ensureProjectCached：readDirectoryTree + formatMcpTreeAscii 缓存到 memory（按 projectRoot 失效）
 *   - buildProjectContextForAi：拼【目录结构】+ MCP_KEY_FILES（package.json 等）+ 用户 @path / `file.ext` 引用
 *   - 总字符预算 MCP_CONTEXT_MAX_TOTAL≈55k，单文件 MCP_CONTEXT_MAX_PER_FILE≈10k，超出截断
 *   - pickXcodeStreamTarget：从 @path 中找 .swift/.m/.h 等作为 SSE 流式写目标
 *   - extractRequestedPaths：@foo 与反引号路径正则
 *
 * 【调用方】agent/router.js → selectChatMode
 *
 * 【对外能力】
 *   buildProjectContextForAi(userText) → contextBlock string（空则 context 模式降级 plain）
 *   pickXcodeStreamTarget(userText) → relPath | null
 *   extractRequestedPaths(userText) / clearProjectCache()
 */
const projectIo = require('./index');
const { formatMcpTreeAscii } = require('../../shared/format-tree');

const MCP_CONTEXT_MAX_TOTAL = 55000;
const MCP_CONTEXT_MAX_PER_FILE = 10000;
const MCP_KEY_FILES = ['package.json', 'README.md', 'CLAUDE.md', 'src/main/main.js'];

/** @type {{ root: string, treeAscii: string }} */
let cache = { root: '', treeAscii: '' };

/** 从用户输入提取 @path 或 `path.ext` */
function extractRequestedPaths(userText) {
  const paths = new Set();
  const s = String(userText || '');
  for (const m of s.matchAll(/@([^\s@,，。；;]+)/g)) {
    paths.add(m[1].replace(/^\/+/, ''));
  }
  for (const m of s.matchAll(/`([^`\n]+\.[a-zA-Z0-9]+)`/g)) {
    const p = m[1].trim();
    if (p && !/\s/.test(p)) paths.add(p.replace(/^\/+/, ''));
  }
  return paths;
}

/** 从用户输入提取 Xcode 流式写入目标 */
function pickXcodeStreamTarget(userText) {
  const codeExt = /\.(swift|m|mm|h|hpp|c|cpp|cc)$/i;
  for (const p of extractRequestedPaths(userText)) {
    if (codeExt.test(p)) return p;
  }
  return null;
}

async function ensureProjectCached() {
  const status = projectIo.getStatus();
  if (!status.connected || !status.projectRoot) return;
  if (cache.root === status.projectRoot && cache.treeAscii) return;
  const tree = await projectIo.readDirectoryTree({});
  cache.root = status.projectRoot;
  cache.treeAscii = formatMcpTreeAscii(tree, 400);
}

function clearProjectCache() {
  cache = { root: '', treeAscii: '' };
}

/** @param {string} userText */
async function buildProjectContextForAi(userText) {
  await ensureProjectCached();
  if (!cache.root) return '';

  const lines = [
    '【本地工程上下文】来自本机 MCP filesystem（directory_tree + read_text_file），请结合以下内容理解并回答代码问题。',
    `工程根目录: ${cache.root}`,
    '',
    '【目录结构】',
    cache.treeAscii || '(无)',
  ];

  const toRead = new Set(MCP_KEY_FILES);
  extractRequestedPaths(userText).forEach((p) => toRead.add(p));

  let budget = MCP_CONTEXT_MAX_TOTAL - lines.join('\n').length;
  for (const rel of toRead) {
    if (budget <= 500) break;
    try {
      const bodyRaw = await projectIo.readText(rel);
      let body = bodyRaw;
      const cap = Math.min(MCP_CONTEXT_MAX_PER_FILE, budget);
      if (body.length > cap) body = `${body.slice(0, cap)}\n…(文件已截断)`;
      lines.push('', `【文件: ${rel}】`, '```', body, '```');
      budget -= body.length + rel.length + 40;
    } catch (_) {
      /* 文件不存在或读失败则跳过 */
    }
  }
  return lines.join('\n');
}

module.exports = {
  extractRequestedPaths,
  pickXcodeStreamTarget,
  buildProjectContextForAi,
  clearProjectCache,
};
