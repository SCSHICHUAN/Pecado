/**
 * @file file-type.js
 * 【功能】按扩展名识别文件类型（图标 / 标签 / MIME）
 * 【调用方】workflow/file-service/server.js、workflow/js/panel.js
 */

/** @type {Array<{ kind: string, label: string, icon: string, exts: string[] }>} */
const FILE_TYPE_RULES = [
  {
    kind: 'image',
    label: '图片',
    icon: '🖼️',
    exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.heic', '.heif', '.bmp', '.ico', '.tif', '.tiff'],
  },
  {
    kind: 'video',
    label: '视频',
    icon: '🎬',
    exts: ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.wmv', '.flv', '.mpeg', '.mpg'],
  },
  {
    kind: 'audio',
    label: '音频',
    icon: '🎵',
    exts: ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.wma', '.aiff'],
  },
  {
    kind: 'document',
    label: '文档',
    icon: '📄',
    exts: ['.pdf', '.doc', '.docx', '.txt', '.md', '.rtf', '.pages', '.odt'],
  },
  {
    kind: 'ppt',
    label: '演示',
    icon: '📊',
    exts: ['.ppt', '.pptx', '.key', '.odp'],
  },
  {
    kind: 'spreadsheet',
    label: '表格',
    icon: '📈',
    exts: ['.xls', '.xlsx', '.csv', '.numbers', '.ods'],
  },
  {
    kind: 'archive',
    label: '压缩包',
    icon: '📦',
    exts: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.dmg'],
  },
  {
    kind: 'code',
    label: '代码',
    icon: '💻',
    exts: [
      '.js',
      '.ts',
      '.jsx',
      '.tsx',
      '.py',
      '.swift',
      '.java',
      '.c',
      '.cpp',
      '.h',
      '.m',
      '.go',
      '.rs',
      '.json',
      '.html',
      '.css',
      '.scss',
      '.yaml',
      '.yml',
      '.sh',
      '.rb',
      '.php',
    ],
  },
  {
    kind: 'font',
    label: '字体',
    icon: '🔤',
    exts: ['.ttf', '.otf', '.woff', '.woff2'],
  },
];

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/x-m4v',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.wma': 'audio/x-ms-wma',
  '.aiff': 'audio/aiff',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.rtf': 'text/rtf',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.ts': 'text/plain',
  '.tsx': 'text/plain',
  '.jsx': 'text/plain',
  '.py': 'text/plain',
  '.swift': 'text/plain',
  '.java': 'text/plain',
  '.c': 'text/plain',
  '.cpp': 'text/plain',
  '.h': 'text/plain',
  '.m': 'text/plain',
  '.go': 'text/plain',
  '.rs': 'text/plain',
  '.scss': 'text/plain',
  '.sh': 'text/plain',
  '.rb': 'text/plain',
  '.php': 'text/plain',
};

function getExtension(fileName) {
  const s = String(fileName || '');
  const i = s.lastIndexOf('.');
  return i >= 0 ? s.slice(i).toLowerCase() : '';
}

/**
 * @param {string} fileName
 * @returns {{ kind: string, label: string, icon: string, ext: string }}
 */
function getFileTypeInfo(fileName) {
  const ext = getExtension(fileName);
  for (const rule of FILE_TYPE_RULES) {
    if (rule.exts.includes(ext)) {
      return { kind: rule.kind, label: rule.label, icon: rule.icon, ext };
    }
  }
  return { kind: 'file', label: '文件', icon: '📎', ext };
}

/**
 * @param {string} fileName
 */
function getMimeType(fileName) {
  const ext = getExtension(fileName);
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

/** 是否可在浏览器内直接打开预览 */
function isPreviewable(fileName) {
  const { kind, ext } = getFileTypeInfo(fileName);
  if (kind === 'image' || kind === 'video' || kind === 'audio') return true;
  if (ext === '.pdf') return true;
  if (kind === 'code') return true;
  if (kind === 'document' && ['.txt', '.md', '.rtf'].includes(ext)) return true;
  if (ext === '.csv') return true;
  return false;
}

module.exports = {
  FILE_TYPE_RULES,
  getExtension,
  getFileTypeInfo,
  getMimeType,
  isPreviewable,
};
