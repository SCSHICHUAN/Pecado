/**
 * @file xcode-plain-text-stream.js
 *
 * 纯对话模式下，将 LLM 文本增量流式写入 Xcode 目标文件。
 */
const xcodeWrite = require('./xcode-write-stream');
const { IS_DARWIN } = require('./xcode-stream-target');

/**
 * @param {string | null} xcodeAbsPath
 * @param {string} piece
 */
function writePlainTextDeltaToXcode(xcodeAbsPath, piece) {
  if (xcodeAbsPath && IS_DARWIN && piece) {
    xcodeWrite.writeXcodeFile(xcodeAbsPath, piece);
  }
}

/**
 * @param {string | null} xcodeAbsPath
 */
async function finalizePlainTextXcodeStream(xcodeAbsPath) {
  if (xcodeAbsPath && IS_DARWIN) {
    xcodeWrite.flushXcodeFile(xcodeAbsPath);
    await xcodeWrite.closeCodeFile(xcodeAbsPath);
  }
}

module.exports = { writePlainTextDeltaToXcode, finalizePlainTextXcodeStream };
