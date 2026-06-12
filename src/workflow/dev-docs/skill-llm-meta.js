/**
 * @file skill-llm-meta.js
 * markdown 路径：检查 data frontmatter → LLM 补缺失字段 → 本地兜底
 */
const { collectPlainChat } = require('../../llm-server');
const { resolveVolcCredentials, MISSING_KEY_ERROR } = require('../../settings/js/volc-user-config');
const {
  contentForSummaryInference,
  appendSkillLayerDescHint,
  extractMetaFromMarkdownData,
  extractTitleFromMarkdown,
  inferTitleFromSummary,
  stripSkillFrontmatter,
  isGenericSkillTitle,
  MAX_DESC_LEN,
} = require('./skill-summary');
const { stripMarkdownToPlain } = require('../../markdown/read-markdown');

const MAX_LLM_ARTICLE_CHARS = 14000;
const MAX_IMPORT_NAME_LEN = 48;

const IMPORT_SYSTEM_PROMPT = `你是技术文档分析助手。用户会提供一篇完整文章，你需要阅读全文后输出 JSON（仅 JSON，不要 markdown 代码块、不要其它说明）。

字段：
- name：简短展示名称（与文章主要语言一致，4～48 字/字符，是主题名而非完整句子）
- description：整篇文章的综合摘要（2～5 句，覆盖文档目的、核心要点与适用范围；与文章主要语言一致；不要写 Layer 分层读取相关说明）

示例格式：
{"name":"OpenGL 插件开发","description":"本文介绍……"}`;

const MARKDOWN_FILL_SYSTEM_PROMPT = `你是 skill 元数据分析助手。用户会提供 Markdown 文档与已有元数据。

任务：仅为「缺失」的字段生成内容，输出 JSON（仅 JSON）：
- name：展示名称（4～48 字/字符，主题名而非完整句子）
- description：整篇综合摘要（2～5 句；不要写 Layer 分层读取相关说明）

若某字段已有有效值，请在 JSON 中原样返回该值；仅对标注为「缺失」的字段新生成。`;

function tryParseJsonObject(text) {
  if (!text || typeof text !== 'string') return null;
  const s = text.trim();
  try {
    const o = JSON.parse(s);
    return typeof o === 'object' && o !== null && !Array.isArray(o) ? o : null;
  } catch (_) {}
  const block = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (block) {
    try {
      const o = JSON.parse(block[1].trim());
      return typeof o === 'object' && o !== null && !Array.isArray(o) ? o : null;
    } catch (_) {}
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const o = JSON.parse(s.slice(start, end + 1));
      return typeof o === 'object' && o !== null && !Array.isArray(o) ? o : null;
    } catch (_) {}
  }
  return null;
}

function prepareArticleForLlm(markdown) {
  const raw = String(markdown || '').trim();
  const body = contentForSummaryInference(markdown);
  const text = body.trim() || raw;
  return text.slice(0, MAX_LLM_ARTICLE_CHARS);
}

function parseLlmMetaResponse(content, opts = {}) {
  const parsed = tryParseJsonObject(content);
  if (!parsed) return { ok: false, error: 'LLM 返回格式无效，请重试' };

  const name = String(parsed.name || parsed.title || '')
    .trim()
    .slice(0, MAX_IMPORT_NAME_LEN);
  const description = String(parsed.description || parsed.summary || '')
    .trim()
    .slice(0, MAX_DESC_LEN - 120);

  if (opts.partial) {
    if (opts.needName && !name) {
      return { ok: false, error: 'LLM 未返回有效的 name' };
    }
    if (opts.needDesc && !description) {
      return { ok: false, error: 'LLM 未返回有效的 description' };
    }
    return {
      ok: true,
      name: opts.needName ? name : String(opts.fallbackName || name || '').trim(),
      description: opts.needDesc
        ? description
        : String(opts.fallbackDesc || description || '').trim(),
    };
  }

  if (!name || !description) {
    return { ok: false, error: 'LLM 未返回有效的 name 或 description' };
  }
  return { ok: true, name, description };
}

