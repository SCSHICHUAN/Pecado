/**
 * @file stream.js
 * 【功能】LLM / Agent write_file 流式写入磁盘（跨平台）
 *   - createLiveWriter(absPath)：plain/context 下 assistant 正文流式写 @ 目标
 *   - registerWriteFileStreamTarget：agent write_file 解析到 path 后登记
 *   - macOS：新建时可 confirmCreateOperation（加入 Xcode）
 *   - 非空已有文件 → CodX deferred（只进编辑器）
 *
 * 【调用方】
 *   pecado/js/agent/router.js、plain-stream.js
 *   llm-server/llm-infer-service.js（INFER 节点流式写盘）
 */
const fs = require('fs');
const projectIo = require('../mcp-filesystem');
const { getMainWindow } = require('../mcp-filesystem/ipc');
const { HAS_XCODE, IS_DARWIN } = require('../shared/platform');

/**
 * @param {string} projectRoot
 * @param {string} relPath
 * @returns {string | null}
 */
function resolveAbsInProject(projectRoot, relPath) {
  if (!projectRoot || !relPath) return null;
  try {
    return projectIo.resolveUnderProject(projectRoot, relPath);
  } catch (e) {
    console.warn('[disk-stream] ignore path:', e.message);
    return null;
  }
}

/** @param {string | null | undefined} relPath */
function resolveOpenProjectPath(relPath) {
  if (!relPath || !projectIo.getStatus().connected) return null;
  const abs = resolveAbsInProject(projectIo.getStatus().projectRoot, relPath);
  if (abs) console.log('[disk-stream] SSE target', abs);
  return abs;
}

/**
 * @param {string | null} absPath
 * @returns {{
 *   active: boolean,
 *   start: (opts?: { preserveExisting?: boolean }) => void,
 *   writeDelta: (piece: string) => void,
 *   finish: () => Promise<void>,
 * }}
 */
function createLiveWriter(absPath) {
  if (!absPath) {
    return {
      active: false,
      start() {},
      writeDelta() {},
      finish: async () => {},
    };
  }

  let started = false;
  return {
    get active() {
      return started;
    },
    start(opts = {}) {
      if (started) return;
      const preserveExisting = opts.preserveExisting ?? fs.existsSync(absPath);
      projectIo.beginWriteSession(absPath, { preserveExisting });
      started = true;
    },
    writeDelta(piece) {
      if (!piece) return;
      if (!started) this.start();
      projectIo.scheduleWriteDelta(absPath, piece);
    },
    async finish() {
      if (!started) return;
      await projectIo.awaitWritePending(absPath);
      await projectIo.closeWriteFile(absPath);
      started = false;
    },
  };
}

function isEmptyFileForLiveStream(absPath) {
  if (!fs.existsSync(absPath)) return true;
  try {
    if (!fs.statSync(absPath).isFile()) return false;
    return fs.readFileSync(absPath, 'utf8').trim().length === 0;
  } catch {
    return fs.statSync(absPath).size === 0;
  }
}

/**
 * Agent `write_file` 流式：解析到 path 后登记落盘目标。
 * @param {string} projectRoot
 * @param {string} relPath
 */
function registerWriteFileStreamTarget(projectRoot, relPath) {
  try {
    const absPath = projectIo.resolveUnderProject(projectRoot, relPath);
    const isNew = !fs.existsSync(absPath);
    let liveStream = true;
    let cancelled = false;
    let xcodeIntegrate = false;
    let xcodeMeta = null;

    if (isNew && HAS_XCODE) {
      const { confirmCreateOperation } = require('./prompt');
      const confirm = confirmCreateOperation(getMainWindow(), 'write_file', projectRoot, relPath);
      if (!confirm.proceed) {
        cancelled = true;
        liveStream = false;
      } else {
        xcodeIntegrate = confirm.integrateXcode;
        xcodeMeta = confirm.xcodeMeta;
        console.log('[xcode-prompt]', confirm.message);
      }
    }

    if (cancelled) {
      console.log('[disk-stream] write_file cancelled:', relPath);
      return {
        absPath,
        relPath,
        fileStarted: false,
        xcodeLiveStream: false,
        cancelled: true,
        xcodeIntegrate: false,
        xcodeMeta: null,
      };
    }

    if (liveStream) {
      const fileEmpty = isEmptyFileForLiveStream(absPath);
      if (fileEmpty) {
        projectIo.beginWriteSession(absPath, { preserveExisting: false });
      } else {
        liveStream = false;
      }
    }

    console.log(
      '[disk-stream] write_file →',
      absPath,
      liveStream
        ? '(live stream, new/empty → disk)'
        : '(CodX deferred → editor)'
    );

    return {
      absPath,
      relPath,
      fileStarted: false,
      xcodeLiveStream: liveStream,
      codxDeferred: !liveStream && !cancelled,
      cancelled: false,
      xcodeIntegrate,
      xcodeMeta,
    };
  } catch (e) {
    console.warn('[disk-stream] path rejected:', e.message);
    return null;
  }
}

/** @param {ReturnType<typeof registerWriteFileStreamTarget>} target */
function writeDeltaToTarget(target, delta) {
  if (!target || target.cancelled || !delta || !target.absPath) return;
  if (!target.xcodeLiveStream && !target.codxDeferred) return;
  target.fileStarted = true;
  if (target.xcodeLiveStream) {
    projectIo.scheduleWriteDelta(target.absPath, delta);
  }
}

module.exports = {
  IS_DARWIN,
  resolveAbsInProject,
  resolveOpenProjectPath,
  createLiveWriter,
  registerWriteFileStreamTarget,
  writeDeltaToTarget,
};
