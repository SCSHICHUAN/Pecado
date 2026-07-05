/**
 * @file index.js
 *
 * 【功能】Pecado 渲染进程 UI：工程目录树气泡 + 对话主逻辑。
 * 【调用方】main/html/index.html → ../../pecado/js/index.js
 */
(function () {
  /** @type {null | {
   *   addMessage: (text: string, type: string) => void,
   *   scrollChatToBottomForced: (opts?: object) => void,
   *   pushChatHistory: (entry: { role: string, content: string }) => void,
   * }} */
  let uiDeps = null;

  function getApi() {
    return window.electronAPI;
  }

  function formatMcpTreeAscii(tree, maxLines) {
    return window.formatMcpTree.formatMcpTreeAscii(tree, maxLines);
  }

  function buildProjectTreeMarkdownFromAscii(projectRoot, treeAscii, xcodeProject) {
    const folderName = String(projectRoot).split(/[/\\]/).filter(Boolean).pop() || projectRoot;
    const indented = String(treeAscii || '(无)')
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n');
    const xcodeHint = xcodeProject
      ? `\n\n检测到 Xcode 工程 **${xcodeProject.name}**（${xcodeProject.kind === 'workspace' ? '.xcworkspace' : '.xcodeproj'}）。`
      : '';
    return (
      `已选择工程 **${folderName}**${xcodeHint}\n\n` +
      `\`${projectRoot}\`\n\n` +
      `**目录结构**\n\n${indented}`
    );
  }

  function buildProjectTreeMarkdown(projectRoot, tree, xcodeProject) {
    const treeText = formatMcpTreeAscii(tree, 400);
    return buildProjectTreeMarkdownFromAscii(projectRoot, treeText, xcodeProject);
  }

  function showProjectTreeMarkdown(projectRoot, md) {
    if (!uiDeps) return;
    uiDeps.addMessage(md, 'assistant');
    uiDeps.pushChatHistory({ role: 'assistant', content: md });
  }

  async function showProjectTreeBubble(projectRoot, xcodeProject) {
    if (!uiDeps) return;
    const api = getApi();
    if (!api || typeof api.mcpFsDirectoryTree !== 'function') {
      uiDeps.addMessage('已选择工程，但当前环境无法读取文件树。', 'assistant');
      uiDeps.scrollChatToBottomForced();
      return;
    }
    const res = await api.mcpFsDirectoryTree({});
    if (res.error) {
      uiDeps.addMessage(`已选择工程，但读取目录树失败：${res.error}`, 'assistant');
      uiDeps.scrollChatToBottomForced();
      return;
    }
    const md = buildProjectTreeMarkdown(projectRoot, res.tree, xcodeProject);
    showProjectTreeMarkdown(projectRoot, md);
  }

  function setupProjectListener() {
    const api = getApi();
    if (!api || typeof api.onMcpFsProjectChanged !== 'function') return;
    api.onMcpFsProjectChanged(({ projectRoot, showTree, treeAscii, xcodeProject }) => {
      if (!projectRoot || showTree !== true) return;
      if (treeAscii) {
        showProjectTreeMarkdown(
          projectRoot,
          buildProjectTreeMarkdownFromAscii(projectRoot, treeAscii, xcodeProject)
        );
        return;
      }
      showProjectTreeBubble(projectRoot, xcodeProject).catch((e) => {
        console.error('[project-ui] showProjectTreeBubble', e);
        if (uiDeps) {
          uiDeps.addMessage(`已选择工程，但展示目录树失败：${e.message || String(e)}`, 'assistant');
          uiDeps.scrollChatToBottomForced();
        }
      });
    });
  }

  function init(deps) {
    uiDeps = deps;
    setupProjectListener();
  }

  window.projectUi = { init };
})();
// —— 对话 UI ——
const chatInput = document.getElementById('chat-input');
const sendButton = document.querySelector('.send-button');
const xcodeRunBtn = document.getElementById('pecado-xcode-run-btn');
const chatContent = document.getElementById('chat-content');
const scrollAnchor = document.getElementById('chat-scroll-anchor');
const workspaceScroll = document.getElementById('workspace-scroll');

