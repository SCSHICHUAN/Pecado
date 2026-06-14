/**
 * @file build-runner.js
 * xcodebuild 构建/测试、xcode_run（simctl 安装启动）、Run 缓存与加速。仅 macOS。
 * 调用方：xcode/agent/tools.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const { findXcodeProject, findXcodeWorkspace, IS_DARWIN } = require('./project');
const { formatStepElapsed } = require('../shared/agent-log');

const execFileAsync = promisify(execFile);
const LOG_TAIL_MAX = 12000;
const RUN_LOG_CAPTURE_SEC = 2;
const RUN_SETTLE_MS = 400;
const RUN_SETTLE_MS_FAST = 100;
/** 编译用 generic destination；Apple Silicon 限定 arm64 减少切片工作 */
const SIMULATOR_BUILD_DESTINATION =
  process.arch === 'arm64'
    ? 'generic/platform=iOS Simulator,arch=arm64'
    : 'generic/platform=iOS Simulator';
const SOURCE_SCAN_SKIP_DIRS = new Set([
  'DerivedData',
  'build',
  'Pods',
  'Carthage',
  '.build',
  'node_modules',
]);

function shouldSkipSourceScanDir(name) {
  return name.startsWith('.') || SOURCE_SCAN_SKIP_DIRS.has(name);
}

const SOURCE_EXTS = new Set(['.swift', '.m', '.mm', '.c', '.cpp', '.cc', '.h', '.hpp']);
const SOURCE_SCAN_MAX_DEPTH = 8;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * xcode_run 分步进度：上一步在下一步 log 出现时结算耗时（秒表），仅写 log 面板。
 */
function createRunProgress(onLine) {
  let stepStart = Date.now();
  /** @type {{ raw: string, isError?: boolean } | null} */
  let openStep = null;

  function completeOpenStep(elapsedMs) {
    if (!openStep || typeof onLine !== 'function') return;
    const step = openStep;
    openStep = null;
    if (step.isError) return;
    onLine({
      text: `${step.raw}  ${formatStepElapsed(elapsedMs)}`,
      raw: step.raw,
      elapsedMs,
    });
  }

  function emit(text, opts = {}) {
    if (typeof onLine !== 'function') return;
    const now = Date.now();
    const elapsedMs = now - stepStart;
    stepStart = now;
    const raw = String(text || '').trim();
    if (!raw) return;
    if (openStep) completeOpenStep(elapsedMs);
    openStep = { raw, isError: Boolean(opts.isError) };
  }

  function finish() {
    if (!openStep) return;
    completeOpenStep(Date.now() - stepStart);
    stepStart = Date.now();
  }

  /** 当前步骤结束（不开启下一步）；可选附带 BUILD 结果，避免与流式 BUILD 行重复 */
  function completeStep(result = {}) {
    if (!openStep || typeof onLine !== 'function') return;
    const elapsedMs = Date.now() - stepStart;
    const step = openStep;
    openStep = null;
    if (step.isError) return;

    let raw = step.raw;
    if (result.skipped) {
      /* 跳过编译：保留 emit 原文，仅结算耗时 */
    } else if (result.ok === true) {
      const compiled = countCompileUnits(result.buildOutput);
      if (compiled === 0) {
        raw = `${raw.replace(/…$/, '')} · BUILD SUCCEEDED · 增量（未编译新文件）`;
      } else {
        raw = `${raw.replace(/…$/, '')} · BUILD SUCCEEDED · 编译 ${compiled} 个文件`;
      }
    } else if (result.ok === false) {
      raw = `${raw.replace(/…$/, '')} · BUILD FAILED`;
    }

    onLine({
      text: `${raw}  ${formatStepElapsed(elapsedMs)}`,
      raw,
      elapsedMs,
      isError: result.ok === false,
    });
  }

  emit.reset = () => {
    stepStart = Date.now();
    openStep = null;
  };

  return { emit, finish, completeStep };
}

/**
 * xcode_run 耗时诊断：写入 log 面板，+Δ 为本段耗时，Σ 为从 Run 开始累计
 * @param {(payload: { text: string, raw: string, elapsedMs: number }) => void} [onLine]
 */
