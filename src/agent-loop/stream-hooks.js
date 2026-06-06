/**
 * @file stream-hooks.js
 * @module agent-loop
 *
 * 【功能】将 llm-server 流事件接到 pecado UI + xcode（agent-loop 编排层，非 llm 职责）。
 */
const {
  IS_DARWIN,
  createLiveWriter,
  registerWriteFileStreamTarget,
  writeDeltaToTarget,
} = require('../xcode/live-stream');

/**
 * @param {{
 *   uiSink?: { onTextDelta?: Function, onTool?: Function, onToolStream?: Function },
 *   projectRoot?: string,
 *   xcodeAbsPath?: string | null,
 * }} opts
 */
function createAgentStreamHooks(opts = {}) {
  const { uiSink, projectRoot = '', xcodeAbsPath = null } = opts;
  /** @type {Map<number, object>} */
  const writeTargets = new Map();
  const textXcodeWriter = createLiveWriter(xcodeAbsPath);
  if (xcodeAbsPath && IS_DARWIN) textXcodeWriter.start();

  const hooks = {
    writeTargets,
    onTextDelta(text) {
      uiSink?.onTextDelta?.(text);
      textXcodeWriter.writeDelta(text);
    },
    onTool(info) {
      uiSink?.onTool?.(info);
    },
    onWriteFilePath(index, relPath) {
      const target = registerWriteFileStreamTarget(projectRoot, relPath);
      if (target) writeTargets.set(index, target);
    },
    onWriteFileContentDelta(index, delta, relPath) {
      const target = writeTargets.get(index);
      writeDeltaToTarget(target, delta);
      if (delta && uiSink) {
        uiSink.onToolStream?.({ name: 'write_file', path: relPath, text: delta });
      }
    },
    async onRoundEnd() {
      await textXcodeWriter.finish();
    },
  };

  return { hooks, streamContext: { writeTargets } };
}

module.exports = { createAgentStreamHooks };
