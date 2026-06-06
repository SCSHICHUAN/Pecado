/**
 * @file log-parser.js
 *
 * 【功能】将 git log --pretty 输出转为 @gitgraph/js import() 所需的 git2json 结构。
 */

/**
 * @param {string} decorate git log %D 字段
 * @returns {string[]}
 */
function parseRefs(decorate) {
  if (!decorate || !String(decorate).trim()) return [];
  return String(decorate)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const head = part.match(/^HEAD\s*->\s*(.+)$/);
      if (head) return head[1].trim();
      const tag = part.match(/^tag:\s*(.+)$/);
      if (tag) return `tag: ${tag[1].trim()}`;
      return part;
    });
}

/**
 * @param {string} logOutput tab 分隔的 git log 行
 * @returns {object[]}
 */
function buildGit2Json(logOutput) {
  const lines = String(logOutput || '')
    .trim()
    .split('\n')
    .filter(Boolean);
  return lines.map((line) => {
    const parts = line.split('\t');
    const [hash, parents, subject, authorName, authorEmail, decorate] = parts;
    const name = authorName || 'unknown';
    const email = authorEmail || '';
    return {
      hash: hash || '',
      author: { name, email },
      committer: { name, email },
      subject: subject || '',
      body: '',
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      refs: parseRefs(decorate),
    };
  });
}

module.exports = { parseRefs, buildGit2Json };
