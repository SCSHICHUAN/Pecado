#!/usr/bin/env node
/**
 * macOS 开发启动：复制 Electron.app 到 .dev/ 并改写 Info.plist，
 * 使菜单栏显示 Pecado 而不是 Electron（app.setName 在 electron . 下无效）。
 */
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const APP_NAME = 'Pecado';
const ELECTRON_PKG = path.join(ROOT, 'node_modules', 'electron');
const SOURCE_APP = path.join(ELECTRON_PKG, 'dist', 'Electron.app');
const DEV_DIR = path.join(ROOT, '.dev');
const DEV_APP = path.join(DEV_DIR, 'Electron.app');
const DEV_VERSION_FILE = path.join(DEV_DIR, 'electron-version');

function readElectronVersion() {
  return fs.readFileSync(path.join(ELECTRON_PKG, 'dist', 'version'), 'utf8').trim();
}

function patchPlistValue(plistPath, key, value) {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plistPath], {
      stdio: 'pipe',
    });
  } catch {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plistPath], {
      stdio: 'pipe',
    });
  }
}

function ensureMacDevElectron() {
  if (process.platform !== 'darwin') return null;
  if (!fs.existsSync(SOURCE_APP)) {
    throw new Error(`未找到 Electron.app：${SOURCE_APP}，请先 npm install`);
  }

  const version = readElectronVersion();
  const cachedVersion = fs.existsSync(DEV_VERSION_FILE)
    ? fs.readFileSync(DEV_VERSION_FILE, 'utf8').trim()
    : '';

  if (fs.existsSync(DEV_APP) && cachedVersion === version) {
    return DEV_DIR;
  }

  fs.mkdirSync(DEV_DIR, { recursive: true });
  if (fs.existsSync(DEV_APP)) {
    fs.rmSync(DEV_APP, { recursive: true, force: true });
  }

  execFileSync('cp', ['-R', SOURCE_APP, DEV_APP], { stdio: 'inherit' });

  const plistPath = path.join(DEV_APP, 'Contents', 'Info.plist');
  patchPlistValue(plistPath, 'CFBundleName', APP_NAME);
  patchPlistValue(plistPath, 'CFBundleDisplayName', APP_NAME);
  fs.writeFileSync(DEV_VERSION_FILE, `${version}\n`, 'utf8');

  console.log(`[dev] 已准备 macOS 开发用 ${APP_NAME} 启动器（Electron ${version}）`);
  return DEV_DIR;
}

function launchElectron() {
  const env = { ...process.env };
  const devDist = ensureMacDevElectron();
  if (devDist) {
    env.ELECTRON_OVERRIDE_DIST_PATH = devDist;
  }

  const electronCli = path.join(ELECTRON_PKG, 'cli.js');
  const child = spawn(process.execPath, [electronCli, '.'], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });

  child.on('close', (code, signal) => {
    if (code === null) {
      console.error('Electron exited with signal', signal);
      process.exit(1);
    }
    process.exit(code);
  });
}

launchElectron();
