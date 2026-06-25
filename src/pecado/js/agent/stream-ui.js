/**
 * @file stream-ui.js
 *
 * 【功能】主进程 → 渲染进程的 LLM 流式 UI 事件推送（单向 send，非 invoke）。
 *   - 通道：shared/ipc-channels VOLC_ARK.BOTS_STREAM_EVENT
 *   - 每条 payload：{ streamId, phase, ... }，streamId 与 invoke 时一致，renderer 按 id 匹配气泡
 *   - sender 销毁时 send 静默忽略，避免 crash
 *
 * 【调用方】
 *   - pecado/js/agent/router.js：plain 模式创建 uiSink
 *   - pecado/js/agent/router.js：createUiStreamSink + runAppAgentLoop
 *
 * 【对外能力】
 *   createUiStreamSink(sender, streamId) → {
 *     send(payload),
 *     onTextDelta(text)           → phase: 'delta'
 *     onReasoningDelta(text)      → phase: 'reasoning_delta'
 *     onToolStream({ name, path, text }) → phase: 'tool_stream'
 *     onTool(payload)             → phase: 'tool'
 *     onError(error)              → phase: 'error'
 *   }
 */
const { VOLC_ARK } = require('../../../shared/ipc-channels');

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
    onReasoningDelta(text) {
      send({ phase: 'reasoning_delta', text });
    },
    onToolStream({ name, path, text, index }) {
      send({ phase: 'tool_stream', name, path, text, index });
    },
    onWriteFileBegin({ path, xcodeLiveStream, codxDeferred }) {
      send({ phase: 'write_file_begin', name: 'write_file', path, xcodeLiveStream, codxDeferred });
    },
    onCodxEditBegin({ index, path }) {
      send({ phase: 'codx_edit_begin', name: 'codx_edit', index, path });
    },
    onCodxEditPlan({ path, edits }) {
      send({ phase: 'codx_edit_plan', path, edits });
    },
    onTool(payload) {
      send({ phase: 'tool', ...payload });
    },
    onAgentLog(entry) {
      send({ phase: 'agent_log', entry: { ts: Date.now(), ...entry } });
    },
    onError(error) {
      send({ phase: 'error', error });
    },
  };
}

module.exports = { createUiStreamSink };