function createRunDiagLogger(onLine) {
  const runStart = Date.now();
  let lastMark = runStart;
  /** @type {Array<{ label: string, stepMs: number, totalMs: number, detail?: string }>} */
  const marks = [];

  function publish(label, stepMs, totalMs, detail) {
    if (typeof onLine !== 'function') return;
    const detailText = detail ? ` · ${detail}` : '';
    onLine({
      text: `Run: [耗时] ${label}${detailText}  +${formatStepElapsed(stepMs)}  Σ ${formatStepElapsed(totalMs)}`,
      raw: `Run: [耗时] ${label}`,
      elapsedMs: stepMs,
    });
  }

  function mark(label, detail) {
    const now = Date.now();
    const stepMs = now - lastMark;
    const totalMs = now - runStart;
    lastMark = now;
    marks.push({ label, stepMs, totalMs, detail: detail ? String(detail) : '' });
    publish(label, stepMs, totalMs, detail);
  }

  function duration(label, ms, detail) {
    const totalMs = Date.now() - runStart;
    lastMark = Date.now();
    marks.push({ label, stepMs: ms, totalMs, detail: detail ? String(detail) : '' });
    publish(label, ms, totalMs, detail);
  }

  return {
    mark,
    duration,
    getMarks: () => marks.slice(),
    totalMs: () => Date.now() - runStart,
  };
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
  const cache = readProjectXcodeCache(projectRoot);
  if (cache.defaultScheme) return String(cache.defaultScheme);
  const target = resolveXcodeTarget(projectRoot);
  if (!target) throw new Error('未找到 .xcodeproj 或 .xcworkspace');
  const schemes = await listSchemes(target);
  if (!schemes.length) throw new Error('未找到可用的 Xcode scheme');
  const picked = schemes[0];
  writeProjectXcodeCache(projectRoot, { defaultScheme: picked, schemes });
  return picked;
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
    const env = { ...process.env, NSUnbufferedIO: 'YES' };
    if (opts.simulatorBuild) {
      Object.assign(env, {
        CODE_SIGN_IDENTITY: '-',
        EXPANDED_CODE_SIGN_IDENTITY: '-',
        CODE_SIGNING_REQUIRED: 'NO',
        CODE_SIGNING_ALLOWED: 'NO',
        PROVISIONING_PROFILE: '',
        PROVISIONING_PROFILE_SPECIFIER: '',
      });
    }
    const child = spawn('xcodebuild', args, {
      cwd: opts.cwd || process.cwd(),
      env,
      shell: false,
    });
    let output = '';
    let appReadyEmitted = false;
    const outputCap = LOG_TAIL_MAX * 4;

    const feed = (chunk) => {
      const text = chunk.toString();
      output += text;
      if (output.length > outputCap) {
        output = output.slice(-LOG_TAIL_MAX * 2);
      }
      if (typeof opts.onLine === 'function' || typeof opts.onAppReady === 'function') {
        for (const line of text.split('\n')) {
          const t = line.trim();
          if (!t) continue;
          if (typeof opts.onLine === 'function') opts.onLine(t);
          if (!appReadyEmitted && typeof opts.onAppReady === 'function') {
            const appPath = parseAppPathFromBuildLine(t);
            if (appPath) {
              appReadyEmitted = true;
              opts.onAppReady(appPath);
            }
          }
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

/** Debug 模拟器构建加速；暖构建也关闭 Index Store（不影响增量） */
function buildXcodeFastSettings(destination, action, warmBuild) {
  if (action !== 'build') return [];
  if (!/simulator/i.test(String(destination || ''))) return [];
  const fast = [
    'COMPILER_INDEX_STORE_ENABLE=NO',
    'SWIFT_EMIT_LOC_STRINGS=NO',
    'CODE_SIGN_IDENTITY=-',
    'CODE_SIGNING_REQUIRED=NO',
    'AD_HOC_CODE_SIGNING_ALLOWED=YES',
    'ONLY_ACTIVE_ARCH=YES',
  ];
  if (!warmBuild) {
    fast.push('DEBUG_INFORMATION_FORMAT=dwarf');
  }
  return fast;
}

function resolveSimulatorBuildDestination(explicitMac, runDestination) {
  if (explicitMac) {
    return String(runDestination || '').trim() || 'platform=macOS';
  }
  return SIMULATOR_BUILD_DESTINATION;
}

function buildLogHasPortalSessionError(output) {
  return /DVTPortal|session has expired|DVTPortalServiceErrorDomain Code=1100/i.test(String(output || ''));
}

/**
 * 模拟器 Run 专用 xcconfig：跳过 Portal Provisioning（比命令行 KEY=VALUE 更可靠）
 * @param {string} projectRoot
 */
function ensureSimulatorRunXcconfig(projectRoot) {
  if (!projectRoot) return '';
  const dir = path.join(projectRoot, '.pecado');
  const xcconfigPath = path.join(dir, 'simulator-run.xcconfig');
  const content = [
    'CODE_SIGN_STYLE = Manual',
    'DEVELOPMENT_TEAM =',
    'PROVISIONING_PROFILE_SPECIFIER =',
    'PROVISIONING_PROFILE =',
    'CODE_SIGN_IDENTITY = -',
    'EXPANDED_CODE_SIGN_IDENTITY = -',
    'CODE_SIGNING_REQUIRED = NO',
    'CODE_SIGNING_ALLOWED = NO',
    'AD_HOC_CODE_SIGNING_ALLOWED = YES',
    'COMPILER_INDEX_STORE_ENABLE = NO',
    'SWIFT_EMIT_LOC_STRINGS = NO',
    'SWIFT_COMPILATION_MODE = incremental',
    'CLANG_ENABLE_MODULE_DEBUGGING = NO',
    'ENABLE_PREVIEWS = NO',
    'VALIDATE_PRODUCT = NO',
    'DEBUG_INFORMATION_FORMAT = dwarf',
    'GCC_GENERATE_DEBUGGING_SYMBOLS = NO',
    'ONLY_ACTIVE_ARCH = YES',
    'ENABLE_USER_SCRIPT_SANDBOXING = NO',
  ].join('\n');
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(xcconfigPath) || fs.readFileSync(xcconfigPath, 'utf8') !== `${content}\n`) {
      fs.writeFileSync(xcconfigPath, `${content}\n`);
    }
    return xcconfigPath;
  } catch {
    return '';
  }
}

function readProjectXcodeCache(projectRoot) {
  try {
    const p = path.join(projectRoot, '.pecado', 'xcode-cache.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function writeProjectXcodeCache(projectRoot, patch) {
  if (!projectRoot) return;
  try {
    const dir = path.join(projectRoot, '.pecado');
    fs.mkdirSync(dir, { recursive: true });
    const prev = readProjectXcodeCache(projectRoot);
    fs.writeFileSync(
      path.join(dir, 'xcode-cache.json'),
      JSON.stringify({ ...prev, ...patch, updatedAt: Date.now() }, null, 2)
    );
  } catch {
    /* 缓存写入失败不影响构建 */
  }
}

/**
 * 复用 Xcode 已有 DerivedData，避免冷缓存重复全量编译
 * @param {string} projectRoot
 * @returns {string}
 */
function resolveDerivedDataPathForProject(projectRoot) {
  const cached = readProjectXcodeCache(projectRoot);
  if (cached.derivedDataPath && fs.existsSync(cached.derivedDataPath)) {
    return cached.derivedDataPath;
  }
  const found = findDerivedDataRootForProject(projectRoot);
  if (found) writeProjectXcodeCache(projectRoot, { derivedDataPath: found });
  return found || '';
}

/**
 * @param {string} projectRoot
 * @param {string} buildOutput
 */
function rememberDerivedDataFromBuild(projectRoot, buildOutput) {
  const fromLog = parseDerivedDataRootFromBuildOutput(buildOutput);
  if (fromLog) {
    writeProjectXcodeCache(projectRoot, { derivedDataPath: fromLog });
    return fromLog;
  }
  const found = findDerivedDataRootForProject(projectRoot);
  if (found) writeProjectXcodeCache(projectRoot, { derivedDataPath: found });
  return found || '';
}

/**
 * @param {string} output
 */
function countCompileUnits(output) {
  const keys = new Set();
  for (const line of String(output || '').split('\n')) {
    if (!/CompileC |SwiftCompile /.test(line)) continue;
    const m = line.match(/\/([^/]+\.(m|mm|swift|c|cpp|cc))\s/);
    keys.add(m ? m[1] : line.slice(0, 80));
  }
  return keys.size;
}

/**
 * @param {string} projectRoot
 * @param {string} scheme
 * @param {boolean} forSimulator
 */
function resolvePreflightRunApp(projectRoot, scheme, forSimulator) {
  const derivedRoot = resolveDerivedDataPathForProject(projectRoot);
  if (!derivedRoot) return '';
  if (forSimulator) return findSimulatorAppInDerivedData(derivedRoot, scheme);
  return '';
}

/**
 * @param {string} projectRoot
 * @param {string} appPath
 */
function canSkipRunBuild(projectRoot, appPath) {
  if (!appPath || !fs.existsSync(appPath)) return false;
  const cache = readProjectXcodeCache(projectRoot);
  const appSig = getAppSignature(appPath);

  if (cache.lastRunAppSignature === appSig) {
    if (Number(cache.lastSourceMtime) > 0) {
      return !hasSourceNewerThan(projectRoot, Number(cache.lastSourceMtime));
    }
    return true;
  }

  if (
    cache.lastRunAppPath === appPath &&
    cache.lastRunAppSignature === appSig &&
    Number(cache.lastSourceMtime) > 0
  ) {
    return !hasSourceNewerThan(projectRoot, Number(cache.lastSourceMtime));
  }

  // 产物签名已变或首次 Run：必编译，不做全树源码扫描
  return false;
}

/**
 * @param {string} projectRoot
 * @param {number} sinceMs
 */
function hasSourceNewerThan(projectRoot, sinceMs) {
  return scanSourceNewerThan(projectRoot, 0, sinceMs + 500);
}

/**
 * @param {string} dir
 * @param {number} depth
 * @param {number} thresholdMs
 */
function scanSourceNewerThan(dir, depth, thresholdMs) {
  if (depth > SOURCE_SCAN_MAX_DEPTH) return false;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (shouldSkipSourceScanDir(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (scanSourceNewerThan(full, depth + 1, thresholdMs)) return true;
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!SOURCE_EXTS.has(ext)) continue;
    try {
      if (fs.statSync(full).mtimeMs > thresholdMs) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/**
 * @param {string} appPath
 */
function getAppSignature(appPath) {
  try {
    const appStat = fs.statSync(appPath);
    const plistStat = fs.statSync(path.join(appPath, 'Info.plist'));
    return `${appStat.mtimeMs}:${plistStat.mtimeMs}:${appStat.size}`;
  } catch {
    return '';
  }
}

/**
 * @param {string} udid
 * @param {string} bundleId
 * @param {string} appPath
 * @param {string} projectRoot
 */
function canSkipSimInstall(udid, bundleId, appPath, projectRoot) {
  const sig = getAppSignature(appPath);
  if (!sig) return false;
  const li = readProjectXcodeCache(projectRoot).lastInstall;
  return Boolean(li && li.udid === udid && li.bundleId === bundleId && li.appSignature === sig);
}

/**
 * @param {string} projectRoot
 * @param {{ appPath?: string, simulator?: { udid?: string }, bundleId?: string }} ctx
 */
function rememberSuccessfulRun(projectRoot, ctx = {}) {
  const appPath = String(ctx.appPath || '').trim();
  const patch = {};
  if (appPath) {
    patch.lastRunAppPath = appPath;
    patch.lastRunAppSignature = getAppSignature(appPath);
  }
  if (ctx.bundleId) {
    patch.lastBundleId = String(ctx.bundleId);
  }
  if (appPath && ctx.simulator?.udid && ctx.bundleId) {
    patch.lastInstall = {
      udid: ctx.simulator.udid,
      bundleId: ctx.bundleId,
      appSignature: getAppSignature(appPath),
    };
  }
  if (Object.keys(patch).length) writeProjectXcodeCache(projectRoot, patch);
  if (appPath) {
    setImmediate(() => {
      try {
        writeProjectXcodeCache(projectRoot, {
          lastSourceMtime: getLatestSourceMtimeMs(projectRoot),
        });
      } catch {
        /* 后台扫描失败不影响 Run */
      }
    });
  }
}

/**
 * @param {string} projectRoot
 * @param {{ kind: string, path: string }} target
 */
function hasSwiftPackageLock(projectRoot, target) {
  const candidates = [path.join(projectRoot, 'Package.resolved')];
  if (target?.path) {
    candidates.push(path.join(target.path, 'xcshareddata', 'swiftpm', 'Package.resolved'));
  }
  return candidates.some((p) => fs.existsSync(p));
}

/**
 * @param {string} projectRoot
 * @param {{ scheme?: string, destination?: string, action?: 'build'|'test', cleanFirst?: boolean, onLine?: (line: string) => void }} [opts]
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
  const isSimBuild = /simulator/i.test(destination) && action === 'build';

  const args = [flag, target.path, '-scheme', scheme, '-destination', destination];
  const derivedDataPath = resolveDerivedDataPathForProject(projectRoot);
  const warmBuild = Boolean(derivedDataPath) && fs.existsSync(derivedDataPath) && !opts.cleanFirst;
  let simXcconfig = '';
  if (derivedDataPath) {
    args.push('-derivedDataPath', derivedDataPath);
  }
  if (hasSwiftPackageLock(projectRoot, target)) {
    args.push('-disableAutomaticPackageResolution');
  }
  if (isSimBuild) {
    args.push('-configuration', 'Debug');
    simXcconfig = ensureSimulatorRunXcconfig(projectRoot);
    if (simXcconfig) args.push('-xcconfig', simXcconfig);
  }
  if (action === 'build') {
    args.push('-parallelizeTargets', '-hideShellScriptEnvironment');
    const jobs = Math.min(Math.max(os.cpus().length, 1), 8);
    if (jobs > 1) args.push('-jobs', String(jobs));
    args.push('-quiet');
  }
  const inlineFast =
    isSimBuild && simXcconfig
      ? []
      : buildXcodeFastSettings(destination, action, warmBuild);
  if (opts.cleanFirst && action === 'build') {
    args.push('clean', 'build', ...inlineFast);
  } else {
    args.push(action, ...inlineFast);
  }

  let result;
  try {
    result = await runXcodebuild(args, {
      onLine: opts.onLine,
      onAppReady: opts.onAppReady,
      cwd: projectRoot,
      simulatorBuild: isSimBuild,
    });
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
  const name = settings.FULL_PRODUCT_NAME || settings.WRAPPER_NAME || '';
  if (!dir || !name) return '';
  const appPath = path.join(dir, name.endsWith('.app') ? name : `${name}.app`);
  return fs.existsSync(appPath) ? appPath : '';
}

/**
 * @param {string} output
 */
function parseDerivedDataRootFromBuildOutput(output) {
  const text = String(output || '');
  const fromDesc = text.match(/Build description path:\s*(.+?)\/Build\/Intermediates/i);
  if (fromDesc) return fromDesc[1].trim();
  const fromDerived = text.match(/(\/[^\s]+DerivedData\/[^/\s]+)/);
  return fromDerived ? fromDerived[1].trim() : '';
}

/**
 * @param {string} derivedRoot
 * @param {string} [scheme]
 */
function findSimulatorAppInDerivedData(derivedRoot, scheme) {
  if (!derivedRoot || !fs.existsSync(derivedRoot)) return '';
  const productsDir = path.join(derivedRoot, 'Build', 'Products');
  if (!fs.existsSync(productsDir)) return '';

  /** @type {Array<{ appPath: string, mtime: number, name: string }>} */
  const candidates = [];
  for (const entry of fs.readdirSync(productsDir)) {
    if (!entry.toLowerCase().includes('iphonesimulator')) continue;
    const dir = path.join(productsDir, entry);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.app')) continue;
      const appPath = path.join(dir, f);
      candidates.push({ appPath, mtime: fs.statSync(appPath).mtimeMs, name: f });
    }
  }
  if (!candidates.length) return '';

  const schemeNorm = String(scheme || '')
    .trim()
    .toLowerCase();
  if (schemeNorm) {
    const exact = candidates.find(
      (c) => c.name.replace(/\.app$/i, '').toLowerCase() === schemeNorm
    );
    if (exact) return exact.appPath;
  }

  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].appPath;
}

/**
 * @param {string} projectRoot
 */
function findDerivedDataRootForProject(projectRoot) {
  const target = resolveXcodeTarget(projectRoot);
  if (!target?.name) return '';
  const derivedRoot = path.join(os.homedir(), 'Library/Developer/Xcode/DerivedData');
  if (!fs.existsSync(derivedRoot)) return '';
  const prefix = `${target.name}-`;
  /** @type {Array<{ path: string, mtime: number }>} */
  const matches = [];
  for (const entry of fs.readdirSync(derivedRoot)) {
    if (!entry.startsWith(prefix)) continue;
    const full = path.join(derivedRoot, entry);
    if (!fs.statSync(full).isDirectory()) continue;
    matches.push({ path: full, mtime: fs.statSync(full).mtimeMs });
  }
  matches.sort((a, b) => b.mtime - a.mtime);
  return matches[0]?.path || '';
}

/**
 * @param {{ buildOutput?: string, settings?: Record<string, string>, scheme?: string, projectRoot?: string, forSimulator?: boolean }} ctx
 */
function resolveBuiltAppAfterBuild(ctx) {
  const buildOutput = ctx.buildOutput || '';
  const settings = ctx.settings || {};
  const scheme = ctx.scheme || '';
  const forSimulator = ctx.forSimulator !== false;

  let appPath = parseAppPathFromBuildOutput(buildOutput);
  if (appPath) return appPath;

  if (settings.TARGET_BUILD_DIR && (!forSimulator || settings.TARGET_BUILD_DIR.includes('iphonesimulator'))) {
    appPath = resolveBuiltAppPath(settings);
    if (appPath) return appPath;
  }

  let derivedRoot = parseDerivedDataRootFromBuildOutput(buildOutput);
  if (!derivedRoot && ctx.projectRoot) {
    derivedRoot = findDerivedDataRootForProject(ctx.projectRoot);
  }
  if (forSimulator && derivedRoot) {
    appPath = findSimulatorAppInDerivedData(derivedRoot, scheme);
    if (appPath) return appPath;
  }

  if (!forSimulator && settings.TARGET_BUILD_DIR) {
    appPath = resolveBuiltAppPath(settings);
    if (appPath) return appPath;
  }

  return '';
}

/**
 * @param {string} dir
 * @param {number} depth
 * @param {number} latestMs
 */
function scanLatestSourceMtime(dir, depth, latestMs) {
  if (depth > SOURCE_SCAN_MAX_DEPTH) return latestMs;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return latestMs;
  }
  for (const entry of entries) {
    if (shouldSkipSourceScanDir(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      latestMs = scanLatestSourceMtime(full, depth + 1, latestMs);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!SOURCE_EXTS.has(ext)) continue;
    try {
      latestMs = Math.max(latestMs, fs.statSync(full).mtimeMs);
    } catch {
      /* ignore unreadable file */
    }
  }
  return latestMs;
}

/**
 * @param {string} projectRoot
 */
function getLatestSourceMtimeMs(projectRoot) {
  return scanLatestSourceMtime(projectRoot, 0, 0);
}

/**
 * @param {string} appPath
 * @returns {Promise<string>}
 */
async function readBundleIdFromApp(appPath) {
  if (!appPath) return '';
  const plistPath = path.join(appPath, 'Info.plist');
  if (!fs.existsSync(plistPath)) return '';
  try {
    const { stdout } = await execFileAsync(
      'plutil',
      ['-extract', 'CFBundleIdentifier', 'raw', plistPath],
      { encoding: 'utf8' }
    );
    return String(stdout || '').trim();
  } catch {
    return '';
  }
}

/**
 * @param {string} domain
 * @param {string} key
 */
async function readMacDefault(domain, key) {
  try {
    const { stdout } = await execFileAsync('defaults', ['read', domain, key], { encoding: 'utf8' });
    return String(stdout || '').trim();
  } catch {
    return '';
  }
}

/**
 * @param {string} destination
 */
function parseDestinationUdid(destination) {
  const m = String(destination || '').match(/(?:^|[,\s])id=([A-F0-9-]{36})/i);
  return m ? m[1] : '';
}

/**
 * @param {string} destination
 */
function parseDestinationName(destination) {
  const m = String(destination || '').match(/name=([^,]+)/i);
  return m ? m[1].trim() : '';
}

/**
 * @param {string} projectRoot
 */
function findUserInterfaceStateFile(projectRoot) {
  if (!projectRoot || !fs.existsSync(projectRoot)) return '';
  /** @type {string[]} */
  const found = [];
  const scan = (dir, depth) => {
    if (depth > 8 || found.length) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'DerivedData') continue;
      const full = path.join(dir, ent.name);
      if (ent.isFile() && ent.name === 'UserInterfaceState.xcuserstate') {
        found.push(full);
        return;
      }
      if (ent.isDirectory()) scan(full, depth + 1);
    }
  };
  scan(projectRoot, 0);
  return found[0] || '';
}

/**
 * 从 Xcode 工程 UserInterfaceState 读取 Run 目标（ActiveRunDestination / 按 scheme 最近使用）。
 * @param {string} projectRoot
 * @param {string} [scheme]
 */
function readXcodeRunDestinationUdid(projectRoot, scheme) {
  const userState = findUserInterfaceStateFile(projectRoot);
  if (!userState) return '';
  let raw;
  try {
    raw = fs.readFileSync(userState);
  } catch {
    return '';
  }
  const text = raw.toString('latin1');
  const activeMatch = text.match(/dvtdevice-iphonesimulator:([A-F0-9-]{36})/i);
  if (activeMatch) return activeMatch[1];

  const schemeName = String(scheme || '').trim();
  if (!schemeName) return '';
  const lastUsedIdx = text.indexOf('LastUsedRunDestinationByScheme');
  if (lastUsedIdx < 0) return '';
  const schemeIdx = text.indexOf(schemeName, lastUsedIdx);
  if (schemeIdx < 0 || schemeIdx > lastUsedIdx + 5000) return '';
  const window = text.slice(schemeIdx, schemeIdx + 500);
  const m = window.match(/([A-F0-9-]{36})_iphonesimulator/i);
  return m ? m[1] : '';
}

/**
 * @param {string} name
 */
function iphoneSortScore(name) {
  const n = String(name || '');
  const pro = /pro max/i.test(n) ? 3 : /pro/i.test(n) ? 2 : 0;
  const numMatch = n.match(/iPhone\s+(\d+)/i);
  const num = numMatch ? Number(numMatch[1]) : /\bSE\b/i.test(n) ? 5 : 0;
  const padMatch = n.match(/iPad\s+(\d+)/i);
  if (padMatch) return Number(padMatch[1]) * 0.01;
  return num * 10 + pro;
}

/**
 * @returns {Promise<Array<{ udid: string, name: string, os: string, state: string, lastBootedAt: string }>>}
 */
async function listIosSimulatorCandidates() {
  const { stdout } = await execFileAsync(
    'xcrun',
    ['simctl', 'list', 'devices', 'available', '-j'],
    { maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }
  );
  const json = JSON.parse(stdout || '{}');
  /** @type {Array<{ udid: string, name: string, os: string, state: string, lastBootedAt: string }>} */
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
        lastBootedAt: d.lastBootedAt || '',
      });
    }
  }
  return candidates;
}

