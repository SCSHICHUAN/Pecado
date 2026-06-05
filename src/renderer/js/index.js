/**
 * @file index.js
 *
 * 渲染进程工程 UI：Open Folder 后展示目录树气泡。
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
        console.error('[project-ui] showProjectTreeBubble', e);
        if (uiDeps) {
          uiDeps.addMessage(`已打开工程，但展示目录树失败：${e.message || String(e)}`, 'assistant');
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
