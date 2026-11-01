(function () {
  'use strict';
  var main = document.querySelector('main.bento');
  var amount = document.getElementById('scroll-motion-blur-amount');
  if (!main || !amount) return;

  // Phones: an SVG filter over the whole page re-rasterizes the full content
  // layer every frame; a composited CSS blur stays on the GPU tiles instead.
  var TOUCH = window.matchMedia('(pointer: coarse)').matches;
  var MAX_BLUR = TOUCH ? 7 : 12;
  var GAIN = 0.32;
  var ATTACK = 0.35;
  var DECAY = 0.16;
  var CUT = TOUCH ? 0.6 : 0.15;

  var lastY = window.scrollY;
  var current = 0;
  var raf = null;
  var applied = false;
  var hot = 0;

  function frame() {
    var y = window.scrollY;
    var velocity = Math.abs(y - lastY);
    lastY = y;
    var target = Math.min(MAX_BLUR, velocity * GAIN);
    if (TOUCH) {
      // Single-frame jumps (scroll anchoring, lazy reveals) must not churn the
      // blur layer; only sustained finger scrolling turns it on.
      hot = target >= CUT ? hot + 1 : 0;
      target = hot >= 3 ? target : 0;
    }
    current += (target - current) * (target > current ? ATTACK : DECAY);

    if (target === 0 && current < CUT) {
      raf = null;
      current = 0;
      applied = false;
      main.style.filter = '';
      main.style.willChange = '';
      amount.setAttribute('stdDeviation', '0 0');
      return;
    }

    if (TOUCH) {
      main.style.filter = 'blur(' + (Math.round(current * 2) / 2) + 'px)';
    } else {
      amount.setAttribute('stdDeviation', '0 ' + (Math.round(current * 10) / 10));
      if (!applied) main.style.filter = 'url(#scroll-motion-blur)';
    }
    if (!applied) {
      if (TOUCH) main.style.willChange = 'filter';
      applied = true;
    }
    raf = requestAnimationFrame(frame);
  }

  // No prefers-reduced-motion guard on purpose: this box disables OS animations,
  // which would permanently hide the effect the owner asked for.
  // lastY is only advanced inside frame(): resetting it here would zero the velocity.
  window.addEventListener('scroll', function () {
    if (raf !== null) return;
    raf = requestAnimationFrame(frame);
  }, { passive: true });
})();