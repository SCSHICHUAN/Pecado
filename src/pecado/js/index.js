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
      ? `\n\n检测到 Xcode 工程 **${xcodeProject.name}**（${xcodeProject.kind === 'workspace' ? '.xcworkspace' : '.xcodeproj'}），可点击底栏 **打开项目**。`
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
    uiDeps.scrollChatToBottomForced();
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

  /** @type {HTMLButtonElement | null} */
  let openXcodeBtn = null;
  /** @type {{ kind: string, name: string, path: string } | null} */
  let currentXcodeProject = null;

  function syncOpenXcodeToolbar(xcodeProject) {
    currentXcodeProject = xcodeProject?.path ? xcodeProject : null;
    if (!openXcodeBtn) return;
    const has = Boolean(currentXcodeProject);
    openXcodeBtn.hidden = !has;
    openXcodeBtn.disabled = !has;
    openXcodeBtn.textContent = '打开项目';
    openXcodeBtn.title = has
      ? `在 Xcode 中打开：${currentXcodeProject.path}`
      : '当前工程未检测到 .xcodeproj / .xcworkspace';
  }

  async function openXcodeProjectFromToolbar() {
    const api = getApi();
    const filePath = String(currentXcodeProject?.path || '').trim();
    if (!filePath || !openXcodeBtn || !api || typeof api.mcpFsOpenXcodeProject !== 'function') return;
    openXcodeBtn.disabled = true;
    try {
      const res = await api.mcpFsOpenXcodeProject({ path: filePath });
      if (res?.ok) return;
      if (uiDeps) {
        uiDeps.addMessage(`打开 Xcode 工程失败：${res?.error || '未知错误'}`, 'assistant');
        uiDeps.scrollChatToBottomForced();
      }
    } catch (e) {
      if (uiDeps) {
        uiDeps.addMessage(`打开 Xcode 工程异常：${e.message || String(e)}`, 'assistant');
        uiDeps.scrollChatToBottomForced();
      }
    } finally {
      if (openXcodeBtn) openXcodeBtn.disabled = false;
    }
  }

  function setupProjectListener() {
    const api = getApi();
    if (!api || typeof api.onMcpFsProjectChanged !== 'function') return;
    api.onMcpFsProjectChanged(({ projectRoot, showTree, treeAscii, xcodeProject }) => {
      if (projectRoot) syncOpenXcodeToolbar(xcodeProject);
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
    openXcodeBtn = document.getElementById('pecado-open-xcode-btn');
    openXcodeBtn?.addEventListener('click', () => {
      if (openXcodeBtn?.disabled) return;
      openXcodeProjectFromToolbar().catch((err) => {
        console.error('[project-ui] openXcodeProjectFromToolbar', err);
      });
    });
    syncOpenXcodeToolbar(null);
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
/** @type {Array<{ role: string, content: string }>} */
let chatHistory = [{ role: 'assistant', content: INITIAL_GREETING }];

if (!chatInput || !sendButton || !chatContent || !scrollAnchor || !workspaceScroll) {
  console.error('[pecado] index.js: 缺少必要的 DOM 节点，请检查 main/html/index.html 结构');
} else {
  /** 一般「在底部附近」判定 */
  const SCROLL_PIN_THRESHOLD_PX = 80;
  /** 流式跟读：只有离底极近才自动滚 */
  const STREAM_FOLLOW_MAX_GAP_PX = 20;
  /** 用户 scroll 超过该 gap 视为在看历史 */
  const STREAM_DETACH_SCROLL_GAP_PX = 40;
  /** 向上滑轮后的冷却窗：禁止流式抢滚动 */
  const WHEEL_UP_BLOCK_STREAM_MS = 900;

  let chatProgrammaticScrollActive = false;
  let chatUserDetachedFromStream = false;
  let lastWheelUpIntentAt = 0;
  /** 本轮对话进行中：大段 Markdown 突增时仍跟滚，除非用户主动上滑 */
  let activeChatTurnFollow = false;
  /** @type {ResizeObserver | null} */
  let activeBubbleResizeObserver = null;

  function isChatWheelCooldownActive() {
    const now = performance.now();
    return lastWheelUpIntentAt > 0 && now - lastWheelUpIntentAt < WHEEL_UP_BLOCK_STREAM_MS;
  }

  function shouldFollowChatOutput() {
    if (chatUserDetachedFromStream) return false;
    if (isChatWheelCooldownActive()) return false;
    if (activeChatTurnFollow) return true;
    return chatScrollGapFromBottom() <= STREAM_FOLLOW_MAX_GAP_PX;
  }

  function shouldStreamFollowBottom() {
    return shouldFollowChatOutput();
  }

  function chatScrollGapFromBottom() {
    const el = workspaceScroll;
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  }

  function isChatPinnedToBottom() {
    return chatScrollGapFromBottom() <= SCROLL_PIN_THRESHOLD_PX;
  }

  /** 本轮结束时的滚底：跟读中或仍在底部附近 */
  function shouldAutoScrollAfterTurn() {
    if (chatUserDetachedFromStream) return false;
    if (isChatWheelCooldownActive()) return false;
    if (activeChatTurnFollow) return true;
    return chatScrollGapFromBottom() <= SCROLL_PIN_THRESHOLD_PX;
  }

  function bindActiveBubbleResizeFollow(bubble) {
    activeBubbleResizeObserver?.disconnect();
    activeBubbleResizeObserver = null;
    if (!bubble || typeof ResizeObserver === 'undefined') return;
    activeBubbleResizeObserver = new ResizeObserver(() => {
      if (shouldFollowChatOutput()) scrollChatToBottomForced({ streamFollow: true });
    });
    activeBubbleResizeObserver.observe(bubble);
  }

  function unbindActiveBubbleResizeFollow() {
    activeBubbleResizeObserver?.disconnect();
    activeBubbleResizeObserver = null;
  }

  function syncDetachFromStreamOnUserScroll() {
    if (chatProgrammaticScrollActive) return;
    const gap = chatScrollGapFromBottom();
    if (gap > STREAM_DETACH_SCROLL_GAP_PX) {
      chatUserDetachedFromStream = true;
    } else if (gap <= 8) {
      chatUserDetachedFromStream = false;
    }
  }

  workspaceScroll.addEventListener('scroll', syncDetachFromStreamOnUserScroll, { passive: true });

  function onChatWheelCapture(e) {
    if (e.ctrlKey) return;
    if (e.deltaY < 0) {
      lastWheelUpIntentAt = performance.now();
      chatUserDetachedFromStream = true;
      return;
    }
    if (!chatProgrammaticScrollActive && e.deltaY > 0 && isChatPinnedToBottom()) {
      chatUserDetachedFromStream = false;
    }
  }
  workspaceScroll.addEventListener('wheel', onChatWheelCapture, { passive: true, capture: true });

  let chatTouchLastY = null;
  workspaceScroll.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) chatTouchLastY = e.touches[0].clientY;
  }, { passive: true });
  workspaceScroll.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      if (chatTouchLastY == null) return;
      const dy = y - chatTouchLastY;
      if (dy > 2) {
        lastWheelUpIntentAt = performance.now();
        chatUserDetachedFromStream = true;
      }
      if (!chatProgrammaticScrollActive && dy < -2 && isChatPinnedToBottom()) {
        chatUserDetachedFromStream = false;
      }
      chatTouchLastY = y;
    },
    { passive: true }
  );
  workspaceScroll.addEventListener('touchend', () => {
    chatTouchLastY = null;
  }, { passive: true });

  /**
   * @param {{ streamFollow?: boolean }} [opts] streamFollow=true 时瞬时滚底（流式跟读），避免 smooth 与用户滚轮打架
   */
  function scrollChatToBottomForced(opts = {}) {
    if (!workspaceScroll) return;
    const el = workspaceScroll;
    const streamFollow = opts.streamFollow === true;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const instant = streamFollow || reduceMotion;

    chatProgrammaticScrollActive = true;

    /** 大段 Markdown / 代码块同帧写入时 scrollHeight 可能滞后，多帧 + 微延迟滚底 */
    const flushInstant = () => {
      const top = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTo({ top, behavior: 'auto' });
    };

    if (instant) {
      flushInstant();
      let passes = 0;
      const maxPasses = 32;
      const settle = () => {
        passes += 1;
        flushInstant();
        if (chatScrollGapFromBottom() > 2 && passes < maxPasses) {
          requestAnimationFrame(settle);
          return;
        }
        setTimeout(() => {
          flushInstant();
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              chatProgrammaticScrollActive = false;
            });
          });
        }, passes < 4 ? 16 : 0);
      };
      requestAnimationFrame(settle);
      return;
    }

    const top = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTo({ top, behavior: 'smooth' });
    setTimeout(() => {
      chatProgrammaticScrollActive = false;
    }, 480);
  }

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

  /**
   * 流式输出：用 Markdown 渲染当前累积文本（每帧最多刷新一次，减轻主线程压力）
   * @param {{ bubble: HTMLDivElement, getRaw: () => string, setRaf: (n: number) => void, getRaf: () => number }} ctx
   */
  function scheduleStreamMarkdownRender(ctx) {
    if (ctx.getRaf()) return;
    ctx.setRaf(
      requestAnimationFrame(() => {
        ctx.setRaf(0);
        const raw = ctx.getRaw();
        const { bubble } = ctx;
        const target = getBubbleReplyEl(bubble);
        const api = window.electronAPI;
        if (!raw) {
          clearAssistantMarkdownClass(bubble);
          target.textContent = '…';
          if (shouldFollowChatOutput()) scrollChatToBottomForced({ streamFollow: true });
          return;
        }
        bubble.classList.add('markdown-body');
        bubble.classList.add('streaming');
        if (api && typeof api.renderMarkdown === 'function') {
          target.innerHTML = api.renderMarkdown(raw);
          enhanceAssistantCodeBlocks(bubble);
        } else {
          clearAssistantMarkdownClass(bubble);
          target.textContent = raw;
        }

        if (shouldFollowChatOutput()) scrollChatToBottomForced({ streamFollow: true });
      })
    );
  }

  function cancelStreamMarkdownRender(rafIdRef) {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
  }

  chatInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  sendButton.addEventListener('click', () => sendMessage());
  xcodeRunBtn?.addEventListener('click', () => {
    if (sendButton.disabled) return;
    sendMessage('xcode_run');
  });
  chatInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
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

  async function runBotAgent(text, priorHistory, streamHandlers) {
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
        if (!onDelta) return;
        if (payload.phase === 'delta' && payload.text) onDelta(payload.text);
        if (payload.phase === 'tool_stream' && payload.text) onDelta(payload.text);
      });
    }

    try {
      const r = await api.volcArkBotsChatStream({
        streamId,
        userText: text,
        history: Array.isArray(priorHistory) ? priorHistory : [],
      });
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

    chatUserDetachedFromStream = false;
    lastWheelUpIntentAt = 0;

    addMessage(message, 'user');
    const priorHistory = [...chatHistory];
    chatHistory.push({ role: 'user', content: message });
    if (overrideText == null) {
      chatInput.value = '';
      chatInput.style.height = 'auto';
    }

    sendButton.disabled = true;
    if (xcodeRunBtn) xcodeRunBtn.disabled = true;
    activeChatTurnFollow = true;

    const { bubble } = addStreamingAssistantShell();
    bindActiveBubbleResizeFollow(bubble);
    const turnStartedAt = performance.now();
    window.LogPanel?.startBubbleStopwatch?.(bubble, turnStartedAt);
    window.__pecadoTurnExec = {
      bubble,
      startedAt: turnStartedAt,
      update(entry) {
        updateTurnExecBlock(bubble, entry);
        const kind = entry?.logKind;
        const scrollOnProgress =
          kind === 'xcode-progress' || kind === 'skill-progress';
        if (!scrollOnProgress && shouldFollowChatOutput()) {
          scrollChatToBottomForced({ streamFollow: true });
        }
      },
    };
    let rawAccum = '';
    const streamRafRef = { current: 0 };
    const streamCtx = {
      bubble,
      getRaw: () => rawAccum,
      getRaf: () => streamRafRef.current,
      setRaf: (n) => {
        streamRafRef.current = n;
      },
    };

    let turnHadError = false;

    try {
      const result = await runBotAgent(
        message,
        priorHistory,
        {
          onDelta: (piece) => {
            rawAccum += piece;
            scheduleStreamMarkdownRender(streamCtx);
          },
        }
      );

      cancelStreamMarkdownRender(streamRafRef);
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
      let displayText = reply;
      if (typeof window.electronAPI?.handleBotCommand === 'function') {
        const r = await window.electronAPI.handleBotCommand(reply);
        displayText = r?.displayText ?? reply;
      }
      const stickEnd = shouldAutoScrollAfterTurn();
      setAssistantBubbleMarkdown(bubble, displayText);
      chatHistory.push({ role: 'assistant', content: displayText });
      if (stickEnd) scrollChatToBottomForced({ streamFollow: true });
    } catch (err) {
      turnHadError = true;
      cancelStreamMarkdownRender(streamRafRef);
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
      activeChatTurnFollow = false;
      unbindActiveBubbleResizeFollow();
      sendButton.disabled = false;
      if (xcodeRunBtn) xcodeRunBtn.disabled = false;
    }
  }

  function addMessage(text, type) {
    const stickAssistant = type === 'assistant' && !chatUserDetachedFromStream;

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = type === 'user' ? '我' : '🤖';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    if (type === 'user') {
      bubble.textContent = text;
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
    if (type === 'user' || stickAssistant) {
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
