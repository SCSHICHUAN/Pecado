/**
 * @file plain-stream.js
 *
 * 非 Agent 模式（plain / context）：一轮 SSE 对话。
 */
const volc = require('../llm-volc');
const { createLiveWriter } = require('../xcode/live-stream');

/**
 * @param {{
 *   apiKey: string,
 *   model: string,
 *   messages: Array<{ role: string, content: string }>,
 *   uiSink: ReturnType<typeof import('./stream-ui').createUiStreamSink>,
 *   xcodeAbsPath?: string | null,
 * }} opts
 */
async function runPlainSession(opts) {
  const { apiKey, model, messages, uiSink, xcodeAbsPath = null } = opts;
  const xcodeWriter = createLiveWriter(xcodeAbsPath);
  if (xcodeAbsPath) xcodeWriter.start();

  const out = await volc.collectPlainChat(
    { apiKey, model, messages },
    {
      onTextDelta(piece) {
        uiSink.onTextDelta(piece);
        xcodeWriter.writeDelta(piece);
      },
    }
  );

  await xcodeWriter.finish();

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
