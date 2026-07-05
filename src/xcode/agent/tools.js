/**
 * @file tools.js
 * 【功能】Agent Xcode 工具定义与执行（status / build / run / test）
 */
const projectIo = require('../../mcp-filesystem');
const { IS_DARWIN, getProjectStatus, formatProjectStatusObservation } = require('../project');
const {
  runXcodeAction,
  runXcodeProject,
  formatBuildObservation,
  formatRunObservation,
} = require('../build-runner');
const { loadSimulatorPref } = require('../simulator-prefs');
const {
  publishXcodeProgress,
  formatStepElapsed,
  sanitizeXcodeProgressLine,
} = require('../../shared/agent-log');

const XCODE_NOISE_LINE =
  /DVTPortal|requestUrl|creationTimestamp|httpCode|protocolVersion|resultCode|userLocale|userString|resultString|NSLocalizedDescription|User defaults from command line|IDEPackageSupportUseBuiltinSCM|Prepare packages|Computing target dependency|Create build description|Build description signature|Build description path|note: Building targets in dependency order|^Command line invocation:|^\/Applications\/Xcode\.app|^\W*\}[,}]/i;

/**
 * xcode_run：只展示 Run 阶段与编译成败/错误，不刷 xcodebuild 原始流
 * @param {string} line
 */
function shouldPublishXcodeRunLine(line) {
  const t = String(line || '').trim();
  if (!t) return false;
  if (t.startsWith('Run:')) return true;
  if (/^Run: \[耗时\]/.test(t)) return true;
  if (/^编译 /.test(t)) return true;
  if (/:(\d+):(\d+):\s*error:/i.test(t) || /^error:/i.test(t)) return true;
  return false;
}

/**
 * @param {string} line
 * @param {string} [method]
 */
function shouldPublishXcodeLine(line, method) {
  const t = String(line || '').trim();
  if (!t) return false;
  if (method === 'xcode_run') return shouldPublishXcodeRunLine(t);
  if (t.startsWith('Run:')) return true;
  if (XCODE_NOISE_LINE.test(t)) return false;
  if (/\*\* BUILD (SUCCEEDED|FAILED)/.test(t)) return true;
  if (/CompileC |SwiftCompile |SwiftDriver|Ld .*\.app|Touch .*\.app|CodeSign /.test(t)) return true;
  if (/:(\d+):(\d+):\s*(error|warning):/i.test(t)) return true;
  if (/^error:|^warning:/i.test(t)) return true;
  return false;
}

/**
 * @param {string} method
 * @param {{ onProgress?: (payload: { method: string, line: string }) => void }} [execOpts]
 */
function createXcodeLineLogger(method, execOpts) {
  const onProgress = execOpts?.onProgress;
  if (typeof onProgress !== 'function') {
    return () => {};
  }
  const seenCompile = new Set();
  let stepStart = Date.now();

  return (lineOrObj) => {
    const obj =
      typeof lineOrObj === 'string'
        ? { text: lineOrObj }
        : lineOrObj && typeof lineOrObj === 'object'
          ? lineOrObj
          : { text: String(lineOrObj || '') };

    const rawText = sanitizeXcodeProgressLine(String(obj.raw || obj.text || obj.line || '').trim());
    if (!rawText) return;

    if (Number.isFinite(Number(obj.elapsedMs)) && obj.raw) {
      if (!shouldPublishXcodeLine(rawText, method)) return;
      onProgress({
        method,
        line: String(obj.text || `${rawText}  ${formatStepElapsed(obj.elapsedMs)}`).trim(),
        isError: Boolean(obj.isError),
        elapsedMs: obj.elapsedMs,
      });
      stepStart = Date.now();
      return;
    }

    const now = Date.now();
    const elapsedMs = now - stepStart;
    stepStart = now;

    if (!shouldPublishXcodeLine(rawText, method)) return;

    let publishLine = `${rawText}  ${formatStepElapsed(elapsedMs)}`;
    let isError = Boolean(obj.isError);

    if (/:(\d+):(\d+):\s*error:/i.test(rawText) || /^error:/i.test(rawText)) {
      isError = true;
    }

    if (/CompileC |SwiftCompile /.test(rawText)) {
      const m = rawText.match(/\/([^/]+\.(m|mm|swift|c|cpp|cc))\s/);
      const key = m ? m[1] : rawText.slice(0, 96);
      if (seenCompile.has(key)) return;
      seenCompile.add(key);
      publishLine = `编译 ${key}  ${formatStepElapsed(elapsedMs)}`;
    } else if (/\*\* BUILD SUCCEEDED/.test(rawText)) {
      publishLine = `BUILD SUCCEEDED  ${formatStepElapsed(elapsedMs)}`;
    } else if (/\*\* BUILD FAILED/.test(rawText)) {
      publishLine = `BUILD FAILED  ${formatStepElapsed(elapsedMs)}`;
      isError = true;
    }

    onProgress({
      method,
      line: publishLine,
      isError,
      elapsedMs,
    });
  };
}

