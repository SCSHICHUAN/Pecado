/**
 * @file ark-chat.js
 *
 * 火山方舟 Bots Chat Completions（主进程）。
 *
 * - `register(ipcMain)`：`BOTS_CHAT_COMPLETION` invoke 内 `loadEnv` + 取 `getResolvedApiKey/model`，对北京 endpoint 发起 `stream: true` POST；
 *   用 `ReadableStream` 按行消费，兼容 `data: {json}` SSE 与整行 JSON；从 choice delta 抽文本，`safeSend` 推送 `BOTS_STREAM_EVENT`。
 * - 流结束后 resolve `{ content }`；网络/解析错误 resolve `{ error }` 或向渲染端推 `phase: 'error'`。
 * - 不负责 UI；密钥仅出现在本进程内存与请求头。
 */
const { VOLC_ARK } = require('../../shared/ipc-channels');
const { loadEnvFromSearchRoots, getDefaultSearchRoots } = require('../load-env');
const { getResolvedApiKey, getResolvedModel } = require('./volc-user-config');

const ARK_BOTS_URL = 'https://ark.cn-beijing.volces.com/api/v3/bots/chat/completions';

function safeSend(sender, channel, payload) {
  try {
    if (sender && !sender.isDestroyed()) sender.send(channel, payload);
  } catch (_) {}
}

/** 从流式 JSON 块取出增量文本（兼容 OpenAI 风格 delta.content） */
function extractDeltaText(json) {
  if (!json || typeof json !== 'object') return '';
  const c0 = json.choices?.[0];
  if (!c0) return '';
  const d = c0.delta;
  if (d && typeof d.content === 'string') return d.content;
  if (d && Array.isArray(d.content)) {
    return d.content
      .map((p) => (p && p.type === 'text' && p.text ? String(p.text) : ''))
      .join('');
  }
  const msg = c0.message;
  if (msg && typeof msg.content === 'string') return msg.content;
  return '';
}

function streamJsonErrorMessage(json) {
  if (!json || typeof json !== 'object') return '';
  const err = json.error;
  if (!err) return '';
  if (typeof err === 'string') return err;
  return err.message || err.msg || String(err.code || '') || '';
}

/**
 * 读取 text/event-stream（SSE），按行解析 data: JSON
 * @param {import('electron').WebContents} sender
 * @param {string} streamId
 * @param {ReadableStream<Uint8Array>} body
 * @returns {Promise<{ ok: true, text: string } | { error: string }>}
 */
async function readSseStream(sender, streamId, body) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let carry = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    const lines = carry.split(/\r?\n/);
    carry = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      let data = '';
      if (trimmed.startsWith('data:')) {
        data = trimmed.slice(5).trim();
      } else if (trimmed.startsWith('{')) {
        data = trimmed;
      } else {
        continue;
      }
      if (data === '[DONE]') continue;
      let json;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      const errMsg = streamJsonErrorMessage(json);
      if (errMsg) {
        safeSend(sender, VOLC_ARK.BOTS_STREAM_EVENT, {
          streamId,
          phase: 'error',
          error: errMsg,
        });
        return { error: errMsg };
      }
      const piece = extractDeltaText(json);
      if (piece) {
        full += piece;
        safeSend(sender, VOLC_ARK.BOTS_STREAM_EVENT, {
          streamId,
          phase: 'delta',
          text: piece,
        });
      }
    }
  }

  if (carry.trim()) {
    const trimmed = carry.trim();
    let data = '';
    if (trimmed.startsWith('data:')) {
      data = trimmed.slice(5).trim();
    } else if (trimmed.startsWith('{')) {
      data = trimmed;
    }
    if (data && data !== '[DONE]') {
      try {
        const json = JSON.parse(data);
        const errTail = streamJsonErrorMessage(json);
        if (errTail) {
          safeSend(sender, VOLC_ARK.BOTS_STREAM_EVENT, {
            streamId,
            phase: 'error',
            error: errTail,
          });
          return { error: errTail };
        }
        const piece = extractDeltaText(json);
        if (piece) {
          full += piece;
          safeSend(sender, VOLC_ARK.BOTS_STREAM_EVENT, {
            streamId,
            phase: 'delta',
            text: piece,
          });
        }
      } catch (_) {}
    }
  }

  return { ok: true, text: full };
}

function register(ipcMain) {
  ipcMain.handle(VOLC_ARK.BOTS_CHAT_COMPLETION, async (event, payload) => {
    const roots = getDefaultSearchRoots();
    try {
      const { app } = require('electron');
      if (app && app.isReady && app.isReady()) roots.push(app.getAppPath());
    } catch (_) {}
    loadEnvFromSearchRoots(roots);

    const { messages, streamId } = payload || {};
    if (!streamId || typeof streamId !== 'string') {
      return { error: '缺少 streamId（流式对话需要）' };
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return { error: 'messages 必须为非空数组' };
    }

    let apiKey =
      process.env.VOLC_ARK_API_KEY ||
      process.env.ARK_API_KEY ||
      process.env.DOUBAO_API_KEY;
    if (apiKey) apiKey = String(apiKey).trim();
    if (!apiKey) apiKey = getResolvedApiKey();
    const model = getResolvedModel();

    if (!apiKey) {
      return {
        error:
          '未配置 API 密钥。任选其一：① 项目根目录 .env 中 VOLC_ARK_API_KEY=密钥（勿留空）② 复制 config/secrets.example.json 为 config/secrets.json，填写 volcArkApiKey。③ 应用内用户配置（若已接入）。文件须 UTF-8。',
      };
    }

    const body = {
      model,
      stream: true,
      stream_options: { include_usage: true },
      messages,
    };

    const sender = event.sender;

    try {
      const res = await fetch(ARK_BOTS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        let msg = `HTTP ${res.status}`;
        try {
          const j = JSON.parse(errText);
          msg = j.error?.message || j.message || msg;
        } catch (_) {
          if (errText && errText.length < 500) msg = errText;
        }
        safeSend(sender, VOLC_ARK.BOTS_STREAM_EVENT, {
          streamId,
          phase: 'error',
          error: msg,
        });
        return { error: msg };
      }

      if (!res.body) {
        const msg = '响应无 body，无法读取流';
        safeSend(sender, VOLC_ARK.BOTS_STREAM_EVENT, {
          streamId,
          phase: 'error',
          error: msg,
        });
        return { error: msg };
      }

      const out = await readSseStream(sender, streamId, res.body);
      if ('error' in out) return { error: out.error };
      if (!out.text || !String(out.text).trim()) {
        const msg = '流式响应中无有效文本内容';
        safeSend(sender, VOLC_ARK.BOTS_STREAM_EVENT, {
          streamId,
          phase: 'error',
          error: msg,
        });
        return { error: msg };
      }
      return { content: out.text };
    } catch (e) {
      const msg = e.message || String(e);
      safeSend(sender, VOLC_ARK.BOTS_STREAM_EVENT, {
        streamId,
        phase: 'error',
        error: msg,
      });
      return { error: msg };
    }
  });
}

module.exports = { register };
