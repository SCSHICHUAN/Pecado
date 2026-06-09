/**
 * @file git-chat.js
 *
 * Git 面板 pecado tab：消息内可点击 Git 操作、结果在对话内展示。
 */
(function () {
  /** @type {Array<{ role: string, content: string }>} */
  let chatHistory = [];
  let busy = false;

  let getGitContext = async () => '';
  /** @type {(action: string, extra?: object) => Promise<{ ok?: boolean, error?: string, output?: string, command?: string, cancelled?: boolean }>} */
  let runGitAction = async () => ({ ok: false });
  /** @type {(action: string, extra?: object) => string} */
  let gitCommandLabel = (action) => action;
  /** @type {(actionOrText: string) => void} */
  let setGitMetaProgress = () => {};
  /** @type {() => void} */
  let restoreGitMetaAfterErrorAnalysis = () => {};
  /** @type {(info?: object) => void} */
  let syncGitMetaAfterComplete = () => {};
  /** @type {(tabId: string) => void} */
  let switchTab = () => {};
  /** @type {() => string} */
  let getProjectRoot = () => '';
  /** @type {() => Promise<void>} */
  let onShellCommandDone = async () => {};

  const GIT_CMD_MAP = {
    push: 'push',
    pull: 'pull',
    status: 'status',
    commit: 'commit',
    branch: 'branch',
    checkout: 'checkout',
    merge: 'merge',
    revert: 'revert',
    reset: 'reset',
    tag: 'tag',
    推送: 'push',
    拉取: 'pull',
    状态: 'status',
    提交: 'commit',
    分支: 'branch',
  };

  const ACTION_LABEL = {
    push: '推送',
    pull: '拉取',
    commit: '提交',
    status: '查看状态',
    branch: '创建分支',
  };

  const GIT_CMD_RE = new RegExp(
    `\\b(${Object.keys(GIT_CMD_MAP)
      .filter((k) => /^[a-z]+$/i.test(k))
      .join('|')})\\b|(${Object.keys(GIT_CMD_MAP)
      .filter((k) => /[\u4e00-\u9fff]/.test(k))
      .join('|')})`,
    'gi'
  );

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function resolveGitAction(token) {
    const raw = String(token || '');
    if (GIT_CMD_MAP[raw]) return GIT_CMD_MAP[raw];
    const lower = raw.toLowerCase();
    return GIT_CMD_MAP[lower] || lower;
  }

  function actionLabel(action) {
    return ACTION_LABEL[action] || action;
  }

  function parseGitContext(text) {
    const lines = String(text || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const ctx = { branch: '', root: '', remote: '', fileLines: [], isClean: true };
    for (const line of lines) {
      if (line.startsWith('branch: ')) ctx.branch = line.slice(8).trim();
      else if (line.startsWith('root: ')) ctx.root = line.slice(6).trim();
      else if (line.startsWith('remote: ')) ctx.remote = line.slice(8).trim();
      else {
        ctx.fileLines.push(line);
        ctx.isClean = false;
      }
    }
    return ctx;
  }

  function buildPreflightMessage(action, ctx) {
    const label = actionLabel(action);
    const parts = [`我先帮你看一下当前仓库状态，准备${label}…`];
    if (ctx.branch) parts.push(`当前分支：${ctx.branch}`);
    parts.push(ctx.isClean ? '工作区：干净' : `工作区：有 ${ctx.fileLines.length} 个文件未提交`);
    if (ctx.remote) {
      parts.push(`远程：${ctx.remote}`);
    } else if (action === 'push' || action === 'pull') {
      parts.push('远程：未配置 origin（操作可能失败）');
    }
    if (action === 'pull') {
      parts.push('正在从远程拉取最新提交…');
    } else if (action === 'push') {
      parts.push('正在把本地提交推送到远程…');
    } else if (action === 'commit') {
      parts.push('正在提交当前变更…');
    } else if (action === 'status') {
      parts.push('正在刷新工作区状态…');
    } else if (action === 'branch') {
      parts.push('正在创建并切换到新分支…');
    }
    return parts.join('\n');
  }

  function buildSuccessMessage(action, result) {
    const output = String(result?.output || '').trim();
    const parts = [`${actionLabel(action)}完成。`];
    if (
      output &&
      output !== `${action} 完成` &&
      !/^Commit 成功$/i.test(output) &&
      output.length <= 800
    ) {
      parts.push('', output);
    }
    parts.push('', '建议下一步：');
    if (action === 'pull') {
      parts.push('若本地还有未推送提交，可点击 push；查看详情用 status。');
    } else if (action === 'push') {
      parts.push('可用 status 确认工作区是否干净。');
    } else if (action === 'commit') {
      parts.push('若要同步到远程，可点击 push。');
    } else if (action === 'status') {
      parts.push('若有未提交文件，可输入 commit 说明提交；需要同步时用 pull 或 push。');
    } else if (action === 'branch') {
      parts.push('在新分支上开发后，可 commit 再 push。');
    }
    return parts.join('\n');
  }

  const GIT_CHAT_WELCOME =
    '我会先帮你看仓库状态，再执行 push / pull 等操作；失败时会分析原因并给出解决方法。也可输入 commit 说明或自然语言描述需求。';

  let streamMarkdownRaf = 0;

  function isShellCommandText(text) {
    const t = String(text || '').trim();
    if (!t || t.length > 600 || t.includes('```')) return false;
    if (/^(git|cd|mkdir|export|rm|cp|mv)\b/i.test(t)) return true;
    if (/\s&&\s/.test(t) && /\b(git|cd|mkdir)\b/i.test(t)) return true;
    return false;
  }

  function createApproveButton(shellCmd) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'git-chat-approve-btn';
    btn.textContent = '同意';
    btn.dataset.shellCmd = encodeURIComponent(shellCmd);
    return btn;
  }

  function decodeShellCmd(encoded) {
    try {
      return decodeURIComponent(String(encoded || ''));
    } catch {
      return String(encoded || '');
    }
  }

  function collectShellCommandEntries(bodyEl) {
    if (!bodyEl) return [];
    const entries = [];
    bodyEl.querySelectorAll('.git-chat-approve-btn:not(.git-chat-batch-btn)').forEach((btn) => {
      const cmd = decodeShellCmd(btn.dataset.shellCmd);
      if (cmd) entries.push({ cmd, btn });
    });
    return entries;
  }

  function maybeAppendBatchExecuteBlock(bodyEl) {
    if (!bodyEl || bodyEl.closest('.git-chat-msg.streaming')) return;
    bodyEl.querySelectorAll('.git-chat-batch-wrap').forEach((el) => el.remove());

    const entries = collectShellCommandEntries(bodyEl);
    if (entries.length < 2) return;

    const wrap = document.createElement('div');
    wrap.className = 'git-chat-batch-wrap';

    const intro = document.createElement('p');
    intro.className = 'git-chat-batch-intro';
    intro.textContent = `共 ${entries.length} 条命令，可按以下顺序执行：`;
    wrap.appendChild(intro);

    const ol = document.createElement('ol');
    ol.className = 'git-chat-batch-list';
    entries.forEach(({ cmd }) => {
      const li = document.createElement('li');
      const code = document.createElement('code');
      code.textContent = cmd;
      li.appendChild(code);
      ol.appendChild(li);
    });
    wrap.appendChild(ol);

    const ask = document.createElement('p');
    ask.className = 'git-chat-batch-ask';
    ask.textContent = '要不要我按这个顺序全部执行？';
    wrap.appendChild(ask);

    const batchBtn = document.createElement('button');
    batchBtn.type = 'button';
    batchBtn.className = 'git-chat-approve-btn git-chat-batch-btn';
    batchBtn.textContent = '按顺序全部执行';
    batchBtn.dataset.batchCmds = encodeURIComponent(
      JSON.stringify(entries.map((entry) => entry.cmd))
    );
    wrap.appendChild(batchBtn);

    bodyEl.appendChild(wrap);
  }

  function markApproveButtonDone(btn, ok) {
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = ok ? '已执行' : '失败';
    btn.classList.toggle('is-error', !ok);
  }

  async function runShellCommandOnce(command) {
    const api = window.electronAPI;
    if (!api || typeof api.gitRunShell !== 'function') {
      return { ok: false, error: '当前环境无法执行 shell 命令。', output: '', command };
    }
    const res = await api.gitRunShell({
      command,
      projectRoot: getProjectRoot() || undefined,
    });
    return {
      ok: Boolean(res?.ok),
      error: res?.error || '',
      output: res?.output || '',
      command,
    };
  }

  function wrapShellCommandElement(cmdEl, shellCmd) {
    if (!cmdEl || cmdEl.closest('.git-chat-shell-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'git-chat-shell-wrap';
    cmdEl.parentNode.insertBefore(wrap, cmdEl);
    wrap.appendChild(cmdEl);
    wrap.appendChild(createApproveButton(shellCmd));
  }

  function enhanceShellCommandBlocks(root) {
    if (!root) return;
    root.querySelectorAll('pre').forEach((pre) => {
      const code = pre.querySelector('code');
      const text = (code || pre).textContent.trim();
      if (!isShellCommandText(text)) return;
      wrapShellCommandElement(pre, text);
    });
    root.querySelectorAll('p').forEach((p) => {
      if (p.closest('.git-chat-shell-wrap')) return;
      const text = p.textContent.trim();
      if (!isShellCommandText(text)) return;
      const wrap = document.createElement('div');
      wrap.className = 'git-chat-shell-wrap git-chat-shell-wrap-inline';
      const code = document.createElement('code');
      code.className = 'git-chat-shell-cmd';
      code.textContent = text;
      wrap.appendChild(code);
      wrap.appendChild(createApproveButton(text));
      p.replaceWith(wrap);
    });
  }

  function setChatActionButtonsDisabled(disabled) {
    setChatCmdButtonsDisabled(disabled);
    document
      .querySelectorAll('#git-chat-messages .git-chat-approve-btn, #git-chat-messages .git-chat-batch-btn')
      .forEach((btn) => {
        btn.disabled = Boolean(disabled);
      });
  }

  async function executeApprovedShellCommand(encodedCmd, btn) {
    const command = decodeShellCmd(encodedCmd);
    if (!command || busy) return;
    busy = true;
    setChatActionButtonsDisabled(true);
    setGitMetaProgress('正在执行命令…');
    appendUserMessage(command);
    try {
      const res = await runShellCommandOnce(command);
      markApproveButtonDone(btn, res.ok);
      if (res.ok) {
        const out = String(res.output || '').trim() || '命令执行完成';
        appendMessage('assistant', `**已执行**\n\n\`${command}\`\n\n${out}`);
        pushAssistantHistory(`已执行: ${command}\n${out}`);
        await onShellCommandDone({ ...res, command });
      } else {
        const err = res.error || '执行失败';
        appendMessage('assistant', `**执行失败**\n\n\`${command}\`\n\n${err}`, { isError: true });
        pushAssistantHistory(`执行失败: ${command}\n${err}`);
        await onShellCommandDone({ ok: false, error: err, command, output: '' });
        busy = false;
        setChatActionButtonsDisabled(false);
        await analyzeGitError(err, command, { skipSwitch: true });
        return;
      }
    } catch (e) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '同意';
      }
      const errMsg = e.message || String(e);
      appendMessage('assistant', errMsg, { isError: true });
      busy = false;
      setChatActionButtonsDisabled(false);
      await analyzeGitError(errMsg, command, { skipSwitch: true });
      return;
    } finally {
      busy = false;
      setChatActionButtonsDisabled(false);
    }
  }

  async function executeBatchShellCommands(encodedList, batchBtn) {
    let commands = [];
    try {
      commands = JSON.parse(decodeURIComponent(String(encodedList || '')));
    } catch {
      return;
    }
    if (!Array.isArray(commands) || !commands.length || busy) return;

    const messageBody = batchBtn?.closest('.git-chat-msg-body');
    const pending = [];
    if (messageBody) {
      collectShellCommandEntries(messageBody).forEach((entry) => {
        if (entry.btn && !entry.btn.disabled) pending.push(entry);
      });
    } else {
      commands.forEach((cmd) => pending.push({ cmd: String(cmd || ''), btn: null }));
    }
    if (!pending.length) return;

    busy = true;
    setChatActionButtonsDisabled(true);
    if (batchBtn) {
      batchBtn.disabled = true;
      batchBtn.textContent = '执行中…';
    }

    const userLines = pending.map((entry, index) => `${index + 1}. ${entry.cmd}`);
    appendUserMessage(`按顺序执行：\n${userLines.join('\n')}`);

    const results = [];
    let stopped = false;
    let batchFinished = false;

    try {
      for (let i = 0; i < pending.length; i += 1) {
        const { cmd, btn } = pending[i];
        setGitMetaProgress(`正在执行命令 (${i + 1}/${pending.length})…`);
        const res = await runShellCommandOnce(cmd);
        results.push(res);
        markApproveButtonDone(btn, res.ok);
        await onShellCommandDone({
          ok: res.ok,
          error: res.error,
          output: res.output,
          command: cmd,
        });
        if (!res.ok) {
          stopped = true;
          const stepErr = res.error || '执行失败';
          appendMessage(
            'assistant',
            `**批量执行在第 ${i + 1} 步失败**\n\n\`${cmd}\`\n\n${stepErr}`,
            { isError: true }
          );
          pushAssistantHistory(`批量执行失败: ${cmd}\n${stepErr}`);
          busy = false;
          setChatActionButtonsDisabled(false);
          if (batchBtn) {
            batchBtn.textContent = '部分失败';
            batchBtn.classList.add('is-error');
            batchBtn.disabled = false;
          }
          await analyzeGitError(stepErr, cmd, { skipSwitch: true });
          return;
        }
      }

      if (!stopped) {
        const summary = results
          .map((res, index) => {
            const out = String(res.output || '').trim() || '完成';
            return `${index + 1}. \`${res.command}\`\n${out}`;
          })
          .join('\n\n');
        appendMessage('assistant', `**已全部按顺序执行**\n\n${summary}`);
        pushAssistantHistory(`批量执行完成:\n${summary}`);
        if (batchBtn) {
          batchBtn.textContent = '已全部执行';
          batchBtn.disabled = true;
        }
        batchFinished = true;
      } else if (batchBtn) {
        batchBtn.textContent = '部分失败';
        batchBtn.classList.add('is-error');
        batchBtn.disabled = false;
      }
    } catch (e) {
      if (batchBtn) {
        batchBtn.textContent = '按顺序全部执行';
        batchBtn.disabled = false;
      }
      appendMessage('assistant', e.message || String(e), { isError: true });
    } finally {
      busy = false;
      setChatActionButtonsDisabled(false);
      if (batchBtn && batchFinished) batchBtn.disabled = true;
    }
  }

  function fullGitCommandLabel(action, extra = {}) {
    if (typeof gitCommandLabel === 'function') {
      return gitCommandLabel(action, extra);
    }
    const cmd = resolveGitAction(action);
    if (extra.message != null && String(extra.message).trim()) {
      return `git commit -m ${JSON.stringify(String(extra.message).trim())}`;
    }
    if (extra.branchName != null && String(extra.branchName).trim()) {
      return `git checkout -b ${String(extra.branchName).trim()}`;
    }
    return cmd ? `git ${cmd}` : String(action || '').trim();
  }

  function gitInputToFullCommand(text) {
    const raw = String(text || '').trim();
    const lower = raw.toLowerCase();
    if (/^(push|推送)$/.test(lower)) return fullGitCommandLabel('push');
    if (/^(pull|拉取)$/.test(lower)) return fullGitCommandLabel('pull');
    if (/^(status|状态)$/.test(lower)) return fullGitCommandLabel('status');
    const commitMatch = raw.match(/^(commit|提交)\s+(.+)$/i);
    if (commitMatch) {
      return fullGitCommandLabel('commit', { message: commitMatch[2].trim() });
    }
    const branchMatch = raw.match(/^(branch|分支)\s+(.+)$/i);
    if (branchMatch) {
      return fullGitCommandLabel('branch', { branchName: branchMatch[2].trim() });
    }
    return null;
  }

  function appendUserGitAction(action, extra = {}) {
    const label = fullGitCommandLabel(action, extra);
    if (!label) return;
    appendMessage('user', label);
    chatHistory.push({ role: 'user', content: label });
  }

  function appendUserMessage(text) {
    const label = String(text || '').trim();
    if (!label) return;
    appendMessage('user', label);
    chatHistory.push({ role: 'user', content: label });
  }

  function linkifyGitCommandsInElement(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest('pre, code, .git-chat-cmd')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const raw = node.textContent || '';
      GIT_CMD_RE.lastIndex = 0;
      if (!GIT_CMD_RE.test(raw)) continue;
      GIT_CMD_RE.lastIndex = 0;
      const wrap = document.createElement('span');
      wrap.innerHTML = linkifyGitCommands(raw);
      node.replaceWith(wrap);
    }
  }

  function looksLikeMarkdown(text) {
    return /(\*\*|__|```|^#{1,6}\s|^[-*+]\s|^\d+\.\s|`[^`\n]+`|\[[^\]]+\]\([^)]+\))/m.test(
      String(text || '')
    );
  }

  function renderPlainAssistantBody(body, text) {
    body.classList.remove('markdown-body');
    body.innerHTML = linkifyGitCommands(String(text || ''));
  }

  function renderMarkdownAssistantBody(body, text) {
    const raw = String(text || '');
    const api = window.electronAPI;
    body.classList.add('markdown-body');
    if (api && typeof api.renderMarkdown === 'function') {
      body.innerHTML = api.renderMarkdown(raw || '…');
      linkifyGitCommandsInElement(body);
      enhanceShellCommandBlocks(body);
      maybeAppendBatchExecuteBlock(body);
    } else {
      renderPlainAssistantBody(body, raw);
    }
  }

  function renderAssistantBody(body, text, opts = {}) {
    if (!body) return;
    const raw = String(text || '');
    const wrap = body.closest('.git-chat-msg');
    if (opts.isError) {
      wrap?.classList.add('git-chat-msg-error');
      body.classList.add('git-chat-error-text');
    }
    const useMarkdown =
      !opts.plain &&
      (Boolean(opts.markdown) ||
        Boolean(opts.streaming) ||
        (looksLikeMarkdown(raw) && !opts.isError) ||
        (opts.isError && looksLikeMarkdown(raw)));

    if (opts.isError && !useMarkdown) {
      body.classList.remove('markdown-body');
      body.textContent = raw;
      return;
    }
    if (useMarkdown) {
      renderMarkdownAssistantBody(body, raw);
      return;
    }
    renderPlainAssistantBody(body, raw);
  }

  function renderUserBody(body, text) {
    if (!body) return;
    body.classList.remove('markdown-body');
    body.textContent = String(text || '');
  }

  function scheduleStreamMarkdownRender(body, getText) {
    if (streamMarkdownRaf) return;
    streamMarkdownRaf = requestAnimationFrame(() => {
      streamMarkdownRaf = 0;
      renderAssistantBody(body, getText(), { streaming: true, markdown: true });
      scrollMessagesToBottom();
    });
  }

  function buildWelcomeText(projectRoot) {
    const name = projectRoot
      ? String(projectRoot).split(/[/\\]/).filter(Boolean).pop() || projectRoot
      : '';
    if (!name) return GIT_CHAT_WELCOME;
    return (
      `已切换到工程 **${name}**。\n\n` +
      '`' +
      projectRoot +
      '`\n\n' +
      GIT_CHAT_WELCOME
    );
  }

  function resetForProject(projectRoot) {
    chatHistory = [];
    busy = false;
    const box = $('git-chat-messages');
    if (!box) return;
    box.innerHTML = '';
    appendMessage('assistant', buildWelcomeText(projectRoot));
  }

  function linkifyGitCommands(text) {
    const raw = String(text || '');
    if (!raw.trim()) return '';
    let out = '';
    let last = 0;
    GIT_CMD_RE.lastIndex = 0;
    let match = GIT_CMD_RE.exec(raw);
    while (match) {
      out += escapeHtml(raw.slice(last, match.index));
      const word = match[0];
      const action = resolveGitAction(word);
      const label = escapeHtml(word);
      out += `<button type="button" class="git-chat-cmd" data-action="${escapeHtml(action)}" title="执行 ${escapeHtml(action)}">${label}</button>`;
      last = match.index + word.length;
      match = GIT_CMD_RE.exec(raw);
    }
    out += escapeHtml(raw.slice(last));
    return out;
  }

  function setChatCmdButtonsDisabled(disabled) {
    document.querySelectorAll('#git-chat-messages .git-chat-cmd').forEach((btn) => {
      btn.disabled = Boolean(disabled);
    });
  }

  function linkifyStaticWelcome() {
    const body = document.querySelector(
      '#git-chat-messages .git-chat-msg-assistant .git-chat-msg-body'
    );
    if (body) renderAssistantBody(body, body.textContent || GIT_CHAT_WELCOME);
  }

  function scrollMessagesToBottom() {
    const box = $('git-chat-messages');
    if (box) box.scrollTop = box.scrollHeight;
  }

  function appendMessage(role, text, opts = {}) {
    const box = $('git-chat-messages');
    if (!box) return null;
    const wrap = document.createElement('div');
    wrap.className = `git-chat-msg git-chat-msg-${role}${opts.streaming ? ' streaming' : ''}`;
    if (opts.isError) wrap.classList.add('git-chat-msg-error');
    const body = document.createElement('div');
    body.className = 'git-chat-msg-body';
    if (role === 'user') {
      renderUserBody(body, text);
    } else if (opts.isError) {
      renderAssistantBody(body, text, { isError: true });
    } else if (opts.plain) {
      renderAssistantBody(body, text, { plain: true });
    } else if (opts.streaming && !text) {
      body.classList.add('markdown-body');
      body.textContent = '';
    } else {
      renderAssistantBody(body, text, { streaming: Boolean(opts.streaming) });
    }
    wrap.appendChild(body);
    box.appendChild(wrap);
    scrollMessagesToBottom();
    if (busy) setChatActionButtonsDisabled(true);
    return { wrap, body };
  }

  function pushAssistantHistory(content) {
    chatHistory.push({ role: 'assistant', content: String(content || '') });
  }

  function showOperationResult(text, opts = {}) {
    const msg = String(text || '').trim();
    if (!msg) return;
    const command = opts.command ? String(opts.command).trim() : '';
    const body = command ? `${command}\n\n${msg}` : msg;
    appendMessage('assistant', body, { isError: Boolean(opts.isError) });
    pushAssistantHistory(body);
  }

  async function runGitActionWithFeedback(action, extra = {}) {
    if (busy) return;
    busy = true;
    setChatActionButtonsDisabled(true);
    try {
      setGitMetaProgress(action);
      const ctx = parseGitContext(await getGitContext());
      const preflight = buildPreflightMessage(action, ctx);
      appendMessage('assistant', preflight, { plain: true });
      pushAssistantHistory(preflight);

      const result = await runGitAction(action, extra);

      if (result?.cancelled) {
        appendMessage('assistant', '已取消操作。', { plain: true });
        pushAssistantHistory('已取消操作。');
        return;
      }

      if (!result?.ok) {
        const err = result?.error || '操作失败';
        const cmd = result?.command || (typeof gitCommandLabel === 'function' ? gitCommandLabel(action, extra) : action);
        const errBody = cmd ? `${cmd}\n\n${err}` : err;
        appendMessage('assistant', errBody, { isError: true });
        pushAssistantHistory(errBody);
      }

      await analyzeGitOperation(
        {
          action,
          ok: Boolean(result?.ok),
          output: result?.output || '',
          error: result?.error || '',
          command: result?.command || (typeof gitCommandLabel === 'function' ? gitCommandLabel(action, extra) : action),
        },
        { nested: true, skipSwitch: Boolean(result?.ok) }
      );
    } finally {
      busy = false;
      setChatActionButtonsDisabled(false);
    }
  }

  async function executeGitCommand(action, extra = {}) {
    const cmd = resolveGitAction(action);
    if (!cmd || busy) return;
    if (cmd === 'branch') {
      const branchName = window.prompt('新分支名', '');
      if (branchName === null || !String(branchName).trim()) return;
      const name = String(branchName).trim();
      appendUserGitAction('branch', { branchName: name });
      await runGitActionWithFeedback('branch', { branchName: name });
      return;
    }
    if (cmd === 'commit') {
      const message = window.prompt('Commit 信息', 'Update from Pecado');
      if (message === null) return;
      const msg = String(message).trim();
      if (!msg) return;
      appendUserGitAction('commit', { message: msg });
      await runGitActionWithFeedback('commit', { message: msg, ...extra });
      return;
    }
    if (cmd === 'status' || cmd === 'push' || cmd === 'pull') {
      appendUserGitAction(cmd);
      await runGitActionWithFeedback(cmd, extra);
      return;
    }
    appendMessage('assistant', `暂不支持一键执行 ${cmd}，请在输入框描述需求。`);
    pushAssistantHistory(`暂不支持一键执行 ${cmd}，请在输入框描述需求。`);
  }

  async function tryLocalCommand(text) {
    const raw = String(text || '').trim();
    const lower = raw.toLowerCase();
    if (/^(push|推送)$/.test(lower)) {
      await runGitActionWithFeedback('push');
      return true;
    }
    if (/^(pull|拉取)$/.test(lower)) {
      await runGitActionWithFeedback('pull');
      return true;
    }
    if (/^(status|状态)$/.test(lower)) {
      await runGitActionWithFeedback('status');
      return true;
    }
    const branchMatch = raw.match(/^(branch|分支)\s+(.+)$/i);
    if (branchMatch) {
      await runGitActionWithFeedback('branch', { branchName: branchMatch[2].trim() });
      return true;
    }
    if (/^(branch|分支)$/i.test(lower)) {
      await executeGitCommand('branch');
      return true;
    }
    const commitMatch = raw.match(/^(commit|提交)\s+(.+)$/i);
    if (commitMatch) {
      await runGitActionWithFeedback('commit', { message: commitMatch[2].trim() });
      return true;
    }
    return false;
  }

  async function streamGitAssistant(userText, historySlice) {
    const api = window.electronAPI;
    if (!api || typeof api.volcArkBotsChatStream !== 'function') {
      const fallback = '可点击：push、pull、status、commit、branch；或输入 commit 说明、branch 名称。';
      appendMessage('assistant', fallback);
      return { content: fallback };
    }

    const streamId = `git-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const assistantEntry = appendMessage('assistant', '', { streaming: true });
    let acc = '';
    let unsubscribe = () => {};
    if (typeof api.onVolcArkStreamEvent === 'function') {
      unsubscribe = api.onVolcArkStreamEvent((payload) => {
        if (!payload || payload.streamId !== streamId) return;
        if (payload.phase === 'delta' && payload.text) {
          acc += payload.text;
          if (assistantEntry?.body) scheduleStreamMarkdownRender(assistantEntry.body, () => acc);
        }
      });
    }

    try {
      const gitContext = await getGitContext();
      const res = await api.volcArkBotsChatStream({
        streamId,
        userText,
        history: historySlice,
        mode: 'git',
        gitContext,
      });
      assistantEntry?.wrap?.classList.remove('streaming');
      if (res?.error) {
        assistantEntry?.wrap?.classList.add('git-chat-msg-error');
        if (assistantEntry?.body) {
          renderAssistantBody(assistantEntry.body, res.error, { isError: true });
        }
        return { error: res.error };
      }
      const content = typeof res?.content === 'string' ? res.content : acc;
      if (assistantEntry?.body) {
        renderAssistantBody(assistantEntry.body, content || '（无回复）', { markdown: true });
      }
      pushAssistantHistory(content || acc);
      return { content: content || acc };
    } finally {
      unsubscribe();
    }
  }

  async function sendMessage(text, opts = {}) {
    const trimmed = String(text || '').trim();
    if (!trimmed || busy) return;
    const sendBtn = $('git-chat-send');
    const input = $('git-chat-input');

    if (!opts.skipUserBubble) {
      const userText = gitInputToFullCommand(trimmed) || trimmed;
      appendMessage('user', userText);
      chatHistory.push({ role: 'user', content: userText });
    }
    if (input && !opts.skipUserBubble) {
      input.value = '';
      input.style.height = 'auto';
    }

    try {
      if (!opts.forceLlm) {
        const handled = await tryLocalCommand(trimmed);
        if (handled) return;
      }

      busy = true;
      setChatActionButtonsDisabled(true);
      if (sendBtn) sendBtn.disabled = true;
      await streamGitAssistant(trimmed, chatHistory.slice(0, -1));
    } catch (e) {
      appendMessage('assistant', e.message || String(e));
    } finally {
      busy = false;
      setChatActionButtonsDisabled(false);
      if (sendBtn) sendBtn.disabled = false;
      input?.focus();
    }
  }

  async function analyzeGitOperation(payload, opts = {}) {
    const action = String(payload?.action || '').trim();
    const ok = Boolean(payload?.ok);
    const output = String(payload?.output || '').trim();
    const error = String(payload?.error || '').trim();
    const command = String(payload?.command || '').trim();
    const nested = Boolean(opts.nested);

    if (busy && !nested) return null;
    if (!nested) {
      busy = true;
      setChatActionButtonsDisabled(true);
    }
    if (!opts.skipSwitch || !ok) switchTab('chat');

    const act = actionLabel(action) || action || 'Git';
    const body = ok ? output || '（无输出）' : error || '操作失败';
    const summary = command ? `${command}\n\n${body}` : body;

    const userText = ok
      ? `Git ${act} 操作已成功完成。\n\n${summary}\n\n请分析：刚才发生了什么、当前仓库状态、用户下一步建议。结构：结论 → 状态说明 → 建议步骤。需要用户执行的 Git 命令请直接写出 push、pull、status、commit、branch。`
      : `Git ${act} 操作失败。\n\n${summary}\n\n请分析：优先方案 → 多种可能原因（网络/认证/冲突/未提交/no upstream 等）及对应解决步骤 → 操作顺序。需要用户执行的 Git 命令请直接写出 push、pull、status、commit、branch。`;

    chatHistory.push({ role: 'user', content: userText });
    setGitMetaProgress(ok ? '正在分析操作结果…' : '正在分析错误原因…');

    let analysisContent = '';
    try {
      const res = await streamGitAssistant(userText, chatHistory.slice(0, -1));
      analysisContent = res?.content || res?.error || '';
      if (!analysisContent && ok) {
        analysisContent = buildSuccessMessage(action, { output });
      } else if (!analysisContent && !ok) {
        analysisContent = error || '操作失败';
      }
    } catch (e) {
      const msg = e.message || String(e);
      appendMessage('assistant', msg);
      analysisContent = msg;
    } finally {
      if (!ok) restoreGitMetaAfterErrorAnalysis();
      else syncGitMetaAfterComplete({ action, output });
      if (!nested) {
        busy = false;
        setChatActionButtonsDisabled(false);
      }
    }
    return analysisContent;
  }

  async function analyzeGitError(errorText, command, opts = {}) {
    const err = String(errorText || '').trim();
    if (!err) return null;
    let action = opts.action || '';
    if (!action && command) {
      const m = String(command).match(/\bgit\b[^\n]*?\s+(push|pull|commit|status|checkout)\b/i);
      if (m) action = m[1] === 'checkout' ? 'branch' : m[1].toLowerCase();
    }
    return analyzeGitOperation(
      {
        action,
        ok: false,
        error: err,
        command,
      },
      opts
    );
  }

  function setupMessageActions() {
    const box = $('git-chat-messages');
    if (!box || box.dataset.actionsBound === '1') return;
    box.dataset.actionsBound = '1';
    box.addEventListener('click', (e) => {
      const batchBtn = e.target.closest('.git-chat-batch-btn');
      if (batchBtn && !batchBtn.disabled && !busy) {
        e.preventDefault();
        executeBatchShellCommands(batchBtn.dataset.batchCmds, batchBtn);
        return;
      }
      const approveBtn = e.target.closest('.git-chat-approve-btn:not(.git-chat-batch-btn)');
      if (approveBtn && !approveBtn.disabled && !busy) {
        e.preventDefault();
        executeApprovedShellCommand(approveBtn.dataset.shellCmd, approveBtn);
        return;
      }
      const btn = e.target.closest('.git-chat-cmd');
      if (!btn || btn.disabled || busy) return;
      e.preventDefault();
      executeGitCommand(btn.dataset.action);
    });
  }

  function setupInput() {
    const input = $('git-chat-input');
    const sendBtn = $('git-chat-send');
    if (!input || input.dataset.bound === '1') return;
    input.dataset.bound = '1';
    sendBtn?.addEventListener('click', () => sendMessage(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input.value);
      }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 80)}px`;
    });
  }

  function init(opts = {}) {
    if (typeof opts.getGitContext === 'function') getGitContext = opts.getGitContext;
    if (typeof opts.runGitAction === 'function') runGitAction = opts.runGitAction;
    if (typeof opts.gitCommandLabel === 'function') gitCommandLabel = opts.gitCommandLabel;
    if (typeof opts.setGitMetaProgress === 'function') setGitMetaProgress = opts.setGitMetaProgress;
    if (typeof opts.restoreGitMetaAfterErrorAnalysis === 'function') {
      restoreGitMetaAfterErrorAnalysis = opts.restoreGitMetaAfterErrorAnalysis;
    }
    if (typeof opts.syncGitMetaAfterComplete === 'function') {
      syncGitMetaAfterComplete = opts.syncGitMetaAfterComplete;
    }
    if (typeof opts.switchTab === 'function') switchTab = opts.switchTab;
    if (typeof opts.getProjectRoot === 'function') getProjectRoot = opts.getProjectRoot;
    if (typeof opts.onShellCommandDone === 'function') onShellCommandDone = opts.onShellCommandDone;
    setupInput();
    setupMessageActions();
    linkifyStaticWelcome();
  }

  window.GitChatPanel = {
    init,
    resetForProject,
    analyzeGitError,
    analyzeGitOperation,
    sendMessage,
    showOperationResult,
  };
})();
