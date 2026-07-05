/**
 * @file simulator-prefs.js
 * 用户选择的模拟器持久化：保存/读取 UDID + 名称 + iOS 版本。
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function prefsPath() {
  return path.join(app.getPath('userData'), 'xcode-simulator.json');
}

/** @param {{ udid:string, name:string, os:string }} prefs */
function saveSimulatorPref(prefs) {
  const p = prefsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({
    udid: String(prefs?.udid || '').trim(),
    name: String(prefs?.name || '').trim(),
    os: String(prefs?.os || '').trim(),
  }, null, 2), 'utf8');
}

/** @returns {{ udid:string, name:string, os:string }|null} */
function loadSimulatorPref() {
  try {
    const p = prefsPath();
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const udid = String(j.udid || '').trim();
    if (!udid) return null;
    return {
      udid,
      name: String(j.name || '').trim(),
      os: String(j.os || '').trim(),
    };
  } catch {
    return null;
  }
}

module.exports = { saveSimulatorPref, loadSimulatorPref };
