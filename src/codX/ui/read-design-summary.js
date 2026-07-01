/**
 * @file read-design-summary.js
 * 读取 DesignImports 下 Framelink 导出并返回精简摘要
 */
const fs = require('fs');
const path = require('path');
const projectIo = require('../../mcp-filesystem');
const { DESIGN_IMPORTS_DIR } = require('../../workflow/design-import/copy');
const { simplifyDesignBundle } = require('./simplify');
const { readUserVolcConfig, DEFAULT_CODX_DESIGN_DEPTH } = require('../../settings/js/volc-user-config');

function findFramelinkJsonInDir(dir) {
  let best = '';
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const full = path.join(dir, name);
    if (!fs.statSync(full).isFile()) continue;
    try {
      const raw = fs.readFileSync(full, 'utf8');
      const data = JSON.parse(raw);
      if (data?.framelinkExport) {
        best = full;
        break;
      }
    } catch {
      /* skip */
    }
  }
  return best;
}

/**
 * @param {string} projectRoot
 * @param {string} inputPath 相对工程：DesignImports/foo 或 …/file.json
 */
function resolveDesignJsonPath(projectRoot, inputPath) {
  const root = path.resolve(String(projectRoot || '').trim());
  const raw = String(inputPath || '').trim().replace(/\\/g, '/');
  if (!root || !raw) return { ok: false, error: '缺少 bundlePath' };

  let abs;
  try {
    abs = projectIo.resolveUnderProject(root, raw);
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }

  const relNorm = path.relative(root, abs).split(path.sep).join('/');
  if (!relNorm.startsWith(`${DESIGN_IMPORTS_DIR}/`) && relNorm !== DESIGN_IMPORTS_DIR) {
    return { ok: false, error: `路径须在 ${DESIGN_IMPORTS_DIR}/ 下` };
  }

  if (fs.existsSync(abs) && fs.statSync(abs).isFile() && abs.endsWith('.json')) {
    return { ok: true, jsonPath: abs, bundleRel: path.dirname(relNorm) };
  }

  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    const jsonPath = findFramelinkJsonInDir(abs);
    if (!jsonPath) return { ok: false, error: '目录中未找到 Framelink JSON' };
    return { ok: true, jsonPath, bundleRel: relNorm };
  }

  return { ok: false, error: '路径不是 DesignImports 下的目录或 JSON 文件' };
}

/**
 * @param {string} projectRoot
 * @param {{ bundlePath: string, depth?: number, nodeId?: string }} args
 */
function readDesignSummary(projectRoot, args = {}) {
  const bundlePath = String(args.bundlePath || args.path || '').trim();
  const resolved = resolveDesignJsonPath(projectRoot, bundlePath);
  if (!resolved.ok) return resolved;

  let bundle;
  try {
    bundle = JSON.parse(fs.readFileSync(resolved.jsonPath, 'utf8'));
  } catch (e) {
    return { ok: false, error: `无法解析 JSON：${e.message || String(e)}` };
  }

  if (!bundle?.framelinkExport) {
    return { ok: false, error: '不是 Framelink Exporter 导出的 JSON' };
  }

  const depth = args.depth != null ? Number(args.depth) : (() => {
    try { return readUserVolcConfig().codxDesignDepth; } catch { return DEFAULT_CODX_DESIGN_DEPTH; }
  })();
  const simplified = simplifyDesignBundle(bundle, {
    depth,
    nodeId: args.nodeId,
  });
  if (!simplified.ok) return simplified;

  const exportMeta = bundle.framelinkExport;
  const previewAssets = [];
  for (const rootId of simplified.rootIds || []) {
    const asset = exportMeta.assets?.[rootId];
    if (asset?.image) {
      previewAssets.push(path.join(resolved.bundleRel, asset.image).split(path.sep).join('/'));
    }
  }

  return {
    ok: true,
    bundlePath: resolved.bundleRel,
    jsonRel: path.relative(projectRoot, resolved.jsonPath).split(path.sep).join('/'),
    summary: simplified.text,
    nodeCount: simplified.nodeCount,
    truncated: simplified.truncated,
    charCount: simplified.charCount,
    previewAssets,
    hint:
      previewAssets.length > 0
        ? `视觉参考可用 read_media_file：${previewAssets[0]}`
        : '无 PNG 预览；可缩小 depth 或指定 nodeId',
  };
}

module.exports = {
  readDesignSummary,
  resolveDesignJsonPath,
};
