const chatInput = document.getElementById('chat-input');
const sendButton = document.querySelector('.send-button');
const chatContent = document.getElementById('chat-content');
const scrollAnchor = document.getElementById('chat-scroll-anchor');
const workspaceScroll = document.getElementById('workspace-scroll');

const INITIAL_GREETING = '你好！我是 Pecado AI。有什么可以帮助你的吗？';
/** @type {Array<{ role: string, content: string }>} */
let chatHistory = [{ role: 'assistant', content: INITIAL_GREETING }];

if (!chatInput || !sendButton || !chatContent || !scrollAnchor || !workspaceScroll) {
  console.error('[renderer] chat.js: 缺少必要的 DOM 节点，请检查 app.html 结构');
} else {
  /**
   * 助手消息：Markdown → HTML + 样式类；无 API 时退回纯文本
   * @param {HTMLDivElement} bubble
   * @param {string} text
   */
  function setAssistantBubbleMarkdown(bubble, text) {
    const api = window.electronAPI;
    bubble.classList.add('markdown-body');
    if (api && typeof api.renderMarkdown === 'function') {
      bubble.innerHTML = api.renderMarkdown(text);
    } else {
      bubble.textContent = text;
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
        const api = window.electronAPI;
        if (!raw) {
          clearAssistantMarkdownClass(bubble);
          bubble.textContent = '…';
          scrollChatToBottom();
          return;
        }
        bubble.classList.add('markdown-body');
        bubble.classList.add('streaming');
        if (api && typeof api.renderMarkdown === 'function') {
          bubble.innerHTML = api.renderMarkdown(raw);
        } else {
          clearAssistantMarkdownClass(bubble);
          bubble.textContent = raw;
        }
        scrollChatToBottom();
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

  sendButton.addEventListener('click', sendMessage);
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
    bubble.textContent = '…';

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(bubble);
    chatContent.insertBefore(messageDiv, scrollAnchor);
    scrollChatToBottom();
    return { messageDiv, bubble };
  }

  async function sendMessage() {
    const message = chatInput.value.trim();
    if (!message) return;

    addMessage(message, 'user');
    const priorHistory = [...chatHistory];
    chatHistory.push({ role: 'user', content: message });
    chatInput.value = '';
    chatInput.style.height = 'auto';

    sendButton.disabled = true;
    const volc = window.volcChat;
    if (!volc || typeof volc.runBotAgent !== 'function') {
      const t = '未加载 volc-chat.js';
      chatHistory.push({ role: 'assistant', content: t });
      addMessage(t, 'assistant');
      sendButton.disabled = false;
      return;
    }

    const { bubble } = addStreamingAssistantShell();
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

    try {
      const result = await volc.runBotAgent(message, priorHistory, {
        onDelta: (piece) => {
          rawAccum += piece;
          scheduleStreamMarkdownRender(streamCtx);
        },
      });

      cancelStreamMarkdownRender(streamRafRef);
      bubble.classList.remove('streaming');

      if (result.error) {
        const errText = `请求失败：${result.error}`;
        clearAssistantMarkdownClass(bubble);
        bubble.textContent = errText;
        chatHistory.push({ role: 'assistant', content: errText });
        scrollChatToBottom();
        return;
      }

      const reply = result.content || rawAccum;
      let displayText = reply;
      if (window.botCommands && typeof window.botCommands.handleAssistantContent === 'function') {
        const r = await window.botCommands.handleAssistantContent(reply);
        displayText = r.displayText;
      }
      setAssistantBubbleMarkdown(bubble, displayText);
      chatHistory.push({ role: 'assistant', content: displayText });
      scrollChatToBottom();
    } catch (err) {
      cancelStreamMarkdownRender(streamRafRef);
      bubble.classList.remove('streaming');
      clearAssistantMarkdownClass(bubble);
      const errText = `请求异常：${err.message || String(err)}`;
      bubble.textContent = errText;
      chatHistory.push({ role: 'assistant', content: errText });
      scrollChatToBottom();
    } finally {
      sendButton.disabled = false;
    }
  }

  function scrollChatToBottom() {
    if (!workspaceScroll) return;
    const el = workspaceScroll;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const run = () => {
      const top = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
  }

  function addMessage(text, type) {
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
    scrollChatToBottom();
  }
}
