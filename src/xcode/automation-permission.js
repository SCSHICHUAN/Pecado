/**
 * @file automation-permission.js
 *
 * 【功能】请求 macOS「自动化」权限，使 Pecado 可通过 AppleScript 控制 Xcode（等同 ⌘R）。
 *   - probeXcodeAutomationAccess：执行无害 AppleScript，触发系统 TCC 弹窗
 *   - ensureXcodeAutomationPermission：探测失败时弹出应用内对话框，可打开系统设置或重试
 *
 * 【调用方】xcode/build-runner.js（xcode_run）；settings/js/app-menu.js（菜单手动授权）
 */
const { execFile } = require('child_process');
const { promisify } = require('util');
const { dialog, shell } = require('electron');

const execFileAsync = promisify(execFile);

const AUTOMATION_DENIED =
  /not authorized|not authorised|Not authorized|-1743|-1900|-1708|1002|errAEEventNotPermitted|不允许|未获得授权|User cancelled|用户取消/i;

const AUTOMATION_SETTINGS_URLS = [
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
  'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Automation',
];

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {unknown} error
 */
function isXcodeAutomationDenied(error) {
  const text = [
    error && typeof error === 'object' && 'stderr' in error ? error.stderr : '',
    error && typeof error === 'object' && 'message' in error ? error.message : '',
    error,
  ]
    .filter(Boolean)
    .join('\n');
  return AUTOMATION_DENIED.test(text);
}

/**
 * 打开「系统设置 → 隐私与安全性 → 自动化」。
 */
async function openXcodeAutomationSettings() {
  for (const url of AUTOMATION_SETTINGS_URLS) {
    try {
      await shell.openExternal(url);
      return true;
    } catch (_) {
      /* 尝试下一个 deep link */
    }
  }
  return false;
}

/**
 * 向 Xcode 发送 Apple Event，首次会弹出 macOS 授权框。
 * @returns {Promise<{ granted: boolean, message?: string }>}
 */
async function probeXcodeAutomationAccess() {
  if (process.platform !== 'darwin') {
    return { granted: false, message: '仅支持 macOS' };
  }

  try {
    await execFileAsync(
      'osascript',
      ['-e', 'tell application "Xcode" to version'],
      { encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 }
    );
    return { granted: true };
  } catch (e) {
    const message = String(e?.stderr || e?.message || e);
    if (isXcodeAutomationDenied(e) || AUTOMATION_DENIED.test(message)) {
      return { granted: false, message };
    }
    return { granted: true, warning: message };
  }
}

/**
 * @param {import('electron').BrowserWindow | null | undefined} browserWindow
 * @param {(line: string) => void} [onLine]
 * @returns {Promise<{ granted: boolean, canceled?: boolean, useFallback?: boolean }>}
 */
async function promptXcodeAutomationPermission(browserWindow, onLine) {
  const win = browserWindow && !browserWindow.isDestroyed() ? browserWindow : null;

  onLine?.('Run: 正在请求「控制 Xcode」的系统权限（请在弹窗中点「好」）…');

  let probe = await probeXcodeAutomationAccess();
  if (probe.granted) {
    onLine?.('Run: 已获得 Xcode 自动化权限');
    return { granted: true };
  }

  const choice = dialog.showMessageBoxSync(win, {
    type: 'warning',
    title: '需要自动化权限',
    message: 'Pecado 需要控制 Xcode 才能等同 ⌘R 运行项目',
    detail:
      '若刚才未看到系统弹窗，或曾点过「不允许」，请打开：\n' +
      '系统设置 → 隐私与安全性 → 自动化 → 勾选 Pecado → Xcode\n\n' +
      '勾选后点「已授权，重试」。也可改用命令行方式运行（不依赖 Xcode 界面）。',
    buttons: ['已授权，重试', '打开系统设置', '改用命令行运行', '取消'],
    defaultId: 0,
    cancelId: 3,
    noLink: true,
  });

  if (choice === 1) {
    await openXcodeAutomationSettings();
    onLine?.('Run: 已打开系统设置，请勾选 Pecado → Xcode 后返回重试');
    await delay(1500);
    probe = await probeXcodeAutomationAccess();
    if (probe.granted) {
      onLine?.('Run: 已获得 Xcode 自动化权限');
      return { granted: true };
    }
  }

  if (choice === 0) {
    probe = await probeXcodeAutomationAccess();
    if (probe.granted) {
      onLine?.('Run: 已获得 Xcode 自动化权限');
      return { granted: true };
    }
  }

  if (choice === 2) {
    onLine?.('Run: 未授权自动化，将改用 xcodebuild + simctl');
    return { granted: false, useFallback: true };
  }

  onLine?.('Run: 已取消 Xcode 自动化授权');
  return { granted: false, canceled: true };
}

/**
 * @param {{ browserWindow?: import('electron').BrowserWindow | null, onLine?: (line: string) => void, interactive?: boolean }} [opts]
 */
async function ensureXcodeAutomationPermission(opts = {}) {
  if (process.platform !== 'darwin') {
    return { granted: false, message: '仅支持 macOS' };
  }

  const probe = await probeXcodeAutomationAccess();
  if (probe.granted) {
    return { granted: true };
  }

  if (opts.interactive === false) {
    return { granted: false, needsAutomation: true, message: probe.message };
  }

  return promptXcodeAutomationPermission(opts.browserWindow, opts.onLine);
}

module.exports = {
  isXcodeAutomationDenied,
  openXcodeAutomationSettings,
  probeXcodeAutomationAccess,
  promptXcodeAutomationPermission,
  ensureXcodeAutomationPermission,
};
