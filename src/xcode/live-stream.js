/**
 * @file live-stream.js
 *
 * 【功能】macOS 专用：LLM 流式输出增量写入磁盘，使 Xcode 打开的文件实时刷新。
 *   - createLiveWriter(absPath)：plain/context 下 assistant 正文流式写 @ 目标
 *   - registerWriteFileStreamTarget：agent write_file 解析到 path 后登记；新文件弹 confirmCreateOperation
 *   - writeDeltaToTarget：tool 参数 content delta → scheduleWriteDelta
 *   - resolveOpenProjectPath：MCP 已连接时把 relPath 转 abs（router plain 分支）
 *   非 darwin 或路径非法时各 API 降级为空操作
 *
 * 【调用方】
 *   pecado/js/agent/router.js、plain-stream.js
 *   llm-server/llm-infer-service.js（INFER 节点流式写盘）
 *
 * 【对外能力】
 *   IS_DARWIN / resolveAbsInProject(projectRoot, relPath) / resolveOpenProjectPath(relPath)
 *   createLiveWriter(absPath) → { start, writeDelta, finish, active }
 *   registerWriteFileStreamTarget(projectRoot, relPath) → target | null
 *   writeDeltaToTarget(target, delta)
 */
const fs = require('fs');
const projectIo = require('../mcp-filesystem');
const { getMainWindow } = require('../mcp-filesystem/ipc');
const { confirmCreateOperation } = require('./prompt');

const IS_DARWIN = process.platform === 'darwin';

/**
 * @param {string} projectRoot
 * @param {string} relPath
 * @returns {string | null}
 */
function resolveAbsInProject(projectRoot, relPath) {
  if (!IS_DARWIN || !projectRoot || !relPath) return null;
  try {
    return projectIo.resolveUnderProject(projectRoot, relPath);
  } catch (e) {
    console.warn('[xcode-stream] ignore path:', e.message);
    return null;
  }
}

/** @param {string | null | undefined} relPath */
function resolveOpenProjectPath(relPath) {
  if (!relPath || !projectIo.getStatus().connected) return null;
  const abs = resolveAbsInProject(projectIo.getStatus().projectRoot, relPath);
  if (abs) console.log('[xcode-stream] SSE target', abs);
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
  if (!absPath || !IS_DARWIN) {
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

/**
 * Agent `write_file` 流式：解析到 path 后登记落盘目标（含新建弹窗）。
 * @param {string} projectRoot
 * @param {string} relPath
 */
function registerWriteFileStreamTarget(projectRoot, relPath) {
  if (!IS_DARWIN) return null;

  try {
    const absPath = projectIo.resolveUnderProject(projectRoot, relPath);
    const isNew = !fs.existsSync(absPath);
    let xcodeLiveStream = true;
    let cancelled = false;
    let xcodeIntegrate = false;
    let xcodeMeta = null;

    if (isNew) {
      const confirm = confirmCreateOperation(getMainWindow(), 'write_file', projectRoot, relPath);
      if (!confirm.proceed) {
        cancelled = true;
        xcodeLiveStream = false;
      } else {
        xcodeIntegrate = confirm.integrateXcode;
        xcodeMeta = confirm.xcodeMeta;
        console.log('[xcode-prompt]', confirm.message);
      }
    }

    if (cancelled) {
      console.log('[xcode-stream] write_file cancelled:', relPath);
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

    if (xcodeLiveStream) {
      projectIo.beginWriteSession(absPath, { preserveExisting: !isNew });
    }

    console.log(
      '[xcode-stream] write_file →',
      absPath,
      xcodeLiveStream ? (isNew ? '(live stream, new file)' : '(live stream, overlay existing)') : '(skipped)'
    );

    return {
      absPath,
      relPath,
      fileStarted: false,
      xcodeLiveStream,
      cancelled: false,
      xcodeIntegrate,
      xcodeMeta,
    };
  } catch (e) {
    console.warn('[xcode-stream] path rejected:', e.message);
    return null;
  }
}

/** @param {ReturnType<typeof registerWriteFileStreamTarget>} target */
function writeDeltaToTarget(target, delta) {
  if (!target || target.cancelled || !target.xcodeLiveStream || !IS_DARWIN || !delta || !target.absPath) {
    return;
  }
  target.fileStarted = true;
  projectIo.scheduleWriteDelta(target.absPath, delta);
}

module.exports = {
  IS_DARWIN,
  resolveAbsInProject,
  resolveOpenProjectPath,
  createLiveWriter,
  registerWriteFileStreamTarget,
  writeDeltaToTarget,
};
