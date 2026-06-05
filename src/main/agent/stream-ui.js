/**
 * @file stream-ui.js
 *
 * 将 LLM 流事件推送到渲染进程（VOLC_ARK.BOTS_STREAM_EVENT）。
 */
const { VOLC_ARK } = require('../../shared/ipc-channels');

/**
 * @param {import('electron').WebContents} sender
 * @param {string} streamId
 */
function createUiStreamSink(sender, streamId) {
  function send(payload) {
    try {
      if (sender && !sender.isDestroyed()) {
        sender.send(VOLC_ARK.BOTS_STREAM_EVENT, { streamId, ...payload });
      }
    } catch (_) {}
  }

  return {
    send,
    onTextDelta(text) {
      send({ phase: 'delta', text });
    },
    onToolStream({ name, path, text }) {
      send({ phase: 'tool_stream', name, path, text });
    },
    onTool(payload) {
      send({ phase: 'tool', ...payload });
    },
    onError(error) {
      send({ phase: 'error', error });
    },
  };
}

module.exports = { createUiStreamSink };