/**
 * @param {Array<{ udid: string, name: string }>} candidates
 * @param {string} udid
 */
function pickCandidateByUdid(candidates, udid) {
  const id = String(udid || '').trim();
  if (!id) return null;
  return candidates.find((c) => c.udid.toLowerCase() === id.toLowerCase()) || null;
}

/**
 * @param {Array<{ udid: string, name: string }>} candidates
 * @param {string} name
 */
function pickCandidateByName(candidates, name) {
  const pref = String(name || '').trim();
  if (!pref) return null;
  return (
    candidates.find((c) => c.name === pref) ||
    candidates.find((c) => c.name.toLowerCase() === pref.toLowerCase()) ||
    candidates.find((c) => c.name.toLowerCase().includes(pref.toLowerCase())) ||
    null
  );
}

/**
 * 解析 Run 用模拟器。优先级：显式参数 → Xcode 工程 Run 目标 → Xcode/Simulator 偏好 → 唯一 Boot → 最近 Boot → 较新 iPhone。
 * @param {{ simulator?: string, destination?: string, projectRoot?: string, scheme?: string } | string} [opts]
 */
async function pickIosSimulatorDevice(opts = {}) {
  if (typeof opts === 'string') {
    opts = { simulator: opts };
  }

  const candidates = await listIosSimulatorCandidates();
  if (!candidates.length) {
    throw new Error('未找到可用的 iOS 模拟器');
  }

  const preferredName = String(opts.simulator || '').trim();
  const destUdid = parseDestinationUdid(opts.destination);
  const destName = parseDestinationName(opts.destination);

  /** @type {{ candidate: typeof candidates[number], source: string } | null} */
  let picked = null;

  if (destUdid) {
    const c = pickCandidateByUdid(candidates, destUdid);
    if (c) picked = { candidate: c, source: 'destination id' };
  }
  if (!picked && preferredName) {
    const byUdid = pickCandidateByUdid(candidates, preferredName);
    if (byUdid) picked = { candidate: byUdid, source: 'simulator UDID 参数' };
    else {
      const byName = pickCandidateByName(candidates, preferredName);
      if (byName) picked = { candidate: byName, source: 'simulator 名称参数' };
    }
  }
  if (!picked && destName) {
    const byName = pickCandidateByName(candidates, destName);
    if (byName) picked = { candidate: byName, source: 'destination name' };
  }

  if (!picked && opts.projectRoot) {
    const li = readProjectXcodeCache(opts.projectRoot).lastInstall;
    if (li?.udid) {
      const c = pickCandidateByUdid(candidates, li.udid);
      if (c) picked = { candidate: c, source: '上次 Run 设备' };
    }
  }
  const booted = candidates.filter((c) => c.state === 'Booted');
  if (!picked && booted.length === 1) {
    picked = { candidate: booted[0], source: '唯一已 Boot 模拟器' };
  }
  if (!picked && booted.length > 1) {
    const sorted = [...booted].sort((a, b) => {
      const ta = a.lastBootedAt ? Date.parse(a.lastBootedAt) : 0;
      const tb = b.lastBootedAt ? Date.parse(b.lastBootedAt) : 0;
      return tb - ta;
    });
    picked = { candidate: sorted[0], source: '最近 Boot 的模拟器' };
  }
  if (!picked) {
    const simUdid = await readMacDefault('com.apple.iphonesimulator', 'CurrentDeviceUDID');
    const c = pickCandidateByUdid(candidates, simUdid);
    if (c) picked = { candidate: c, source: 'Simulator 当前设备' };
  }
  if (!picked) {
    const xcodeUdid = await readMacDefault(
      'com.apple.dt.Xcode',
      'DVTDevicesWindowControllerSelectedSimulatorIdentifier'
    );
    const c = pickCandidateByUdid(candidates, xcodeUdid);
    if (c) picked = { candidate: c, source: 'Xcode 已选模拟器' };
  }
  if (!picked && opts.projectRoot) {
    const udid = readXcodeRunDestinationUdid(opts.projectRoot, opts.scheme);
    const c = pickCandidateByUdid(candidates, udid);
    if (c) picked = { candidate: c, source: 'Xcode 上次 Run 目标' };
  }
  if (!picked) {
    const sorted = [...candidates].sort((a, b) => iphoneSortScore(b.name) - iphoneSortScore(a.name));
    const best = sorted.find((c) => /^iPhone/.test(c.name)) || sorted[0];
    picked = { candidate: best, source: '默认（较新 iPhone）' };
  }

  const destination = `platform=iOS Simulator,id=${picked.candidate.udid}`;
  return { ...picked.candidate, destination, selectionSource: picked.source };
}

