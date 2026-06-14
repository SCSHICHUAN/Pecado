/**
 * @file agent-log.js
 * 【功能】Agent tool 执行日志 → Pecado 主窗口 log 面板
 */
const path = require('path');
const { getMainWindow } = require('../mcp-filesystem/ipc');
const { SKILL } = require('./ipc-channels');
const projectIo = require('../mcp-filesystem');

const MODULE_LABELS = {
  'mcp-filesystem': 'mcp',
  skill: 'skill',
  xcode: 'xcode',
  'agent-loop': 'agent',
};

const AGENT_PHASES = Object.freeze({
  INFER: { label: '推理', short: 'INFER' },
  PARSE: { label: '解析', short: 'PARSE' },
  DISPATCH: { label: '分发', short: 'DISPATCH' },
  EXEC: { label: '执行', short: 'EXEC' },
  FEED: { label: '喂入', short: 'FEED' },
});

/** 一轮 Agent 流水线顺序：先喂入上下文，再推理…执行，最后喂回结果 */
const AGENT_PHASE_ORDER = ['FEED', 'INFER', 'PARSE', 'DISPATCH', 'EXEC'];

function formatArgValue(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'string') return v.length > 300 ? `${v.slice(0, 300)}…` : v;
  try {
    const s = JSON.stringify(v);
    return s.length > 300 ? `${s.slice(0, 300)}…` : s;
  } catch {
    return String(v);
  }
}

function resolveSourcePath(projectRoot, args = {}) {
  const rel = args.path != null ? String(args.path).trim() : '';
  if (!rel) return { sourcePath: '', sourceLabel: '' };
  const sourcePath = path.isAbsolute(rel) ? rel : path.join(projectRoot, rel);
  return { sourcePath, sourceLabel: rel };
}

/** @type {import('electron').WebContents | null} */
let boundLogSender = null;

function bindAgentLogSender(webContents) {
  boundLogSender =
    webContents && typeof webContents.isDestroyed === 'function' && !webContents.isDestroyed()
      ? webContents
      : null;
}

function unbindAgentLogSender() {
  boundLogSender = null;
}

function resolveLogSender() {
  if (boundLogSender && !boundLogSender.isDestroyed()) return boundLogSender;
  const win = getMainWindow();
  if (win && !win.isDestroyed()) return win.webContents;
  return null;
}

/**
 * @param {object} entry
 */
/**
 * 秒表计时：百分之一秒为 1s，如 1.85 s（1 秒 85 厘秒）
 * @param {number} ms
 */
function formatStepElapsed(ms) {
  const centis = Math.max(0, Math.floor(Number(ms) / 10));
  const sec = Math.floor(centis / 100);
  const frac = centis % 100;
  if (frac === 0) return `${sec} s`;
  return `${sec}.${String(frac).padStart(2, '0')} s`;
}

/** 气泡/日志展示：仅保留 Run: 后的文案 */
function formatRunStepLabel(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  if (/^\*\*\s*BUILD (SUCCEEDED|FAILED)/i.test(t)) {
    return t.replace(/^\*\*\s*|\s*\*\*$/g, '').trim();
  }
  return t.replace(/^Run:\s*/i, '').trim();
}

/** 过滤 xcodebuild 原始流里的 NSDictionary / DVTPortal 噪声 */
function sanitizeXcodeProgressLine(line) {
  const t = String(line || '').trim();
  if (!t) return '';
  if (
    /DVTPortal|requestUrl|creationTimestamp|httpCode|protocolVersion|resultCode|userLocale|userString|resultString/i.test(
      t
    )
  ) {
    return '';
  }
  if (/NSLocalizedDescription=/.test(t)) {
    const m = t.match(/NSLocalizedDescription=([^}\];]+)/);
    if (!m) return '';
    const msg = m[1].trim();
    if (/session has expired/i.test(msg)) {
      return 'Xcode 开发者账号会话已过期（可忽略，一般不影响本地 Run）';
    }
    return msg;
  }
  if (/^\W*\}[,}]/.test(t)) return '';
  return t;
}

function emitAgentLog(entry) {
  const sender = resolveLogSender();
  if (!sender) return;
  try {
    sender.send(SKILL.LOG_EVENT, {
      ts: Date.now(),
      ...entry,
    });
  } catch (_) {}
}

function buildAgentPhaseEntry(phase, opts = {}) {
  const key = String(phase || '').trim().toUpperCase();
  const meta = AGENT_PHASES[key] || { label: key, short: key };
  const detail = Array.isArray(opts.detail) ? [...opts.detail] : [];
  if (opts.module && !detail.some((d) => d.k === '模块')) {
    detail.unshift({ k: '模块', v: String(opts.module) });
  }
  if (opts.method && !detail.some((d) => d.k === 'tool')) {
    detail.push({ k: 'tool', v: String(opts.method) });
  }
  return {
    logKind: 'agent-phase',
    module: 'agent-loop',
    moduleLabel: 'agent',
    phase: key,
    phaseLabel: meta.label,
    phaseShort: meta.short,
    round: Number(opts.round) > 0 ? Number(opts.round) : 1,
    phaseStatus: opts.status || 'start',
    method: String(opts.method || '').trim(),
    methodLabel: String(opts.methodLabel || opts.method || '').trim(),
    detail,
    output: String(opts.note || '').trim(),
    isError: Boolean(opts.isError),
  };
}

