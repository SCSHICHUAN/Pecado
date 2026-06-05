/**
 * @file agent-commands.js
 *
 * 【功能】助手回复后置处理：解析 JSON 结构化指令并执行本地 OS 动作（与 MCP tools 无关）。
 *   - tryParseJsonObject：整段 JSON / ```json 代码块 / 首尾 {} 子串 三种解析策略
 *   - normalizeCmd：小写 + 合并空白
 *   - 已支持 cmd：open music | open qq music | open qqmusic → 打开 QQ 音乐（失败 fallback 浏览器）
 *   - 未识别 cmd → displayText 原样返回 raw
 *
 * 【调用方】
 *   - main.js → register(ipcMain)
 *   - renderer/js/chat.js：流式结束后 invoke handleBotCommand(reply)
 *
 * 【对外能力】
 *   - register(ipcMain)：QQ_MUSIC.HANDLE_BOT_COMMAND，payload { rawContent }
 *   - handleBotCommand(rawContent) → { displayText: string }
 */
const { shell } = require('electron');
const { exec } = require('child_process');
const { QQ_MUSIC } = require('../../shared/ipc-channels');

function openDesktopQQMusic() {
  if (process.platform === 'darwin') {
    exec('open -a "QQMusic"', (err) => {
      if (err) {
        console.error('无法打开 QQ 音乐:', err);
        shell.openExternal('https://y.qq.com');
      }
    });
  } else if (process.platform === 'win32') {
    exec('start "" "C:\\Program Files\\Tencent\\QQMusic\\QQMusic.exe"', (err) => {
      if (err) {
        console.error('无法打开 QQ 音乐:', err);
        shell.openExternal('https://y.qq.com');
      }
    });
  } else {
    exec('xdg-open qqmusic', (err) => {
      if (err) {
        console.error('无法打开 QQ 音乐:', err);
        shell.openExternal('https://y.qq.com');
      }
    });
  }
}

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
 * @param {string} rawContent
 * @returns {Promise<{ displayText: string }>}
 */
async function handleBotCommand(rawContent) {
  const raw = rawContent == null ? '' : String(rawContent);
  const obj = tryParseJsonObject(raw);
  if (!obj || typeof obj.cmd !== 'string') {
    return { displayText: raw };
  }

  const cmd = normalizeCmd(obj.cmd);

  if (cmd === 'open music' || cmd === 'open qq music' || cmd === 'open qqmusic') {
    try {
      await new Promise((resolve) => {
        openDesktopQQMusic();
        resolve();
      });
      return { displayText: '已为你打开 QQ 音乐。' };
    } catch (e) {
      return { displayText: `已识别打开音乐指令，但启动失败：${e.message || String(e)}` };
    }
  }

  return { displayText: raw };
}

function register(ipcMain) {
  ipcMain.handle(QQ_MUSIC.HANDLE_BOT_COMMAND, async (_event, payload) => {
    return handleBotCommand(payload?.rawContent ?? '');
  });
}

module.exports = { register, handleBotCommand };
