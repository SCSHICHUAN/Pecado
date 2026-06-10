/**
 * @file store.js
 * 【功能】Workflow 配置持久化（定时任务等）→ userData/workflows.json
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const STORE_FILE = 'workflows.json';

function getStorePath() {
  return path.join(app.getPath('userData'), STORE_FILE);
}

function readStore() {
  try {
    const p = getStorePath();
    if (!fs.existsSync(p)) return { schedules: [] };
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      schedules: Array.isArray(j.schedules) ? j.schedules : [],
      lastDownloadServiceUrl: j.lastDownloadServiceUrl ? String(j.lastDownloadServiceUrl).trim() : '',
      downloadServiceDir: j.downloadServiceDir ? String(j.downloadServiceDir).trim() : '',
    };
  } catch {
    return { schedules: [], lastDownloadServiceUrl: '', downloadServiceDir: '' };
  }
}

function writeStore(data) {
  const p = getStorePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const payload = {
    schedules: Array.isArray(data?.schedules) ? data.schedules : [],
    lastDownloadServiceUrl: data?.lastDownloadServiceUrl
      ? String(data.lastDownloadServiceUrl).trim()
      : '',
    downloadServiceDir: data?.downloadServiceDir ? String(data.downloadServiceDir).trim() : '',
  };
  fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function listSchedules() {
  return readStore().schedules;
}

/**
 * @param {object} schedule
 */
function upsertSchedule(schedule) {
  const store = readStore();
  const id = schedule.id || `sch-${Date.now()}`;
  const next = {
    id,
    name: String(schedule.name || '未命名任务').trim() || '未命名任务',
    enabled: schedule.enabled !== false,
    triggerType: schedule.triggerType === 'daily' ? 'daily' : 'interval',
    intervalMinutes: Math.max(1, parseInt(String(schedule.intervalMinutes || 60), 10) || 60),
    dailyTime: String(schedule.dailyTime || '09:00').trim() || '09:00',
    appPath: String(schedule.appPath || '').trim(),
    appName: String(schedule.appName || '').trim(),
    createdAt: schedule.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const idx = store.schedules.findIndex((s) => s.id === id);
  if (idx >= 0) store.schedules[idx] = next;
  else store.schedules.push(next);
  writeStore(store);
  return next;
}

function deleteSchedule(id) {
  const store = readStore();
  store.schedules = store.schedules.filter((s) => s.id !== id);
  writeStore(store);
  return { ok: true };
}

function getLastDownloadServiceUrl() {
  return readStore().lastDownloadServiceUrl || '';
}

function saveLastDownloadServiceUrl(url) {
  const store = readStore();
  store.lastDownloadServiceUrl = String(url || '').trim();
  writeStore(store);
  return store.lastDownloadServiceUrl;
}

function getDownloadServiceDir() {
  return readStore().downloadServiceDir || '';
}

function saveDownloadServiceDir(dir) {
  const store = readStore();
  store.downloadServiceDir = String(dir || '').trim();
  writeStore(store);
  return store.downloadServiceDir;
}

module.exports = {
  getStorePath,
  readStore,
  listSchedules,
  upsertSchedule,
  deleteSchedule,
  getLastDownloadServiceUrl,
  saveLastDownloadServiceUrl,
  getDownloadServiceDir,
  saveDownloadServiceDir,
};
