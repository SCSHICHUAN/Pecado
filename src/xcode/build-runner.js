/**
 * @file build-runner.js
 *
 * 【功能】xcodebuild 构建/测试、scheme 发现、日志解析（仅 macOS）。
 * 【调用方】xcode/tool-executor.js
 */
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const { findXcodeProject, findXcodeWorkspace, IS_DARWIN, openXcodeForProjectRoot } = require('./project');

const execFileAsync = promisify(execFile);
const LOG_TAIL_MAX = 12000;
const RUN_LOG_CAPTURE_SEC = 15;
const RUN_SETTLE_MS = 8000;
const XCODE_RUN_WAIT_MS = 240000;
const XCODE_OPEN_DELAY_MS = 3500;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {string} projectRoot
 * @returns {{ kind: 'workspace'|'project', path: string, name: string } | null}
 */
function resolveXcodeTarget(projectRoot) {
  if (!IS_DARWIN || !projectRoot) return null;
  const workspace = findXcodeWorkspace(projectRoot);
  if (workspace) {
    return { kind: 'workspace', path: workspace.workspaceDir, name: workspace.name };
  }
  const proj = findXcodeProject(projectRoot);
  if (proj) {
    return { kind: 'project', path: proj.xcodeProjDir, name: proj.name };
  }
  return null;
}

/**
 * @param {{ kind: string, path: string }} target
 * @returns {Promise<string[]>}
 */
async function listSchemes(target) {
  const flag = target.kind === 'workspace' ? '-workspace' : '-project';
  const { stdout } = await execFileAsync(
    'xcodebuild',
    ['-list', '-json', flag, target.path],
    { maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }
  );
  const json = JSON.parse(stdout || '{}');
  const schemes =
    json.workspace?.schemes ||
    json.project?.schemes ||
    (Array.isArray(json.schemes) ? json.schemes : []);
  return schemes.filter(Boolean);
}

/**
 * @param {string} projectRoot
 * @param {string} [preferredScheme]
 * @returns {Promise<string>}
 */
async function resolveScheme(projectRoot, preferredScheme) {
  const scheme = String(preferredScheme || '').trim();
  if (scheme) return scheme;
  const target = resolveXcodeTarget(projectRoot);
  if (!target) throw new Error('未找到 .xcodeproj 或 .xcworkspace');
  const schemes = await listSchemes(target);
  if (!schemes.length) throw new Error('未找到可用的 Xcode scheme');
  return schemes[0];
}

/**
 * @param {string} text
 */
function parseBuildLog(text) {
  const raw = String(text || '');
  const lines = raw.split('\n');
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const issueRe = /:(\d+):(\d+):\s*(error|warning):\s*(.+)$/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(issueRe);
    if (m) {
      const kind = m[3].toLowerCase();
      if (kind === 'error') errors.push(trimmed);
      else warnings.push(trimmed);
      continue;
    }
    if (/\berror:\s/.test(trimmed) && !/^note:/i.test(trimmed)) {
      errors.push(trimmed);
    } else if (/\bwarning:\s/.test(trimmed) && !/^note:/i.test(trimmed)) {
      warnings.push(trimmed);
    } else if (trimmed.includes('** BUILD FAILED **') || trimmed.includes('❌')) {
      errors.push(trimmed);
    }
  }

  const uniq = (arr) => [...new Set(arr)];
  return {
    errors: uniq(errors),
    warnings: uniq(warnings),
    logTail: raw.length > LOG_TAIL_MAX ? raw.slice(-LOG_TAIL_MAX) : raw,
  };
}

/**
 * @param {string[]} args
 * @param {{ onLine?: (line: string) => void, cwd?: string }} [opts]
 */