async function callLlmForMeta(systemPrompt, userContent, parseOpts = {}) {
  const { apiKey, model, apiMode, endpoint } = resolveVolcCredentials();
  if (!apiKey) return { ok: false, error: MISSING_KEY_ERROR };

  const out = await collectPlainChat({
    apiKey,
    model,
    apiMode,
    endpoint,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  });

  if (out.error) return { ok: false, error: out.error || 'LLM 分析失败' };
  return parseLlmMetaResponse(out.content, parseOpts);
}

/** 本地兜底：LLM 不可用时从正文推断缺失字段 */
function inferMissingMetaFromData(markdown, fromData, needName, needDesc) {
  const body = stripSkillFrontmatter(markdown);
  const raw = String(markdown || '').trim();

  let name = fromData.name;
  if (needName) {
    name =
      extractTitleFromMarkdown(body) ||
      inferTitleFromSummary(raw) ||
      extractTitleFromMarkdown(raw) ||
      '';
    name = String(name).trim().slice(0, MAX_IMPORT_NAME_LEN);
  }

  let description = fromData.description;
  if (needDesc) {
    const plain = stripMarkdownToPlain(contentForSummaryInference(raw) || body || raw).trim();
    description =
      plain.length >= 8
        ? plain.slice(0, MAX_DESC_LEN - 120)
        : `关于「${name || '该主题'}」的 skill 文档。`;
  }

  if (needName && (!name || isGenericSkillTitle(name))) {
    return { ok: false, error: '无法推断 name，请配置 LLM 或补充 frontmatter' };
  }
  if (needDesc && !String(description || '').trim()) {
    return { ok: false, error: '无法推断 description，请配置 LLM 或补充 frontmatter' };
  }

  return {
    ok: true,
    name: needName ? name : fromData.name,
    description: needDesc ? description : fromData.description,
    usedLlm: false,
    usedFallback: true,
  };
}

/** 其他模式：全文 LLM 分析 */
async function analyzeImportMetaWithLlm(markdown) {
  const article = prepareArticleForLlm(markdown);
  if (!article.trim()) return { ok: false, error: '正文为空，无法分析' };
  return callLlmForMeta(IMPORT_SYSTEM_PROMPT, `请分析以下全文并输出 JSON：\n\n${article}`);
}

/**
 * markdown 路径 step 1–2：
 *   1. 检查 data（frontmatter）是否含 name / description
 *   2. 缺哪个用 LLM 补哪个；LLM 失败时本地兜底
 */
async function ensureMarkdownModeMeta(markdown) {
  const fromData = extractMetaFromMarkdownData(markdown);
  const { name: existingName, description: existingDesc, hasName, hasDesc } = fromData;

  if (hasName && hasDesc) {
    return {
      ok: true,
      name: existingName,
      description: existingDesc,
      usedLlm: false,
    };
  }

  const needName = !hasName;
  const needDesc = !hasDesc;
  const article = prepareArticleForLlm(markdown);
  if (!article.trim()) {
    return inferMissingMetaFromData(markdown, fromData, needName, needDesc);
  }

  const missing = [];
  if (needName) missing.push('name');
  if (needDesc) missing.push('description');

  const userContent = [
    `请分析以下 Markdown，仅为缺失字段生成内容（已有字段请勿改写）。缺失：${missing.join('、')}`,
    '输出 JSON（仅 JSON），字段：name、description',
    '',
    article,
    '',
    'data frontmatter 中已有：',
    `name: ${hasName ? existingName : '（缺失）'}`,
    `description: ${hasDesc ? existingDesc : '（缺失）'}`,
  ].join('\n');

  const analyzed = await callLlmForMeta(MARKDOWN_FILL_SYSTEM_PROMPT, userContent, {
    partial: true,
    needName,
    needDesc,
    fallbackName: existingName,
    fallbackDesc: existingDesc,
  });

  if (analyzed.ok) {
    return {
      ok: true,
      name: hasName ? existingName : analyzed.name,
      description: hasDesc ? existingDesc : analyzed.description,
      usedLlm: true,
    };
  }

  const fallback = inferMissingMetaFromData(markdown, fromData, needName, needDesc);
  if (fallback.ok) return fallback;
  return analyzed;
}

function buildImportSkillDescription(llmDescription) {
  return appendSkillLayerDescHint(llmDescription);
}

module.exports = {
  analyzeImportMetaWithLlm,
  ensureMarkdownModeMeta,
  buildImportSkillDescription,
  inferMissingMetaFromData,
};
