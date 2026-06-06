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
      if (/^tag:/i.test(part)) return null;
      return part;
    })
    .filter(Boolean);
}

/**
 * @param {string} name git author 名
 * @returns {string} 首字母大写，用于 commit 圆点内展示
 */
function authorInitial(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '?';
  return trimmed.charAt(0).toUpperCase();
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
    const hash = parts[0] || '';
    const parents = parts[1] || '';
    const subject = parts[2] || '';
    const authorName = parts[3] || '';
    const authorEmail = parts[4] || '';
    let date = '';
    let decorate = '';
    if (parts.length >= 7) {
      date = parts[5] || '';
      decorate = parts[6] || '';
    } else {
      decorate = parts[5] || '';
    }
    const name = authorName || 'unknown';
    const email = authorEmail || '';
    return {
      hash,
      author: { name, email },
      committer: { name, email },
      subject,
      date,
      body: '',
      dotText: authorInitial(name),
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      refs: parseRefs(decorate),
    };
  });
}

module.exports = { parseRefs, buildGit2Json, authorInitial };