function emitXcodeProgress(method, line, execOpts = {}) {
  const text = String(line || '').trim();
  if (!text) return;
  const payload = {
    method,
    line: text,
    isError: Boolean(execOpts.isError),
    elapsedMs: execOpts.elapsedMs,
    bubble: execOpts.bubble,
    stepLabel: execOpts.stepLabel,
  };
  if (typeof execOpts.onProgress === 'function') {
    execOpts.onProgress(payload);
  } else {
    publishXcodeProgress(method, text, {
      isError: payload.isError,
      elapsedMs: payload.elapsedMs,
      bubble: payload.bubble,
      stepLabel: payload.stepLabel,
    });
  }
}

const XCODE_TOOL_NAMES = new Set([
  'xcode_project_status',
  'xcode_build',
  'xcode_run',
  'xcode_test',
]);

const XCODE_SOLO_TOOL_NAMES = new Set(['xcode_build', 'xcode_run', 'xcode_test']);

/**
 * 用户明确要跑 xcode 工具时跳过 LLM（节省 5–15s）
 * @param {string} userText
 * @returns {{ type: 'xcode_tool', name: string, args: object } | null}
 */
function tryParseDirectXcodeTool(userText) {
  const t = String(userText || '').trim();
  if (!t) return null;

  const toolMatch = t.match(/^(xcode_build|xcode_run|xcode_test)(?:\s+scheme[:=]\s*(\S+))?$/i);
  if (toolMatch) {
    const name = toolMatch[1].toLowerCase();
    const args = toolMatch[2] ? { scheme: toolMatch[2] } : {};
    return { type: 'xcode_tool', name, args };
  }

  if (/^(运行|跑一下|跑起来|启动|run|⌘r|cmd\+r)$/i.test(t)) {
    return { type: 'xcode_tool', name: 'xcode_run', args: {} };
  }

  return null;
}

function isXcodeSoloToolName(name) {
  return XCODE_SOLO_TOOL_NAMES.has(String(name || ''));
}

/** @returns {Array<{ name: string, description: string, inputSchema: object }>} */
function getXcodeTools() {
  if (!IS_DARWIN) return [];

  return [
    {
      name: 'xcode_project_status',
      description:
        '读取当前 Open Folder 的 Xcode 工程：workspace/project 路径、scheme、建议 destination。编译前可先调用以确认工程结构。',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'xcode_build',
      description:
        '用 xcodebuild 编译 Open Folder 下的 iOS/macOS 工程（含最新磁盘代码），返回编译错误/警告与日志尾部。修改 Swift/ObjC 后应调用以验证能否编译通过。',
      inputSchema: {
        type: 'object',
        properties: {
          scheme: {
            type: 'string',
            description: '可选。Xcode scheme 名；省略时使用第一个可用 scheme。',
          },
          destination: {
            type: 'string',
            description:
              '可选。xcodebuild -destination，默认 generic/platform=iOS Simulator。macOS 应用可用 platform=macOS。',
          },
        },
      },
    },
    {
      name: 'xcode_run',
      description:
        '编译并在模拟器安装、启动 Open Folder 工程（xcodebuild + simctl install/launch，会打开 Simulator）。' +
        '未指定 simulator 时优先跟随 Simulator/Xcode 当前设备；多模拟器已 Boot 时用最近 Boot 的那台。' +
        '用户要在模拟器看最新代码时必须用此工具，勿仅用 xcode_build 或 app_launcher。',
      inputSchema: {
        type: 'object',
        properties: {
          scheme: { type: 'string', description: '可选 scheme 名' },
          destination: {
            type: 'string',
            description:
              '可选 destination。iOS 模拟器可省略（自动选择 iPhone）；macOS 应用用 platform=macOS。',
          },
          simulator: {
            type: 'string',
            description: '可选模拟器设备名，如 iPhone 16',
          },
        },
      },
    },
    {
      name: 'xcode_test',
      description:
        '使用 xcodebuild test 运行单元/UI 测试，返回失败用例与构建日志。',
      inputSchema: {
        type: 'object',
        properties: {
          scheme: { type: 'string', description: '可选 scheme 名' },
          destination: {
            type: 'string',
            description: '可选 destination，默认 generic/platform=iOS Simulator',
          },
        },
      },
    },
  ];
}