const INITIAL_GREETING = '你好！我是 Pecado。有什么可以帮助你的吗？';
/** @type {Array<{ role: string, content: string | Array<object> }>} */
let chatHistory = [{ role: 'assistant', content: INITIAL_GREETING }];

/** @type {Array<object>} */
let pendingImages = [];

function renderImagePreview() {
  var bar = document.getElementById('image-preview-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'image-preview-bar';
    bar.className = 'image-preview-bar';
    var inputContainer = document.querySelector('.input-container');
    if (inputContainer && inputContainer.parentNode) {
      inputContainer.parentNode.insertBefore(bar, inputContainer);
    }
  }
  bar.innerHTML = '';
  pendingImages.forEach(function (img, idx) {
    var item = document.createElement('div');
    item.className = 'image-preview-item';
    var thumb = document.createElement('img');
    thumb.className = 'image-preview-thumb';
    thumb.src = window.MediaUtils.toDataUri(img);
    thumb.alt = img.name || '';
    var removeBtn = document.createElement('button');
    removeBtn.className = 'image-preview-remove';
    removeBtn.textContent = '\u00d7';
    removeBtn.type = 'button';
    removeBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      pendingImages.splice(idx, 1);
      renderImagePreview();
    });
    item.appendChild(thumb);
    item.appendChild(removeBtn);
    bar.appendChild(item);
  });
  if (pendingImages.length === 0 && bar.parentNode) {
    bar.remove();
  }
}

// 拖拽图片到气泡区+输入区，阻止浏览器默认打开文件行为
document.addEventListener('dragover', function (e) {
  e.preventDefault();
  e.stopPropagation();
});
document.addEventListener('drop', async function (e) {
  e.preventDefault();
  e.stopPropagation();
  var files = Array.from(e.dataTransfer.files).filter(
    function (f) { return f.type.startsWith('image/') || f.name.toLowerCase().endsWith('.svg'); }
  );
  if (!files.length) return;
  for (var i = 0; i < files.length; i++) {
    try {
      var img = await window.MediaUtils.fromFile(files[i]);
      pendingImages.push(img);
    } catch (err) {
      console.error('[pecado] \u56fe\u7247\u8bfb\u53d6\u5931\u8d25', err);
    }
  }
  renderImagePreview();
});