function runXcodebuild(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('xcodebuild', args, {
      cwd: opts.cwd || process.cwd(),
      env: process.env,
      shell: false,
    });
    let output = '';

    const feed = (chunk) => {
      const text = chunk.toString();
      output += text;
      if (typeof opts.onLine === 'function') {
        for (const line of text.split('\n')) {
          const t = line.trim();
          if (t) opts.onLine(t);
        }
      }
    };

    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, output });
    });
  });
}

/**
 * @param {string} projectRoot
 * @param {{ scheme?: string, destination?: string, action?: 'build'|'test', onLine?: (line: string) => void }} [opts]
 */
async function runXcodeAction(projectRoot, opts = {}) {
  if (!IS_DARWIN) {
    return { ok: false, error: 'Xcode 构建/测试仅支持 macOS', exitCode: 1, output: '' };
  }

  const target = resolveXcodeTarget(projectRoot);
  if (!target) {
    return { ok: false, error: '未找到 .xcodeproj 或 .xcworkspace', exitCode: 1, output: '' };
  }

  let scheme;
  try {
    scheme = await resolveScheme(projectRoot, opts.scheme);
  } catch (e) {
    return { ok: false, error: e.message || String(e), exitCode: 1, output: '' };
  }

  const action = opts.action === 'test' ? 'test' : 'build';
  const destination = String(opts.destination || '').trim() || 'generic/platform=iOS Simulator';
  const flag = target.kind === 'workspace' ? '-workspace' : '-project';

  const args = [flag, target.path, '-scheme', scheme, '-destination', destination, action];

  let result;
  try {
    result = await runXcodebuild(args, { onLine: opts.onLine, cwd: projectRoot });
  } catch (e) {
    return {
      ok: false,
      error: e.message || String(e),
      exitCode: 1,
      output: '',
      scheme,
      destination,
      target,
      action,
    };
  }

  const parsed = parseBuildLog(result.output);
  const ok = result.exitCode === 0;

  return {
    ok,
    exitCode: result.exitCode,
    output: result.output,
    scheme,
    destination,
    target,
    action,
    errors: parsed.errors,
    warnings: parsed.warnings,
    logTail: parsed.logTail,
    error: ok ? '' : parsed.errors[0] || `xcodebuild ${action} 失败 (exit ${result.exitCode})`,
  };
}

/**
 * @param {object} result
 * @returns {string}
 */
function formatBuildObservation(result) {
  if (!result || typeof result !== 'object') return String(result ?? '');

  if (result.error && !result.output && !result.errors?.length) {
    return String(result.error);
  }

  const lines = [];
  const action = result.action === 'test' ? '测试' : '构建';
  lines.push(
    result.ok
      ? `Xcode ${action}成功 (exit 0)`
      : `Xcode ${action}失败 (exit ${result.exitCode ?? '?'})`
  );
  if (result.target?.path) lines.push(`工程: ${result.target.path}`);
  if (result.scheme) lines.push(`Scheme: ${result.scheme}`);
  if (result.destination) lines.push(`Destination: ${result.destination}`);

  if (result.errors?.length) {
    lines.push('', `Errors (${result.errors.length}):`);
    result.errors.slice(0, 40).forEach((e, i) => lines.push(`${i + 1}. ${e}`));
    if (result.errors.length > 40) lines.push(`… 另有 ${result.errors.length - 40} 条`);
  }

  if (result.warnings?.length) {
    lines.push('', `Warnings (${result.warnings.length}):`);
    result.warnings.slice(0, 20).forEach((w, i) => lines.push(`${i + 1}. ${w}`));
    if (result.warnings.length > 20) lines.push(`… 另有 ${result.warnings.length - 20} 条`);
  }

  if (result.logTail) {
    lines.push('', '--- build log (tail) ---', result.logTail);
  }

  return lines.join('\n');
}

/**
 * @param {string} stdout
 * @returns {Record<string, string>}
 */
function parseShowBuildSettings(stdout) {
  /** @type {Record<string, string>} */
  const map = {};
  for (const line of String(stdout || '').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) map[m[1]] = m[2].trim();
  }
  return map;
}