/**
 * MCP / Xcode tool 调用日志（Skill tool 在 workflow/skill/agent/tools.js 单独发布）
 * @param {{ name: string, args?: object }} parsedTask
 * @param {{ module: string }} routed
 * @param {object} execRaw
 * @param {{ observation?: string }} toolFeed
 */
function publishToolLog(parsedTask, routed, execRaw, toolFeed) {
  const status = projectIo.getStatus();
  const root = status.connected ? String(status.projectRoot || '') : '';
  const args = parsedTask.args || {};
  const { sourcePath, sourceLabel } = resolveSourcePath(root, args);
  const method = String(parsedTask.name || '').trim();
  const module = String(routed.module || '').trim();

  const detail = [];
  for (const [k, v] of Object.entries(args)) {
    const val = formatArgValue(v);
    if (val) detail.push({ k, v: val });
  }

  let command = method;
  if (sourceLabel) command = `${method} ${sourceLabel}`;
  else if (detail.length) {
    const brief = detail
      .slice(0, 3)
      .map(({ k, v }) => `${k}=${v}`)
      .join(' ');
    if (brief) command = `${method} · ${brief}`;
  }

  emitAgentLog({
    module,
    moduleLabel: MODULE_LABELS[module] || module || 'tool',
    method,
    methodLabel: method,
    command,
    sourcePath,
    sourceLabel: sourceLabel || method,
    src: root,
    detail,
    output: String(toolFeed?.observation || '').slice(0, 2400),
    isError: Boolean(execRaw?.isError),
    layerPreviewKind: sourcePath ? 'file' : '',
  });
}

/**
 * Agent Loop 阶段日志（INFER / PARSE / DISPATCH / EXEC / FEED）
 * @param {'INFER'|'PARSE'|'DISPATCH'|'EXEC'|'FEED'} phase
 * @param {{ round?: number, status?: 'start'|'done'|'error', method?: string, methodLabel?: string, module?: string, note?: string, detail?: Array<{k:string,v:string}>, isError?: boolean }} [opts]
 */
function publishAgentPhaseLog(phase, opts = {}) {
  emitAgentLog(buildAgentPhaseEntry(phase, opts));
}

/**
 * xcode_build / xcode_run 执行过程流式日志（气泡 + 底部 log 面板）
 */
function publishXcodeProgress(method, line, opts = {}) {
  const text = sanitizeXcodeProgressLine(line);
  if (!text) return;
  const elapsedMs = Number(opts.elapsedMs);
  const status = projectIo.getStatus();
  const root = status.connected ? String(status.projectRoot || '') : '';
  emitAgentLog({
    logKind: 'xcode-progress',
    module: 'xcode',
    moduleLabel: 'xcode',
    method: String(method || '').trim(),
    methodLabel: String(method || '').trim(),
    command: text,
    output: '',
    src: root,
    sourcePath: root,
    sourceLabel: root ? path.basename(root) : '',
    elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : undefined,
    isError: Boolean(opts.isError),
  });
}

/**
 * Skill 脚本执行过程流式日志
 */
function publishSkillProgress(payload = {}) {
  const text = String(payload.line || payload.output || '').trim();
  if (!text) return;
  const skill = String(payload.skill || '').trim();
  emitAgentLog({
    logKind: 'skill-progress',
    module: 'skill',
    moduleLabel: 'skill',
    skill,
    skillDocId: String(payload.skillDocId || '').trim(),
    method: String(payload.method || 'run_skill_resource_script').trim(),
    methodLabel: String(payload.methodLabel || payload.method || '执行资源脚本').trim(),
    command: text,
    output: text,
    path: String(payload.path || '').trim(),
    relPath: String(payload.relPath || '').trim(),
    previewResourcePath: String(payload.path || payload.relPath || '').trim(),
    layerPreviewKind: payload.path ? 'file' : '',
    isError: Boolean(payload.isError),
  });
}

module.exports = {
  emitAgentLog,
  publishToolLog,
  publishAgentPhaseLog,
  publishXcodeProgress,
  publishSkillProgress,
  buildAgentPhaseEntry,
  bindAgentLogSender,
  unbindAgentLogSender,
  formatStepElapsed,
  formatRunStepLabel,
  sanitizeXcodeProgressLine,
  AGENT_PHASES,
  AGENT_PHASE_ORDER,
};
