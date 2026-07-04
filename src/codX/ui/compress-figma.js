/**
 * @file compress-figma.js
 * Figma 导出 JSON 裁剪 + 短key压缩
 *
 * 流程：原始 JSON → trim(删空节点/空属性) → compress(长key→短key)
 * 输出：shot+[jsonName]（压缩后的JSON，头部含key映射表）
 */
const fs = require('fs');
const path = require('path');

/** key长度超过此值才压缩 */
const COMPRESS_KEY_MIN_LEN = 5;

/**
 * 删除空属性（null、空字符串、空数组、空对象）
 */
function isEmptyValue(v) {
  if (v == null) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  if (Array.isArray(v) && v.length === 0) return true;
  if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return true;
  return false;
}

/**
 * 递归裁剪：删除空节点（visible===false 且无关键内容）、删除空属性
 */
function trimNode(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    const trimmed = [];
    for (const item of node) {
      const t = trimNode(item);
      if (t !== null) trimmed.push(t);
    }
    return trimmed;
  }

  // 节点：如果 visible===false 且不是纯容器，跳过
  if (node.visible === false) {
    if (node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'COMPONENT') {
      if (Array.isArray(node.children) && node.children.length > 0) {
        // 不可见的容器但仍有子节点，保留结构但跳过自身视觉属性
        const trimmed = {};
        trimmed.type = node.type;
        trimmed.name = node.name;
        trimmed.id = node.id;
        const children = trimNode(node.children);
        if (children && children.length) trimmed.children = children;
        return Object.keys(trimmed).length > 3 ? trimmed : null;
      }
    }
    return null;
  }

  const result = {};
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (isEmptyValue(val)) continue;

    if (key === 'children' && Array.isArray(val)) {
      const trimmed = trimNode(val);
      if (trimmed.length) result[key] = trimmed;
    } else if (typeof val === 'object' && !Array.isArray(val)) {
      const trimmed = trimNode(val);
      if (trimmed && (typeof trimmed !== 'object' || Object.keys(trimmed).length > 0)) {
        result[key] = trimmed;
      }
    } else {
      result[key] = val;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * 压缩：收集所有长度>COMPRESS_KEY_MIN_LEN的key，生成短key映射表
 * 短key格式：S0,S1,S2...
 * 返回 { compressed: 压缩后的对象, keyMap: { S0: "longKey", ... } }
 */
function compressKeys(obj, keyMap, keyIndex, reverseMap) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(item => compressKeys(item, keyMap, keyIndex, reverseMap));
  }

  const result = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    let shortKey = key;

    if (key.length > COMPRESS_KEY_MIN_LEN) {
      if (reverseMap.has(key)) {
        shortKey = reverseMap.get(key);
      } else {
        shortKey = 'S' + keyIndex.count;
        keyIndex.count++;
        keyMap[shortKey] = key;
        reverseMap.set(key, shortKey);
      }
    }

    if (typeof val === 'object' && val !== null) {
      result[shortKey] = compressKeys(val, keyMap, keyIndex, reverseMap);
    } else {
      result[shortKey] = val;
    }
  }
  return result;
}

/**
 * 主入口：读原始JSON → 裁剪 → 压缩 → 写文件
 * @param {string} projectRoot
 * @param {string} relPath DesignImports/xxx
 */
function compressFigmaBundle(projectRoot, relPath) {
  const root = path.resolve(String(projectRoot || '').trim());
  const absDir = path.join(root, String(relPath || ''));

  // 找 Framelink JSON
  let jsonFile = null;
  for (const name of fs.readdirSync(absDir)) {
    if (name.endsWith('.json') && !name.startsWith('shot-')) {
      const full = path.join(absDir, name);
      try {
        const raw = fs.readFileSync(full, 'utf8');
        const data = JSON.parse(raw);
        if (data?.framelinkExport) {
          jsonFile = { path: full, name: name };
          break;
        }
      } catch (_) {}
    }
  }
  if (!jsonFile) return { ok: false, error: '未找到 Framelink JSON' };

  const raw = fs.readFileSync(jsonFile.path, 'utf8');
  const bundle = JSON.parse(raw);

  // 1. 裁剪
  const trimmed = trimNode(bundle);

  // 2. 压缩
  const keyMap = {};
  const keyIndex = { count: 0 };
  const reverseMap = new Map();
  const compressed = compressKeys(trimmed, keyMap, keyIndex, reverseMap);

  // 3. 输出：头部放key映射表（供LLM理解），后面放压缩后的数据
  const output = { __keyMap: keyMap, ...compressed };

  // 4. 写文件
  const shotName = 'shot-' + jsonFile.name;
  const shotPath = path.join(absDir, shotName);
  fs.writeFileSync(shotPath, JSON.stringify(output), 'utf8');

  return {
    ok: true,
    shotPath,
    shotName,
    originalName: jsonFile.name,
    keyCount: keyIndex.count,
    originalSize: raw.length,
    compressedSize: JSON.stringify(output).length,
  };
}

/**
 * 检查是否已有压缩文件
 */
function hasCompressed(projectRoot, relPath) {
  const root = path.resolve(String(projectRoot || '').trim());
  const absDir = path.join(root, String(relPath || ''));
  try {
    for (const name of fs.readdirSync(absDir)) {
      if (name.startsWith('shot-') && name.endsWith('.json')) return true;
    }
  } catch (_) {}
  return false;
}

module.exports = {
  compressFigmaBundle,
  hasCompressed,
  COMPRESS_KEY_MIN_LEN,
};
