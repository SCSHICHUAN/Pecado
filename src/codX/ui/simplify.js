/**
 * @file simplify.js
 * Framelink / Figma 导出 JSON → 紧凑 tree 文本（省 token）
 */

const MAX_NODES = 96;
const MAX_OUTPUT_CHARS = 14000;

function rgbToHex(color) {
  if (!color) return '';
  const ch = (v) => Math.round(Number(v) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${ch(color.r)}${ch(color.g)}${ch(color.b)}`.toUpperCase();
}

function primaryFillHex(node) {
  const fills = node?.fills;
  if (!Array.isArray(fills)) return '';
  for (const fill of fills) {
    if (fill?.visible === false) continue;
    if (fill?.type === 'SOLID' && fill.color) return rgbToHex(fill.color);
  }
  return '';
}

function textStyle(node) {
  const s = node?.style || {};
  const parts = [];
  if (s.fontSize) parts.push(`${s.fontSize}pt`);
  if (s.fontWeight) parts.push(`w${s.fontWeight}`);
  const hex = primaryFillHex(node);
  if (hex) parts.push(hex);
  return parts.join(' ');
}

function boxOf(node) {
  const b = node?.absoluteBoundingBox;
  if (!b) return null;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

function relBox(box, origin) {
  if (!box || !origin) return box;
  return {
    x: Math.round(box.x - origin.x),
    y: Math.round(box.y - origin.y),
    w: Math.round(box.w),
    h: Math.round(box.h),
  };
}

/**
 * @param {object} bundle parsed JSON
 * @param {{ depth?: number, nodeId?: string, maxNodes?: number }} [opts]
 */
function simplifyDesignBundle(bundle, opts = {}) {
  const depthLimit = Math.max(1, Math.min(8, Number(opts.depth) || 4));
  const maxNodes = Math.max(8, Math.min(MAX_NODES, Number(opts.maxNodes) || MAX_NODES));
  const exportMeta = bundle?.framelinkExport || {};
  const rootIds = opts.nodeId
    ? [String(opts.nodeId)]
    : (exportMeta.rootNodeIds || []).map(String);

  if (!rootIds.length) {
    return { ok: false, error: 'JSON 中缺少 framelinkExport.rootNodeIds' };
  }

  const palette = new Set();
  const lines = [];
  let nodeCount = 0;
  let truncated = false;

  function walk(node, depth, origin) {
    if (!node || typeof node !== 'object') return;
    if (node.visible === false) return;
    if (nodeCount >= maxNodes) {
      truncated = true;
      return;
    }

    const box = boxOf(node);
    const rel = relBox(box, origin);
    const type = String(node.type || 'NODE');
    const name = String(node.name || '').replace(/\s+/g, ' ').trim();
    const indent = '  '.repeat(depth);
    const fill = primaryFillHex(node);
    if (fill) palette.add(fill);

    let extra = '';
    if (rel && rel.w && rel.h) extra += ` ${rel.w}×${rel.h}`;
    if (rel && (rel.x || rel.y)) extra += ` @${rel.x},${rel.y}`;
    if (fill && type !== 'TEXT') extra += ` bg=${fill}`;
    if (node.cornerRadius) extra += ` r=${Math.round(node.cornerRadius)}`;

    if (type === 'TEXT' && node.characters) {
      const text = String(node.characters).replace(/\n/g, ' ').slice(0, 80);
      const style = textStyle(node);
      lines.push(`${indent}TEXT "${text}"${style ? ` ${style}` : ''}${extra}`);
    } else {
      lines.push(`${indent}${type}${name ? ` "${name}"` : ''}${extra}`);
    }
    nodeCount += 1;

    if (depth >= depthLimit) return;
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) walk(child, depth + 1, origin);
  }

  function findNodeDocument(nodeId) {
    const entry = bundle?.nodes?.[nodeId];
    return entry?.document || null;
  }

  const assets = exportMeta.assets || {};
  const assetLines = [];
  for (const id of rootIds) {
    const a = assets[id];
    if (!a) continue;
    if (a.image) assetLines.push(`${id} png → ${a.image}`);
    if (a.svg) assetLines.push(`${id} svg → ${a.svg}`);
  }

  const header = [
    `# ${bundle.name || exportMeta.fileName || 'Design'}`,
    `exported: ${exportMeta.exportedAt || '—'}`,
    `roots: ${rootIds.join(', ')}`,
  ];

  if (assetLines.length) {
    header.push('assets:');
    header.push(...assetLines.map((l) => `  ${l}`));
  }

  for (const rootId of rootIds) {
    const doc = findNodeDocument(rootId);
    if (!doc) {
      header.push(`! root ${rootId} not found in nodes`);
      continue;
    }
    const origin = boxOf(doc) || { x: 0, y: 0, w: 0, h: 0 };
    header.push(`tree ${rootId}:`);
    walk(doc, 1, origin);
  }

  if (palette.size) {
    header.push(`colors: ${[...palette].join(', ')}`);
  }
  if (truncated) {
    header.push(`… truncated after ${maxNodes} nodes (raise depth or pass nodeId)`);
  }

  let text = [...header, ...lines].join('\n');
  if (text.length > MAX_OUTPUT_CHARS) {
    text = `${text.slice(0, MAX_OUTPUT_CHARS)}\n… output capped at ${MAX_OUTPUT_CHARS} chars`;
  }

  return {
    ok: true,
    text,
    rootIds,
    nodeCount,
    truncated,
    charCount: text.length,
  };
}

module.exports = {
  simplifyDesignBundle,
  MAX_NODES,
  MAX_OUTPUT_CHARS,
};
