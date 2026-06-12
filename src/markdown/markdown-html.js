/**
 * @file markdown-html.js
 * 【功能】Markdown → HTML（markdown-it + highlight.js）
 */
const MarkdownIt = require('markdown-it');
const hljs = require('highlight.js/lib/core');

hljs.registerLanguage('cpp', require('highlight.js/lib/languages/cpp'));

/** @type {import('markdown-it') | null} */
let renderer = null;

function getMarkdownRenderer() {
  if (renderer) return renderer;
  const md = new MarkdownIt({ html: false, linkify: false, breaks: true });
  md.options.highlight = (str, lang) => {
    const raw = (lang || '').trim().toLowerCase();
    const useLang = raw && hljs.getLanguage(raw) ? raw : 'cpp';
    try {
      return hljs.highlight(str, { language: useLang, ignoreIllegals: true }).value;
    } catch (_) {
      try {
        return hljs.highlight(str, { language: 'cpp', ignoreIllegals: true }).value;
      } catch (__) {
        return md.utils.escapeHtml(str);
      }
    }
  };
  renderer = md;
  return renderer;
}

/**
 * @param {string} src
 * @returns {string}
 */
function markdownToHtml(src) {
  return getMarkdownRenderer().render(String(src ?? ''));
}

module.exports = {
  markdownToHtml,
  getMarkdownRenderer,
};
