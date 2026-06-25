/**
 * @file plain-stream.js
 *
 * 【功能】plain / context 模式的单轮 SSE 对话（无 tool 循环）。
 *   - 调用 llm.collectPlainChat，每段 text_delta → uiSink.onTextDelta
 *   - 若 router 传入 xcodeAbsPath（macOS + 用户 @ 了源码路径），并行 createLiveWriter 增量落盘
 *   - 流结束校验非空 content，否则 onError
 *
 * 【调用方】pecado/js/agent/router.js（mode === plain | context）
 *
 * 【对外能力】
 *   runPlainSession({ apiKey, model, messages, uiSink, xcodeAbsPath? })
 *   → { content: string } | { error: string }
 */
const llm = require('../../../llm-server');
const { createLiveWriter } = require('../../../xcode/stream');

/**
 * @param {{
 *   apiKey: string,
 *   model: string,
 *   apiMode?: string,
 *   endpoint?: string,
 *   messages: Array<{ role: string, content: string }>,
 *   uiSink: ReturnType<typeof import('./stream-ui').createUiStreamSink>,
 *   xcodeAbsPath?: string | null,
 * }} opts
 */
async function runPlainSession(opts) {
  const { apiKey, model, apiMode, endpoint, messages, uiSink, xcodeAbsPath = null } = opts;
  const xcodeWriter = createLiveWriter(xcodeAbsPath);
  if (xcodeAbsPath) xcodeWriter.start();

  const out = await llm.collectPlainChat(
    { apiKey, model, apiMode, endpoint, messages },
    {
      onTextDelta(piece) {
        uiSink.onTextDelta(piece);
        xcodeWriter.writeDelta(piece);
      },
      onReasoningDelta(piece) {
        uiSink.onReasoningDelta?.(piece);
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