if (!chatInput || !sendButton || !chatContent || !scrollAnchor || !workspaceScroll) {
  console.error('[pecado] index.js: 缺少必要的 DOM 节点，请检查 main/html/index.html 结构');
} else {
  const chatScroll = window.ChatScrollFollow.create(() => workspaceScroll);
  chatScroll.bindScrollListeners();

  function bindActiveBubbleResizeFollow(bubble) {
    chatScroll.bindResizeFollow(bubble);
  }

  function unbindActiveBubbleResizeFollow() {
    chatScroll.unbindResizeFollow();
  }

  const shouldFollowChatOutput = () => chatScroll.shouldFollowChatOutput();
  const shouldAutoScrollAfterTurn = () => chatScroll.shouldAutoScrollAfterTurn();
  const isChatPinnedToBottom = () => chatScroll.isChatPinnedToBottom();
  const isChatWheelCooldownActive = () => chatScroll.isChatWheelCooldownActive();
  const scrollChatToBottomForced = (opts) => chatScroll.scrollChatToBottomForced(opts);

  /**
   * 为每个 fenced `pre` 外包层：圆角背景层 + 横向滚动层 +「复制」按钮，并给 `code` 加上 hljs 类名
   * @param {HTMLDivElement} bubble
   */
  function enhanceAssistantCodeBlocks(bubble) {
    if (!bubble || typeof bubble.querySelectorAll !== 'function') return;
    bubble.querySelectorAll('pre').forEach((pre) => {
      if (pre.closest('.code-block-wrap')) return;
      const code = pre.querySelector('code');
      if (!code) return;
      code.classList.add('hljs');

      const wrap = document.createElement('div');
      wrap.className = 'code-block-wrap';
      const backdrop = document.createElement('div');
      backdrop.className = 'code-block-backdrop';
      backdrop.setAttribute('aria-hidden', 'true');
      const scroll = document.createElement('div');
      scroll.className = 'code-block-scroll';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-copy-btn';
      btn.textContent = '复制';

      const copyPlain = () => code.innerText;

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const text = copyPlain();
        const okLabel = () => {
          btn.textContent = '已复制';
          clearTimeout(btn._copyTimer);
          btn._copyTimer = setTimeout(() => {
            btn.textContent = '复制';
          }, 2000);
        };
        const failLabel = () => {
          btn.textContent = '失败';
          clearTimeout(btn._copyTimer);
          btn._copyTimer = setTimeout(() => {
            btn.textContent = '复制';
          }, 2000);
        };

        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(text).then(okLabel).catch(() => {
            try {
              const ta = document.createElement('textarea');
              ta.value = text;
              ta.setAttribute('readonly', '');
              ta.style.position = 'fixed';
              ta.style.left = '-9999px';
              document.body.appendChild(ta);
              ta.select();
              document.execCommand('copy');
              document.body.removeChild(ta);
              okLabel();
            } catch (_) {
              failLabel();
            }
          });
        } else {
          try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            okLabel();
          } catch (_) {
            failLabel();
          }
        }
      });

      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(backdrop);
      wrap.appendChild(btn);
      wrap.appendChild(scroll);
      scroll.appendChild(pre);
    });
  }

  function getBubbleReplyEl(bubble) {
    return bubble.querySelector('.chat-bubble-reply') || bubble;
  }

  function ensureStreamingBubbleShell(bubble) {
    if (!bubble || bubble.querySelector('.chat-bubble-reply')) return;
    const execBlock = document.createElement('div');
    execBlock.className = 'chat-exec-block';
    execBlock.hidden = true;
    const reply = document.createElement('div');
    reply.className = 'chat-bubble-reply';
    bubble.textContent = '';
    bubble.appendChild(execBlock);
    bubble.appendChild(reply);
  }

  function updateTurnExecBlock(bubble, entry) {
    if (!bubble || !entry) return;
    ensureStreamingBubbleShell(bubble);
    const execBlock = bubble.querySelector('.chat-exec-block');
    if (!execBlock) return;

    if (entry.logKind === 'agent-phase') {
      window.LogPanel?.updateBubbleAgentPhases?.(execBlock, entry, bubble);
      return;
    }

    window.LogPanel?.updateBubbleToolSummary?.(execBlock, entry, bubble);
  }

  function setAssistantBubbleMarkdown(bubble, text) {
    ensureStreamingBubbleShell(bubble);
    const target = getBubbleReplyEl(bubble);
    const api = window.electronAPI;
    bubble.classList.add('markdown-body');
    if (api && typeof api.renderMarkdown === 'function') {
      target.innerHTML = api.renderMarkdown(text);
      enhanceAssistantCodeBlocks(bubble);
    } else {
      target.textContent = text;
    }
  }

  function clearAssistantMarkdownClass(bubble) {
    bubble.classList.remove('markdown-body');
  }

  function createBubbleStreamReveal(ctx) {
    return window.StreamTextReveal?.create?.({
      getTarget: () => getBubbleReplyEl(ctx.bubble),
      getRaw: () => ctx.getRaw(),
      renderMarkdown: (raw) => {
        const api = window.electronAPI;
        if (api?.renderMarkdown) return api.renderMarkdown(raw);
        return String(raw || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      },
      onEmpty: (target) => {
        clearAssistantMarkdownClass(ctx.bubble);
        target.textContent = '…';
      },
      onAfterRender: () => {
        ctx.bubble.classList.add('streaming', 'markdown-body');
        enhanceAssistantCodeBlocks(ctx.bubble);
        if (shouldFollowChatOutput()) scrollChatToBottomForced({ streamFollow: true });
      },
    });
  }

  function scheduleStreamMarkdownRender(ctx) {
    if (!ctx.streamReveal) ctx.streamReveal = createBubbleStreamReveal(ctx);
    ctx.streamReveal.schedule();
  }

  function flushStreamMarkdownRender(ctx) {
    ctx.streamReveal?.flush?.();
  }

  function cancelStreamMarkdownRender(ctx) {
    ctx.streamReveal?.cancel?.();
    ctx.streamReveal = null;
  }

  chatInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  sendButton.addEventListener('click', () => sendMessage());
  xcodeRunBtn?.addEventListener('click', () => {
    // 在 CodX 面板中，Run 按钮应触发 CodX 对话
    if (window.CodX?.isActive?.()) {
      window.CodXChat?.sendMessage?.('xcode_run');
      return;
    }
    if (sendButton.disabled) return;
    sendMessage('xcode_run');
  });
  let chatImeComposing = false;
  chatInput.addEventListener('compositionstart', () => {
    chatImeComposing = true;
  });
  chatInput.addEventListener('compositionend', () => {
    chatImeComposing = false;
  });
  chatInput.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (chatImeComposing || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    sendMessage();
  });

  /**
   * 插入一条空的助手气泡（流式输出），返回 bubble 节点
   * @returns {{ messageDiv: HTMLDivElement, bubble: HTMLDivElement }}
   */
  function addStreamingAssistantShell() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = '🤖';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble streaming';
    clearAssistantMarkdownClass(bubble);

    const execBlock = document.createElement('div');
    execBlock.className = 'chat-exec-block';
    execBlock.hidden = true;

    const reply = document.createElement('div');
    reply.className = 'chat-bubble-reply';
    reply.textContent = '…';

    bubble.appendChild(execBlock);
    bubble.appendChild(reply);

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(bubble);
    chatContent.insertBefore(messageDiv, scrollAnchor);
    scrollChatToBottomForced({ streamFollow: true });
    return { messageDiv, bubble };
  }

  function makeStreamId() {
    return `s-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  async function runBotAgent(text, priorHistory, imagesPayload, streamHandlers) {
    const api = window.electronAPI;
    if (!api || typeof api.volcArkBotsChatStream !== 'function') {
      return { error: 'electronAPI.volcArkBotsChatStream 不可用' };
    }

    const streamId = makeStreamId();
    let unsubscribe = () => {};
    if (typeof api.onVolcArkStreamEvent === 'function') {
      const onDelta = streamHandlers && typeof streamHandlers.onDelta === 'function'
        ? streamHandlers.onDelta
        : null;
      unsubscribe = api.onVolcArkStreamEvent((payload) => {
        if (!payload || payload.streamId !== streamId) return;
        if (payload.phase === 'agent_log' && payload.entry) {
          if (payload.entry.logKind === 'agent-phase') {
            window.LogPanel?.notifyTurnExec?.(payload.entry);
          } else {
            window.LogPanel?.append?.(payload.entry);
          }
          return;
        }
        if (payload.phase === 'reasoning_delta' && payload.text) {
          window.__pecadoTurnExec?.onReasoningDelta?.(payload.text);
          if (window.CodXLiveStatus?.isTurnActive?.()) {
            window.CodXLiveStatus?.onInferTextDelta?.(payload.text);
          }
          return;
        }
        if (!onDelta) return;
        if (payload.phase === 'delta' && payload.text) onDelta(payload.text);
      });
    }

    var ipcMedia = window.MediaUtils.toIpcPayload(imagesPayload);
    var payloadObj = {
      streamId: streamId,
      userText: text,
      images: ipcMedia.images,
      svgs: ipcMedia.svgs,
      history: Array.isArray(priorHistory) ? priorHistory : [],
    };
    Object.keys(payloadObj).forEach(function (k) { if (payloadObj[k] === undefined) delete payloadObj[k]; });

    try {
      const r = await api.volcArkBotsChatStream(payloadObj);
      if (r && r.error) return { error: r.error };
      if (typeof r?.content !== 'string') return { error: '响应缺少 content' };
      return { content: r.content };
    } finally {
      unsubscribe();
    }
  }

  async function sendMessage(overrideText) {
    const message = (overrideText != null ? String(overrideText) : chatInput.value).trim();
    if (!message) return;

    const turnImages = overrideText != null ? [] : [...pendingImages];

    // 运行/编译/测试前自动同步所有未保存的Monaco修改到磁盘，无需手动按⌘S
    if (/^(xcode_run|xcode_build|xcode_test)/i.test(message)) {
      if (window.CodX?.syncAllToXcode) {
        try {
          await window.CodX.syncAllToXcode();
        } catch (e) {
          console.error('[Pecado] sync unsaved changes failed', e);
        }
      }
    }

    chatScroll.prepareForNewTurn();

    addMessage(message, 'user', turnImages);
    const priorHistory = [...chatHistory];
    var userContent = turnImages.length
      ? [{ type: 'text', text: message }].concat(turnImages.map(function (img) {
          return window.MediaUtils.toChatContent(img);
        }))
      : message;
    chatHistory.push({ role: 'user', content: userContent });
    if (overrideText == null) {
      chatInput.value = '';
      chatInput.style.height = 'auto';
      pendingImages = [];
      renderImagePreview();
    }

    sendButton.disabled = true;
    if (xcodeRunBtn) xcodeRunBtn.disabled = true;

    const { bubble } = addStreamingAssistantShell();
    bindActiveBubbleResizeFollow(bubble);
    const turnStartedAt = performance.now();
    window.LogPanel?.startBubbleStopwatch?.(bubble, turnStartedAt);
    window.__pecadoTurnExec = {
      bubble,
      startedAt: turnStartedAt,
      inferAcc: '',
      update(entry) {
        if (
          entry?.logKind === 'agent-phase' &&
          String(entry.phase || '').trim().toUpperCase() === 'INFER' &&
          String(entry.phaseStatus || '') === 'start'
        ) {
          this.inferAcc = '';
        }
        updateTurnExecBlock(bubble, entry);
        const kind = entry?.logKind;
        const scrollOnProgress =
          kind === 'xcode-progress' || kind === 'skill-progress';
        if (!scrollOnProgress && shouldFollowChatOutput()) {
          scrollChatToBottomForced({ streamFollow: true });
        }
      },
      onReasoningDelta(piece) {
        if (!piece) return;
        ensureStreamingBubbleShell(this.bubble);
        this.inferAcc += String(piece);
        window.LogPanel?.updateBubbleInferDetail?.(this.bubble, this.inferAcc, {
          streaming: true,
        });
        if (shouldFollowChatOutput()) {
          scrollChatToBottomForced({ streamFollow: true });
        }
      },
    };
    let rawAccum = '';
    const streamCtx = {
      bubble,
      getRaw: () => rawAccum,
      streamReveal: null,
    };

    let turnHadError = false;

    try {
      const result = await runBotAgent(
        message,
        priorHistory,
        turnImages.length ? turnImages : null,
        {
          onDelta: (piece) => {
            rawAccum += piece;
            scheduleStreamMarkdownRender(streamCtx);
          },
        }
      );

      flushStreamMarkdownRender(streamCtx);
      cancelStreamMarkdownRender(streamCtx);
      bubble.classList.remove('streaming');

      if (result.error) {
        turnHadError = true;
        const stickErr = shouldAutoScrollAfterTurn();
        const errText = `请求失败：${result.error}`;
        clearAssistantMarkdownClass(bubble);
        getBubbleReplyEl(bubble).textContent = errText;
        chatHistory.push({ role: 'assistant', content: errText });
        if (stickErr) scrollChatToBottomForced({ streamFollow: true });
        return;
      }

      const reply = result.content || rawAccum;
      const resolveTurn =
        window.StreamTextReveal?.resolveStreamTurnContent ||
        ((streamed, invoke) => {
          const s = String(streamed ?? '').trim();
          return s || String(invoke ?? '').trim();
        });
      const hadStream =
        window.StreamTextReveal?.hasStreamedTurnContent?.(rawAccum) ??
        Boolean(String(rawAccum ?? '').trim());
      let displayText = reply;
      if (!hadStream && typeof window.electronAPI?.handleBotCommand === 'function') {
        const r = await window.electronAPI.handleBotCommand(reply);
        displayText = r?.displayText ?? reply;
      }
      displayText = resolveTurn(rawAccum, displayText);
      const stickEnd = shouldAutoScrollAfterTurn();
      if (!hadStream) {
        setAssistantBubbleMarkdown(bubble, displayText);
      } else {
        enhanceAssistantCodeBlocks(bubble);
      }
      chatHistory.push({ role: 'assistant', content: displayText });
      if (stickEnd) scrollChatToBottomForced({ streamFollow: true });
    } catch (err) {
      turnHadError = true;
      cancelStreamMarkdownRender(streamCtx);
      bubble.classList.remove('streaming');
      const stickEx = shouldAutoScrollAfterTurn();
      clearAssistantMarkdownClass(bubble);
      const errText = `请求异常：${err.message || String(err)}`;
      getBubbleReplyEl(bubble).textContent = errText;
      chatHistory.push({ role: 'assistant', content: errText });
      if (stickEx) scrollChatToBottomForced({ streamFollow: true });
    } finally {
      window.LogPanel?.finishBubbleStopwatch?.(bubble, { isError: turnHadError });
      window.__pecadoTurnExec = null;
      chatScroll.endTurnFollow();
      unbindActiveBubbleResizeFollow();
      sendButton.disabled = false;
      if (xcodeRunBtn) xcodeRunBtn.disabled = false;
    }
  }

  function addMessage(text, type, imageAttachments) {
    const stickAssistant = type === 'assistant' && !chatScroll.isDetached;

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = type === 'user' ? '\u6211' : '\ud83e\udd16';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    if (type === 'user') {
      const hasImages = Array.isArray(imageAttachments) && imageAttachments.length;
      if (hasImages) {
        imageAttachments.forEach((img) => {
          const wrap = document.createElement('div');
          wrap.style.width = '56px';
          wrap.style.height = '56px';
          wrap.style.marginBottom = '8px';
          wrap.style.borderRadius = '8px';
          wrap.style.overflow = 'hidden';
          wrap.style.background = 'rgba(0,0,0,0.3)';
          wrap.style.display = 'block';
          const imgEl = document.createElement('img');
          imgEl.style.width = '100%';
          imgEl.style.height = '100%';
          imgEl.style.objectFit = 'contain';
          imgEl.style.display = 'block';
          imgEl.src = window.MediaUtils.toDataUri(img);
          imgEl.alt = img.name || '';
          wrap.appendChild(imgEl);
          bubble.appendChild(wrap);
        });
      }
      const textSpan = document.createElement('span');
      textSpan.textContent = text;
      bubble.appendChild(textSpan);
    } else {
      setAssistantBubbleMarkdown(bubble, text);
    }

    if (type === 'user') {
      messageDiv.appendChild(bubble);
      messageDiv.appendChild(avatar);
    } else {
      messageDiv.appendChild(avatar);
      messageDiv.appendChild(bubble);
    }

    chatContent.insertBefore(messageDiv, scrollAnchor);
    if (type === 'user') {
      if (isChatPinnedToBottom() && !chatScroll.isDetached) {
        scrollChatToBottomForced({ streamFollow: true });
      }
    } else if (stickAssistant) {
      scrollChatToBottomForced({ streamFollow: true });
    }
    return bubble;
  }

  if (window.projectUi && typeof window.projectUi.init === 'function') {
    window.projectUi.init({
      addMessage,
      scrollChatToBottomForced,
      pushChatHistory: (entry) => chatHistory.push(entry),
    });
  }
}
