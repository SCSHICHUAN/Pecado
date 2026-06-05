/**
 * @file index.js
 *
 * 渲染进程工程助手：目录树、工程上下文、Open Folder 监听。
 */
(function () {
  const MCP_CONTEXT_MAX_TOTAL = 55000;
  const MCP_CONTEXT_MAX_PER_FILE = 10000;
  const MCP_KEY_FILES = ['package.json', 'README.md', 'CLAUDE.md', 'src/main/main.js'];

  /** @type {{ root: string, treeAscii: string }} */
  const projectState = { root: '', treeAscii: '' };

  /** @type {null | {
   *   addMessage: (text: string, type: string) => void,
   *   scrollChatToBottomForced: (opts?: object) => void,
   *   pushChatHistory: (entry: { role: string, content: string }) => void,
   * }} */
  let uiDeps = null;

  function getApi() {
    return window.electronAPI;
  }

  /** 从用户输入提取 @path 或 `path.ext` */
  function extractRequestedPaths(userText) {
    const paths = new Set();
    const s = String(userText || '');
    for (const m of s.matchAll(/@([^\s@,，。；;]+)/g)) {
      paths.add(m[1].replace(/^\/+/, ''));
    }
    for (const m of s.matchAll(/`([^`\n]+\.[a-zA-Z0-9]+)`/g)) {
      const p = m[1].trim();
      if (p && !/\s/.test(p)) paths.add(p.replace(/^\/+/, ''));
    }
    return paths;
  }

  /** 从用户输入提取 Xcode 流式写入目标（@path 或 `file.swift`） */
  function pickXcodeStreamTarget(userText) {
    const codeExt = /\.(swift|m|mm|h|hpp|c|cpp|cc)$/i;
    for (const p of extractRequestedPaths(userText)) {
      if (codeExt.test(p)) return p;
    }
    return null;
  }

  /** MCP directory_tree → tree(1) 风格：. / ├── / └── / │ */
  function formatMcpTreeBox(nodes, prefix, lines, maxLines) {
    if (!Array.isArray(nodes) || lines.length >= maxLines) return;
    for (let i = 0; i < nodes.length; i += 1) {
      if (lines.length >= maxLines) break;
      const node = nodes[i];
      const isLast = i === nodes.length - 1;
      const branch = isLast ? '└── ' : '├── ';
      lines.push(`${prefix}${branch}${node.name}`);
      if (node.type === 'directory' && Array.isArray(node.children) && node.children.length) {
        const childPrefix = prefix + (isLast ? '    ' : '│   ');
        formatMcpTreeBox(node.children, childPrefix, lines, maxLines);
      }
    }
  }

  function formatMcpTreeAscii(tree, maxLines) {
    const lines = ['.'];
    if (Array.isArray(tree) && tree.length) {
      formatMcpTreeBox(tree, '', lines, maxLines);
    }
    if (lines.length >= maxLines) {
      lines.push('…（目录过多，已截断）');
    }
    return lines.join('\n');
  }

  async function ensureProjectCached() {
    if (projectState.root && projectState.treeAscii) return;
    const api = getApi();
    if (!api?.mcpFsGetStatus || !api.mcpFsDirectoryTree) return;
    const st = await api.mcpFsGetStatus();
    if (!st.connected || !st.projectRoot) return;
    const res = await api.mcpFsDirectoryTree({});
    if (res.error || !res.tree) return;
    projectState.root = st.projectRoot;
    projectState.treeAscii = formatMcpTreeAscii(res.tree, 400);
  }

  /** 发豆包前：目录树 + MCP read_text_file（关键文件与用户 @ 的文件） */
  async function buildProjectContextForAi(userText) {
    await ensureProjectCached();
    if (!projectState.root) return '';
    const api = getApi();
    if (!api?.mcpFsReadTextFile) return '';

    const lines = [
      '【本地工程上下文】来自本机 MCP filesystem（directory_tree + read_text_file），请结合以下内容理解并回答代码问题。',
      `工程根目录: ${projectState.root}`,
      '',
      '【目录结构】',
      projectState.treeAscii || '(无)',
    ];

    const toRead = new Set(MCP_KEY_FILES);
    extractRequestedPaths(userText).forEach((p) => toRead.add(p));

    let budget = MCP_CONTEXT_MAX_TOTAL - lines.join('\n').length;
    for (const rel of toRead) {
      if (budget <= 500) break;
      const r = await api.mcpFsReadTextFile(rel);
      if (r.error || typeof r.text !== 'string') continue;
      let body = r.text;
      const cap = Math.min(MCP_CONTEXT_MAX_PER_FILE, budget);
      if (body.length > cap) body = `${body.slice(0, cap)}\n…(文件已截断)`;
      lines.push('', `【文件: ${rel}】`, '```', body, '```');
      budget -= body.length + rel.length + 40;
    }
    return lines.join('\n');
  }

  async function isMcpConnected() {
    const api = getApi();
    if (!api?.mcpFsGetStatus) return false;
    const st = await api.mcpFsGetStatus();
    return !!st?.connected;
  }

  function buildProjectTreeMarkdown(projectRoot, tree) {
    const treeText = formatMcpTreeAscii(tree, 400);
    const folderName = String(projectRoot).split(/[/\\]/).filter(Boolean).pop() || projectRoot;
    const indented = treeText
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n');
    return (
      `已打开工程 **${folderName}**\n\n` +
      `\`${projectRoot}\`\n\n` +
      `**目录结构**\n\n${indented}`
    );
  }

  async function showProjectTreeBubble(projectRoot) {
    if (!uiDeps) return;
    const api = getApi();
    if (!api || typeof api.mcpFsDirectoryTree !== 'function') {
      uiDeps.addMessage('已打开工程，但当前环境无法读取文件树。', 'assistant');
      uiDeps.scrollChatToBottomForced();
      return;
    }
    const res = await api.mcpFsDirectoryTree({});
    if (res.error) {
      uiDeps.addMessage(`已打开工程，但读取目录树失败：${res.error}`, 'assistant');
      uiDeps.scrollChatToBottomForced();
      return;
    }
    projectState.root = projectRoot;
    projectState.treeAscii = formatMcpTreeAscii(res.tree, 400);
    const md = buildProjectTreeMarkdown(projectRoot, res.tree);
    uiDeps.addMessage(md, 'assistant');
    uiDeps.pushChatHistory({ role: 'assistant', content: md });
    uiDeps.scrollChatToBottomForced();
  }

  function setupProjectListener() {
    const api = getApi();
    if (!api || typeof api.onMcpFsProjectChanged !== 'function') return;
    api.onMcpFsProjectChanged(({ projectRoot }) => {
      if (!projectRoot) return;
      showProjectTreeBubble(projectRoot).catch((e) => {
        console.error('[mcp] showProjectTreeBubble', e);
        if (uiDeps) {
          uiDeps.addMessage(`已打开工程，但展示目录树失败：${e.message || String(e)}`, 'assistant');
          uiDeps.scrollChatToBottomForced();
        }
      });
    });
  }

  /**
   * @param {{
   *   addMessage: (text: string, type: string) => void,
   *   scrollChatToBottomForced: (opts?: object) => void,
   *   pushChatHistory: (entry: { role: string, content: string }) => void,
   * }} deps
   */
  function init(deps) {
    uiDeps = deps;
    setupProjectListener();
  }

  window.projectClient = {
    init,
    extractRequestedPaths,
    pickXcodeStreamTarget,
    formatMcpTreeAscii,
    buildProjectContextForAi,
    isMcpConnected,
    showProjectTreeBubble,
  };
})();
