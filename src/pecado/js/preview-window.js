/**
 * @file preview-window.js
 * 【功能】Log 预览：打开原生 macOS 窗口（系统标题栏 + 红黄绿按钮）
 */
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');
const { SKILL } = require('../../shared/ipc-channels');
const { readSectionPreview, readResourcePreview } = require('../../workflow/skill/preview');

const PRELOAD_SCRIPT = path.join(__dirname, 'preview-preload.js');
const PREVIEW_HTML = path.join(__dirname, '..', 'html', 'preview.html');

/** @type {Set<import('electron').BrowserWindow>} */
const previewWindows = new Set();

function readAbsoluteTextFile(filePath) {
  const fp = String(filePath || '').trim();
  if (!fp) return { ok: false, error: '缺少 path' };
  if (!fs.existsSync(fp)) return { ok: false, error: `文件不存在：${fp}` };
  const stat = fs.statSync(fp);
  if (!stat.isFile()) return { ok: false, error: '不是文件' };
  if (stat.size > 512000) return { ok: false, error: '文件过大，无法预览' };
  let body = fs.readFileSync(fp, 'utf8');
  if (body.length > 48000) body = `${body.slice(0, 48000)}\n…(已截断)`;
  return { ok: true, title: path.basename(fp), body, filePath: fp };
}

/**
 * @param {Record<string, unknown>} payload
 */
function resolvePreviewContent(payload) {
  const kind = String(payload?.kind || '').trim();
  const title = String(payload?.title || '').trim() || '预览';

  if (kind === 'text') {
    const body = String(payload.fullText || '').trim();
    return { ok: true, title, body: body || '(空)', filePath: '' };
  }

  if (kind === 'section' && payload.sectionPath && (payload.skill || payload.skillDocId)) {
    const res = readSectionPreview(payload.skill, payload.sectionPath, payload.skillDocId);
    if (!res.ok) return res;
    return {
      ok: true,
      title: res.title || title,
      body: res.body,
      filePath: '',
      subtitle: String(payload.sectionPath || ''),
    };
  }

  if (kind === 'skill-file' && payload.resourcePath && (payload.skill || payload.skillDocId)) {
    const res = readResourcePreview(payload.skill, payload.resourcePath, payload.skillDocId);
    if (!res.ok) return res;
    const fp = res.absPath || String(payload.filePath || '').trim();
    return {
      ok: true,
      title: res.title || title,
      body: res.body,
      filePath: fp,
      subtitle: fp || String(payload.resourcePath || ''),
    };
  }

  const filePath = String(payload?.filePath || '').trim();
  if (filePath) {
    const res = readAbsoluteTextFile(filePath);
    if (!res.ok) return res;
    return {
      ok: true,
      title: res.title || title,
      body: res.body,
      filePath,
      subtitle: filePath,
    };
  }

  return { ok: false, error: '无可预览内容' };
}

/**
 * @param {{ title: string, body: string, filePath?: string, subtitle?: string }} content
 */
function openPreviewWindow(content) {
  const win = new BrowserWindow({
    title: String(content.title || '预览').slice(0, 120),
    width: 760,
    height: 520,
    minWidth: 420,
    minHeight: 280,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_SCRIPT,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  previewWindows.add(win);
  win.on('closed', () => previewWindows.delete(win));

  win.once('ready-to-show', () => win.show());
  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    win.webContents.send(SKILL.PREVIEW_CONTENT, content);
  });

  win.loadFile(PREVIEW_HTML);
  return win;
}

/** @param {import('electron').IpcMain} ipcMain */
function register(ipcMain) {
  ipcMain.handle(SKILL.OPEN_PREVIEW, async (_evt, payload) => {
    try {
      const resolved = resolvePreviewContent(payload || {});
      if (!resolved.ok) return resolved;
      openPreviewWindow({
        title: resolved.title || '预览',
        body: String(resolved.body || ''),
        filePath: String(resolved.filePath || ''),
        subtitle: String(resolved.subtitle || resolved.filePath || ''),
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });
}

module.exports = { register, resolvePreviewContent, openPreviewWindow };
