/**
 * @file config-store.js
 * 【功能】RemoteServer 本机配置读写（SSH 账号、下载目录、上传暂存、树状态）
 * 【存储】app.getPath('userData')/remote-server.json
 * 【调用】register.js（IPC 读写）；密码明文存本机，仅供本机自动登录
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const STORE_FILE = 'remote-server.json';

function getStorePath() {
  return path.join(app.getPath('userData'), STORE_FILE);
}

/** 默认空配置形状（字段说明见 README） */
function emptyConfig() {
  return {
    host: '',
    port: 22,
    username: '',
    password: '',
    lastPath: '/',
    downloadDir: '',
    uploadItems: [], // [{ path, relativePath }] 待上传本地项
    treeExpanded: [], // 已展开远程目录绝对路径
    selectedPath: '',
    selectedIsDir: true,
  };
}

function defaultLocalDir() {
  try {
    return app.getPath('desktop');
  } catch {
    return app.getPath('home');
  }
}

function resolveLocalDir(raw) {
  const s = raw != null ? String(raw).trim() : '';
  if (s && fs.existsSync(s)) {
    try {
      if (fs.statSync(s).isDirectory()) return s;
    } catch (_) {}
  }
  return defaultLocalDir();
}

function defaultDownloadDir() {
  return defaultLocalDir();
}

function resolveDownloadDir(raw) {
  return resolveLocalDir(raw);
}

function normalizeUploadItems(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const ent of raw) {
    const p = String(ent?.path || '').trim();
    if (!p || !fs.existsSync(p)) continue;
    out.push({
      path: p,
      relativePath: ent?.relativePath ? String(ent.relativePath).replace(/\\/g, '/') : '',
    });
  }
  return out;
}

function normalizeTreeExpanded(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const p of raw) {
    const s = String(p || '').trim();
    if (!s.startsWith('/')) continue;
    const n = s.replace(/\/+$/, '') || '/';
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function legacyUploadItems(j) {
  const legacy = String(j?.uploadDir || j?.uploadPath || '').trim();
  if (legacy && fs.existsSync(legacy)) {
    return [{ path: legacy, relativePath: '' }];
  }
  return [];
}

function readConfig() {
  try {
    const p = getStorePath();
    if (!fs.existsSync(p)) {
      const cfg = emptyConfig();
      cfg.downloadDir = defaultLocalDir();
      cfg.uploadItems = [];
      return cfg;
    }
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const port = parseInt(String(j.port != null ? j.port : 22), 10);
    return {
      host: j.host ? String(j.host).trim() : '',
      port: Number.isFinite(port) && port > 0 ? port : 22,
      username: j.username ? String(j.username).trim() : '',
      password: j.password != null ? String(j.password) : '',
      lastPath: j.lastPath ? String(j.lastPath).trim() || '/' : '/',
      downloadDir: resolveDownloadDir(j.downloadDir),
      uploadItems: normalizeUploadItems(
        j.uploadItems != null ? j.uploadItems : legacyUploadItems(j)
      ),
      treeExpanded: normalizeTreeExpanded(j.treeExpanded),
      selectedPath: j.selectedPath ? String(j.selectedPath).trim() : '',
      selectedIsDir: j.selectedIsDir !== false,
    };
  } catch {
    const cfg = emptyConfig();
    cfg.downloadDir = defaultLocalDir();
    cfg.uploadItems = [];
    return cfg;
  }
}

function writeConfig(data) {
  const prev = readConfig();
  const port = parseInt(String(data?.port != null ? data.port : prev.port), 10);
  const payload = {
    host: data?.host != null ? String(data.host).trim() : prev.host,
    port: Number.isFinite(port) && port > 0 ? port : 22,
    username: data?.username != null ? String(data.username).trim() : prev.username,
    password: data?.password != null ? String(data.password) : prev.password,
    lastPath: data?.lastPath != null ? String(data.lastPath).trim() || '/' : prev.lastPath,
    downloadDir: resolveDownloadDir(
      data?.downloadDir != null ? data.downloadDir : prev.downloadDir
    ),
    uploadItems: normalizeUploadItems(
      data?.uploadItems != null ? data.uploadItems : prev.uploadItems
    ),
    treeExpanded: normalizeTreeExpanded(
      data?.treeExpanded != null ? data.treeExpanded : prev.treeExpanded
    ),
    selectedPath:
      data?.selectedPath != null ? String(data.selectedPath).trim() : prev.selectedPath,
    selectedIsDir: data?.selectedIsDir != null ? Boolean(data.selectedIsDir) : prev.selectedIsDir,
  };
  const p = getStorePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function clearPassword() {
  const cfg = readConfig();
  cfg.password = '';
  return writeConfig(cfg);
}

module.exports = {
  getStorePath,
  readConfig,
  writeConfig,
  clearPassword,
  emptyConfig,
  defaultDownloadDir,
  resolveDownloadDir,
  defaultLocalDir,
  normalizeUploadItems,
  normalizeTreeExpanded,
};
