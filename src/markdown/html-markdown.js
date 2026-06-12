/**
 * @file html-markdown.js
 * 【功能】轻量 HTML → Markdown（无第三方依赖）
 */
function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripTags(html) {
  return decodeEntities(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractTitle(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m) return stripTags(m[1]);
  const h1 = String(html || '').match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return stripTags(h1[1]);
  return '';
}

/** @param {string} html */
function pickMainHtml(html) {
  const s = String(html || '');
  const selectors = [
    /<div[^>]*class="[^"]*\bedit\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/body>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
  ];
  for (const re of selectors) {
    const m = s.match(re);
    if (m && stripTags(m[1]).length > 80) return m[1];
  }
  const body = s.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return body ? body[1] : s;
}

function inlineToMd(html) {
  let s = String(html || '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const label = stripTags(text) || href;
    return `[${label}](${href})`;
  });
  s = s.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**');
  s = s.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*');
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => `\`${stripTags(c)}\``);
  s = s.replace(/<[^>]+>/g, '');
  return decodeEntities(s).replace(/\s+\n/g, '\n').trim();
}

/** @param {string} htmlFragment */
function htmlFragmentToMarkdown(htmlFragment) {
  let src = String(htmlFragment || '');
  src = src.replace(/<script[\s\S]*?<\/script>/gi, '');
  src = src.replace(/<style[\s\S]*?<\/style>/gi, '');

  const blocks = [];
  const preRe = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
  let last = 0;
  let m;
  while ((m = preRe.exec(src))) {
    if (m.index > last) blocks.push({ type: 'html', body: src.slice(last, m.index) });
    const code = m[1].replace(/<code[^>]*>([\s\S]*?)<\/code>/i, '$1');
    blocks.push({ type: 'pre', body: stripTags(code) || stripTags(m[1]) });
    last = preRe.lastIndex;
  }
  if (last < src.length) blocks.push({ type: 'html', body: src.slice(last) });

  const lines = [];
  for (const block of blocks) {
    if (block.type === 'pre') {
      lines.push('', '```', block.body, '```', '');
      continue;
    }
    let chunk = block.body;
    chunk = chunk.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, inner) => {
      const n = Math.min(6, Math.max(1, parseInt(level, 10) || 2));
      return `\n${'#'.repeat(n)} ${stripTags(inner)}\n\n`;
    });
    chunk = chunk.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `\n- ${inlineToMd(inner)}\n`);
    chunk = chunk.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, inner) => `\n${inlineToMd(inner)}\n\n`);
    chunk = chunk.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, (_, inner) => {
      const t = inlineToMd(inner);
      return t ? `\n${t}\n\n` : '';
    });
    const rest = inlineToMd(chunk);
    if (rest) lines.push(rest, '');
  }

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * @param {string} html
 * @param {{ sourceUrl?: string }} [opts]
 */
function htmlToMarkdown(html, opts = {}) {
  const title = extractTitle(html);
  const main = pickMainHtml(html);
  let md = htmlFragmentToMarkdown(main);
  if (opts.sourceUrl) {
    md = `> 原文：[${opts.sourceUrl}](${opts.sourceUrl})\n\n${md}`;
  }
  if (title && !md.startsWith('#')) {
    md = `# ${title}\n\n${md}`;
  }
  return { title: title || '未命名文档', markdown: md.trim() };
}

module.exports = {
  htmlToMarkdown,
  extractTitle,
  stripTags,
  htmlFragmentToMarkdown,
};