/**
 * Boot 指定模拟器、设为 Simulator.app 当前设备并打开窗口。
 * @param {string} udid
 * @param {{ skipBoot?: boolean }} [opts]
 */
async function openSimulatorForDevice(udid, opts = {}) {
  const id = String(udid || '').trim();
  if (!id) {
    try {
      await execFileAsync('open', ['-a', 'Simulator'], { encoding: 'utf8' });
    } catch (_) {
      /* Simulator 可能已打开 */
    }
    return;
  }
  if (!opts.skipBoot) {
    await ensureSimulatorBooted(id);
  }
  try {
    await execFileAsync(
      'defaults',
      ['write', 'com.apple.iphonesimulator', 'CurrentDeviceUDID', '-string', id],
      { encoding: 'utf8' }
    );
  } catch (_) {
    /* 非致命 */
  }
  try {
    await execFileAsync('open', ['-a', 'Simulator'], { encoding: 'utf8' });
  } catch (_) {
    /* Simulator 可能已打开 */
  }
}

function parseAppPathFromBuildLine(line) {
  const t = String(line || '').trim();
  if (!t) return '';
  const m = t.match(/(?:Touch|Validate|CodeSign(?:ing)?|RegisterExecutionPolicyException)\s+(\/[^\s]+\.app)/i);
  if (m && fs.existsSync(m[1])) return m[1];
  const m2 = t.match(/(\/[^\s]+\.app)/);
  if (m2 && fs.existsSync(m2[1]) && /iphonesimulator/i.test(m2[1])) return m2[1];
  return '';
}

