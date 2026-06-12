/**
 * @file normalize-markdown.js
 * 【功能】将 Resources 原文规整为规范 Markdown（HTML → MD，纯文本结构化）
 */
const { htmlFragmentToMarkdown } = require('./html-markdown');

function looksLikeHtml(text) {
  return /<(?:html|body|div|p|br|h[1-6]|article|main|span|a)\b/i.test(String(text || ''));
}

function isStructuralLine(trimmed) {
  if (!trimmed) return true;
  if (/^#{1,6}\s/.test(trimmed)) return true;
  if (/^>\s/.test(trimmed)) return true;
  if (/^[-*+]\s/.test(trimmed)) return true;
  if (/^```/.test(trimmed)) return true;
  if (/^\d+[、.．)]\s*\S/.test(trimmed)) return true;
  return false;
}

function normalizeSectionHeadings(line) {
  const trimmed = String(line || '').trim();
  const m = trimmed.match(/^(\d+)[、.．)]\s*(.+)$/);
  if (m) return `## ${m[1]}、${m[2].trim()}`;
  return trimmed;
}

function extractCodeBlocks(lines) {
  /** @type {string[]} */
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (/^\s*\/\*/.test(raw)) {
      /** @type {string[]} */
      const block = [];
      while (i < lines.length) {
        block.push(String(lines[i]).replace(/^\s+/, ''));
        if (/\*\/\s*$/.test(String(lines[i]).trim())) {
          i += 1;
          break;
        }
        i += 1;
      }
      out.push('```', ...block, '```', '');
      continue;
    }
    if (trimmed.startsWith('`') && trimmed.endsWith('`') && trimmed.length > 2) {
      out.push(trimmed.slice(1, -1), '');
      i += 1;
      continue;
    }
    out.push(raw);
    i += 1;
  }
  return out;
}

function mergePlainParagraphs(lines) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  let buf = [];
  let inFence = false;

  function flush() {
    if (!buf.length) return;
    out.push(buf.join(' ').replace(/\s+/g, ' ').trim(), '');
    buf = [];
  }

  for (const raw of lines) {
    const trimmed = raw.trim();

    if (/^```/.test(trimmed)) {
      flush();
      inFence = !inFence;
      out.push(trimmed);
      if (!inFence) out.push('');
      continue;
    }

    if (inFence) {
      out.push(raw);
      continue;
    }

    if (!trimmed) {
      flush();
      continue;
    }
    if (isStructuralLine(trimmed)) {
      flush();
      out.push(normalizeSectionHeadings(raw), '');
      continue;
    }
    buf.push(trimmed);
  }
  flush();
  return out;
}

function dropDuplicateTitleLine(lines) {
  let docTitle = '';
  for (const line of lines) {
    const m = String(line || '').trim().match(/^#\s+(.+)$/);
    if (m) {
      docTitle = m[1].trim();
      break;
    }
  }
  if (!docTitle) return lines;

  let seenH1 = false;
  return lines.filter((line) => {
    const trimmed = String(line || '').trim();
    if (/^#\s+/.test(trimmed)) {
      seenH1 = true;
      return true;
    }
    if (seenH1 && trimmed === docTitle) return false;
    return true;
  });
}

/**
 * @param {string} input
 * @returns {string}
 */
function normalizeResourcesMarkdown(input) {
  let s = String(input || '').trim();
  if (!s) return '';

  if (looksLikeHtml(s)) {
    s = htmlFragmentToMarkdown(s);
  }

  let lines = s.split('\n');
  lines = dropDuplicateTitleLine(lines);
  lines = extractCodeBlocks(lines);
  lines = mergePlainParagraphs(lines);

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = {
  normalizeResourcesMarkdown,
  looksLikeHtml,
};
