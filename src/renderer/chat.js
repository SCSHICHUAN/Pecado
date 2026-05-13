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

  async function sendMessage() {
    const message = chatInput.value.trim();
    if (!message) return;

    addMessage(message, 'user');
    const priorHistory = [...chatHistory];
    chatHistory.push({ role: 'user', content: message });
    chatInput.value = '';
    chatInput.style.height = 'auto';

    sendButton.disabled = true;
    try {
      const volc = window.volcChat;
      if (!volc || typeof volc.runBotAgent !== 'function') {
        const t = '未加载 volc-chat.js';
        chatHistory.push({ role: 'assistant', content: t });
        addMessage(t, 'assistant');
        return;
      }
      const result = await volc.runBotAgent(message, priorHistory);
      if (result.error) {
        const errText = `请求失败：${result.error}`;
        chatHistory.push({ role: 'assistant', content: errText });
        addMessage(errText, 'assistant');
        return;
      }
      const reply = result.content || '';
      let displayText = reply;
      if (window.botCommands && typeof window.botCommands.handleAssistantContent === 'function') {
        const r = await window.botCommands.handleAssistantContent(reply);
        displayText = r.displayText;
      }
      chatHistory.push({ role: 'assistant', content: displayText });
      addMessage(displayText, 'assistant');
    } catch (err) {
      const errText = `请求异常：${err.message || String(err)}`;
      chatHistory.push({ role: 'assistant', content: errText });
      addMessage(errText, 'assistant');
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
    bubble.textContent = text;

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
