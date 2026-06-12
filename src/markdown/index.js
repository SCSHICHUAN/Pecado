/**
 * @file index.js
 * 【功能】Markdown 读写与转换统一入口
 */
const { htmlToMarkdown, extractTitle, stripTags, htmlFragmentToMarkdown } = require('./html-markdown');
const { markdownToHtml, getMarkdownRenderer } = require('./markdown-html');
const {
  readMarkdownFile,
  splitFrontmatter,
  stripMarkdownToPlain,
  parseHeadingTree,
  getSectionContent,
} = require('./read-markdown');
const { normalizeResourcesMarkdown, looksLikeHtml } = require('./normalize-markdown');
const {
  LAYER_SECTION_HEADING,
  LAYER_READ_HINT,
  buildLayerTreeObject,
  buildMarkdownLayerTree,
  stripLayerSection,
  readSkillSectionByPath,
  extractH2SectionBody,
} = require('./skill-layer');

module.exports = {
  htmlToMarkdown,
  extractTitle,
  stripTags,
  htmlFragmentToMarkdown,
  markdownToHtml,
  getMarkdownRenderer,
  readMarkdownFile,
  splitFrontmatter,
  stripMarkdownToPlain,
  parseHeadingTree,
  getSectionContent,
  normalizeResourcesMarkdown,
  looksLikeHtml,
  LAYER_SECTION_HEADING,
  LAYER_READ_HINT,
  buildLayerTreeObject,
  buildMarkdownLayerTree,
  stripLayerSection,
  readSkillSectionByPath,
  extractH2SectionBody,
};
