/**
 * @file media-utils.js
 *
 * 统一图片 / SVG 转码模块，浏览器 (window.MediaUtils) 和 Node (require) 两用。
 *
 * 数据结构：
 *   MediaItem = {
 *     kind: 'raster' | 'svg',
 *     name?: string,
 *     // raster only
 *     base64?: string,
 *     mimeType?: string,
 *     // svg only
 *     svgText?: string,
 *   }
 *
 * API:
 *   fromFile(file)      — 浏览器 File → Promise<MediaItem>
 *   fromDisk(abs, fs, path) — Node 磁盘文件 → MediaItem | null
 *   toDataUri(item)     — MediaItem → data: URI
 *   toChatContent(item) — MediaItem → LLM content 数组元素
 *   toIpcPayload(items) — MediaItem[] → { images?, svgs? }
 *
 * 共享于：
 *   - src/pecado/js/index.js（拖拽 → 预览 + 发送）
 *   - src/mcp-filesystem/read-media.js（磁盘 → LLM 上下文注入）
 */

(function (root) {
  var BINARY_EXT_MIME = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
  };

  function mimeByExt(ext) {
    return BINARY_EXT_MIME[ext] || 'application/octet-stream';
  }

  function fromDisk(absPath, fs, pathLib) {
    try {
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) return null;
      var ext = pathLib.extname(absPath).toLowerCase();
      var buf = fs.readFileSync(absPath);
      if (buf.length > 10 * 1024 * 1024) return null;

      if (ext === '.svg') {
        var text = buf.toString('utf8');
        return { kind: 'svg', name: pathLib.basename(absPath), svgText: text };
      }

      var mime = mimeByExt(ext);
      var base64 = buf.toString('base64');
      return { kind: 'raster', name: pathLib.basename(absPath), base64: base64, mimeType: mime };
    } catch (_) {
      return null;
    }
  }

  function fromFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = reader.result;
        var isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
        if (isSvg) {
          var text = atob(dataUrl.slice(dataUrl.indexOf(';base64,') + 8));
          resolve({ kind: 'svg', name: file.name, svgText: text });
        } else {
          var b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
          resolve({ kind: 'raster', name: file.name, base64: b64, mimeType: file.type });
        }
      };
      reader.onerror = function () { reject(new Error('\u8bfb\u53d6\u56fe\u7247\u5931\u8d25')); };
      reader.readAsDataURL(file);
    });
  }

  function toDataUri(item) {
    if (!item) return '';
    if (item.kind === 'svg' && item.svgText) {
      return 'data:image/svg+xml,' + encodeURIComponent(item.svgText);
    }
    if (item.kind === 'raster' && item.base64 && item.mimeType) {
      return 'data:' + item.mimeType + ';base64,' + item.base64;
    }
    return '';
  }

  function toChatContent(item) {
    if (!item) return null;
    if (item.kind === 'svg' && item.svgText) {
      return { type: 'text', text: item.svgText };
    }
    if (item.kind === 'raster' && item.base64 && item.mimeType) {
      return { type: 'image_url', image_url: { url: toDataUri(item) } };
    }
    return null;
  }

  function toIpcPayload(items) {
    if (!Array.isArray(items) || !items.length) return {};
    var images = [];
    var svgs = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item) continue;
      if (item.kind === 'raster' && item.base64 && item.mimeType) {
        images.push({ base64: item.base64, mimeType: item.mimeType });
      } else if (item.kind === 'svg' && item.svgText) {
        svgs.push(item.svgText);
      }
    }
    var out = {};
    if (images.length) out.images = images;
    if (svgs.length) out.svgs = svgs;
    return out;
  }

  var api = { fromDisk: fromDisk, fromFile: fromFile, toDataUri: toDataUri, toChatContent: toChatContent, toIpcPayload: toIpcPayload };

  if (typeof module !== 'undefined' && typeof module.exports === 'object') {
    module.exports = api;
  } else {
    root.MediaUtils = api;
  }
})(typeof window !== 'undefined' ? window : global);
