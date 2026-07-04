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

  function addMessage(role, text, design) {
    const scroll = getScrollEl();
    if (!scroll) return;
    const row = document.createElement('div');
    row.className = `codx-chat-msg codx-chat-msg-${role}`;

    const body = document.createElement('div');
    body.className = 'codx-chat-msg-body';

    if (role === 'user') {
      if (design) {
        const tagWrap = document.createElement('div');
        tagWrap.className = 'codx-chat-design-preview';
        if (design.previewBase64) {
          const thumb = document.createElement('img');
          thumb.className = 'codx-chat-design-thumb';
          thumb.src = 'data:image/png;base64,' + design.previewBase64;
          tagWrap.appendChild(thumb);
        }
        const nameSpan = document.createElement('span');
        nameSpan.className = 'codx-chat-design-label';
        nameSpan.textContent = design.name || '';
        tagWrap.appendChild(nameSpan);
        body.appendChild(tagWrap);
      }
      const textSpan = document.createElement('span');
      textSpan.textContent = text;
      body.appendChild(textSpan);
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

    if (payload.phase === 'error') {
      // SSE流断开：记录错误，供 sendMessage catch 块做续写处理
      window.__codxLastStreamError = payload.error || '流式响应中断';
      window.__codxStreamErrorTs = Date.now();
      return true;
    }

    if (payload.phase === 'agent_log' && payload.entry) {
      window.CodXLiveStatus?.onExecEntry?.(payload.entry);
      maybeFollowScroll();
      return true;
    }

    if (payload.phase === 'tool_stream') {
      if (payload.name === 'codx_edit' || payload.name === 'write_file') {
        window.__codxLastCodePath = payload.path || '';
      }
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
      if (payload.phase === 'codx_edit_begin' || payload.phase === 'write_file_begin') {
        window.__codxLastCodePath = payload.path || '';
      }
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

    // 如果选了设计稿，获取目录树和预览图路径，拼到消息前面
    var design = window.__codxSelectedDesign;
    var llmContent = text;
    if (design) {
      try {
        var info = await api.workflowGetUiDesignInfo({
          projectRoot: window.CodX?.getProjectRoot?.() || '',
          relPath: design.relPath,
        });
        if (info && info.ok) {
          var previewLines = info.previewPaths && info.previewPaths.length
            ? '\n\n🖼 预览图路径：\n' + info.previewPaths.map(function (p) { return '- ' + p; }).join('\n')
            : '';
          llmContent = '【当前选中的 UI 设计稿】' + design.name + '（' + design.relPath + '）\n' +
            '📁 目录结构：\n' + info.treeAscii + previewLines + '\n\n' +
            '用户消息：' + text;
        }
      } catch (e) {
        // 获取失败则降级，只告知设计稿名称
        llmContent = '【当前选中的 UI 设计稿：' + design.name + '（' + design.relPath + '）】\n\n' + text;
      }
      window.__codxClearDesign();
    }

    addMessage('user', text, design);
    history.push({ role: 'user', content: llmContent });
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
        userText: llmContent,
        history: prior,
        codxActiveFile: activeRelPath || undefined,
        codxChat: true,
      });
      flushStreamMarkdownRender(streamCtx);
      cancelStreamMarkdownRender(streamCtx);

      // SSE 流中断 -> 走续写，不直接显示错误
      const codePathResume = window.__codxLastCodePath;
      const streamErrorResume = window.__codxLastStreamError || '';
      if (codePathResume && (res?.error || streamErrorResume)) {
        window.__codxLastCodePath = '';
        window.__codxLastStreamError = '';
        window.__codxStreamErrorTs = 0;
        thinking.remove();
        if (streamRow) { streamRow.classList.remove('codx-chat-streaming'); }

        let editorContent = '';
        try {
          if (window.CodXEditor?.getCachedContent) {
            const cached = window.CodXEditor.getCachedContent(codePathResume);
            if (cached && typeof cached === 'object') editorContent = String(cached.content || '');
            else if (cached) editorContent = String(cached);
          }
          if (!editorContent && api.mcpFsReadTextFile) {
            const pr = window.CodX?.getProjectRoot?.() || '';
            const readRes = await api.mcpFsReadTextFile({ path: codePathResume, projectRoot: pr });
            if (readRes && readRes.ok) editorContent = readRes.content || '';
          }
        } catch (_) {}

        if (editorContent) {
          addMessage('assistant', `⚠️ 流式输出中断（${streamErrorResume || res?.error || '网络异常'}），正在自动续写…`);
          const resumePrompt =
            '【系统】上一轮流式输出意外中断。' +
            '以下是当前编辑器中已写入的代码（可能不完整），请检查并补全剩余部分，确保代码完整可运行。' +
            '使用 codx_edit 完成未写完的代码。\n\n' +
            `文件：${codePathResume}\n\`\`\`\n${editorContent}\n\`\`\``;
          history.push({ role: 'assistant', content: raw || '' });
          history.push({ role: 'user', content: resumePrompt });
          addMessage('user', '（自动续写：流中断，补全 ' + codePathResume + '）');
          window.__codxResumeTarget = { codePath: codePathResume };
        } else {
          addMessage('assistant', `⚠️ 流式输出中断（${streamErrorResume || res?.error || '网络异常'}），无法读取 ${codePathResume} 内容，请手动重新发送。`);
          history.push({ role: 'assistant', content: raw || '' });
        }
        return; // 跳过后续正常路径，由 finally 后的 resume 触发 sendMessage
      }

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

      // SSE 断开检测：如果 LLM 正在写代码，记录续写参数，在 finally 后执行
      const codePath = window.__codxLastCodePath;
      const streamError = window.__codxLastStreamError || '';
      window.__codxLastCodePath = '';
      window.__codxLastStreamError = '';
      window.__codxStreamErrorTs = 0;

      window.__codxResumeTarget = null;
      if (codePath && (streamError || e && e.message)) {
        // 尝试读取当前编辑器内容
        let editorContent = '';
        try {
          if (window.CodXEditor?.getCachedContent) {
            const cached = window.CodXEditor.getCachedContent(codePath);
            if (cached && typeof cached === 'object') editorContent = String(cached.content || '');
            else if (cached) editorContent = String(cached);
          }
          if (!editorContent && api.mcpFsReadTextFile) {
            const pr = window.CodX?.getProjectRoot?.() || '';
            const readRes = await api.mcpFsReadTextFile({ path: codePath, projectRoot: pr });
            if (readRes && readRes.ok) editorContent = readRes.content || '';
          }
        } catch (_) {}

        if (editorContent) {
          addMessage('assistant', `⚠️ 流式输出中断（${streamError || e.message || '网络异常'}），正在自动续写…`);

          const resumePrompt =
            '【系统】上一轮流式输出意外中断。' +
            '以下是当前编辑器中已写入的代码（可能不完整），请检查并补全剩余部分，确保代码完整可运行。' +
            '使用 codx_edit 完成未写完的代码。\n\n' +
            `文件：${codePath}\n\`\`\`\n${editorContent}\n\`\`\``;

          history.push({ role: 'assistant', content: raw || '' });
          history.push({ role: 'user', content: resumePrompt });
          addMessage('user', '（自动续写：流中断，补全 ' + codePath + '）');
          window.__codxResumeTarget = { codePath };
        } else {
          addMessage('assistant', `⚠️ 流式输出中断（${streamError || e.message || '网络异常'}），无法读取 ${codePath} 内容，请手动检查并重新发送。`);
        }
      } else {
        addMessage('assistant', `异常：${e.message || String(e)}`);
      }
    } finally {
      unsub();
      window.CodXLiveStatus?.clear?.();
      if (btn) btn.disabled = false;
    }

    // 自动续写：finally 完成后触发，避免 btn.disabled 状态冲突
    if (window.__codxResumeTarget) {
      window.__codxResumeTarget = null;
      setTimeout(() => sendMessage(), 500);
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

  // ---- CodX UI 设计稿选择 ----
  (function () {
    window.__codxSelectedDesign = null;

    window.__codxClearDesign = function () {
      window.__codxSelectedDesign = null;
      var tag = document.getElementById('codx-design-tag');
      if (tag) {
        tag.style.display = '';
        tag.setAttribute('hidden', '');
      }
    };

    function renderDesignTag() {
      var tag = document.getElementById('codx-design-tag');
      var img = document.getElementById('codx-design-tag-img');
      var nameEl = document.getElementById('codx-design-tag-name');
      if (!tag || !img || !nameEl) return;
      var d = window.__codxSelectedDesign;
      if (!d) { tag.hidden = true; return; }
      tag.style.display = 'flex';
      tag.removeAttribute('hidden');
      if (d.previewBase64) img.src = 'data:image/png;base64,' + d.previewBase64;
      else img.src = '';
      nameEl.textContent = d.name || '';
    }

    function positionPicker() {
      var picker = document.getElementById('pecado-ui-picker');
      var container = document.getElementById('codx-chat-input');
      if (!picker || !container) return;
      var rect = container.getBoundingClientRect();
      picker.style.left = rect.left + 'px';
      picker.style.width = rect.width + 'px';
      picker.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    }

    async function loadDesignPickerList() {
      var list = document.getElementById('pecado-ui-picker-list');
      if (!list) return;
      list.innerHTML = '<div class="pecado-ui-picker-loading">加载中…</div>';
      positionPicker();

      var api = window.electronAPI;
      var listRes = { ok: false, items: [] };
      if (api && api.workflowListUiDesigns) {
        try {
          listRes = await api.workflowListUiDesigns({
            projectRoot: window.CodX?.getProjectRoot?.() || '',
            includePreview: true
          });
        } catch (e) {
          listRes = { ok: false, items: [], error: e.message || String(e) };
        }
      }

      if (!listRes.ok) {
        list.innerHTML = '<div class="pecado-ui-picker-empty">' + (listRes.error || '无法读取设计稿列表') + '</div>';
        return;
      }
      if (!listRes.items.length) {
        list.innerHTML = '<div class="pecado-ui-picker-empty">暂无设计稿</div>';
        return;
      }

      list.innerHTML = '';
      listRes.items.forEach(function (item, idx) {
        var row = document.createElement('div');
        row.className = 'pecado-ui-picker-item';
        var num = document.createElement('span');
        num.className = 'pecado-ui-picker-index';
        num.textContent = String(idx + 1);
        row.appendChild(num);
        if (item.previewBase64) {
          var thumb = document.createElement('img');
          thumb.className = 'pecado-ui-picker-thumb';
          thumb.src = 'data:image/png;base64,' + item.previewBase64;
          row.appendChild(thumb);
        }
        var nameSpan = document.createElement('span');
        nameSpan.className = 'pecado-ui-picker-name';
        nameSpan.textContent = item.name;
        row.appendChild(nameSpan);

        (function (captured) {
          row.addEventListener('click', function () {
            window.__codxSelectedDesign = {
              name: captured.name,
              relPath: captured.relPath,
              previewBase64: captured.previewBase64,
            };
            renderDesignTag();
            var picker = document.getElementById('pecado-ui-picker');
            if (picker) picker.classList.add('hidden');
          });
        })(item);

        list.appendChild(row);
      });
    }

    function init() {
      var uiPickBtn = document.getElementById('pecado-ui-pick-btn');
      var uiPicker = document.getElementById('pecado-ui-picker');
      var tagRemove = document.getElementById('codx-design-tag-remove');
      var ignoreNextDocClick = false;

      if (tagRemove) {
        tagRemove.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          window.__codxClearDesign();
        });
      }

      if (!uiPickBtn || !uiPicker) return;

      uiPickBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!uiPicker.classList.contains('hidden')) {
          uiPicker.classList.add('hidden');
          return;
        }
        ignoreNextDocClick = true;
        uiPicker.classList.remove('hidden');
        loadDesignPickerList();
      });

      document.addEventListener('click', function (e) {
        if (ignoreNextDocClick) { ignoreNextDocClick = false; return; }
        if (!uiPicker || uiPicker.classList.contains('hidden')) return;
        if (uiPicker.contains(e.target)) return;
        if (uiPickBtn && uiPickBtn.contains(e.target)) return;
        uiPicker.classList.add('hidden');
      });

      window.addEventListener('resize', function () {
        if (uiPicker && !uiPicker.classList.contains('hidden')) positionPicker();
      });

      // 面板拖拽时 ResizeObserver 触发实时适配
      var inputEl = document.getElementById('codx-chat-input');
      if (inputEl && window.ResizeObserver) {
        var ro = new ResizeObserver(function () {
          if (uiPicker && !uiPicker.classList.contains('hidden')) positionPicker();
        });
        ro.observe(inputEl);
      }
    }

    init();
  })();
})();
