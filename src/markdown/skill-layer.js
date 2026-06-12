/**
 * @file skill-layer.js
 * 【功能】Skill Layer 分层树：生成、解析、按 path 读取
 */
const {
  splitFrontmatter,
  parseHeadingTree,
  getSectionContent,
} = require('./read-markdown');

const LAYER_SECTION_HEADING = '## Layer';
const LAYER_HEADING_RE = /^## Layer\s*$/m;
const LAYER_READ_HINT =
  'Skill markdown-layer-tree: use read_skill_layer and read_skill_section to load only what you need.';

function slugPathSegment(title) {
  let s = String(title || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  if (!s) s = 'section';
  return s.slice(0, 48);
}

/** 无标题节点用正文首行作为 Layer 树 label / path */
function resolveHeadingNodeTitle(node) {
  const title = String(node?.title || '').trim();
  if (title) return title;
  const content = String(node?.content || '').trim();
  if (!content) return 'untitled';
  const firstLine = content.split('\n').find((line) => line.trim()) || content;
  const plain = firstLine.replace(/^#+\s+/, '').replace(/\s+/g, ' ').trim();
  return plain.slice(0, 48) || 'untitled';
}

/**
 * 提取 ## Title 到下一个 ## 同级标题之间的正文
 * @param {string} md
 * @param {string} sectionTitle
 * @param {string[]} [stopTitles]
 */
function extractH2SectionBody(md, sectionTitle, stopTitles = ['Layer']) {
  const s = String(md || '');
  const startRe = new RegExp(`^## ${sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'im');
  const start = startRe.exec(s);
  if (!start) return '';
  let rest = s.slice(start.index + start[0].length);
  let endIdx = rest.length;
  for (const t of stopTitles) {
    const re = new RegExp(`^## ${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'im');
    const m = re.exec(rest);
    if (m && m.index < endIdx) endIdx = m.index;
  }
  return rest.slice(0, endIdx).trim();
}

function layerNodesFromHeadingTree(nodes, pathPrefix) {
  return (nodes || []).map((n) => {
    const title = resolveHeadingNodeTitle(n);
    const seg = slugPathSegment(title);
    const path = pathPrefix ? `${pathPrefix}/${seg}` : seg;
    const item = {
      path,
      label: title,
      level: n.level,
    };
    if (!String(n.title || '').trim() && String(n.content || '').trim()) {
      item.kind = 'content';
    }
    if (n.children?.length) item.children = layerNodesFromHeadingTree(n.children, path);
    return item;
  });
}

function parseNameFromFrontmatter(frontmatter) {
  const m = String(frontmatter || '').match(/^name:\s*(.+)$/m);
  if (!m) return '';
  return String(m[1]).trim().replace(/^["']|["']$/g, '');
}

function parseDescriptionFromFrontmatter(frontmatter) {
  const descMatch = String(frontmatter || '').match(
    /^description:\s*("([^"]*)"|'([^']*)'|(.+))$/m
  );
  return (descMatch?.[2] || descMatch?.[3] || descMatch?.[4] || '').trim();
}

function buildMetadataLayerNode(frontmatter, hasFrontmatter) {
  const node = {
    path: 'metadata',
    label: 'metadata',
    kind: 'frontmatter',
    available: hasFrontmatter,
  };
  if (!hasFrontmatter) return node;

  const name = parseNameFromFrontmatter(frontmatter);
  const description = parseDescriptionFromFrontmatter(frontmatter);
  const children = [];
  if (name) {
    children.push({ path: 'metadata/name', label: 'name', kind: 'field', value: name });
  }
  if (description) {
    children.push({
      path: 'metadata/description',
      label: 'description',
      kind: 'field',
      value: description,
    });
  }
  if (children.length) node.children = children;
  return node;
}

/**
 * @param {string} skillMd
 * @param {string} [skillNameHint]
 * @returns {object}
 */
function isStructuredSkillMarkdown(markdown) {
  const { body } = splitFrontmatter(markdown);
  return /^## Instructions\s*$/im.test(body);
}

/** 从 Markdown 原文（无 Instructions/Resources 结构）生成分层树 */
function buildLayerTreeFromMarkdown(markdown, skillNameHint) {
  const md = String(markdown || '');
  if (isStructuredSkillMarkdown(md)) {
    return buildLayerTreeObject(md, skillNameHint);
  }

  const { hasFrontmatter, frontmatter, body } = splitFrontmatter(md);
  const skillName = String(skillNameHint || parseNameFromFrontmatter(frontmatter) || '').trim();
  const contentTree = parseHeadingTree(body || md);

  return {
    version: 1,
    kind: 'markdown-layer-tree',
    skillName,
    hint: LAYER_READ_HINT,
    tools: {
      layer: 'read_skill_layer(skill_name)',
      section: 'read_skill_section(skill_name, path)',
    },
    nodes: [
      buildMetadataLayerNode(frontmatter, hasFrontmatter),
      {
        path: 'resources',
        label: 'resources',
        heading: 'Resources',
        children: layerNodesFromHeadingTree(contentTree, 'resources'),
      },
    ],
  };
}

function buildLayerTreeObject(skillMd, skillNameHint) {
  const { hasFrontmatter, frontmatter } = splitFrontmatter(skillMd);
  const skillName = String(skillNameHint || parseNameFromFrontmatter(frontmatter) || '').trim();
  const instructionsBody =
    getSectionContent(skillMd, 'Instructions') ||
    extractH2SectionBody(skillMd, 'Instructions', ['Resources', 'Layer', '原文']);
  const resourcesBody =
    extractH2SectionBody(skillMd, 'Resources', ['Layer']) ||
    extractH2SectionBody(skillMd, '原文', ['Layer']);
  const instructionsTree = parseHeadingTree(
    instructionsBody ? `## Instructions\n${instructionsBody}` : '## Instructions\n'
  );
  const resourcesTree = resourcesBody
    ? parseHeadingTree(resourcesBody)
    : [];
  const normalizedResourcesTree =
    resourcesBody.trim() && !resourcesTree.length
      ? [{ level: 1, title: '', content: resourcesBody.trim(), children: [] }]
      : resourcesTree;

  return {
    version: 1,
    kind: 'markdown-layer-tree',
    skillName,
    hint: LAYER_READ_HINT,
    tools: {
      layer: 'read_skill_layer(skill_name)',
      section: 'read_skill_section(skill_name, path)',
    },
    nodes: [
      buildMetadataLayerNode(frontmatter, hasFrontmatter),
      {
        path: 'instructions',
        label: 'instructions',
        heading: 'Instructions',
        children: layerNodesFromHeadingTree(
          instructionsTree.filter((n) => n.title && n.title.toLowerCase() !== 'instructions'),
          'instructions'
        ),
      },
      {
        path: 'resources',
        label: 'resources',
        heading: 'Resources',
        children: layerNodesFromHeadingTree(normalizedResourcesTree, 'resources'),
      },
    ],
  };
}

function stripLayerSection(markdown) {
  const s = String(markdown || '');
  const match = LAYER_HEADING_RE.exec(s);
  if (!match) return s.trim();
  return s.slice(0, match.index).trim();
}

function findHeadingNodeByPath(nodes, segments) {
  let list = nodes || [];
  let found = null;
  for (const seg of segments) {
    const key = seg.toLowerCase();
    found = list.find((n) => {
      const resolved = resolveHeadingNodeTitle(n);
      return slugPathSegment(resolved) === key || resolved.toLowerCase() === key;
    });
    if (!found) return null;
    list = found.children || [];
  }
  return found;
}

function collectSubtreeMarkdown(node) {
  if (!node) return '';
  const lines = [];
  if (node.title) lines.push(`${'#'.repeat(Math.min(6, node.level || 1))} ${node.title}`);
  if (node.content) lines.push(node.content);
  for (const c of node.children || []) {
    const part = collectSubtreeMarkdown(c);
    if (part) lines.push(part);
  }
  return lines.join('\n\n').trim();
}

/**
 * @param {string} skillMd
 * @param {string} path e.g. metadata | instructions | resources | resources/api
 */
function readSkillSectionByPath(skillMd, path) {
  const rawPath = String(path || '').trim();
  if (!rawPath) return { ok: false, error: '缺少 path' };

  const segments = rawPath.split('/').filter(Boolean);
  const root = segments[0]?.toLowerCase();

  if (root === 'metadata') {
    const { frontmatter, hasFrontmatter } = splitFrontmatter(skillMd);
    if (!hasFrontmatter) return { ok: false, error: '无 frontmatter' };
    if (segments.length === 1) return { ok: true, path: rawPath, body: frontmatter };
    const field = segments[1]?.toLowerCase();
    if (field === 'name') {
      const name = parseNameFromFrontmatter(frontmatter);
      if (!name) return { ok: false, error: 'frontmatter 无 name' };
      return { ok: true, path: rawPath, body: `name: ${name}` };
    }
    if (field === 'description') {
      const description = parseDescriptionFromFrontmatter(frontmatter);
      if (!description) return { ok: false, error: 'frontmatter 无 description' };
      return { ok: true, path: rawPath, body: `description: "${description}"` };
    }
    return { ok: false, error: `未知 metadata 路径「${rawPath}」` };
  }

  if (root === 'instructions') {
    let body =
      getSectionContent(skillMd, 'Instructions') ||
      extractH2SectionBody(skillMd, 'Instructions', ['Resources', 'Layer', '原文']);
    if (segments.length === 1) return { ok: true, path: rawPath, body };
    const tree = parseHeadingTree(body ? `## Instructions\n${body}` : '');
    const node = findHeadingNodeByPath(tree, segments.slice(1));
    if (!node) return { ok: false, error: `未找到路径「${rawPath}」` };
    return { ok: true, path: rawPath, body: collectSubtreeMarkdown(node) };
  }

  if (root === 'resources') {
    let body =
      extractH2SectionBody(skillMd, 'Resources', ['Layer']) ||
      extractH2SectionBody(skillMd, '原文', ['Layer']);
    if (!body.trim()) {
      body = splitFrontmatter(skillMd).body;
    }
    if (!body.trim()) return { ok: false, error: '无 Resources 内容' };
    if (segments.length === 1) return { ok: true, path: rawPath, body };
    const tree = parseHeadingTree(body);
    const node = findHeadingNodeByPath(tree, segments.slice(1));
    if (!node) return { ok: false, error: `未找到路径「${rawPath}」` };
    return { ok: true, path: rawPath, body: collectSubtreeMarkdown(node) };
  }

  return { ok: false, error: `未知 path 根节点「${root}」，可用 metadata / instructions / resources` };
}

module.exports = {
  LAYER_SECTION_HEADING,
  LAYER_HEADING_RE,
  LAYER_READ_HINT,
  extractH2SectionBody,
  isStructuredSkillMarkdown,
  buildLayerTreeFromMarkdown,
  buildMarkdownLayerTree: buildLayerTreeFromMarkdown,
  buildLayerTreeObject,
  stripLayerSection,
  readSkillSectionByPath,
};
