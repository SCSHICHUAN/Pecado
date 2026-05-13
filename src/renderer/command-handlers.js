/**
 * 解析助手返回的 JSON 指令（如 {"cmd":"open music"}）并调用主进程能力
 */
(function () {
  function tryParseJsonObject(text) {
    if (!text || typeof text !== 'string') return null;
    const s = text.trim();
    try {
      const o = JSON.parse(s);
      return typeof o === 'object' && o !== null && !Array.isArray(o) ? o : null;
    } catch (_) {}
    const block = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (block) {
      try {
        const o = JSON.parse(block[1].trim());
        return typeof o === 'object' && o !== null && !Array.isArray(o) ? o : null;
      } catch (_) {}
    }
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const o = JSON.parse(s.slice(start, end + 1));
        return typeof o === 'object' && o !== null && !Array.isArray(o) ? o : null;
      } catch (_) {}
    }
    return null;
  }

  function normalizeCmd(cmd) {
    return String(cmd || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * @param {string} rawContent 模型返回的原文
   * @returns {Promise<{ displayText: string }>}
   */
  async function handleAssistantContent(rawContent) {
    const raw = rawContent == null ? '' : String(rawContent);
    const obj = tryParseJsonObject(raw);
    if (!obj || typeof obj.cmd !== 'string') {
      return { displayText: raw };
    }

    const cmd = normalizeCmd(obj.cmd);
    const api = window.electronAPI;

    if (cmd === 'open music' || cmd === 'open qq music' || cmd === 'open qqmusic') {
      if (!api || typeof api.openQQMusic !== 'function') {
        return { displayText: '已识别打开音乐指令，但当前环境无法调用 QQ 音乐（缺少 electronAPI）。' };
      }
      try {
        await api.openQQMusic();
      } catch (e) {
        return { displayText: `已识别打开音乐指令，但启动失败：${e.message || String(e)}` };
      }
      return { displayText: '已为你打开 QQ 音乐。' };
    }

    return { displayText: raw };
  }

  window.botCommands = { handleAssistantContent, tryParseJsonObject };
})();
