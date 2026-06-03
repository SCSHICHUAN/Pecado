/**
 * @file sse-xcode-stream.js
 *
 * 纯 SSE 对话（无 MCP tools）时，将 delta 文本流式写入 Xcode 目标文件。
 */
const xcodeWrite = require('./xcode-write-stream');
const { IS_DARWIN } = require('./xcode-stream-target');

/**
 * @param {string | null} xcodeAbsPath
 * @param {string} piece
 */
function writeSseDeltaToXcode(xcodeAbsPath, piece) {
  if (xcodeAbsPath && IS_DARWIN && piece) {
    xcodeWrite.writeXcodeFile(xcodeAbsPath, piece);
  }
}

/**
 * @param {string | null} xcodeAbsPath
 */
async function finalizeSseXcodeStream(xcodeAbsPath) {
  if (xcodeAbsPath && IS_DARWIN) {
    xcodeWrite.flushXcodeFile(xcodeAbsPath);
    await xcodeWrite.closeCodeFile(xcodeAbsPath);
  }
}

module.exports = { writeSseDeltaToXcode, finalizeSseXcodeStream };