/**
 * @param {string} output
 */
function parseAppPathFromBuildOutput(output) {
  const lines = String(output || '').split('\n');
  for (const line of lines) {
    const appPath = parseAppPathFromBuildLine(line);
    if (appPath) return appPath;
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

function simctlErrorText(error) {
  return [error?.stderr, error?.stdout, error?.message, error]
    .filter(Boolean)
    .join('\n');
}

function isAlreadyBootedSimctlError(error) {
  return /current state:?\s*Booted|already booted|Unable to boot device in current state/i.test(
    simctlErrorText(error)
  );
}

async function ensureSimulatorBooted(udid, opts = {}) {
  if (opts.alreadyBooted) return;

  let needsBootWait = false;
  try {
    await execFileAsync('xcrun', ['simctl', 'boot', udid], { encoding: 'utf8' });
    needsBootWait = true;
  } catch (e) {
    if (isAlreadyBootedSimctlError(e)) return;
    throw e;
  }

  if (!needsBootWait) return;

  try {
    await execFileAsync('xcrun', ['simctl', 'bootstatus', udid, '-b'], {
      encoding: 'utf8',
      timeout: 120000,
    });
  } catch (e) {
    if (!isAlreadyBootedSimctlError(e)) throw e;
  }
}

/**
 * @param {string} stdout
 * @param {string} stderr
 * @param {string} bundleId
 */
function parseSimLaunchOutput(stdout, stderr, bundleId) {
  const launchOut = `${stdout || ''}${stderr || ''}`.trim();
  const pidMatch = launchOut.match(/:\s*(\d+)\s*$/m);
  return {
    pid: pidMatch ? Number(pidMatch[1]) : null,
    launchOutput: launchOut || `已启动 ${bundleId}`,
  };
}

/**
 * 编译流式检测到 .app 后，与 xcodebuild 尾段并行 install + launch
 */
function createEarlySimRunPipeline(ctx) {
  const { simulator, bundleId, diag } = ctx;
  const state = {
    promise: null,
    installDone: false,
    launchDone: false,
    launchInfo: null,
  };

  function onAppReady(readyAppPath) {
    if (!simulator?.udid || !bundleId || state.promise) return;
    state.promise = (async () => {
      const installT0 = Date.now();
      await execFileAsync('xcrun', ['simctl', 'install', simulator.udid, readyAppPath], {
        maxBuffer: 4 * 1024 * 1024,
        encoding: 'utf8',
      });
      state.installDone = true;
      diag?.duration('simctl install（与编译并行）', Date.now() - installT0);
      const launchT0 = Date.now();
      const { stdout, stderr } = await execFileAsync(
        'xcrun',
        ['simctl', 'launch', simulator.udid, bundleId],
        { encoding: 'utf8' }
      );
      state.launchInfo = parseSimLaunchOutput(stdout, stderr, bundleId);
      state.launchDone = true;
      diag?.duration('simctl launch（与编译并行）', Date.now() - launchT0);
    })().catch(() => {
      state.installDone = false;
      state.launchDone = false;
      state.promise = null;
    });
  }

  return {
    onAppReady,
    getState: () => state,
    awaitDone: async () => {
      if (state.promise) await state.promise.catch(() => {});
    },
  };
}

/**
 * @param {string} udid
 * @param {string} appPath
 * @param {string} bundleId
 * @param {(line: string) => void} [onLine]
 * @param {{ skipInstall?: boolean, skipBoot?: boolean }} [opts]
 */
async function launchOnSimulator(udid, appPath, bundleId, onLine, opts = {}) {
  if (!opts.skipBoot) {
    onLine?.('Run: 确保模拟器已 Boot…');
    await ensureSimulatorBooted(udid, { alreadyBooted: Boolean(opts.alreadyBooted) });
  }
  if (!opts.skipInstall) {
    onLine?.(`Run: simctl install ${path.basename(appPath)}`);
    const t0 = Date.now();
    await execFileAsync('xcrun', ['simctl', 'install', udid, appPath], {
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'utf8',
    });
    opts.onTiming?.('simctl install', Date.now() - t0);
  } else {
    opts.onTiming?.('simctl install', 0, '跳过');
  }
  onLine?.(`Run: simctl launch ${bundleId}`);
  const launchT0 = Date.now();
  const { stdout, stderr } = await execFileAsync(
    'xcrun',
    ['simctl', 'launch', udid, bundleId],
    { encoding: 'utf8' }
  );
  opts.onTiming?.('simctl launch', Date.now() - launchT0);
  return parseSimLaunchOutput(stdout, stderr, bundleId);
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
 * xcodebuild + simctl install/launch（xcode_run 唯一路径，不依赖 Xcode ⌘R）
 */
async function runViaSimctl(projectRoot, opts = {}) {
  const progress = opts.progress || createRunProgress(opts.onLine);
  const emit = progress.emit.bind(progress);
  const diag = createRunDiagLogger(opts.onLine);
  diag.mark('Run 开始');

  const logLine =
    typeof opts.logLine === 'function'
      ? (line) => {
          const t = String(line || '').trim();
          if (!t) return;
          if (/:(\d+):(\d+):\s*error:/i.test(t) || /^error:/i.test(t)) {
            opts.logLine({ text: t, raw: t, stream: true, isError: true });
          }
        }
      : null;

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
  diag.mark('resolveScheme', scheme);

  let destination = String(opts.destination || '').trim();
  let simulator = null;
  const explicitMac = /platform=macos/i.test(destination);
  const derivedDataPath = resolveDerivedDataPathForProject(projectRoot);
  diag.mark('DerivedData', derivedDataPath ? path.basename(derivedDataPath) : '默认');

  if (!explicitMac) {
    try {
      simulator = await pickIosSimulatorDevice({
        simulator: opts.simulator,
        destination: opts.destination,
        projectRoot,
        scheme,
      });
      if (!destination) {
        destination = simulator.destination;
      } else if (!parseDestinationUdid(destination) && !/name=/i.test(destination)) {
        destination = simulator.destination;
      }
    } catch (e) {
      return { ok: false, error: e.message || String(e), action: 'run', runMethod: 'simctl', exitCode: 1 };
    }
    emit(`Run: 模拟器 ${simulator.name} · ${simulator.selectionSource}`);
    diag.mark('pickIosSimulator', `${simulator.name} · ${simulator.selectionSource}`);
    void openSimulatorForDevice(simulator.udid, {
      skipBoot: simulator.state === 'Booted',
    }).catch(() => {});
  }

  let buildResult;
  let appPath = '';
  const preflightApp = resolvePreflightRunApp(projectRoot, scheme, !explicitMac);
  const skipBuild = canSkipRunBuild(projectRoot, preflightApp);
  diag.mark(
    '跳过编译检测',
    skipBuild ? '是 · 不跑 xcodebuild' : preflightApp ? '否 · 需 xcodebuild' : '否 · 未找到产物'
  );

  const simAlreadyBooted = Boolean(simulator?.state === 'Booted');
  const bootPromise =
    simulator && !explicitMac && !simAlreadyBooted
      ? ensureSimulatorBooted(simulator.udid).catch(() => {})
      : Promise.resolve();

  if (skipBuild) {
    emit('Run: 跳过编译（DerivedData 产物已是最新）');
    progress.completeStep({ ok: true, skipped: true });
    buildResult = { ok: true, output: '', scheme, destination, skipped: true };
    appPath = preflightApp;
  } else {
    emit(`Run: xcodebuild 编译 scheme「${scheme}」…`);
    const buildDestination = resolveSimulatorBuildDestination(explicitMac, destination);
    diag.mark('xcodebuild 开始', buildDestination);
    const buildT0 = Date.now();
    const earlyBundleId = String(readProjectXcodeCache(projectRoot).lastBundleId || '').trim();
    const earlyPipeline =
      simulator && !explicitMac && earlyBundleId
        ? createEarlySimRunPipeline({ simulator, bundleId: earlyBundleId, diag })
        : null;
    buildResult = await runXcodeAction(projectRoot, {
      scheme,
      destination: buildDestination,
      action: 'build',
      onLine: logLine || undefined,
      onAppReady: earlyPipeline
        ? (readyAppPath) => earlyPipeline.onAppReady(readyAppPath)
        : undefined,
    });
    const buildMs = Date.now() - buildT0;
    diag.duration('xcodebuild', buildMs, buildResult.ok ? '成功' : '失败');
    if (earlyPipeline) {
      await earlyPipeline.awaitDone();
      const earlyState = earlyPipeline.getState();
      buildResult.installDoneEarly = earlyState.installDone;
      buildResult.launchDoneEarly = earlyState.launchDone;
      buildResult.earlyLaunchInfo = earlyState.launchInfo;
    }
    await bootPromise;
    if (simulator && !explicitMac && !simAlreadyBooted) {
      diag.mark('ensureSimulatorBooted（与编译并行）', '完成');
    }
    rememberDerivedDataFromBuild(projectRoot, buildResult.output);
    progress.completeStep({ ok: buildResult.ok, buildOutput: buildResult.output });

    if (!buildResult.ok) {
      progress.finish();
      diag.mark('Run 结束（编译失败）');
      return {
        ...buildResult,
        action: 'run',
        runPhase: 'build',
        runMethod: 'simctl',
        error: buildResult.error || '编译失败，无法 Run',
        runTimings: diag.getMarks(),
      };
    }

    const resolveT0 = Date.now();
    appPath =
      resolvePreflightRunApp(projectRoot, scheme, !explicitMac) ||
      parseAppPathFromBuildOutput(buildResult.output) ||
      resolveBuiltAppAfterBuild({
        buildOutput: buildResult.output,
        settings: {},
        scheme,
        projectRoot,
        forSimulator: !explicitMac,
      });
    diag.duration('解析 .app 路径', Date.now() - resolveT0, appPath ? path.basename(appPath) : '未找到');
    buildResult.installDoneEarly = Boolean(buildResult.installDoneEarly);
    buildResult.launchDoneEarly = Boolean(buildResult.launchDoneEarly);
  }

  const runCache = readProjectXcodeCache(projectRoot);
  let settings = {};
  let bundleId = String(runCache.lastBundleId || '').trim();
  if (appPath && !bundleId) {
    const t0 = Date.now();
    bundleId = await readBundleIdFromApp(appPath);
    diag.duration('readBundleIdFromApp', Date.now() - t0, bundleId || '—');
  } else if (bundleId) {
    diag.mark('readBundleIdFromApp', '缓存');
  }
  if (!appPath || !bundleId) {
    try {
      emit('Run: 读取 build settings（回退）…');
      const t0 = Date.now();
      settings = await getShowBuildSettings(target, scheme, destination);
      diag.duration('getShowBuildSettings', Date.now() - t0);
    } catch (_) {
      /* 仍尝试 DerivedData / Info.plist */
    }
    if (!appPath) {
      appPath = resolveBuiltAppAfterBuild({
        buildOutput: buildResult.output,
        settings,
        scheme,
        projectRoot,
        forSimulator: !explicitMac,
      });
    }
    if (!bundleId) {
      bundleId = settings.PRODUCT_BUNDLE_IDENTIFIER || '';
      if (!bundleId && appPath) {
        bundleId = await readBundleIdFromApp(appPath);
      }
    }
  }

  if (!appPath) {
    diag.mark('Run 结束（无产物）');
    return {
      ok: false,
      action: 'run',
      runPhase: 'launch',
      runMethod: 'simctl',
      error: '编译成功但未找到 .app 产物',
      scheme,
      destination,
      buildResult,
      runTimings: diag.getMarks(),
    };
  }

  emit(`Run: 产物 ${path.basename(appPath)}`);

  await bootPromise;

  let launchInfo = {};
  let runtimeLog = '';

  try {
    if (isMacOsDestination(destination, settings)) {
      launchInfo = await launchMacApp(appPath);
      await delay(RUN_SETTLE_MS);
      runtimeLog = 'macOS 应用已通过 open 启动。';
    } else {
      if (!simulator) {
        simulator = await pickIosSimulatorDevice({
          simulator: opts.simulator,
          destination: opts.destination,
          projectRoot,
          scheme,
        });
      }
      if (!bundleId) {
        return {
          ok: false,
          action: 'run',
          runPhase: 'launch',
          runMethod: 'simctl',
          error: '无法读取 PRODUCT_BUNDLE_IDENTIFIER',
          appPath,
          buildResult,
          runTimings: diag.getMarks(),
        };
      }
      const skipInstall =
        canSkipSimInstall(simulator.udid, bundleId, appPath, projectRoot) ||
        Boolean(buildResult.installDoneEarly);
      const launchDoneEarly = Boolean(buildResult.launchDoneEarly && buildResult.earlyLaunchInfo);
      const fastRelaunch = Boolean(buildResult.skipped && skipInstall);
      diag.mark(
        '跳过安装检测',
        skipInstall ? (launchDoneEarly ? '是 · 并行 install+launch' : '是 · 仅 launch') : '否 · install+launch'
      );
      if (fastRelaunch) {
        emit(`Run: 快速启动 ${bundleId}（跳过编译与安装）`);
      } else if (launchDoneEarly) {
        emit(`Run: 已在编译并行阶段安装并启动 ${bundleId}`);
      } else if (skipInstall) {
        emit(`Run: 启动 ${bundleId}（跳过安装）`);
      } else {
        emit(`Run: 安装并启动 ${bundleId}…`);
      }
      if (launchDoneEarly) {
        launchInfo = buildResult.earlyLaunchInfo;
        diag.mark('launchOnSimulator 合计', '与编译并行 · 已完成');
      } else {
        const launchT0 = Date.now();
        launchInfo = await launchOnSimulator(simulator.udid, appPath, bundleId, logLine, {
          skipInstall,
          skipBoot: true,
          onTiming: (label, ms, detail) => diag.duration(label, ms, detail),
        });
        diag.duration('launchOnSimulator 合计', Date.now() - launchT0);
      }
      if (launchDoneEarly) {
        runtimeLog = '';
        diag.mark('settle+日志', '并行启动 · 跳过');
      } else if (fastRelaunch) {
        await delay(RUN_SETTLE_MS_FAST);
        runtimeLog = '';
        diag.mark('settle+日志', '快速路径 · 跳过');
      } else if (skipInstall) {
        await delay(RUN_SETTLE_MS_FAST);
        runtimeLog = '';
        diag.mark('settle+日志', '跳过安装 · 不抓日志');
      } else {
        const settleT0 = Date.now();
        await delay(RUN_SETTLE_MS_FAST);
        diag.duration('settle delay', Date.now() - settleT0);
        runtimeLog = '';
        diag.mark('settle+日志', '安装后 · 不抓日志');
      }
    }
  } catch (e) {
    progress.finish();
    diag.mark('Run 结束（启动异常）', e.message || String(e));
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
      runTimings: diag.getMarks(),
    };
  }

  let appRunning = null;
  if (simulator && bundleId && !isMacOsDestination(destination, settings)) {
    if (launchInfo.pid) {
      appRunning = true;
      diag.mark('isAppRunningOnSimulator', `pid ${launchInfo.pid}`);
    } else {
      const t0 = Date.now();
      appRunning = await isAppRunningOnSimulator(simulator.udid, bundleId);
      diag.duration('isAppRunningOnSimulator', Date.now() - t0, appRunning ? '运行中' : '未检测到');
    }
  }

  if (appRunning === false) {
    const logT0 = Date.now();
    runtimeLog = await captureSimulatorLogs(simulator.udid, RUN_LOG_CAPTURE_SEC);
    diag.duration(`captureSimulatorLogs ${RUN_LOG_CAPTURE_SEC}s（启动失败）`, Date.now() - logT0);
  }

  if (appRunning !== false) {
    emit('Run: 已在模拟器启动');
  }

  progress.finish();
  diag.mark('Run 总计', formatStepElapsed(diag.totalMs()));

  const result = finalizeRunResult({
    scheme,
    destination,
    appPath,
    bundleId,
    simulator,
    launchInfo,
    runtimeLog,
    buildResult,
    appRunning,
    runMethod: 'simctl',
    error:
      appRunning === false
        ? 'simctl launch 后未检测到应用在模拟器运行'
        : '',
  });

  if (result.ok) {
    rememberSuccessfulRun(projectRoot, { appPath, simulator, bundleId });
  }
  result.runTimings = diag.getMarks();
  return result;
}

function finalizeRunResult(ctx) {
  const runtimeLog = ctx.runtimeLog || '';
  /** @type {string[]} */
  const crashHints = [...(ctx.crashHints || [])];
  const logLower = runtimeLog.toLowerCase();
  if (/fatal error|assertion failed|terminating app due to uncaught|signal abrt| crashed /.test(logLower)) {
    crashHints.push('运行日志中疑似出现崩溃或未捕获异常');
  }

  let ok = ctx.runOk;
  if (ok === undefined) {
    const buildFailed = ctx.buildResult?.ok === false;
    if (buildFailed) {
      ok = false;
    } else if (ctx.simulator && ctx.bundleId) {
      ok = ctx.appRunning === true;
    } else {
      ok = ctx.appRunning !== false;
    }
  }
  if (ctx.buildResult?.ok === false) ok = false;
  if (ctx.appRunning === false) ok = false;

  return {
    ok: Boolean(ok),
    action: 'run',
    runPhase: ctx.buildResult?.ok === false ? 'build' : 'done',
    runMethod: ctx.runMethod || 'simctl',
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

  if (!resolveXcodeTarget(projectRoot)) {
    return { ok: false, error: '未找到 .xcodeproj 或 .xcworkspace', action: 'run', exitCode: 1 };
  }

  let scheme;
  try {
    scheme = await resolveScheme(projectRoot, opts.scheme);
  } catch (e) {
    return { ok: false, error: e.message || String(e), action: 'run', exitCode: 1 };
  }

  const progress = createRunProgress(opts.onLine);
  progress.emit.reset();
  progress.emit('Run: xcodebuild 编译 → simctl 安装 → 模拟器启动…');
  return runViaSimctl(projectRoot, { ...opts, scheme, progress, logLine: opts.onLine });
}

/**
 * @param {object} result
 * @returns {string}
 */
function formatRunObservation(result) {
  if (!result || typeof result !== 'object') return String(result ?? '');

  if (result.error && result.runPhase === 'build') {
    return formatBuildObservation(result.buildResult || result);
  }

  const lines = [];
  lines.push(
    result.ok
      ? 'Xcode Run 成功：已编译并在目标上启动应用'
      : `Xcode Run 未完成 (${result.runPhase || 'unknown'})`
  );

  lines.push('方式: xcodebuild + simctl install/launch');

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

  if (buildLogHasPortalSessionError(result.buildResult?.output || result.buildResult?.logTail)) {
    lines.push(
      '',
      '提示: build log 出现 Apple Developer 会话过期 (DVTPortal 1100)。' +
        '请在 Xcode → Settings → Accounts 重新登录 Apple ID，可显著加快 xcodebuild。'
    );
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
    '可用工具: xcode_build（编译检查）、xcode_run（xcodebuild + simctl 安装启动）、xcode_test（运行测试）。' +
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
