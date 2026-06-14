/**
 * @file ppt.js
 * 【功能】Workflow「写 PPT」：生成 Markdown 大纲
 * 【功能】根据主题生成 PPT 大纲（Markdown），可写入工程目录
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_SLIDE_COUNT = 8;

/**
 * @param {{ title: string, topic?: string, slideCount?: number, audience?: string }} input
 */
function buildOutlineMarkdown(input) {
  const title = String(input.title || '演示文稿').trim() || '演示文稿';
  const topic = String(input.topic || title).trim();
  const audience = String(input.audience || '通用听众').trim();
  let count = parseInt(String(input.slideCount || DEFAULT_SLIDE_COUNT), 10);
  if (!Number.isFinite(count) || count < 3) count = DEFAULT_SLIDE_COUNT;
  if (count > 30) count = 30;

  const sections = [
    { heading: '封面', bullets: [title, topic, `面向：${audience}`] },
    { heading: '目录', bullets: ['背景与目标', '核心内容', '案例或数据', '总结与行动'] },
    { heading: '背景与问题', bullets: ['当前现状', '主要痛点', '为什么要现在解决'] },
    { heading: '目标与价值', bullets: ['希望达成的结果', '对听众的价值', '成功标准'] },
    { heading: '方案概览', bullets: ['整体思路', '关键步骤', '所需资源'] },
    { heading: '详细展开', bullets: ['要点一：说明与示例', '要点二：说明与示例', '要点三：说明与示例'] },
    { heading: '案例 / 数据', bullets: ['真实案例或实验结果', '对比与收益', '风险与应对'] },
    { heading: '实施计划', bullets: ['阶段划分', '时间节点', '负责人'] },
    { heading: '总结', bullets: ['回顾核心信息', '下一步行动', 'Q&A'] },
  ];

  const picked = sections.slice(0, count);
  const lines = [`# ${title}`, '', `> 主题：${topic}`, '', '---', ''];

  picked.forEach((slide, i) => {
    lines.push(`## 第 ${i + 1} 页 · ${slide.heading}`, '');
    slide.bullets.forEach((b) => lines.push(`- ${b}`));
    lines.push('', '---', '');
  });

  lines.push('', '_由 Pecado Workflow 生成，可导入 Keynote / PowerPoint 或交给 Pecado 扩写每页内容。_');
  return lines.join('\n');
}

/**
 * @param {string} projectRoot
 * @param {{ title: string, topic?: string, slideCount?: number, audience?: string, fileName?: string }} input
 */
function writeOutlineToProject(projectRoot, input) {
  if (!projectRoot) {
    return { ok: false, error: '请先 File → Open Folder 打开工程目录' };
  }
  const root = path.resolve(projectRoot);
  if (!fs.existsSync(root)) {
    return { ok: false, error: '工程目录不存在' };
  }

  const title = String(input.title || '演示文稿').trim() || '演示文稿';
  const safeName =
    String(input.fileName || '')
      .trim()
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') ||
    `${title.replace(/[/\\?%*:|"<>]/g, '-').slice(0, 40)}-outline`;

  const outDir = path.join(root, 'workflow-output', 'ppt');
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `${safeName}.md`);
  const content = buildOutlineMarkdown(input);
  fs.writeFileSync(filePath, content, 'utf8');

  return {
    ok: true,
    path: filePath,
    relPath: path.relative(root, filePath),
    content,
  };
}

module.exports = { buildOutlineMarkdown, writeOutlineToProject };
