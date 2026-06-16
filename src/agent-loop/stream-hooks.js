/**
 * @file stream-hooks.js
 * @module agent-loop
 *
 * 【功能】将 llm-server 流事件接到 pecado UI + xcode（agent-loop 编排层，非 llm 职责）。
 */
const { registerWriteFileStreamTarget, writeDeltaToTarget } = require('../xcode/stream');

/**
 * @param {{
 *   uiSink?: {
 *     onTextDelta?: Function,
 *     onTool?: Function,
 *     onToolStream?: Function,
 *     onWriteFileBegin?: Function,
 *     onCodxEditBegin?: Function,
 *   },
 *   projectRoot?: string,
 *   xcodeAbsPath?: string | null,
 * }} opts
 */
function createAgentStreamHooks(opts = {}) {
  const { uiSink, projectRoot = '' } = opts;
  /** @type {Map<number, object>} */
  const writeTargets = new Map();
  /** @type {Map<number, object>} */
  const codxEditTargets = new Map();

  const hooks = {
    writeTargets,
    codxEditTargets,
    onTextDelta(text) {
      uiSink?.onTextDelta?.(text);
    },
    onTool(info) {
      uiSink?.onTool?.(info);
    },
    onWriteFilePath(index, relPath) {
      const target = registerWriteFileStreamTarget(projectRoot, relPath);
      if (target) writeTargets.set(index, target);
      if (target && !target.cancelled && uiSink?.onWriteFileBegin) {
        uiSink.onWriteFileBegin({
          path: relPath,
          xcodeLiveStream: !!target.xcodeLiveStream,
          codxDeferred: !!target.codxDeferred,
        });
      }
    },
    onWriteFileContentDelta(index, delta, relPath) {
      const target = writeTargets.get(index);
      writeDeltaToTarget(target, delta);
      if (delta && uiSink) {
        uiSink.onToolStream?.({ name: 'write_file', path: relPath, text: delta });
      }
    },
    onCodxEditPath(index, relPath) {
      const target = {
        relPath,
        streamed: false,
        textLen: 0,
      };
      codxEditTargets.set(index, target);
      uiSink?.onCodxEditBegin?.({ index, path: relPath });
    },
    onCodxEditTextDelta(index, delta, relPath) {
      const target = codxEditTargets.get(index);
      if (target) {
        target.streamed = true;
        target.textLen = (target.textLen || 0) + String(delta || '').length;
      }
      if (delta && uiSink) {
        uiSink.onToolStream?.({ name: 'codx_edit', index, path: relPath, text: delta });
      }
    },
    async onRoundEnd() {},
  };

  return { hooks, streamContext: { writeTargets, codxEditTargets } };
}

module.exports = { createAgentStreamHooks };