function isXcodeToolName(name) {
  return XCODE_TOOL_NAMES.has(String(name || '').trim());
}

/**
 * @param {{ module: string, task: { name: string, args?: object } }} routedTask
 * @param {{ onProgress?: (payload: { method: string, line: string }) => void }} [execOpts]
 */
async function EXECUTE_execute_tool(routedTask, execOpts = {}) {
  if (routedTask.module !== 'xcode') {
    return {
      isError: true,
      content: [{ type: 'text', text: `EXEC：未支持的模块 ${routedTask.module}` }],
    };
  }

  const { name, args = {} } = routedTask.task;
  if (!isXcodeToolName(name)) {
    return {
      isError: true,
      content: [{ type: 'text', text: `EXEC：未知 Xcode tool「${name}」` }],
    };
  }

  if (!projectIo.getStatus().connected) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'MCP 未连接，请先用 File → Open Folder 打开 iOS 工程目录' }],
    };
  }

  const projectRoot = projectIo.getStatus().projectRoot;

  if (name === 'xcode_project_status') {
    const status = await getProjectStatus(projectRoot);
    const text = formatProjectStatusObservation(status);
    return {
      isError: !status.ok,
      content: [{ type: 'text', text }],
    };
  }

  const scheme = args.scheme != null ? String(args.scheme).trim() : '';
  const destination = args.destination != null ? String(args.destination).trim() : '';
  const simulator = args.simulator != null ? String(args.simulator).trim() : '';
  const onLine = createXcodeLineLogger(name, execOpts);

  if (name === 'xcode_run') {
    // 若用户未指定但已保存模拟器偏好，自动注入
    const pref = loadSimulatorPref();
    const effectiveSimulator = simulator || (pref ? pref.udid : '');
    const result = await runXcodeProject(projectRoot, {
      scheme: scheme || undefined,
      destination: destination || undefined,
      simulator: effectiveSimulator || undefined,
      onLine,
    });
    const text = formatRunObservation(result);
    return {
      isError: !result.ok,
      content: [{ type: 'text', text }],
    };
  }

  const action = name === 'xcode_test' ? 'test' : 'build';
  const result = await runXcodeAction(projectRoot, {
    scheme: scheme || undefined,
    destination: destination || undefined,
    action,
    onLine,
  });
  const text = formatBuildObservation(result);
  return {
    isError: !result.ok,
    content: [{ type: 'text', text }],
  };
}

/**
 * @param {Awaited<ReturnType<typeof EXECUTE_execute_tool>>} execRaw
 */
function FEED_tool_result(execRaw) {
  const parts = Array.isArray(execRaw?.content) ? execRaw.content : [];
  const observation = parts
    .filter((p) => p && p.type === 'text' && p.text != null)
    .map((p) => String(p.text))
    .join('\n');
  return {
    ok: !execRaw?.isError,
    source: 'xcode/exec',
    observation: observation || (execRaw?.isError ? 'Xcode tool error' : ''),
    raw: execRaw,
  };
}

module.exports = {
  getXcodeTools,
  isXcodeToolName,
  isXcodeSoloToolName,
  tryParseDirectXcodeTool,
  XCODE_TOOL_NAMES,
  XCODE_SOLO_TOOL_NAMES,
  EXECUTE_execute_tool,
  FEED_tool_result,
};
