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

  function getScrollEl() {
    return $('codx-chat-scroll');
  }

  const chatScroll = window.ChatScrollFollow.create(getScrollEl);

  const shouldFollowChatOutput = () => chatScroll.shouldFollowChatOutput();
  const shouldAutoScrollAfterTurn = () => chatScroll.shouldAutoScrollAfterTurn();
  const isChatPinnedToBottom = () => chatScroll.isChatPinnedToBottom();
  const scrollChatToBottomForced = (opts) => chatScroll.scrollChatToBottomForced(opts);

  function bindActiveTurnResizeFollow(...elements) {
    chatScroll.bindResizeFollow(...elements);
  }

  function unbindActiveTurnResizeFollow() {
    chatScroll.unbindResizeFollow();
  }

  function maybeFollowScroll() {
    if (shouldFollowChatOutput()) scrollChatToBottomForced({ streamFollow: true });
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

  function addMessage(role, text) {
    const scroll = getScrollEl();
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
    if (role === 'user') {
      if (isChatPinnedToBottom() && !chatScroll.isDetached) {
        scrollChatToBottomForced({ streamFollow: true });
      }
    } else if (!chatScroll.isDetached) {
      scrollChatToBottomForced({ streamFollow: true });
    }
  }

  function createThinkingRow() {
    const row = document.createElement('div');
    row.className = 'codx-chat-msg codx-chat-msg-assistant codx-chat-status';

    const body = document.createElement('div');
    body.className = 'codx-chat-msg-body codx-chat-thinking';

    const lines = document.createElement('div');
    lines.className = 'codx-chat-live-lines';

    const historyLine = document.createElement('span');
    historyLine.className = 'codx-chat-log-line codx-chat-log-history';
    historyLine.hidden = true;

    const mainRow = document.createElement('div');
    mainRow.className = 'codx-chat-live-main';

    const dots = document.createElement('span');
    dots.className = 'codx-chat-thinking-dots';
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = '<i></i><i></i><i></i>';

    const phaseLine = document.createElement('span');
    phaseLine.className = 'codx-chat-log-line codx-chat-log-phase';
    phaseLine.textContent = '思考';

    mainRow.appendChild(dots);
    mainRow.appendChild(phaseLine);

    const detailLine = document.createElement('span');
    detailLine.className = 'codx-chat-log-line codx-chat-log-detail';
    detailLine.hidden = true;

    lines.appendChild(historyLine);
    lines.appendChild(mainRow);
    lines.appendChild(detailLine);

    body.appendChild(lines);
    row.appendChild(body);
    window.CodXLiveStatus?.bindLines?.(historyLine, phaseLine, detailLine);
    return row;
  }

  function handleStreamPayload(payload) {
    if (!payload) return false;

    if (payload.phase === 'agent_log' && payload.entry) {
      window.CodXLiveStatus?.onExecEntry?.(payload.entry);
      maybeFollowScroll();
      return true;
    }

    if (payload.phase === 'tool_stream') {
      if (window.CodXLiveStatus?.isTurnActive?.()) {
        window.CodXLiveStatus?.onToolStream?.(payload);
        maybeFollowScroll();
        return true;
      }
      if (payload.name === 'codx_edit' || payload.name === 'write_file') return true;
      return false;
    }

    if (
      payload.phase === 'tool' ||
      payload.phase === 'codx_edit_begin' ||
      payload.phase === 'write_file_begin' ||
      payload.phase === 'codx_edit_plan'
    ) {
      window.CodXLiveStatus?.onStepStart?.({
        phase: payload.phase,
        name:
          payload.name ||
          (payload.phase === 'codx_edit_plan'
            ? 'codx_edit_plan'
            : payload.phase === 'codx_edit_begin'
              ? 'codx_edit'
              : payload.phase === 'write_file_begin'
                ? 'write_file'
                : ''),
        arguments: payload.arguments,
        path: payload.path,
        index: payload.index,
        streaming: payload.streaming,
      });
      maybeFollowScroll();
      return true;
    }

    return false;
  }

  function createStreamingRow(afterEl) {
    const scroll = getScrollEl();
    if (!scroll) return null;
    const row = document.createElement('div');
    row.className = 'codx-chat-msg codx-chat-msg-assistant codx-chat-streaming';

    const body = document.createElement('div');
    body.className = 'codx-chat-msg-body markdown-body';
    body.innerHTML = '…';
    row.appendChild(body);
    if (afterEl?.parentNode === scroll) {
      scroll.insertBefore(row, afterEl.nextSibling);
    } else {
      scroll.appendChild(row);
    }
    maybeFollowScroll();
    return { row, body };
  }

  function createCodxStreamReveal(ctx) {
    return window.StreamTextReveal?.create?.({
      getTarget: () => ctx.body,
      getRaw: () => ctx.getRaw(),
      renderMarkdown: (raw) => renderMarkdown(raw),
      onEmpty: (target) => {
        target.classList.remove('markdown-body');
        target.textContent = '…';
      },
      onAfterRender: (target) => {
        target?.classList.add('markdown-body');
        maybeFollowScroll();
      },
    });
  }

  function scheduleStreamMarkdownRender(ctx) {
    if (!ctx.streamReveal) ctx.streamReveal = createCodxStreamReveal(ctx);
    ctx.streamReveal.schedule();
  }

  function flushStreamMarkdownRender(ctx) {
    ctx.streamReveal?.flush?.();
  }

  function cancelStreamMarkdownRender(ctx) {
    ctx.streamReveal?.cancel?.();
    ctx.streamReveal = null;
  }

  const INPUT_MAX_LINES = 5;

  function syncInputHeight(input) {
    if (!input) return;
    input.style.height = 'auto';
    const style = window.getComputedStyle(input);
    const lineHeight = parseFloat(style.lineHeight) || 20;
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const maxH = Math.round(lineHeight * INPUT_MAX_LINES + padY);
    const next = Math.min(input.scrollHeight, maxH);
    input.style.height = `${next}px`;
    input.style.overflowY = input.scrollHeight > maxH ? 'auto' : 'hidden';
  }

  async function sendMessage() {
    const input = $('codx-chat-input');
    const btn = $('codx-chat-send');
    const text = String(input?.value || '').trim();
    if (!text) return;
    const api = window.electronAPI;
    if (!api?.volcArkBotsChatStream) {
      alert('对话 API 不可用');
      return;
    }

    chatScroll.prepareForNewTurn();

    addMessage('user', text);
    history.push({ role: 'user', content: text });
    input.value = '';
    syncInputHeight(input);
    if (btn) btn.disabled = true;

    const prior = [...history.slice(0, -1)];
    const streamId = `codx-${Date.now()}`;
    const activeRelPath = String(window.CodXEditor?.getActiveContent?.()?.relPath || '').trim();
    let raw = '';
    let unsub = () => {};
    let streamRow = null;
    let streamBody = null;
    const streamCtx = {
      get body() {
        return streamBody;
      },
      getRaw: () => raw,
      streamReveal: null,
    };

    const thinking = createThinkingRow();
    getScrollEl()?.appendChild(thinking);
    bindActiveTurnResizeFollow(thinking);
    maybeFollowScroll();

    function ensureStreamingRow() {
      if (streamRow) return;
      const created = createStreamingRow(thinking);
      if (!created) return;
      streamRow = created.row;
      streamBody = created.body;
      bindActiveTurnResizeFollow(thinking, streamRow);
    }

    function onAgentReasoning(piece) {
      if (!piece) return;
      window.CodXLiveStatus?.onInferTextDelta?.(piece);
      maybeFollowScroll();
    }

    function onFinalReplyDelta(piece) {
      if (!piece) return;
      ensureStreamingRow();
      raw += piece;
      scheduleStreamMarkdownRender(streamCtx);
    }

    if (api.onVolcArkStreamEvent) {
      unsub = api.onVolcArkStreamEvent((payload) => {
        if (!payload || payload.streamId !== streamId) return;
        if (handleStreamPayload(payload)) return;
        if (payload.phase === 'reasoning_delta' && payload.text) {
          if (window.CodXLiveStatus?.isTurnActive?.()) onAgentReasoning(payload.text);
          return;
        }
        if (payload.phase === 'delta' && payload.text) {
          onFinalReplyDelta(payload.text);
          return;
        }
        if (payload.phase === 'tool_stream' && payload.text) {
          if (window.CodXLiveStatus?.isTurnActive?.()) {
            window.CodXLiveStatus?.onToolStream?.({
              name: payload.name,
              path: payload.path,
              text: payload.text,
            });
            maybeFollowScroll();
          } else {
            onFinalReplyDelta(payload.text);
          }
        }
      });
    }

    try {
      const res = await api.volcArkBotsChatStream({
        streamId,
        userText: text,
        history: prior,
        codxActiveFile: activeRelPath || undefined,
        codxChat: true,
      });
      flushStreamMarkdownRender(streamCtx);
      cancelStreamMarkdownRender(streamCtx);
      const invokeContent = res?.content || (res?.error ? `错误：${res.error}` : '');
      const resolveTurn =
        window.StreamTextReveal?.resolveStreamTurnContent ||
        ((streamed, invoke) => {
          const s = String(streamed ?? '').trim();
          return s || String(invoke ?? '').trim();
        });
      const hadStream =
        window.StreamTextReveal?.hasStreamedTurnContent?.(raw) ??
        Boolean(String(raw ?? '').trim());
      const displayText = resolveTurn(raw, invokeContent);

      if (streamBody) {
        if (!hadStream && displayText) {
          streamBody.innerHTML = renderMarkdown(displayText);
        }
        streamRow?.classList.remove('codx-chat-streaming');
        thinking.remove();
      } else if (displayText) {
        thinking.remove();
        addMessage('assistant', displayText);
      } else {
        thinking.remove();
      }
      history.push({ role: 'assistant', content: displayText });
      if (shouldAutoScrollAfterTurn()) scrollChatToBottomForced({ streamFollow: true });
    } catch (e) {
      cancelStreamMarkdownRender(streamCtx);
      thinking.remove();
      if (streamRow) streamRow.remove();
      addMessage('assistant', `异常：${e.message || String(e)}`);
    } finally {
      unsub();
      window.CodXLiveStatus?.clear?.();
      chatScroll.endTurnFollow();
      unbindActiveTurnResizeFollow();
      if (btn) btn.disabled = false;
    }
  }

  function resetHistory() {
    history = [{ role: 'assistant', content: '在编辑器中改代码，或在这里描述需求。' }];
    chatScroll.resetDetached();
    const scroll = getScrollEl();
    if (scroll) {
      scroll.replaceChildren();
      addMessage('assistant', history[0].content);
    }
  }

  function bind() {
    chatScroll.bindScrollListeners();
    const input = $('codx-chat-input');
    const btn = $('codx-chat-send');
    let imeComposing = false;
    btn?.addEventListener('click', (e) => {
      e.preventDefault();
      sendMessage();
    });
    input?.addEventListener('input', () => syncInputHeight(input));
    input?.addEventListener('compositionstart', () => {
      imeComposing = true;
    });
    input?.addEventListener('compositionend', () => {
      imeComposing = false;
    });
    input?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      if (imeComposing || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      sendMessage();
    });
    syncInputHeight(input);
    const scroll = getScrollEl();
    if (scroll && !scroll.dataset.inited) {
      scroll.dataset.inited = '1';
      addMessage('assistant', history[0].content);
    }
  }

  window.CodXChat = { bind, resetHistory };
})();
