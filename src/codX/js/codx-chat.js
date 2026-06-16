/**
 * @file codx-chat.js
 * CodX 底栏 Pecado 对话（Cursor 风格：用户全宽横条，AI markdown 无气泡）
 */
(function () {
  /** @type {Array<{ role: string, content: string }>} */
  let history = [{ role: 'assistant', content: '在编辑器中改代码，或在这里描述需求。' }];

  function $(id) {
    return document.getElementById(id);
  }

  function renderMarkdown(text) {
    const api = window.electronAPI;
    if (api?.renderMarkdown) {
      try {
        return api.renderMarkdown(String(text || ''));
      } catch (_) {
        /* fall through */
      }
    }
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function scrollBottom() {
    const el = $('codx-chat-scroll');
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }

  function addMessage(role, text) {
    const scroll = $('codx-chat-scroll');
    if (!scroll) return;
    const row = document.createElement('div');
    row.className = `codx-chat-msg codx-chat-msg-${role}`;

    const body = document.createElement('div');
    body.className = 'codx-chat-msg-body';

    if (role === 'user') {
      body.textContent = text;
    } else {
      body.classList.add('markdown-body');
      body.innerHTML = renderMarkdown(text);
    }

    row.appendChild(body);
    scroll.appendChild(row);
    scrollBottom();
  }

  function createThinkingRow() {
    const row = document.createElement('div');
    row.className = 'codx-chat-msg codx-chat-msg-assistant codx-chat-status';

    const body = document.createElement('div');
    body.className = 'codx-chat-msg-body codx-chat-thinking';

    const dots = document.createElement('span');
    dots.className = 'codx-chat-thinking-dots';
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = '<i></i><i></i><i></i>';

    const line = document.createElement('span');
    line.className = 'codx-chat-log-line';
    line.textContent = '思考中';

    body.appendChild(dots);
    body.appendChild(line);
    row.appendChild(body);
    return row;
  }

  function updateThinkingLogLine(thinkingRow, entry) {
    if (!thinkingRow) return;
    const lineEl = thinkingRow.querySelector('.codx-chat-log-line');
    if (!lineEl) return;
    const text = window.CodXLog?.formatLogFirstLine?.(entry);
    if (text) lineEl.textContent = text;
  }

  function createStreamingRow() {
    const scroll = $('codx-chat-scroll');
    if (!scroll) return null;
    const row = document.createElement('div');
    row.className = 'codx-chat-msg codx-chat-msg-assistant codx-chat-streaming';

    const body = document.createElement('div');
    body.className = 'codx-chat-msg-body markdown-body';
    body.innerHTML = '…';
    row.appendChild(body);
    scroll.appendChild(row);
    scrollBottom();
    return { row, body };
  }

  function scheduleStreamMarkdownRender(ctx) {
    if (ctx.getRaf()) return;
    ctx.setRaf(
      requestAnimationFrame(() => {
        ctx.setRaf(0);
        const raw = ctx.getRaw();
        const { body } = ctx;
        if (!body) return;
        body.innerHTML = raw ? renderMarkdown(raw) : '…';
        scrollBottom();
      })
    );
  }

  function cancelStreamMarkdownRender(rafRef) {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }

  async function sendMessage() {
    const input = $('codx-chat-input');
    const btn = $('codx-chat-send');
    const text = String(input?.value || '').trim();
    if (!text) return;
    const api = window.electronAPI;
    if (!api?.volcArkBotsChatStream) return;

    addMessage('user', text);
    history.push({ role: 'user', content: text });
    input.value = '';
    if (btn) btn.disabled = true;

    const prior = [...history.slice(0, -1)];
    const streamId = `codx-${Date.now()}`;
    const activeRelPath = String(window.CodXEditor?.getActiveContent?.()?.relPath || '').trim();
    let raw = '';
    let unsub = () => {};
    let streamRow = null;
    let streamBody = null;
    const streamRafRef = { current: 0 };
    const streamCtx = {
      get body() {
        return streamBody;
      },
      getRaw: () => raw,
      getRaf: () => streamRafRef.current,
      setRaf: (n) => {
        streamRafRef.current = n;
      },
    };

    const thinking = createThinkingRow();
    $('codx-chat-scroll')?.appendChild(thinking);
    scrollBottom();

    function ensureStreamingRow() {
      if (streamRow) return;
      thinking.remove();
      const created = createStreamingRow();
      if (!created) return;
      streamRow = created.row;
      streamBody = created.body;
    }

    function onDelta(piece) {
      if (!piece) return;
      ensureStreamingRow();
      raw += piece;
      scheduleStreamMarkdownRender(streamCtx);
    }

    if (api.onVolcArkStreamEvent) {
      unsub = api.onVolcArkStreamEvent((payload) => {
        if (!payload || payload.streamId !== streamId) return;
        if (payload.phase === 'agent_log' && payload.entry) {
          window.CodXLog?.append?.(payload.entry);
          updateThinkingLogLine(thinking, payload.entry);
          scrollBottom();
          return;
        }
        if (payload.phase === 'delta' && payload.text) onDelta(payload.text);
        if (payload.phase === 'tool_stream' && payload.text) onDelta(payload.text);
      });
    }

    try {
      const res = await api.volcArkBotsChatStream({
        streamId,
        userText: text,
        history: prior,
        codxActiveFile: activeRelPath || undefined,
      });
      cancelStreamMarkdownRender(streamRafRef);
      const reply = res?.content || raw || (res?.error ? `错误：${res.error}` : '');

      if (streamBody) {
        streamBody.innerHTML = renderMarkdown(reply);
        streamRow?.classList.remove('codx-chat-streaming');
      } else {
        thinking.remove();
        addMessage('assistant', reply);
      }
      history.push({ role: 'assistant', content: reply });
    } catch (e) {
      cancelStreamMarkdownRender(streamRafRef);
      thinking.remove();
      if (streamRow) streamRow.remove();
      addMessage('assistant', `异常：${e.message || String(e)}`);
    } finally {
      unsub();
      if (btn) btn.disabled = false;
    }
  }

  function resetHistory() {
    history = [{ role: 'assistant', content: '在编辑器中改代码，或在这里描述需求。' }];
    const scroll = $('codx-chat-scroll');
    if (scroll) {
      scroll.replaceChildren();
      addMessage('assistant', history[0].content);
    }
  }

  function bind() {
    $('codx-chat-send')?.addEventListener('click', () => sendMessage());
    $('codx-chat-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    const scroll = $('codx-chat-scroll');
    if (scroll && !scroll.dataset.inited) {
      scroll.dataset.inited = '1';
      addMessage('assistant', history[0].content);
    }
  }

  window.CodXChat = { bind, resetHistory };
})();