/**
 * @param {{ kind: string, path: string }} target
 * @param {string} scheme
 * @param {string} destination
 */
async function getShowBuildSettings(target, scheme, destination) {
  const flag = target.kind === 'workspace' ? '-workspace' : '-project';
  const { stdout } = await execFileAsync(
    'xcodebuild',
    [flag, target.path, '-scheme', scheme, '-destination', destination, '-showBuildSettings'],
    { maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }
  );
  return parseShowBuildSettings(stdout);
}

/**
 * @param {Record<string, string>} settings
 */
function resolveBuiltAppPath(settings) {
  const dir = settings.TARGET_BUILD_DIR || '';
  const name = settings.FULL_PRODUCT_NAME || '';
  if (!dir || !name) return '';
  const appPath = path.join(dir, name);
  return fs.existsSync(appPath) ? appPath : '';
}

/**
 * @param {string} [preferredName]
 */
async function pickIosSimulatorDevice(preferredName) {
  const { stdout } = await execFileAsync(
    'xcrun',
    ['simctl', 'list', 'devices', 'available', '-j'],
    { maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }
  );
  const json = JSON.parse(stdout || '{}');
  /** @type {Array<{ udid: string, name: string, os: string, state: string }>} */
  const candidates = [];

  for (const [runtime, devices] of Object.entries(json.devices || {})) {
    const osMatch = runtime.match(/iOS[- ]([\d.-]+)/i);
    const os = osMatch ? osMatch[1].replace(/-/g, '.') : '';
    if (!Array.isArray(devices)) continue;
    for (const d of devices) {
      if (!d?.isAvailable || !d.udid || !d.name) continue;
      if (!/^iPhone|^iPad/.test(d.name)) continue;
      candidates.push({
        udid: d.udid,
        name: d.name,
        os,
        state: d.state || '',
      });
    }
  }

  if (!candidates.length) {
    throw new Error('未找到可用的 iOS 模拟器');
  }

  const pref = String(preferredName || '').trim();
  const picked =
    (pref && candidates.find((c) => c.name === pref)) ||
    candidates.find((c) => c.state === 'Booted') ||
    candidates.find((c) => /^iPhone/.test(c.name)) ||
    candidates[0];

  const destination = picked.os
    ? `platform=iOS Simulator,id=${picked.udid}`
    : `platform=iOS Simulator,id=${picked.udid}`;

  return { ...picked, destination };
}

/**
 * @returns {Promise<{ udid: string, name: string } | null>}
 */
async function findBootedSimulator() {
  const { stdout } = await execFileAsync(
    'xcrun',
    ['simctl', 'list', 'devices', 'available', '-j'],
    { maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }
  );
  const json = JSON.parse(stdout || '{}');
  for (const devices of Object.values(json.devices || {})) {
    if (!Array.isArray(devices)) continue;
    for (const d of devices) {
      if (d?.state === 'Booted' && d.udid && d.name) {
        return { udid: d.udid, name: d.name };
      }
    }
  }
  return null;
}

async function openSimulatorApp() {
  try {
    await execFileAsync('open', ['-a', 'Simulator'], { encoding: 'utf8' });
  } catch (_) {
    /* Simulator 可能已打开 */
  }
}

/**
 * @param {string} script
 */
