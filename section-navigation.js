(function(){
  'use strict';
  var root = document.documentElement, portfolio = document.querySelector('main.bento');
  if(!portfolio) return;

  var button = document.createElement('button');
  button.type = 'button';
  button.id = 'section-step';
  button.className = 'section-step';
  button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v16M5 13l7 7 7-7"/></svg>';
  document.body.appendChild(button);

  var MENU_SECTIONS = [
    { id: 'hero-section', name: 'หน้าหลัก', btnId: 'btn-nav-home' },
    { id: 'story-section', name: 'เรื่องราว', btnId: 'btn-nav-story' },
    { id: 'downloads-section', name: 'ดาวน์โหลด & เกียรติบัตร', btnId: 'btn-nav-dl' },
    { id: 'contact-section', name: 'ติดต่อ', btnId: 'btn-nav-contact' }
  ];

  var positions = [], maxY = 0, pendingIndex = null, pendingY = null;
  var updateFrame = null, measureFrame = null;
  var hovered = false, focused = false;

  function layoutTop(element){
    var top = 0;
    for(var node = element; node; node = node.offsetParent) top += node.offsetTop;
    return top;
  }

  function measure(){
    maxY = Math.max(0, (document.scrollingElement || root).scrollHeight - window.innerHeight);
    var header = document.querySelector('.site-header');
    var offset = header ? Math.round(header.getBoundingClientRect().height) + 16 : 85;

    positions = MENU_SECTIONS.map(function(sec, index){
      var el = document.getElementById(sec.id);
      if(!el) return null;
      var y = sec.id === 'hero-section' ? 0 : Math.max(0, Math.min(maxY, layoutTop(el) - offset));
      return {
        index: index,
        id: sec.id,
        element: el,
        name: sec.name,
        btnId: sec.btnId,
        y: y
      };
    }).filter(Boolean);

    if(pendingY !== null) pendingY = Math.min(pendingY, maxY);
    update();
  }

  function scheduleMeasure(){
    if(measureFrame !== null) return;
    measureFrame = requestAnimationFrame(function(){
      measureFrame = null;
      measure();
    });
  }

  function getCurrentIndex(y){
    if(pendingIndex !== null) return pendingIndex;
    if(maxY > 0 && y >= maxY - 12) return positions.length - 1;
    if(y < 60) return 0;

    var header = document.querySelector('.site-header');
    var offset = header ? Math.round(header.getBoundingClientRect().height) + 20 : 90;
    var trigger = y + offset + 20;

    var cur = 0;
    for(var i = 0; i < positions.length; i++){
      if(positions[i].y <= trigger){
        cur = i;
      }
    }
    return cur;
  }

  function update(){
    var y = window.scrollY;
    var atBottom = maxY > 0 && y >= maxY - 12;

    if(pendingY !== null && Math.abs(y - pendingY) < 8){
      pendingIndex = null;
      pendingY = null;
    }

    var busy = String(pendingIndex !== null);
    if(button.getAttribute('aria-busy') !== busy) button.setAttribute('aria-busy', busy);

    var curIdx = getCurrentIndex(y);
    var returning = curIdx >= (positions.length - 1) || atBottom || (pendingIndex === 0 && y > 4);

    button.hidden = maxY < 2 || root.classList.contains('modal-active') || Boolean(document.querySelector('dialog[open]'));
    button.classList.toggle('is-top', returning);

    var nextIdx = returning ? 0 : (curIdx + 1);
    var nextSec = positions[nextIdx] || positions[0];
    var label = returning
      ? 'กลับขึ้นด้านบน'
      : ('เลื่อนไปหมวดถัดไป: ' + (nextSec ? nextSec.name : ''));

    if(button.getAttribute('aria-label') !== label){
      button.setAttribute('aria-label', label);
      button.title = label;
    }
    button.dataset.direction = returning ? 'up' : 'down';
    button.dataset.target = nextSec.id;
  }

  function scheduleUpdate(){
    if(updateFrame !== null) return;
    updateFrame = requestAnimationFrame(function(){
      updateFrame = null;
      update();
    });
  }

  button.addEventListener('click', function(){
    measure();
    var y = window.scrollY;
    var atBottom = maxY > 0 && y >= maxY - 12;
    var curIdx = getCurrentIndex(y);

    var nextIdx;
    if(pendingIndex !== null){
      nextIdx = (pendingIndex + 1) % positions.length;
    } else if(curIdx >= positions.length - 1 || atBottom){
      nextIdx = 0;
    } else {
      nextIdx = curIdx + 1;
    }

    if(nextIdx >= positions.length) nextIdx = 0;

    var targetSec = positions[nextIdx] || positions[0];
    pendingIndex = nextIdx;
    pendingY = targetSec.y;

    if(typeof scrollToSection === 'function'){
      scrollToSection(targetSec.id);
    } else if(typeof smoothScrollTo === 'function'){
      smoothScrollTo(targetSec.y, false, {
        duration: Math.min(1100, 720 + Math.abs(targetSec.y - y) / 12),
        easing: 'in-out'
      });
    } else {
      window.scrollTo({ top: targetSec.y, behavior: 'smooth' });
    }

    scheduleUpdate();
  });

  function engaged(){
    root.classList.toggle('section-nav-engaged', hovered || focused);
  }

  // 0.8s idle timer: bounces away after 0.8s inactivity, bounces back on mouse move
  var idleTimer = null;
  function wakeStepButton(){
    button.classList.remove('is-idle-hidden');
    clearTimeout(idleTimer);
    if(!hovered && !focused){
      idleTimer = setTimeout(function(){
        button.classList.add('is-idle-hidden');
      }, 800);
    }
  }

  window.addEventListener('mousemove', wakeStepButton, { passive: true });
  window.addEventListener('pointermove', wakeStepButton, { passive: true });
  window.addEventListener('scroll', wakeStepButton, { passive: true });
  window.addEventListener('touchstart', wakeStepButton, { passive: true });

  button.addEventListener('pointerenter', function(event){
    if(event.pointerType !== 'touch'){
      hovered = true;
      clearTimeout(idleTimer);
      button.classList.remove('is-idle-hidden');
      engaged();
    }
  });
  button.addEventListener('pointerleave', function(){
    hovered = false;
    wakeStepButton();
    engaged();
  });
  button.addEventListener('focus', function(){
    focused = button.matches(':focus-visible');
    clearTimeout(idleTimer);
    button.classList.remove('is-idle-hidden');
    engaged();
  });
  button.addEventListener('keydown', function(){
    focused = true;
    clearTimeout(idleTimer);
    button.classList.remove('is-idle-hidden');
    engaged();
  });
  button.addEventListener('blur', function(){
    focused = false;
    wakeStepButton();
    engaged();
  });

  // Start with 0.8s display then bounce away if idle
  wakeStepButton();

  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleMeasure, { passive: true });
  window.addEventListener('load', scheduleMeasure, { once: true });

  function clearPending(){
    pendingIndex = null;
    pendingY = null;
    scheduleUpdate();
  }

  window.addEventListener('pointerdown', function(event){
    if(!button.contains(event.target)) clearPending();
  }, { passive: true });
  window.addEventListener('wheel', clearPending, { passive: true });
  window.addEventListener('touchstart', function(event){
    if(!button.contains(event.target)) clearPending();
  }, { passive: true });
  window.addEventListener('keydown', function(event){
    if(/^(ArrowDown|ArrowUp|PageDown|PageUp|Home|End| )$/.test(event.key) && event.target !== button){
      clearPending();
    }
  });
  document.addEventListener('visibilitychange', function(){
    if(document.hidden) clearPending();
  });

  new MutationObserver(scheduleUpdate).observe(root, { attributes: true, attributeFilter: ['class'] });

  new MutationObserver(scheduleUpdate).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  if('ResizeObserver' in window) new ResizeObserver(scheduleMeasure).observe(portfolio);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleMeasure);

  measure();
})();
