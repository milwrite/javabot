// Mobile + Canvas Utilities for Bot Sportello Arcade
// Lightweight helpers to improve mobile gameplay and canvas crispness

(function () {
  function setupHiDPICanvas(canvas, logicalWidth, logicalHeight) {
    const ctx = canvas.getContext('2d');
    const dpr = (window.devicePixelRatio || 1);

    // Keep game logic in logical units; scale the backing store for crispness
    if (typeof logicalWidth === 'number' && typeof logicalHeight === 'number') {
      canvas.width = Math.round(logicalWidth * dpr);
      canvas.height = Math.round(logicalHeight * dpr);
    } else {
      // Fallback to current intrinsic size
      canvas.width = Math.round(canvas.width * dpr);
      canvas.height = Math.round(canvas.height * dpr);
    }
    // Let CSS handle responsive sizing; this ensures aspect ratio remains consistent
    canvas.style.imageRendering = 'crisp-edges';
    canvas.style.imageRendering = 'pixelated';

    // Scale drawing operations so 1 unit == 1 logical pixel
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    return { dpr, ctx };
  }

  // Bind a press-and-hold repeating action for buttons
  function bindHold(button, handler, options = {}) {
    const { initialDelay = 250, repeatEvery = 80 } = options;
    let timeoutId = null;
    let intervalId = null;

    const start = (e) => {
      e.preventDefault();
      handler();
      clearTimers();
      timeoutId = setTimeout(() => {
        intervalId = setInterval(handler, repeatEvery);
      }, initialDelay);
    };

    const clearTimers = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
      timeoutId = null;
      intervalId = null;
    };

    const end = (e) => {
      e.preventDefault();
      clearTimers();
    };

    button.addEventListener('mousedown', start);
    button.addEventListener('mouseup', end);
    button.addEventListener('mouseleave', end);
    button.addEventListener('touchstart', start, { passive: false });
    button.addEventListener('touchend', end, { passive: false });
    button.addEventListener('touchcancel', end, { passive: false });
  }

  // Pause a loop when page is hidden; resume on visible
  function setupVisibilityPause({ onPause, onResume }) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        try { onPause && onPause(); } catch {}
      } else {
        try { onResume && onResume(); } catch {}
      }
    });
  }

  // Prevent scroll-jank during gameplay by disabling body scroll temporarily
  function withNoScrollDuring(fn) {
    const { body } = document;
    const prev = body.style.overflow;
    body.style.overflow = 'hidden';
    try { fn && fn(); } finally {
      body.style.overflow = prev || '';
    }
  }

  // Export to window
  window.MobileGameUtils = {
    setupHiDPICanvas,
    bindHold,
    setupVisibilityPause,
    withNoScrollDuring,
  };
})();

