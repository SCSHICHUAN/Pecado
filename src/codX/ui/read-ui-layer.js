/**
 * @file read-ui-layer.js
 * 分层读取压缩后的 Figma 设计稿 JSON
 *
 * read_UI_layer(bundlePath, layer?) → 返回指定层级的完整数据
 *  - 不带 layer：返回骨架（前3-4层的完整节点数据）
 *  - 带 layer + nodeId：返回指定节点往下一层的完整数据
 */
const fs = require('fs');
const path = require('path');
const { DESIGN_IMPORTS_DIR } = require('../../workflow/design-import/copy');

const SKELETON_DEPTH = 3;
const MAX_LAYER_DEPTH = 8;

/**
 * 找压缩后的 shot-*.json
 */
function findCompressedJson(absDir) {
  for (const name of fs.readdirSync(absDir)) {
    if (name.startsWith('shot-') && name.endsWith('.json')) {
      return path.join(absDir, name);
    }
  }
  return null;
}

/**
 * 找原始 Framelink JSON
 */
function findOriginalJson(absDir) {
  for (const name of fs.readdirSync(absDir)) {
    if (name.endsWith('.json') && !name.startsWith('shot-')) {
      try {
        const raw = fs.readFileSync(path.join(absDir, name), 'utf8');
        if (JSON.parse(raw)?.framelinkExport) return path.join(absDir, name);
      } catch (_) {}
    }
  }
  return null;
}

/**
 * 解压：对用了短key的数据，用keyMap还原后返回完整key的版本
 * 如果没压缩（原始JSON），直接返回
 */
function resolveKeys(data, keyMap) {
  if (!keyMap || typeof keyMap !== 'object') return data;
  if (typeof data !== 'object' || data === null) return data;
  if (Array.isArray(data)) return data.map(v => resolveKeys(v, keyMap));

  const result = {};
  for (const key of Object.keys(data)) {
    if (key === '__keyMap') continue;
    const realKey = keyMap[key] || key;
    const val = data[key];
    result[realKey] = typeof val === 'object' && val !== null
      ? resolveKeys(val, keyMap)
      : val;
  }
  return result;
}

/**
 * 按深度裁剪节点：保留 depth 层完整数据，更深层的 children 只保留 type/name/id
 * @returns {object} 裁剪后的节点
 */
function layerSlice(node, currentDepth, targetDepth) {
  if (!node || typeof node !== 'object') return node;

  const result = {};
  const keepAll = currentDepth < targetDepth;

  for (const key of Object.keys(node)) {
    const val = node[key];
    if (key === 'children' && Array.isArray(val)) {
      if (keepAll) {
        result.children = val.map(c => layerSlice(c, currentDepth + 1, targetDepth));
      } else {
        // 到达目标层，只保留骨架信息
        result.children = val.map(c => {
          const box = c.absoluteBoundingBox;
          const item = {
            type: c.type,
            name: c.name,
            id: c.id,
          };
          if (box && box.width && box.height) item.size = { w: Math.round(box.width), h: Math.round(box.height) };
          if (Array.isArray(c.children) && c.children.length) {
            item.childCount = c.children.length;
          }
          if (c.characters) item.text = String(c.characters).slice(0, 60);
          return item;
        });
      }
    } else {
      result[key] = val;
    }
  }
  return result;
}

/**
 * 在 tree 中按 nodeId 查找节点
 */
function findNodeById(node, targetId) {
  if (!node) return null;
  if (node.id === targetId) return node;
  if (Array.isArray(node.children)) {
    for (const c of node.children) {
      const found = findNodeById(c, targetId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 主入口
 * @param {string} projectRoot
 * @param {{ bundlePath: string, layer?: number, nodeId?: string }} args
 * layer: 不传=骨架(3层)，数字=返回该层完整数据
 * nodeId: 配合layer使用，从指定节点开始读取
 */
function readUiLayer(projectRoot, args = {}) {
  const bundlePath = String(args.bundlePath || '').trim();
  if (!bundlePath) return { ok: false, error: '缺少 bundlePath' };

  const root = path.resolve(String(projectRoot || '').trim());
  let absDir;

  // 支持传目录或 json 文件路径
  const bp = bundlePath.replace(/\\/g, '/');
  if (bp.endsWith('.json')) {
    absDir = path.dirname(path.join(root, bp));
  } else {
    absDir = path.join(root, bp);
  }

  if (!fs.existsSync(absDir)) return { ok: false, error: '目录不存在' };

  // 优先读压缩文件
  let jsonPath = findCompressedJson(absDir);
  let isCompressed = true;
  if (!jsonPath) {
    jsonPath = findOriginalJson(absDir);
    isCompressed = false;
  }
  if (!jsonPath) return { ok: false, error: '未找到 Framelink JSON（需先导入设计稿）' };

  let bundle;
  try {
    bundle = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${e.message}` };
  }

  // 解压
  let keyMap = null;
  if (isCompressed) {
    keyMap = bundle.__keyMap || null;
    bundle = resolveKeys(bundle, keyMap);
  }

  if (!bundle.framelinkExport) {
    return { ok: false, error: '不是 Framelink 导出的 JSON' };
  }

  const rootIds = bundle.framelinkExport.rootNodeIds || [];
  if (!rootIds.length) return { ok: false, error: 'JSON 缺少 rootNodeIds' };

  // 确定层级
  const requestedLayer = args.layer != null ? Number(args.layer) : SKELETON_DEPTH;
  const layer = Math.max(1, Math.min(MAX_LAYER_DEPTH, requestedLayer));

  const nodeId = args.nodeId || null;
  let targetNode = null;

  for (const rid of rootIds) {
    const entry = bundle.nodes?.[rid];
    const doc = entry?.document || null;
    if (!doc) continue;
    if (nodeId) {
      targetNode = findNodeById(doc, nodeId);
      if (targetNode) break;
    } else {
      targetNode = doc;
      break;
    }
  }

  if (!targetNode) {
    if (nodeId) return { ok: false, error: `节点 ${nodeId} 未找到` };
    return { ok: false, error: '未找到根节点' };
  }

  // 裁片
  const sliced = layerSlice(targetNode, 0, layer, []);

  // 预览资源
  const exportMeta = bundle.framelinkExport;
  const previewAssets = [];
  for (const rid of rootIds) {
    const a = exportMeta.assets?.[rid];
    if (a?.image) previewAssets.push(a.image);
  }

  // 计算摘要信息
  function countNodes(n) {
    if (!n) return 0;
    let c = 1;
    if (Array.isArray(n.children)) n.children.forEach(ch => { c += countNodes(ch); });
    return c;
  }
  const totalNodes = countNodes(targetNode);

  // 子节点摘要（供 LLM 决定下一步深入哪个）
  const childSummary = [];
  if (Array.isArray(sliced.children)) {
    for (const c of sliced.children) {
      childSummary.push({
        id: c.id,
        type: c.type,
        name: c.name,
        childCount: c.childCount || 0,
      });
    }
  }

  return {
    ok: true,
    layer,
    nodeId: nodeId || rootIds[0],
    totalNodes,
    childSummary,
    data: sliced,
    previewAssets,
    compressed: isCompressed,
    hint:
      layer < MAX_LAYER_DEPTH && childSummary.length > 0
        ? `骨架层级 ${layer}，${childSummary.length} 个子节点可深入。传 nodeId + layer=${layer + 2} 深入查看`
        : `层级 ${layer}，已是完整层级`,
  };
}

module.exports = { readUiLayer, SKELETON_DEPTH, MAX_LAYER_DEPTH };
