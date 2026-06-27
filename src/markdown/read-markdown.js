/**
 * @file read-markdown.js
 * 【功能】解析 Markdown 文本（frontmatter、纯文本、标题树）
 */

const FENCE_RE = /^(`{3,}|~{3,})/;

/**
 * @param {string} markdown
 * @returns {{ frontmatter: string, body: string, hasFrontmatter: boolean }}
 */
function splitFrontmatter(markdown) {
  const s = String(markdown || '');
  const m = s.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) {
    return { frontmatter: '', body: s.trim(), hasFrontmatter: false };
  }
  return {
    frontmatter: m[1].trim(),
    body: s.slice(m[0].length).trim(),
    hasFrontmatter: true,
  };
}

/**
 * 去掉 Markdown 标记，得到纯文本（摘要/搜索用）
 * @param {string} md
 */
function stripMarkdownToPlain(md) {
  return String(md || '')
    .replace(/^---[\s\S]*?---\n?/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim(); 
}

/**
 * 按 heading 建树（跳过 fenced code block 内的 # 行）
 * @param {string} markdown
 * @returns {Array<{ level: number, title: string, content: string, children: Array<object> }>}
 */
function parseHeadingTree(markdown) {
  const { body } = splitFrontmatter(markdown);
  const lines = String(body || '').split('\n');
  /** @type {Array<{ level: number, title: string, lines: string[] }>} */
  const nodes = [];
  let inFence = false;
  let fenceMark = '';

  for (const line of lines) {
    const fence = line.match(FENCE_RE);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMark = fence[1];
      } else if (line.startsWith(fenceMark)) {
        inFence = false;
        fenceMark = '';
      }
      if (nodes.length) nodes[nodes.length - 1].lines.push(line);
      continue;
    }

    const hm = !inFence && line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (hm) {
      nodes.push({
        level: hm[1].length,
        title: hm[2].trim(),
        lines: [],
      });
      continue;
    }

    if (nodes.length) nodes[nodes.length - 1].lines.push(line);
    else if (line.trim()) {
      nodes.push({ level: 1, title: '', lines: [line] });
    }
  }

  /** @type {Array<{ level: number, title: string, content: string, children: Array<object> }>} */
  const roots = [];
  /** @type {Array<{ level: number, title: string, content: string, children: Array<object> }>} */
  const stack = [];

  for (const node of nodes) {
    const item = {
      level: node.level,
      title: node.title,
      content: node.lines.join('\n').trim(),
      children: [],
    };
    while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop();
    if (!stack.length) roots.push(item);
    else stack[stack.length - 1].children.push(item);
    stack.push(item);
  }

  return roots;
}

/**
 * @param {string} markdown
 * @param {string} headingTitle 不区分大小写，如 Instructions / Resources
 * @returns {string}
 */
function getSectionContent(markdown, headingTitle) {
  const key = String(headingTitle || '').trim().toLowerCase();
  if (!key) return '';

  function walk(nodes) {
    for (const n of nodes) {
      if (String(n.title || '').trim().toLowerCase() === key) {
        return String(n.content || '').trim();
      }
      const nested = walk(n.children);
      if (nested) return nested;
    }
    return '';
  }

  return walk(parseHeadingTree(markdown));
}

module.exports = {
  splitFrontmatter,
  stripMarkdownToPlain,
  parseHeadingTree,
  getSectionContent,
};
