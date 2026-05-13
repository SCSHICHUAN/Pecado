/**
 * 火山方舟 · 豆包 bots（JS 侧）
 * 对应 Swift 的 runBotAgent(text:)：拼 messages → 经 IPC 由主进程带密钥 POST。
 * 密钥不得写在本文件；用 .env 或 config/secrets.json（见主进程 ark-chat.js）。
 */
(function () {
  const SYSTEM_PROMPT = 'You are a helpful assistant.';

  /**
   * 与 Swift runBotAgent(text:) 一致：system + 历史 self.messages + 本轮 user(text)
   * @param {string} text 当前用户输入
   * @param {Array<{ role: string, content: string }>} priorHistory 不含本轮 user（即发送前的 self.messages）
   * @returns {Promise<{ content?: string, error?: string }>}
   */
  async function runBotAgent(text, priorHistory) {
    const api = window.electronAPI;
    if (!api || typeof api.volcArkBotsChat !== 'function') {
      return { error: 'electronAPI.volcArkBotsChat 不可用' };
    }
    const history = Array.isArray(priorHistory) ? priorHistory : [];
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ];
    return api.volcArkBotsChat(messages);
  }

  /** 已含本轮 user 在末尾时的便捷封装（内部仍拆成 runBotAgent） */
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
