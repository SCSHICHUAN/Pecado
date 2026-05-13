/**
 * 火山方舟 · 豆包 bots（JS 侧）
 * 流式：主进程 SSE → IPC 增量；invoke 结束返回全文 { content } 或 { error }。
 * 密钥不得写在本文件；见主进程 ark-chat.js。
 */
(function () {
  const SYSTEM_PROMPT = 'You are a helpful assistant.';

  function makeStreamId() {
    return `s-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * @param {string} text 当前用户输入
   * @param {Array<{ role: string, content: string }>} priorHistory 不含本轮 user
   * @param {{ onDelta?: (piece: string) => void }} [streamHandlers]
   * @returns {Promise<{ content?: string, error?: string }>}
   */
  async function runBotAgent(text, priorHistory, streamHandlers) {
    const api = window.electronAPI;
    if (!api || typeof api.volcArkBotsChatStream !== 'function') {
      return { error: 'electronAPI.volcArkBotsChatStream 不可用' };
    }
    const history = Array.isArray(priorHistory) ? priorHistory : [];
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ];

    const streamId = makeStreamId();
    let unsubscribe = () => {};
    if (typeof api.onVolcArkStreamEvent === 'function' && streamHandlers && typeof streamHandlers.onDelta === 'function') {
      const onDelta = streamHandlers.onDelta;
      unsubscribe = api.onVolcArkStreamEvent((payload) => {
        if (!payload || payload.streamId !== streamId) return;
        if (payload.phase === 'delta' && payload.text) onDelta(payload.text);
      });
    }

    try {
      const r = await api.volcArkBotsChatStream(messages, streamId);
      if (r && r.error) return { error: r.error };
      if (typeof r?.content !== 'string') return { error: '响应缺少 content' };
      return { content: r.content };
    } finally {
      unsubscribe();
    }
  }

  /** 已含本轮 user 在末尾时的便捷封装 */
  async function complete(chatHistory) {
    if (!Array.isArray(chatHistory) || chatHistory.length === 0) {
      return { error: 'chatHistory 不能为空' };
    }
    const last = chatHistory[chatHistory.length - 1];
    if (last.role !== 'user') {
      return { error: 'chatHistory 最后一条须为 user' };
    }
    const prior = chatHistory.slice(0, -1);
    return runBotAgent(last.content, prior);
  }

  window.volcChat = { SYSTEM_PROMPT, runBotAgent, complete };
})();
