/**
 * @file project-context.js
 * @module mcp-filesystem
 *
 * 【功能】为对话拼 AI 工程上下文（directory_tree + 关键文件 + 用户 @ 引用）。
 * 【调用方】pecado/js/agent/router.js → buildProjectContextForAi
 */
const fs = require('fs');
const path = require('path');
const projectIo = require('./index');
const { formatMcpTreeAscii } = require('../shared/format-tree');
const { extractRequestedPaths } = require('../xcode/paths');

const MCP_CONTEXT_MAX_TOTAL = 55000;
const MCP_CONTEXT_MAX_PER_FILE = 10000;
const MCP_KEY_FILES = [
  'package.json',
  'README.md',
  'CLAUDE.md',
  'src/main/js/main.js',
  'src/pecado/js/index.js',
];

/** @type {{ root: string, treeAscii: string }} */
let cache = { root: '', treeAscii: '' };

async function ensureProjectCached() {
  const status = projectIo.getStatus();
  if (!status.connected || !status.projectRoot) return;
  if (cache.root === status.projectRoot && cache.treeAscii) return;
  const tree = await projectIo.readDirectoryTree({});
  cache.root = status.projectRoot;
  cache.treeAscii = formatMcpTreeAscii(tree, 400);
}

async function warmProjectTreeCache() {
  await ensureProjectCached();
}

function getCachedTreeAscii() {
  return cache.treeAscii || '';
}

function clearProjectCache() {
  cache = { root: '', treeAscii: '' };
}

const AT_MENTION_MAX = 12000;
const AT_MENTION_MAX_FILE = 4000;

/** Agent 模式下注入用户 @ 的绝对路径摘要（工程外 skill 目录等） */
async function buildAtMentionContextForAi(userText) {
  const absPaths = [...extractRequestedPaths(userText)].filter((p) => path.isAbsolute(p));
  if (!absPaths.length) return '';

  const lines = ['【用户 @ 引用路径】'];
  let budget = AT_MENTION_MAX;

  for (const p of absPaths) {
    if (budget <= 500) break;
    try {
      if (!fs.existsSync(p)) {
        lines.push(`- ${p}（路径不存在）`);
        continue;
      }
      const stat = fs.statSync(p);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(p).slice(0, 48);
        const listing = entries.join('\n');
        lines.push('', `### 目录 ${p}`, '```', listing, '```');
        budget -= listing.length + p.length;
        for (const name of ['SKILL.md', 'README.md', 'CLAUDE.md']) {
          const rp = path.join(p, name);
          if (!fs.existsSync(rp) || !fs.statSync(rp).isFile()) continue;
          let body = fs.readFileSync(rp, 'utf8');
          const cap = Math.min(AT_MENTION_MAX_FILE, budget);
          if (body.length > cap) body = `${body.slice(0, cap)}\n…(已截断)`;
          lines.push('', `### ${name}`, '```markdown', body, '```');
          budget -= body.length;
          break;
        }
        continue;
      }
      let body = fs.readFileSync(p, 'utf8');
      const cap = Math.min(AT_MENTION_MAX_FILE, budget);
      if (body.length > cap) body = `${body.slice(0, cap)}\n…(已截断)`;
      lines.push('', `### 文件 ${p}`, '```', body, '```');
      budget -= body.length;
    } catch (e) {
      lines.push(`- ${p}（读取失败: ${e.message || String(e)}）`);
    }
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

function buildProjectAnchorLines() {
  if (!cache.root) return [];
  const lines = [
    '【工程锚点】',
    `工程根目录: ${cache.root}`,
    'MCP 工具 path：用 "." 表示工程根；或用相对路径（如 src/foo.swift）。勿编造不存在的绝对路径。',
  ];
  if (cache.treeAscii) {
    lines.push('', '【目录结构（本地缓存）】', cache.treeAscii);
  }
  return lines;
}

/**
 * @param {string} userText
 * @param {{ agentAnchorOnly?: boolean }} [opts]
 */
async function buildProjectContextForAi(userText, opts = {}) {
  await ensureProjectCached();
  if (!cache.root) return '';
  if (opts.agentAnchorOnly) return buildProjectAnchorLines().join('\n');

  const lines = [
    '【工程上下文】',
    `工程根目录: ${cache.root}`,
    '',
    '【目录结构】',
    cache.treeAscii || '(无)',
  ];

  const toRead = new Set(MCP_KEY_FILES);
  extractRequestedPaths(userText).forEach((p) => {
    if (!path.isAbsolute(p)) toRead.add(p);
  });

  let budget = MCP_CONTEXT_MAX_TOTAL - lines.join('\n').length;

  const atBlock = await buildAtMentionContextForAi(userText);
  if (atBlock.trim()) {
    lines.push('', atBlock.trim());
    budget -= atBlock.length;
  }

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
  buildProjectContextForAi,
  buildAtMentionContextForAi,
  clearProjectCache,
  warmProjectTreeCache,
  getCachedTreeAscii,
};
