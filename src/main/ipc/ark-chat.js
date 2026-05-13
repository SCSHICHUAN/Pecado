const { VOLC_ARK } = require('../../shared/ipc-channels');
const { loadEnvFromSearchRoots, getDefaultSearchRoots } = require('../load-env');

const ARK_BOTS_URL = 'https://ark.cn-beijing.volces.com/api/v3/bots/chat/completions';

function register(ipcMain) {
  ipcMain.handle(VOLC_ARK.BOTS_CHAT_COMPLETION, async (event, payload) => {
    const roots = getDefaultSearchRoots();
    try {
      const { app } = require('electron');
      if (app && app.isReady && app.isReady()) roots.push(app.getAppPath());
    } catch (_) {}
    loadEnvFromSearchRoots(roots);

    const { messages } = payload || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return { error: 'messages 必须为非空数组' };
    }

    let apiKey =
      process.env.VOLC_ARK_API_KEY ||
      process.env.ARK_API_KEY ||
      process.env.DOUBAO_API_KEY;
    if (apiKey) apiKey = String(apiKey).trim();
    const model = process.env.VOLC_ARK_MODEL || 'bot-20260424113808-wwggn';
    if (!apiKey) {
      return {
        error:
          '未配置 API 密钥。任选其一：① 项目根目录 .env 中 VOLC_ARK_API_KEY=密钥（勿留空）② 复制 config/secrets.example.json 为 config/secrets.json，填写 volcArkApiKey。③ npm run env:init 生成 .env 后再编辑。文件须 UTF-8。改完后可再发一条消息（已支持每次请求前重新加载环境文件）。',
      };
    }

    const body = {
      model,
      stream: false,
      stream_options: { include_usage: true },
      messages,
    };

    try {
      const res = await fetch(ARK_BOTS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          json.error?.message ||
          json.message ||
          (typeof json.error === 'string' ? json.error : null) ||
          `HTTP ${res.status}`;
        return { error: msg };
      }

      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        return { error: '响应中缺少 choices[0].message.content' };
      }
      return { content };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  });
}

module.exports = { register };
