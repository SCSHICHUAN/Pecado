/**
 * @file stream-text-reveal.js
 * 聊天气泡正文：流式节流 Markdown（中途即有格式），HTML 未变不重绘
 */
(function () {
  const MIN_INTERVAL_MS = 48;

  function renderHtml(options, raw) {
    try {
      return options.renderMarkdown(String(raw ?? ''));
    } catch (_) {
      return String(raw ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  }

  /**
   * @param {{
   *   getTarget: () => HTMLElement | null,
   *   getRaw: () => string,
   *   renderMarkdown: (raw: string) => string,
   *   onEmpty?: (target: HTMLElement) => void,
   *   onAfterRender?: (target: HTMLElement, raw: string, mode: 'stream' | 'done') => void,
   * }} options
   */
  function create(options) {
    const state = { lastHtml: '', raf: 0, timer: 0, dirty: false, lastAt: 0 };

    function cancelTimers() {
      if (state.raf) cancelAnimationFrame(state.raf);
      if (state.timer) clearTimeout(state.timer);
      state.raf = 0;
      state.timer = 0;
    }

    function paint(mode) {
      state.raf = 0;
      state.timer = 0;
      state.dirty = false;
      state.lastAt = performance.now();

      const target = options.getTarget();
      if (!target) return;
      const raw = String(options.getRaw() ?? '');

      if (!raw.trim()) {
        state.lastHtml = '';
        target.replaceChildren();
        target.classList.remove('is-stream-live', 'markdown-body');
        options.onEmpty?.(target);
        options.onAfterRender?.(target, raw, mode);
        return;
      }

      const html = renderHtml(options, raw);
      target.classList.add('markdown-body');
      target.classList.toggle('is-stream-live', mode === 'stream');

      if (html !== state.lastHtml || mode === 'done') {
        target.innerHTML = html;
        state.lastHtml = html;
      }

      options.onAfterRender?.(target, raw, mode);
    }

    function schedule() {
      state.dirty = true;
      if (state.raf || state.timer) return;

      const elapsed = performance.now() - state.lastAt;
      if (elapsed >= MIN_INTERVAL_MS || state.lastAt === 0) {
        state.raf = requestAnimationFrame(() => paint('stream'));
        return;
      }

      state.timer = setTimeout(() => {
        state.timer = 0;
        state.raf = requestAnimationFrame(() => paint('stream'));
      }, MIN_INTERVAL_MS - elapsed);
    }

    function flush() {
      cancelTimers();
      state.dirty = false;
      paint('done');
      const target = options.getTarget();
      target?.classList.remove('is-stream-live');
    }

    function cancel() {
      state.dirty = false;
      cancelTimers();
      state.lastHtml = '';
    }

    return { schedule, flush, cancel };
  }

  /**
   * 流式回合最终正文：本轮有过 content delta 则以流式累积为准；
   * invoke 返回的 content 仅在没有流式正文时作为兜底（finish_task 摘要等不得覆盖已流式展示的正文）。
   * @param {string} streamedRaw
   * @param {string} invokeContent
   */
  function resolveStreamTurnContent(streamedRaw, invokeContent) {
    const streamed = String(streamedRaw ?? '').trim();
    if (streamed) return streamed;
    return String(invokeContent ?? '').trim();
  }

  function hasStreamedTurnContent(streamedRaw) {
    return Boolean(String(streamedRaw ?? '').trim());
  }

  const api = { create, resolveStreamTurnContent, hasStreamedTurnContent };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.StreamTextReveal = api;
  }
})();
