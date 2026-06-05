/**
 * @file chat-stream-client.js
 *
 * 渲染进程 LLM 对话客户端（拼 messages、订阅 IPC 流，不触碰密钥）。
 */
(function () {
  const SYSTEM_PROMPT = 'You are a helpful assistant.';
  const AGENT_SYSTEM_PROMPT =
    (window.projectPrompts && window.projectPrompts.AGENT_SYSTEM_PROMPT) ||
    '你是代码编辑器助手。用户已打开本地工程；需要查看目录、读文件或修改代码时，请调用提供的 tools，不要编造文件内容。修改源码请用 write_file（整文件）或 edit_file（局部）。';

  function makeStreamId() {
    return `s-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  const CHAT_MODE = { PLAIN: 'plain', CONTEXT: 'context', AGENT: 'agent' };

  function resolveMode(opts) {
    if (opts.mode === CHAT_MODE.AGENT || opts.mode === 'agent') return CHAT_MODE.AGENT;
    if (opts.mode === CHAT_MODE.CONTEXT || opts.mode === 'context') return CHAT_MODE.CONTEXT;
    if (opts.useMcpTools) return CHAT_MODE.AGENT;
    return CHAT_MODE.PLAIN;
  }

  /**
   * @param {string} text
   * @param {Array<{ role: string, content: string }>} priorHistory
   * @param {{ onDelta?: (piece: string) => void }} [streamHandlers]
   * @param {{ mode?: string, projectContext?: string, useMcpTools?: boolean, xcodeStreamPath?: string }} [options]
   */
  async function runBotAgent(text, priorHistory, streamHandlers, options) {
    const api = window.electronAPI;
    if (!api || typeof api.volcArkBotsChatStream !== 'function') {
      return { error: 'electronAPI.volcArkBotsChatStream 不可用' };
    }
    const opts = options && typeof options === 'object' ? options : {};
    const mode = resolveMode(opts);
    let systemContent = mode === CHAT_MODE.AGENT ? AGENT_SYSTEM_PROMPT : SYSTEM_PROMPT;
    if (mode !== CHAT_MODE.AGENT && opts.projectContext && String(opts.projectContext).trim()) {
      systemContent += '\n\n' + String(opts.projectContext).trim();
    }
    const history = Array.isArray(priorHistory) ? priorHistory : [];
    const messages = [
      { role: 'system', content: systemContent },
      ...history.map((m) => ({
        role: m.role,
        content: m.content == null ? '' : String(m.content),
      })),
      { role: 'user', content: text },
    ];

    const streamId = makeStreamId();
    let unsubscribe = () => {};
    if (typeof api.onVolcArkStreamEvent === 'function' && streamHandlers && typeof streamHandlers.onDelta === 'function') {
      const onDelta = streamHandlers.onDelta;
      unsubscribe = api.onVolcArkStreamEvent((payload) => {
        if (!payload || payload.streamId !== streamId) return;
        if (payload.phase === 'delta' && payload.text) onDelta(payload.text);
        if (payload.phase === 'tool_stream' && payload.text) onDelta(payload.text);
      });
    }

    try {
      const r = await api.volcArkBotsChatStream(messages, streamId, {
        mode,
        xcodeStreamPath: mode === CHAT_MODE.AGENT ? opts.xcodeStreamPath || undefined : undefined,
      });
      if (r && r.error) return { error: r.error };
      if (typeof r?.content !== 'string') return { error: '响应缺少 content' };
      return { content: r.content };
    } finally {
      unsubscribe();
    }
  }

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

  window.chatStream = { SYSTEM_PROMPT, CHAT_MODE, runBotAgent, complete };
})();