async function runAppleScript(script) {
  await execFileAsync('osascript', ['-e', script], {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

/**
 * 等同 Xcode ⌘R：激活 Xcode 并 run（使用当前 scheme / destination）。
 * @param {string} projectRoot
 * @param {{ kind: string, path: string }} target
 */
async function triggerXcodeCommandR(projectRoot, target) {
  openXcodeForProjectRoot(projectRoot);
  await delay(XCODE_OPEN_DELAY_MS);

  const xcodePath = target.path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `
    tell application "Xcode"
      activate
      try
        open POSIX file "${xcodePath}"
      end try
      delay 1.5
      run
    end tell
  `;

  try {
    await runAppleScript(script);
    return { launchOutput: '已通过 Xcode Run（⌘R）启动构建与运行' };
  } catch (e) {
    const fallback = `
      tell application "Xcode"
        activate
        run
      end tell
    `;
    await runAppleScript(fallback);
    return {
      launchOutput: `Xcode Run（⌘R）已触发（${e.message || 'open 步骤跳过'}）`,
    };
  }
}

/**
 * @param {(line: string) => void} [onLine]
 */
async function waitForXcodeBuildOutcome(onLine) {
  const start = Date.now();
  while (Date.now() - start < XCODE_RUN_WAIT_MS) {
    const elapsed = Math.round((Date.now() - start) / 1000);
    onLine?.(`Run: 等待 Xcode ⌘R 完成… (${elapsed}s)`);
    try {
      const { stdout } = await execFileAsync(
        'log',
        [
          'show',
          '--last',
          '60s',
          '--style',
          'compact',
          '--predicate',
          'eventMessage CONTAINS[c] "BUILD SUCCEEDED" OR eventMessage CONTAINS[c] "BUILD FAILED" OR eventMessage CONTAINS[c] "Testing failed" OR eventMessage CONTAINS[c] "Launching"',
        ],
        { timeout: 25000, maxBuffer: 8 * 1024 * 1024 }
      );
      if (/BUILD SUCCEEDED|Testing succeeded on/i.test(stdout)) {
        return { ok: true, buildLog: stdout };
      }
      if (/BUILD FAILED|Testing failed on/i.test(stdout)) {
        const parsed = parseBuildLog(stdout);
        return {
          ok: false,
          buildLog: stdout,
          errors: parsed.errors,
          error: parsed.errors[0] || 'Xcode 构建失败',
        };
      }
    } catch (_) {
      /* log show 可能暂时不可用 */
    }
    await delay(4000);
  }
  return { ok: null, timedOut: true, error: '等待 Xcode Run 超时（可查看 Xcode 窗口确认）' };
}

/**
 * @param {string} output
 */
function parseAppPathFromBuildOutput(output) {
  const lines = String(output || '').split('\n');
  for (const line of lines) {
    const m = line.match(/(?:Touch|Validate|CodeSign(?:ing)?)\s+(\/[^\s]+\.app)/i);
    if (m && fs.existsSync(m[1])) return m[1];
  }
  return '';
}

/**
 * @param {string} udid
 * @param {string} bundleId
 */
async function isAppRunningOnSimulator(udid, bundleId) {
  if (!udid || !bundleId) return false;
  try {
    const { stdout } = await execFileAsync(
      'xcrun',
      ['simctl', 'spawn', udid, 'launchctl', 'list'],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 15000 }
    );
    return stdout.includes(bundleId);
  } catch {
    return false;
  }
}

async function ensureSimulatorBooted(udid) {
  try {
    await execFileAsync('xcrun', ['simctl', 'boot', udid], { encoding: 'utf8' });
  } catch (e) {
    const msg = e.message || String(e);
    if (!/current state Booted|Unable to boot device in current state Booted/i.test(msg)) {
      throw e;
    }
  }
  try {
    await execFileAsync('xcrun', ['simctl', 'bootstatus', udid, '-b'], {
      encoding: 'utf8',
      timeout: 120000,
    });
  } catch (_) {
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/**
 * @param {string} udid
 * @param {string} appPath
 * @param {string} bundleId
 */
async function launchOnSimulator(udid, appPath, bundleId) {
  await ensureSimulatorBooted(udid);
  await execFileAsync('xcrun', ['simctl', 'install', udid, appPath], {
    maxBuffer: 4 * 1024 * 1024,
    encoding: 'utf8',
  });
  const { stdout, stderr } = await execFileAsync(
    'xcrun',
    ['simctl', 'launch', udid, bundleId],
    { encoding: 'utf8' }
  );
  const launchOut = `${stdout || ''}${stderr || ''}`.trim();
  const pidMatch = launchOut.match(/:\s*(\d+)\s*$/m);
  return {
    pid: pidMatch ? Number(pidMatch[1]) : null,
    launchOutput: launchOut || `已启动 ${bundleId}`,
  };
}

/**
 * @param {string} udid
 * @param {number} [seconds]
 */
async function captureSimulatorLogs(udid, seconds = RUN_LOG_CAPTURE_SEC) {
  try {
    const { stdout } = await execFileAsync(
      'xcrun',
      [
        'simctl',
        'spawn',
        udid,
        'log',
        'show',
        '--last',
        `${seconds}s`,
        '--style',
        'compact',
      ],
      { maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', timeout: 30000 }
    );
    const raw = String(stdout || '');
    return raw.length > LOG_TAIL_MAX ? raw.slice(-LOG_TAIL_MAX) : raw;
  } catch (e) {
    return `(无法读取模拟器日志: ${e.message || String(e)})`;
  }
}

/**
 * @param {string} appPath
 */
async function launchMacApp(appPath) {
  await execFileAsync('open', [appPath], { encoding: 'utf8' });
  return { launchOutput: `已通过 open 启动 ${appPath}` };
}

function isMacOsDestination(destination, settings) {
  const dest = String(destination || '').toLowerCase();
  const sdk = String(settings?.SDKROOT || '').toLowerCase();
  return dest.includes('platform=macos') || sdk.includes('macosx');
}

/**
 * simctl 回退：xcodebuild + install + launch（Xcode ⌘R 不可用时的备选）
 */
async function runViaSimctl(projectRoot, opts = {}) {
  const target = resolveXcodeTarget(projectRoot);
  if (!target) {
    return { ok: false, error: '未找到 .xcodeproj 或 .xcworkspace', action: 'run', exitCode: 1 };
  }

  let scheme;
  try {
    scheme = await resolveScheme(projectRoot, opts.scheme);
  } catch (e) {
    return { ok: false, error: e.message || String(e), action: 'run', exitCode: 1 };
  }

  let destination = String(opts.destination || '').trim();
  let simulator = null;
  const explicitMac = /platform=macos/i.test(destination);

  if (!explicitMac) {
    try {
      simulator = await pickIosSimulatorDevice(opts.simulator);
      destination = simulator.destination;
    } catch (e) {
      return { ok: false, error: e.message || String(e), action: 'run', runMethod: 'simctl', exitCode: 1 };
    }
    await openSimulatorApp();
  }

  opts.onLine?.(`Run: xcodebuild 编译 scheme「${scheme}」…`);
  const buildResult = await runXcodeAction(projectRoot, {
    scheme,
    destination,
    action: 'build',
    onLine: opts.onLine,
  });

  if (!buildResult.ok) {
    return {
      ...buildResult,
      action: 'run',
      runPhase: 'build',
      runMethod: 'simctl',
      error: buildResult.error || '编译失败，无法 Run',
    };
  }

  let appPath = parseAppPathFromBuildOutput(buildResult.output);
  const settings = await getShowBuildSettings(target, scheme, destination);
  if (!appPath) appPath = resolveBuiltAppPath(settings);
  const bundleId = settings.PRODUCT_BUNDLE_IDENTIFIER || '';

  if (!appPath) {
    return {
      ok: false,
      action: 'run',
      runPhase: 'launch',
      runMethod: 'simctl',
      error: '编译成功但未找到 .app 产物',
      scheme,
      destination,
      buildResult,
    };
  }

  opts.onLine?.(`Run: 产物 ${appPath}`);

  let launchInfo = {};
  let runtimeLog = '';

  try {
    if (isMacOsDestination(destination, settings)) {
      launchInfo = await launchMacApp(appPath);
      await delay(RUN_SETTLE_MS);
      runtimeLog = 'macOS 应用已通过 open 启动。';
    } else {
      if (!simulator) simulator = await pickIosSimulatorDevice(opts.simulator);
      if (!bundleId) {
        return {
          ok: false,
          action: 'run',
          runPhase: 'launch',
          runMethod: 'simctl',
          error: '无法读取 PRODUCT_BUNDLE_IDENTIFIER',
          appPath,
          buildResult,
        };
      }
      opts.onLine?.(`Run: 安装并启动 ${bundleId}…`);
      launchInfo = await launchOnSimulator(simulator.udid, appPath, bundleId);
      await delay(RUN_SETTLE_MS);
      runtimeLog = await captureSimulatorLogs(simulator.udid);
    }
  } catch (e) {
    return {
      ok: false,
      action: 'run',
      runPhase: 'launch',
      runMethod: 'simctl',
      error: e.message || String(e),
      appPath,
      bundleId,
      buildResult,
      launchInfo,
      runtimeLog,
    };
  }

  return finalizeRunResult({
    scheme,
    destination,
    appPath,
    bundleId,
    simulator,
    launchInfo,
    runtimeLog,
    buildResult,
    runMethod: 'simctl',
  });
}

function finalizeRunResult(ctx) {
  const runtimeLog = ctx.runtimeLog || '';
  /** @type {string[]} */
  const crashHints = [...(ctx.crashHints || [])];
  const logLower = runtimeLog.toLowerCase();
  if (/fatal error|assertion failed|terminating app due to uncaught|signal abrt| crashed /.test(logLower)) {
    crashHints.push('运行日志中疑似出现崩溃或未捕获异常');
  }
  if (ctx.buildOutcome?.timedOut) {
    crashHints.push('未在时限内从系统日志确认 BUILD SUCCEEDED，请查看 Xcode 是否仍在构建');
  }

  let ok = ctx.runOk;
  if (ok === undefined) {
    ok = ctx.buildOutcome?.ok !== false && ctx.appRunning !== false;
  }
  if (ctx.buildOutcome?.ok === false) ok = false;
  if (ctx.appRunning === false) ok = false;

  return {
    ok: Boolean(ok),
    action: 'run',
    runPhase: ctx.buildOutcome?.ok === false ? 'build' : 'done',
    runMethod: ctx.runMethod || 'xcode-cmd-r',
    exitCode: ok ? 0 : 1,
    scheme: ctx.scheme,
    destination: ctx.destination,
    appPath: ctx.appPath,
    bundleId: ctx.bundleId,
    simulator: ctx.simulator ? { name: ctx.simulator.name, udid: ctx.simulator.udid } : null,
    launchInfo: ctx.launchInfo,
    runtimeLog,
    crashHints: [...new Set(crashHints)],
    buildResult: ctx.buildResult,
    buildOutcome: ctx.buildOutcome,
    appRunning: ctx.appRunning,
    error: ok ? '' : ctx.error || crashHints[0] || 'Run 未完成',
  };
}

/**
 * @param {string} projectRoot
 * @param {{ scheme?: string, destination?: string, simulator?: string, onLine?: (line: string) => void }} [opts]
 */
async function runXcodeProject(projectRoot, opts = {}) {
  if (!IS_DARWIN) {
    return { ok: false, error: 'Xcode Run 仅支持 macOS', action: 'run', exitCode: 1 };
  }

  const target = resolveXcodeTarget(projectRoot);
  if (!target) {
    return { ok: false, error: '未找到 .xcodeproj 或 .xcworkspace', action: 'run', exitCode: 1 };
  }

  let scheme;
  try {
    scheme = await resolveScheme(projectRoot, opts.scheme);
  } catch (e) {
    return { ok: false, error: e.message || String(e), action: 'run', exitCode: 1 };
  }

  const explicitMac = /platform=macos/i.test(String(opts.destination || ''));

  if (explicitMac) {
    return runViaSimctl(projectRoot, opts);
  }

  opts.onLine?.('Run: 打开 Simulator…');
  await openSimulatorApp();

  /** @type {object} */
  let launchInfo = {};
  let buildOutcome = null;

  try {
    opts.onLine?.('Run: 触发 Xcode ⌘R（与 Xcode 播放按钮相同）…');
    launchInfo = await triggerXcodeCommandR(projectRoot, target);
    buildOutcome = await waitForXcodeBuildOutcome(opts.onLine);
  } catch (e) {
    opts.onLine?.(`Run: Xcode ⌘R 不可用 (${e.message || e})，改用 xcodebuild…`);
    return runViaSimctl(projectRoot, opts);
  }

  if (buildOutcome?.ok === false) {
    return finalizeRunResult({
      scheme,
      destination: '(Xcode 当前 Run destination)',
      launchInfo,
      runtimeLog: buildOutcome.buildLog || '',
      buildOutcome,
      runMethod: 'xcode-cmd-r',
      runOk: false,
      error: buildOutcome.error || 'Xcode 构建失败',
      crashHints: buildOutcome.errors?.length ? ['Xcode 报告构建失败'] : [],
    });
  }

  await delay(RUN_SETTLE_MS);

  let simulator = await findBootedSimulator();
  if (!simulator) {
    try {
      simulator = await pickIosSimulatorDevice(opts.simulator);
      await ensureSimulatorBooted(simulator.udid);
    } catch (_) {
      simulator = null;
    }
  }

  let settings = {};
  let bundleId = '';
  let appPath = '';
  let destination = simulator
    ? `platform=iOS Simulator,id=${simulator.udid}`
    : '(Xcode Run destination)';

  if (simulator) {
    try {
      settings = await getShowBuildSettings(target, scheme, destination);
      bundleId = settings.PRODUCT_BUNDLE_IDENTIFIER || '';
      appPath = resolveBuiltAppPath(settings);
    } catch (_) {
      /* showBuildSettings 可能因 destination 与 Xcode 不一致而失败 */
    }
  }

  let runtimeLog = '';
  if (simulator) {
    runtimeLog = await captureSimulatorLogs(simulator.udid, RUN_LOG_CAPTURE_SEC);
  }
  if (buildOutcome?.buildLog) {
    runtimeLog = `${buildOutcome.buildLog}\n\n${runtimeLog}`.trim();
  }

  const timedOut = buildOutcome?.ok == null;
  const appRunning =
    simulator && bundleId ? await isAppRunningOnSimulator(simulator.udid, bundleId) : null;
  const runOk =
    buildOutcome?.ok === false
      ? false
      : appRunning === true || buildOutcome?.ok === true
        ? true
        : !timedOut;

  return finalizeRunResult({
    scheme,
    destination,
    appPath,
    bundleId,
    simulator,
    launchInfo,
    runtimeLog,
    buildOutcome: timedOut ? { ...buildOutcome, timedOut: true } : buildOutcome,
    runMethod: 'xcode-cmd-r',
    runOk,
    appRunning,
    error: timedOut ? buildOutcome?.error : appRunning === false ? '应用可能未在模拟器上成功启动' : '',
  });
}

/**
 * @param {object} result
 * @returns {string}
 */
function formatRunObservation(result) {
  if (!result || typeof result !== 'object') return String(result ?? '');

  if (result.error && result.runPhase === 'build' && result.errors) {
    return formatBuildObservation(result);
  }

  const lines = [];
  lines.push(
    result.ok
      ? 'Xcode Run 成功：已编译并在目标上启动应用'
      : `Xcode Run 未完成 (${result.runPhase || 'unknown'})`
  );

  if (result.runMethod === 'xcode-cmd-r') {
    lines.push('方式: Xcode ⌘R（与播放按钮相同）');
  } else if (result.runMethod === 'simctl') {
    lines.push('方式: xcodebuild + simctl（Xcode ⌘R 不可用时的回退）');
  }

  if (result.appRunning === true) lines.push('模拟器进程: 已检测到应用在运行');
  if (result.appRunning === false) lines.push('模拟器进程: 未检测到应用在运行');

  if (result.scheme) lines.push(`Scheme: ${result.scheme}`);
  if (result.destination) lines.push(`Destination: ${result.destination}`);
  if (result.appPath) lines.push(`App: ${result.appPath}`);
  if (result.bundleId) lines.push(`Bundle ID: ${result.bundleId}`);
  if (result.simulator?.name) {
    lines.push(`Simulator: ${result.simulator.name} (${result.simulator.udid})`);
  }
  if (result.launchInfo?.launchOutput) {
    lines.push('', 'Launch:', result.launchInfo.launchOutput);
  }
  if (result.launchInfo?.pid) lines.push(`PID: ${result.launchInfo.pid}`);

  if (result.crashHints?.length) {
    lines.push('', 'Run 问题:');
    result.crashHints.forEach((h, i) => lines.push(`${i + 1}. ${h}`));
  }

  if (result.error && !result.ok) {
    lines.push('', `Error: ${result.error}`);
  }

  if (result.buildResult && !result.buildResult.ok && result.buildResult.errors?.length) {
    lines.push('', 'Build errors:');
    result.buildResult.errors.slice(0, 10).forEach((e, i) => lines.push(`${i + 1}. ${e}`));
  }

  if (result.runtimeLog) {
    lines.push('', '--- runtime log ---', result.runtimeLog);
  } else if (result.buildResult?.logTail) {
    lines.push('', '--- build log (tail) ---', result.buildResult.logTail);
  }

  return lines.join('\n');
}

/**
 * @param {string} projectRoot
 */
async function getProjectStatus(projectRoot) {
  if (!IS_DARWIN) {
    return { ok: false, error: 'Xcode 仅支持 macOS', platform: process.platform };
  }
  const target = resolveXcodeTarget(projectRoot);
  if (!target) {
    return { ok: false, error: '未找到 .xcodeproj 或 .xcworkspace', projectRoot };
  }
  let schemes = [];
  try {
    schemes = await listSchemes(target);
  } catch (e) {
    return {
      ok: false,
      error: `读取 scheme 失败：${e.message || String(e)}`,
      target,
      projectRoot,
    };
  }
  return {
    ok: true,
    projectRoot,
    target,
    schemes,
    defaultScheme: schemes[0] || '',
    suggestedDestination: 'generic/platform=iOS Simulator',
  };
}

/**
 * @param {object} status
 * @returns {string}
 */
function formatProjectStatusObservation(status) {
  if (!status?.ok) {
    return status?.error || '无法读取 Xcode 工程状态';
  }
  const lines = [
    `工程根目录: ${status.projectRoot}`,
    `Xcode ${status.target.kind}: ${status.target.path}`,
    `名称: ${status.target.name}`,
    `Schemes (${status.schemes.length}): ${status.schemes.join(', ') || '—'}`,
    `默认 scheme: ${status.defaultScheme || '—'}`,
    `建议 destination: ${status.suggestedDestination}`,
    '',
    '可用工具: xcode_build（编译检查）、xcode_run（等同 Xcode Run 播放：编译+启动+运行日志）、xcode_test（运行测试）。' +
    '编译通过后请用 xcode_run 验证应用能否正常启动。',
  ];
  return lines.join('\n');
}

module.exports = {
  resolveXcodeTarget,
  listSchemes,
  resolveScheme,
  parseBuildLog,
  runXcodeAction,
  runXcodeProject,
  formatBuildObservation,
  formatRunObservation,
  getProjectStatus,
  formatProjectStatusObservation,
};
