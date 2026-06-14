/**
 * @file schedule.js
 * 【功能】Workflow「定时任务」：间隔或每日时刻启动应用
 * 【功能】定时启动 macOS / Windows 应用程序
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { listSchedules, upsertSchedule } = require('../config-store');

/** @type {Map<string, { timeoutId?: NodeJS.Timeout, intervalId?: NodeJS.Timeout }>} */
const timers = new Map();

function parseDailyTime(timeStr) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || '').trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, min };
}

function msUntilNextDaily(timeStr) {
  const parsed = parseDailyTime(timeStr);
  if (!parsed) return 24 * 60 * 60 * 1000;
  const now = new Date();
  const next = new Date(now);
  next.setHours(parsed.h, parsed.min, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

/**
 * @param {{ appPath?: string, appName?: string }} schedule
 */
async function launchApplication(schedule) {
  const appPath = String(schedule.appPath || '').trim();
  const appName = String(schedule.appName || '').trim();

  if (process.platform === 'darwin') {
    if (appPath && fs.existsSync(appPath)) {
      await new Promise((resolve, reject) => {
        spawn('open', [appPath], { stdio: 'ignore' }).on('error', reject).on('close', () => resolve());
      });
      return { ok: true, message: `已打开 ${path.basename(appPath)}` };
    }
    if (appName) {
      await new Promise((resolve, reject) => {
        spawn('open', ['-a', appName], { stdio: 'ignore' }).on('error', reject).on('close', () => resolve());
      });
      return { ok: true, message: `已启动 ${appName}` };
    }
    return { ok: false, error: '请填写 .app 路径或应用名称' };
  }

  if (appPath && fs.existsSync(appPath)) {
    spawn(appPath, [], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, message: `已启动 ${path.basename(appPath)}` };
  }
  return { ok: false, error: '请填写可执行文件路径' };
}

function clearScheduleTimer(id) {
  const t = timers.get(id);
  if (!t) return;
  if (t.timeoutId) clearTimeout(t.timeoutId);
  if (t.intervalId) clearInterval(t.intervalId);
  timers.delete(id);
}

function armSchedule(schedule) {
  clearScheduleTimer(schedule.id);
  if (!schedule.enabled) return;

  const run = () => {
    launchApplication(schedule).catch((e) => {
      console.error('[workflow] schedule launch', schedule.id, e);
    });
  };

  if (schedule.triggerType === 'daily') {
    const delay = msUntilNextDaily(schedule.dailyTime);
    const timeoutId = setTimeout(function tick() {
      run();
      const intervalId = setInterval(run, 24 * 60 * 60 * 1000);
      timers.set(schedule.id, { intervalId });
    }, delay);
    timers.set(schedule.id, { timeoutId });
    return;
  }

  const ms = Math.max(60000, schedule.intervalMinutes * 60 * 1000);
  const intervalId = setInterval(run, ms);
  timers.set(schedule.id, { intervalId });
}

function reloadAllSchedules() {
  for (const id of timers.keys()) clearScheduleTimer(id);
  for (const sch of listSchedules()) armSchedule(sch);
}

function stopAllSchedules() {
  for (const id of [...timers.keys()]) clearScheduleTimer(id);
}

module.exports = {
  launchApplication,
  armSchedule,
  reloadAllSchedules,
  stopAllSchedules,
  upsertSchedule,
};
