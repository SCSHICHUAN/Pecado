/**
 * @file agent-commands.js
 *
 * Agent 最原始的能力：解析助手回复中的结构化 JSON 指令并执行（如打开 QQ 音乐）。
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
