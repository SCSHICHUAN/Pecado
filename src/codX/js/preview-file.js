/**
 * @file preview-file.js
 * CodX 可浏览器预览的文件类型（图片 / PDF / 音视频等）
 */
(function () {
  const PREVIEW_EXTS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.svg',
    '.ico',
    '.bmp',
    '.pdf',
    '.mp4',
    '.webm',
    '.mov',
    '.mp3',
    '.wav',
    '.m4a',
    '.aac',
    '.ogg',
  ]);

  function extOf(relPath) {
    const name = String(relPath || '');
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i).toLowerCase() : '';
  }

  function isPreviewPath(relPath) {
    return PREVIEW_EXTS.has(extOf(relPath));
  }

  window.CodXPreview = { isPreviewPath, extOf };
})();
