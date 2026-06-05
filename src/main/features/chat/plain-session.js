/**
 * @file plain-session.js
 * @domain chat
 *
 * 纯流式对话：消费 llm-volc 事件，推 UI + 可选 Xcode 落盘。
 */
const volc = require('../../llm-volc');
const {
  writePlainTextDeltaToXcode,
  finalizePlainTextXcodeStream,
} = require('../../mcp/xcode-plain-text-stream');

/**
 * @param {{
 *   apiKey: string,
 *   model: string,
 *   messages: Array<{ role: string, content: string }>,
 *   uiSink: ReturnType<typeof import('./ui-stream-sink').createUiStreamSink>,
 *   xcodeAbsPath?: string | null,
 * }} opts
 */
async function runPlainSession(opts) {
  const { apiKey, model, messages, uiSink, xcodeAbsPath = null } = opts;

  const out = await volc.collectPlainChat(
    { apiKey, model, messages },
    {
      onTextDelta(piece) {
        uiSink.onTextDelta(piece);
        writePlainTextDeltaToXcode(xcodeAbsPath, piece);
      },
    }
  );

  await finalizePlainTextXcodeStream(xcodeAbsPath);

  if (out.error) {
    uiSink.onError(out.error);
    return { error: out.error };
  }

  if (!out.content || !String(out.content).trim()) {
    const msg = '流式响应中无有效文本内容';
    uiSink.onError(msg);
    return { error: msg };
  }

  return { content: out.content };
}

module.exports = { runPlainSession };
