/**
 * @file file-organize.js
 * 【功能】按扩展名将目录内文件归类到子文件夹
 */
const fs = require('fs');
const path = require('path');

const CATEGORY_RULES = [
  { folder: '图片', exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.heic', '.bmp'] },
  { folder: '文档', exts: ['.pdf', '.doc', '.docx', '.txt', '.md', '.rtf', '.pages'] },
  { folder: '演示文稿', exts: ['.ppt', '.pptx', '.key'] },
  { folder: '表格', exts: ['.xls', '.xlsx', '.csv', '.numbers'] },
  { folder: '代码', exts: ['.js', '.ts', '.jsx', '.tsx', '.py', '.swift', '.java', '.c', '.cpp', '.h', '.m', '.go', '.rs', '.json', '.yaml', '.yml'] },
  { folder: '压缩包', exts: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'] },
  { folder: '音视频', exts: ['.mp4', '.mov', '.avi', '.mkv', '.mp3', '.wav', '.m4a', '.aac'] },
];

const OTHER_FOLDER = '其他';

function resolveCategory(ext) {
  const lower = String(ext || '').toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.exts.includes(lower)) return rule.folder;
  }
  return OTHER_FOLDER;
}

function listTopLevelFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name);
}

/**
 * @param {string} sourceDir
 * @param {{ dryRun?: boolean }} [opts]
 */
function organizeFiles(sourceDir, opts = {}) {
  const abs = path.resolve(sourceDir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    return { ok: false, error: '目录不存在或不是文件夹' };
  }

  const moves = [];
  const errors = [];

  for (const name of listTopLevelFiles(abs)) {
    const ext = path.extname(name);
    const category = resolveCategory(ext);
    const targetDir = path.join(abs, category);
    const from = path.join(abs, name);
    const to = path.join(targetDir, name);
    if (path.dirname(from) === path.dirname(to) && category === OTHER_FOLDER && !ext) {
      continue;
    }
    if (from === to) continue;
    moves.push({ from, to, category, fileName: name });
  }

  if (opts.dryRun) {
    return { ok: true, dryRun: true, moves, moved: 0, errors };
  }

  let moved = 0;
  for (const m of moves) {
    try {
      fs.mkdirSync(path.dirname(m.to), { recursive: true });
      if (fs.existsSync(m.to)) {
        errors.push(`${m.fileName}：目标已存在，跳过`);
        continue;
      }
      fs.renameSync(m.from, m.to);
      moved += 1;
    } catch (e) {
      errors.push(`${m.fileName}：${e.message || String(e)}`);
    }
  }

  return { ok: errors.length === 0 || moved > 0, moves, moved, errors };
}

module.exports = { organizeFiles, CATEGORY_RULES, OTHER_FOLDER };
