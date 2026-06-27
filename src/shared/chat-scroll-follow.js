/**
 * @file chat-scroll-follow.js
 * 对话区流式跟滚：用户读历史时不抢滚，贴底时恢复跟读（主 Pecado + CodX 底栏共用）
 */
(function () {
  const SCROLL_PIN_THRESHOLD_PX = 80;
  const STREAM_FOLLOW_MAX_GAP_PX = 20;
  const STREAM_DETACH_SCROLL_GAP_PX = 40;
  const WHEEL_UP_BLOCK_STREAM_MS = 900;

  /**
   * @param {() => HTMLElement | null} getScrollEl
   */
  function create(getScrollEl) {
    let chatProgrammaticScrollActive = false;
    let chatUserDetachedFromStream = false;
    let lastWheelUpIntentAt = 0;
    let activeChatTurnFollow = false;
    /** @type {ResizeObserver | null} */
    let resizeObserver = null;
    let scrollBound = false;

    function chatScrollGapFromBottom() {
      const el = getScrollEl();
      if (!el) return 0;
      return el.scrollHeight - el.scrollTop - el.clientHeight;
    }

    function isChatPinnedToBottom() {
      return chatScrollGapFromBottom() <= SCROLL_PIN_THRESHOLD_PX;
    }

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

    function shouldAutoScrollAfterTurn() {
      if (chatUserDetachedFromStream) return false;
      if (isChatWheelCooldownActive()) return false;
      if (activeChatTurnFollow) return true;
      return chatScrollGapFromBottom() <= SCROLL_PIN_THRESHOLD_PX;
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

    /**
     * @param {{ streamFollow?: boolean }} [opts]
     */
    function scrollChatToBottomForced(opts = {}) {
      const el = getScrollEl();
      if (!el) return;
      const streamFollow = opts.streamFollow === true;
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const instant = streamFollow || reduceMotion;

      chatProgrammaticScrollActive = true;

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

    function bindResizeFollow(...elements) {
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (typeof ResizeObserver === 'undefined') return;
      const els = elements.filter(Boolean);
      if (!els.length) return;
      resizeObserver = new ResizeObserver(() => {
        if (shouldFollowChatOutput()) scrollChatToBottomForced({ streamFollow: true });
      });
      els.forEach((el) => resizeObserver.observe(el));
    }

    function unbindResizeFollow() {
      resizeObserver?.disconnect();
      resizeObserver = null;
    }

    function bindScrollListeners() {
      if (scrollBound) return;
      const el = getScrollEl();
      if (!el) return;
      scrollBound = true;

      el.addEventListener('scroll', syncDetachFromStreamOnUserScroll, { passive: true });

      el.addEventListener(
        'wheel',
        (e) => {
          if (e.ctrlKey) return;
          if (e.deltaY < 0) {
            lastWheelUpIntentAt = performance.now();
            chatUserDetachedFromStream = true;
            return;
          }
          if (!chatProgrammaticScrollActive && e.deltaY > 0 && isChatPinnedToBottom()) {
            chatUserDetachedFromStream = false;
          }
        },
        { passive: true, capture: true }
      );

      let touchLastY = null;
      el.addEventListener(
        'touchstart',
        (e) => {
          if (e.touches.length === 1) touchLastY = e.touches[0].clientY;
        },
        { passive: true }
      );
      el.addEventListener(
        'touchmove',
        (e) => {
          if (e.touches.length !== 1) return;
          const y = e.touches[0].clientY;
          if (touchLastY == null) return;
          const dy = y - touchLastY;
          if (dy > 2) {
            lastWheelUpIntentAt = performance.now();
            chatUserDetachedFromStream = true;
          }
          if (!chatProgrammaticScrollActive && dy < -2 && isChatPinnedToBottom()) {
            chatUserDetachedFromStream = false;
          }
          touchLastY = y;
        },
        { passive: true }
      );
      el.addEventListener(
        'touchend',
        () => {
          touchLastY = null;
        },
        { passive: true }
      );
    }

    function prepareForNewTurn() {
      if (isChatPinnedToBottom() && !isChatWheelCooldownActive()) {
        chatUserDetachedFromStream = false;
        lastWheelUpIntentAt = 0;
      }
      activeChatTurnFollow = !chatUserDetachedFromStream;
    }

    function endTurnFollow() {
      activeChatTurnFollow = false;
    }

    function resetDetached() {
      chatUserDetachedFromStream = false;
      lastWheelUpIntentAt = 0;
      activeChatTurnFollow = false;
    }

    return {
      prepareForNewTurn,
      endTurnFollow,
      resetDetached,
      shouldFollowChatOutput,
      shouldAutoScrollAfterTurn,
      isChatPinnedToBottom,
      isChatWheelCooldownActive,
      scrollChatToBottomForced,
      bindScrollListeners,
      bindResizeFollow,
      unbindResizeFollow,
      get isDetached() {
        return chatUserDetachedFromStream;
      },
    };
  }

  const api = { create };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.ChatScrollFollow = api;
  }
})();
