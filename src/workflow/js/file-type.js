/**
 * @file file-type.js
 * 【功能】Workflow 文件列表图标（与 shared/file-type.js 规则一致）
 */
(function (global) {
  const RULES = [
    { kind: 'image', label: '图片', icon: '🖼️', exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.heic', '.heif', '.bmp', '.ico', '.tif', '.tiff'] },
    { kind: 'video', label: '视频', icon: '🎬', exts: ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.wmv', '.flv', '.mpeg', '.mpg'] },
    { kind: 'audio', label: '音频', icon: '🎵', exts: ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.wma', '.aiff'] },
    { kind: 'document', label: '文档', icon: '📄', exts: ['.pdf', '.doc', '.docx', '.txt', '.md', '.rtf', '.pages', '.odt'] },
    { kind: 'ppt', label: '演示', icon: '📊', exts: ['.ppt', '.pptx', '.key', '.odp'] },
    { kind: 'spreadsheet', label: '表格', icon: '📈', exts: ['.xls', '.xlsx', '.csv', '.numbers', '.ods'] },
    { kind: 'archive', label: '压缩包', icon: '📦', exts: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.dmg'] },
    { kind: 'code', label: '代码', icon: '💻', exts: ['.js', '.ts', '.jsx', '.tsx', '.py', '.swift', '.java', '.c', '.cpp', '.h', '.m', '.go', '.rs', '.json', '.html', '.css', '.scss', '.yaml', '.yml', '.sh', '.rb', '.php'] },
    { kind: 'font', label: '字体', icon: '🔤', exts: ['.ttf', '.otf', '.woff', '.woff2'] },
  ];

  function getExtension(fileName) {
    const s = String(fileName || '');
    const i = s.lastIndexOf('.');
    return i >= 0 ? s.slice(i).toLowerCase() : '';
  }

  function getFileTypeInfo(fileName) {
    const ext = getExtension(fileName);
    for (const rule of RULES) {
      if (rule.exts.includes(ext)) {
        return { kind: rule.kind, label: rule.label, icon: rule.icon, ext };
      }
    }
    return { kind: 'file', label: '文件', icon: '📎', ext };
  }

  global.WorkflowFileType = { getFileTypeInfo };
})(typeof window !== 'undefined' ? window : globalThis);
