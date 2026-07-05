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

    // history 折叠面板
    const details = document.createElement('details');
    details.className = 'codx-chat-thinking-details';
    details.hidden = true;
    const summary = document.createElement('summary');
    summary.className = 'codx-chat-thinking-summary';
    summary.textContent = 'history';
    const histScroll = document.createElement('div');
    histScroll.className = 'codx-chat-thinking-scroll';
    details.appendChild(summary);
    details.appendChild(histScroll);

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

    lines.appendChild(mainRow);
    lines.appendChild(detailLine);

    body.appendChild(details);
    body.appendChild(lines);
    row.appendChild(body);

    // history 滚动逻辑
    let histDetached = false;
    histScroll.addEventListener('scroll', function () {
      var near = histScroll.scrollTop + histScroll.clientHeight + 2 >= histScroll.scrollHeight;
      histDetached = !near;
    });

    let _callSeq = 0;
    let _pendingKey = '';
    let _pendingCount = 0;
    let _pendingExtra = [];
    let _pendingHead = null;

    row._recordCall = function (name, path) {
      _callSeq++;
      var label = String(name || '?').trim();
      var file = String(path || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
      var key = label + '|' + file;

      function build(seq, n, cnt) {
        var line = document.createElement('div');
        line.className = 'codx-chat-call-entry';
        var idx = document.createElement('span');
        idx.className = 'call-idx';
        idx.textContent = seq;
        var mod = document.createElement('span');
        mod.className = 'call-mod';
        mod.textContent = (/^xcode_/.test(n) ? 'Xcode' : /^codx_edit|^write_file|^create_directory/.test(n) ? 'CodX' : /^read_skill|^run_skill/.test(n) ? 'Skill' : 'MCP');
        var sep = document.createElement('span');
        sep.className = 'call-sep';
        sep.textContent = '·';
        var nameEl = document.createElement('span');
        nameEl.className = 'call-name';
        nameEl.textContent = n;
        line.appendChild(idx);
        line.appendChild(mod);
        line.appendChild(sep);
        line.appendChild(nameEl);
        if (file) {
          var sep2 = document.createElement('span');
          sep2.className = 'call-sep';
          sep2.textContent = '·';
          var param = document.createElement('span');
          param.className = 'call-param';
          param.textContent = file;
          line.appendChild(sep2);
          line.appendChild(param);
        }
        if (cnt >= 5) {
          var tag = document.createElement('span');
          tag.className = 'call-batch';
          tag.textContent = '[' + cnt + ' 次调用]';
          line.appendChild(tag);
        }
        return line;
      }

      if (_pendingKey === key) {
        _pendingCount++;
        if (_pendingCount < 5) {
          var ext = build(_callSeq, label, 0);
          histScroll.appendChild(ext);
          _pendingExtra.push(ext);
        } else if (_pendingCount === 5) {
          _pendingExtra.forEach(function (el) { el.remove(); });
          _pendingExtra = [];
          _pendingHead.replaceWith(build(_callSeq, label, _pendingCount));
          _pendingHead = histScroll.lastElementChild;
        } else {
          _pendingHead.replaceWith(build(_callSeq, label, _pendingCount));
          _pendingHead = histScroll.lastElementChild;
        }
        details.hidden = false;
        if (!histDetached) histScroll.scrollTop = histScroll.scrollHeight;
        return;
      }

      _pendingKey = key;
      _pendingCount = 1;
      _pendingExtra = [];
      var line = build(_callSeq, label, 0);
      histScroll.appendChild(line);
      _pendingHead = line;
      details.hidden = false;
      if (!histDetached) histScroll.scrollTop = histScroll.scrollHeight;
    };

    row._finishThinking = function () {
      _pendingKey = '';
      details.open = false;
      mainRow.remove();
      detailLine.remove();
      lines.hidden = true;
      row.classList.remove('codx-chat-status');
      window.__codxThinkingRow = null;
    };

    window.CodXLiveStatus?.bindLines?.(historyLine, phaseLine, detailLine);
    return row;
  }

  function handleStreamPayload(payload) {
    if (!payload) return false;

    if (payload.phase === 'error') {
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

      var toolName =
        payload.name ||
        (payload.phase === 'codx_edit_plan'
          ? 'codx_edit_plan'
          : payload.phase === 'codx_edit_begin'
            ? 'codx_edit'
            : payload.phase === 'write_file_begin'
              ? 'write_file'
              : '');
      var toolPath = payload.path || (payload.arguments && payload.arguments.path) || '';

      if (toolName && toolName !== 'finish_task') {
        var t = window.__codxThinkingRow;
        if (t && typeof t._recordCall === 'function') t._recordCall(toolName, toolPath);
      }

      window.CodXLiveStatus?.onStepStart?.({
        phase: payload.phase,
        name: toolName,
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

  async function sendMessage(forceText) {
    const input = $('codx-chat-input');
    const btn = $('codx-chat-send');
    const text = String(forceText || input?.value || '').trim();
    if (!text) return;

    const isResuming = window.__isCodxResuming === true;
    window.__isCodxResuming = false;

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

    addMessage('user', isResuming ? '（续写中…）' : text, design);
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
    window.__codxThinkingRow = thinking;
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

        addMessage('assistant', `⚠️ 流式输出中断（${streamErrorResume || res?.error || '网络异常'}），正在自动续写…`);
        const resumePrompt =
          '【系统】上一轮 codx_edit 写入被意外中断，代码已部分写入文件 `' + codePathResume + '`。' +
          '请先用 read_text_file 读取该文件当前内容，确认截断位置。' +
          '然后使用 codx_edit_plan → codx_edit 从截断处补全剩余代码。' +
          '切勿重写已有代码，只补全末尾缺失部分。';
        history.push({ role: 'assistant', content: '[codx_edit 流式写入被中断]' });
        input.value = resumePrompt;
        window.__isCodxResuming = true;
        window.__codxResumeTarget = { codePath: codePathResume };
        unsub();
        window.CodXLiveStatus?.clear?.();
        if (btn) btn.disabled = false;
        return;
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
        thinking._finishThinking?.();
      } else if (displayText) {
        thinking._finishThinking?.();
        addMessage('assistant', displayText);
      } else {
        thinking._finishThinking?.();
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
        addMessage('assistant', `⚠️ 流式输出中断（${streamError || e.message || '网络异常'}），正在自动续写…`);
        const resumePrompt =
          '【系统】上一轮 codx_edit 写入被意外中断，代码已部分写入文件 `' + codePath + '`。' +
          '请先用 read_text_file 读取该文件当前内容，确认截断位置。' +
          '然后使用 codx_edit_plan → codx_edit 从截断处补全剩余代码。' +
          '切勿重写已有代码，只补全末尾缺失部分。';
        history.push({ role: 'assistant', content: '[codx_edit 流式写入被中断]' });
        input.value = resumePrompt;
        window.__isCodxResuming = true;
        window.__codxResumeTarget = { codePath };
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

  window.CodXChat = { bind, resetHistory, sendMessage };

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
