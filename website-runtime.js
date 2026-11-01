var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

var isProgrammaticScrolling = false;
var isNavScrollLocked = false;
var navWrap = document.getElementById('nav-pill-wrap');
var navButtons = Array.from(document.querySelectorAll('.nav-btn'));
var activeNavId = null;
var scrollFinishTimer = null;
var navScrollTarget = null;
var navUpdateFrame = null;
var navGeometry = { story: Infinity, certificates: Infinity, downloads: Infinity, maxScroll: 0, height: 0 };
var navActiveLine = navWrap && navWrap.querySelector('.nav-active-line');
var navLineFrame = null;
var navPressAnimations = new WeakMap();

function syncNavActiveLine(){
    if(!navActiveLine) return;
    var button = navWrap.querySelector('.nav-btn.active');
    if(!button) return;
    var label = button.querySelector('span');
    // Compact phones show the certificates icon without its label.
    var target = label && label.getClientRects().length ? label : button.querySelector('svg');
    if(!target) return;
    var container = navWrap.getBoundingClientRect();
    var rect = target.getBoundingClientRect();
    var scaleX = container.width / navWrap.offsetWidth || 1;
    var scaleY = container.height / navWrap.offsetHeight || 1;
    navActiveLine.style.width = (rect.width / scaleX) + 'px';
    navActiveLine.style.transform = 'translate3d(' + ((rect.left - container.left) / scaleX) + 'px,' +
        ((rect.bottom - container.top) / scaleY + 4) + 'px,0)';
    if(!navActiveLine.classList.contains('is-ready')){
        // Establish the initial position before enabling transitions.
        void navActiveLine.offsetWidth;
        navActiveLine.classList.add('is-ready');
    }
}

function scheduleNavActiveLine(){
    if(navLineFrame !== null) return;
    navLineFrame = requestAnimationFrame(function(){ navLineFrame = null; syncNavActiveLine(); });
}

function playNavPress(button){
    if(!button.animate) return;
    var previous = navPressAnimations.get(button);
    if(previous) previous.cancel();
    var gentle = reducedMotion.matches;
    var animation = button.animate(gentle ? [{opacity:.65},{opacity:1}] : [
        {transform:'translateY(0) scale(1)',offset:0},
        {transform:'translateY(1px) scale(.975)',offset:.25},
        {transform:'translateY(0) scale(1)',offset:1}
    ],{duration:gentle ? 180 : 320,easing:'cubic-bezier(.22,1,.36,1)'});
    navPressAnimations.set(button,animation);
}
window.addEventListener('resize',scheduleNavActiveLine,{passive:true});
if(navWrap && 'ResizeObserver' in window) new ResizeObserver(scheduleNavActiveLine).observe(navWrap);
if(document.fonts) document.fonts.ready.then(scheduleNavActiveLine);



[navWrap].forEach(function(group){
    if(!group) return;
    group.addEventListener('click', function(event){
        var button = event.target.closest('button');
        if(button && group.contains(button)){
            playNavPress(button);
        }
    });
});

function setActiveNav(id){
    if(activeNavId === id) return;
    activeNavId = id;
    navButtons.forEach(function(btn){
        var active = btn.id === id;
        btn.classList.toggle('active', active);
        if(active) btn.setAttribute('aria-current', 'location');
        else btn.removeAttribute('aria-current');
    });
    syncNavActiveLine();
}

function setNavScrollLocked(locked){
    if(isNavScrollLocked === locked) return;
    isNavScrollLocked = locked;
    if(navWrap) navWrap.setAttribute('aria-busy', String(locked));
    navButtons.forEach(function(btn){ btn.disabled = locked; });
}

function finishNavScroll(){
    clearTimeout(scrollFinishTimer);
    scrollFinishTimer = null;
    navScrollTarget = null;
    isProgrammaticScrolling = false;
    setNavScrollLocked(false);
    updateActiveNav();
}

var scrollTweenFrame = null;
var scrollTweenTarget = 0;
var wheelTweenRunning = false;

function stopScrollTween(){
    if(scrollTweenFrame !== null) cancelAnimationFrame(scrollTweenFrame);
    scrollTweenFrame = null;
    wheelTweenRunning = false;
    if(isProgrammaticScrolling) finishNavScroll();
}

// A single, on-demand tween for both menu navigation and wheel input.
function smoothScrollTo(targetY, fromWheel, options){
    if(fromWheel){
        startWheelTween(targetY);
        return;
    }
    stopScrollTween();
    scrollTweenTarget = targetY;
    if(Math.abs(targetY - window.scrollY) < 2){
        window.scrollTo({ top: targetY, behavior: 'instant' });
        finishNavScroll();
        return;
    }
    wheelTweenRunning = !!fromWheel;
    isProgrammaticScrolling = !fromWheel;
    // Menu clicks may retarget the tween at any time; never disable the buttons.
    setNavScrollLocked(false);
    navScrollTarget = targetY;
    var startY = window.scrollY;
    var diff = targetY - startY;
    var startTime = performance.now();
    // Ultra-smooth duration (950ms default) for luxurious gliding
    var duration = options && Number.isFinite(options.duration)
        ? Math.max(300, Math.min(1500, options.duration)) : 950;
    function tick(now){
        var p = Math.min(1, (now - startTime) / duration);
        // Silky quintic ease-in-out curve (นุ่มที่สุดที่ทำได้)
        var eased = p < 0.5
            ? 16 * p * p * p * p * p
            : 1 - Math.pow(-2 * p + 2, 5) / 2;
        window.scrollTo({ top: startY + diff * eased, behavior: 'instant' });
        if(p < 1) scrollTweenFrame = requestAnimationFrame(tick);
        else {
            scrollTweenFrame = null;
            wheelTweenRunning = false;
            finishNavScroll();
        }
    }
    scrollTweenFrame = requestAnimationFrame(tick);
}

function startWheelTween(targetY){
    scrollTweenTarget = targetY;
    // Retarget the existing animation instead of restarting its easing curve.
    if(wheelTweenRunning) return;
    stopScrollTween();
    wheelTweenRunning = true;
    var position = window.scrollY;
    var lastTime = performance.now();
    function step(now){
        var elapsed = Math.min(50, now - lastTime);
        lastTime = now;
        scrollTweenTarget = Math.max(0, Math.min(scrollTweenTarget, navGeometry.maxScroll));
        var distance = scrollTweenTarget - position;
        if(Math.abs(distance) < 0.3){
            window.scrollTo({ top: scrollTweenTarget, behavior: 'instant' });
            scrollTweenFrame = null;
            wheelTweenRunning = false;
            updateActiveNav();
            if(window.__updatePassedSections) window.__updatePassedSections();
            return;
        }
        // Softer time constant (160ms) gives a buttery, silky float feel
        position += distance * (1 - Math.exp(-elapsed / 160));
        window.scrollTo({ top: position, behavior: 'instant' });
        if(window.__updatePassedSections) window.__updatePassedSections();
        scrollTweenFrame = requestAnimationFrame(step);
    }
    scrollTweenFrame = requestAnimationFrame(step);
}

window.addEventListener('wheel', function(event){
    if(event.defaultPrevented || !event.cancelable || event.ctrlKey || event.metaKey ||
       event.altKey || event.shiftKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    if(document.documentElement.style.overflow === 'hidden') return;
    // Leave nested scrolling areas and controls to their own native behavior.
    for(var node = event.target; node && node !== document.body; node = node.parentElement){
        if(node.nodeType !== 1) continue;
        if(node.matches('input,textarea,select,[contenteditable]')) return;
        if(node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)) return;
    }
    var delta = event.deltaY;
    if(event.deltaMode === 1) delta *= 32;
    else if(event.deltaMode === 2) delta *= window.innerHeight;
    // Scale mouse-wheel travel gently with the viewport; keep fine trackpad input precise.
    if(event.deltaMode !== 0 || Math.abs(delta) >= 50){
        delta *= Math.max(1, Math.min(2, window.innerHeight / 800));
    }
    var maxY = navGeometry.maxScroll;
    var actualY = window.scrollY;
    var baseY = wheelTweenRunning ? scrollTweenTarget : actualY;
    // Reversing the wheel should reverse immediately, not consume queued travel.
    if(wheelTweenRunning && delta * (scrollTweenTarget - actualY) < 0) baseY = actualY;
    var lead = Math.max(240, window.innerHeight * 0.75);
    baseY = Math.max(actualY - lead, Math.min(baseY + delta, actualY + lead));
    var nextY = Math.max(0, Math.min(baseY, maxY));
    event.preventDefault();
    smoothScrollTo(nextY, true);
}, { passive: false });
window.addEventListener('touchstart', function(event){
    if(!navWrap.contains(event.target)) stopScrollTween();
}, { passive: true });
window.addEventListener('pointerdown', function(event){
    if(!navWrap.contains(event.target)) stopScrollTween();
}, { passive: true });
window.addEventListener('keydown', function(event){
    if(/^(ArrowDown|ArrowUp|PageDown|PageUp|Home|End| )$/.test(event.key)) stopScrollTween();
});
document.addEventListener('visibilitychange', function(){
    if(document.hidden) stopScrollTween();
});

function measureNavGeometry(){
    var y = window.scrollY;
    var story = document.getElementById('story-section');
    var certificates = document.getElementById('certificates-section');
    var downloads = document.getElementById('downloads-section');
    var contact = document.getElementById('contact-section');
    navGeometry.height = window.innerHeight;
    navGeometry.maxScroll = Math.max(0, document.documentElement.scrollHeight - navGeometry.height);
    navGeometry.story = story ? story.getBoundingClientRect().top + y : Infinity;
    navGeometry.downloads = downloads ? downloads.getBoundingClientRect().top + y : Infinity;
    navGeometry.certificates = certificates ? certificates.getBoundingClientRect().top + y : Infinity;
    navGeometry.contact = contact ? contact.getBoundingClientRect().top + y : Infinity;
    updateActiveNav();
}

function scheduleNavMeasure(){
    if(navUpdateFrame !== null) return;
    navUpdateFrame = window.requestAnimationFrame(function(){
        navUpdateFrame = null;
        measureNavGeometry();
    });
}

function updateActiveNav(){
    if(isProgrammaticScrolling) return;
    var y = window.scrollY;
    var header = document.querySelector('.site-header');
    var headerOffset = header ? Math.round(header.getBoundingClientRect().height) + 20 : 90;
    var trigger = y + headerOffset + 20;
    var activeId = 'btn-nav-home';
    if(navGeometry.maxScroll > 0 && y >= navGeometry.maxScroll - 16){
        activeId = 'btn-nav-contact';
    } else if(y >= 80){
        var sections = [
            {top:navGeometry.story, button:'btn-nav-story'},
            {top:navGeometry.downloads, button:'btn-nav-dl'},
            {top:navGeometry.contact, button:'btn-nav-contact'}
        ].sort(function(a,b){return a.top-b.top;});
        sections.forEach(function(section){
            if(section.top <= trigger) activeId = section.button;
        });
    }
    setActiveNav(activeId);
}

function scrollToSection(id){
    var el = document.getElementById(id);
    if(!el) return;
    measureNavGeometry();
    var targetBtnId = 'btn-nav-home';
    if(id === 'story-section') targetBtnId = 'btn-nav-story';
    else if(id === 'downloads-section' || id === 'certificates-section') targetBtnId = 'btn-nav-dl';
    else if(id === 'contact-section') targetBtnId = 'btn-nav-contact';
    var header = document.querySelector('.site-header');
    var headerOffset = header ? Math.round(header.getBoundingClientRect().height) + 16 : 85;
    var targetY = id === 'hero-section' ? 0 : Math.round(el.getBoundingClientRect().top + window.scrollY - headerOffset);
    smoothScrollTo(Math.max(0, Math.min(targetY, navGeometry.maxScroll)));
    // Apply the clicked state after cancelling any previous tween, so it updates immediately.
    setActiveNav(targetBtnId);
}

window.addEventListener('scroll', function(){
    if(!isProgrammaticScrolling){
        updateActiveNav();
    }
}, { passive: true });
window.addEventListener('resize', scheduleNavMeasure, { passive: true });
window.addEventListener('load', scheduleNavMeasure, { once: true });
if('ResizeObserver' in window){
    new ResizeObserver(scheduleNavMeasure).observe(document.querySelector('.bento'));
}
if(document.fonts) document.fonts.ready.then(scheduleNavMeasure);
measureNavGeometry();

// Replay a short entrance when a section returns to the viewport.
// Images remain lazy, and finished sections keep no animation layers or filters.
(function setupLazySectionReveal(){
    var root = document.documentElement;
    var portfolio = document.querySelector('main.bento');
    var parts = portfolio ? Array.from(portfolio.children) : [];
    var states = new WeakMap();
    var active = new Set();
    var revealed = 0;
    var fallbackFrame = null;
    clearTimeout(window.__seenRevealFallback);

    function loadSectionImages(part){
        part.querySelectorAll('img[data-section-src]').forEach(function(img){
            img.src = img.getAttribute('data-section-src');
            img.removeAttribute('data-section-src');
        });
    }
    function isVisible(part){
        var bounds = part.getBoundingClientRect();
        return bounds.bottom > 0 && bounds.top < window.innerHeight;
    }
    // Initial load: reveal sections one at a time, in DOM order, slowly.
    var entranceQueue = [];
    var entranceTimer = null;
    function drainEntrance(){
        entranceTimer = null;
        if(window.__introHold) return;
        var part = entranceQueue.shift();
        if(!part) return;
        enterPart(part, part.getBoundingClientRect(), true);
        if(entranceQueue.length) entranceTimer = window.setTimeout(drainEntrance, 320);
    }
    function queueEntrance(part){
        if(entranceQueue.indexOf(part) !== -1) return;
        entranceQueue.push(part);
        entranceQueue.sort(function(a, b){ return parts.indexOf(a) - parts.indexOf(b); });
        if(entranceTimer === null && !window.__introHold) entranceTimer = window.setTimeout(drainEntrance, 60);
    }
    // The signature intro releases the staged entrance as its overlay dissolves.
    window.__seenIntroRelease = function(){
        if(entranceQueue.length && entranceTimer === null) entranceTimer = window.setTimeout(drainEntrance, 60);
    };
    function finishAnimation(part){
        var state = states.get(part);
        if(state.animation){
            var animation = state.animation;
            state.animation = null;
            animation.cancel();
        }
        active.delete(part);
        part.classList.remove('section-entering');
        state.visible = isVisible(part);
    }
    function enterPart(part, bounds, animate){
        var state = states.get(part);
        var initial = root.classList.contains('page-loading');
        finishAnimation(part);
        state.visible = true;
        loadSectionImages(part);
        part.classList.remove('scroll-passed', 'scroll-passed-bottom');
        part.classList.add('load-ready');
        var certSub = part.querySelector('#certificates-section');
        if(certSub) certSub.classList.add('load-ready');
        if(!state.ready){
            state.ready = true;
            revealed++;
            if(revealed === parts.length){
                root.classList.remove('page-loading');
                scheduleNavMeasure();
            }
        }
        // A focused control must stay fully visible, including when Tab scrolls to it.
        // The owner wants the slow staged entrance even with OS reduced motion on.
        if(!animate || (reducedMotion.matches && !initial) || document.hidden ||
           part.contains(document.activeElement) || typeof part.animate !== 'function') return;
        var distance = bounds.top < 0 ? -24 : (initial ? 36 : 28);
        part.classList.add('section-entering');
        var animation = part.animate([
            {opacity:initial ? 0 : 0.18, transform:'translate3d(0,' + distance + 'px,0)'},
            {opacity:1, transform:'translate3d(0,0,0)'}
        ], {duration:initial ? 1100 : 620, easing:'cubic-bezier(.22,1,.36,1)'});
        state.animation = animation;
        active.add(part);
        function cleanup(){
            if(state.animation === animation){
                state.animation = null;
                active.delete(part);
                part.classList.remove('section-entering');
                state.visible = isVisible(part);
            }
        }
        animation.finished.then(cleanup, cleanup);
    }
    function revealVisibleParts(){
        fallbackFrame = null;
        var height = window.innerHeight;
        parts.forEach(function(part){
            var bounds = part.getBoundingClientRect();
            if(bounds.top < height + 240) loadSectionImages(part);
            var visible = bounds.bottom > 0 && bounds.top < height;
            var state = states.get(part);
            if(visible && !state.visible) enterPart(part, bounds, true);
            else if(!visible && !state.animation) state.visible = false;
        });
    }
    if(!parts.length){ root.classList.remove('page-loading'); return; }
    parts.forEach(function(part){
        states.set(part, {ready:false, visible:false, animation:null});
        part.classList.add('scroll-reveal-item');
    });
    if('IntersectionObserver' in window){
        var revealObserver = new IntersectionObserver(function(entries){
            entries.forEach(function(entry){
                var part = entry.target, state = states.get(part);
                if(entry.isIntersecting && !state.visible){
                    if(root.classList.contains('page-loading')) queueEntrance(part);
                    else enterPart(part, entry.boundingClientRect, true);
                }
                // The entrance translation may briefly cross the viewport edge.
                // Let it finish, then measure its resting position to avoid replay loops.
                else if(!entry.isIntersecting && !state.animation) state.visible = false;
            });
        }, {threshold:0});
        var imageObserver = new IntersectionObserver(function(entries){
            entries.forEach(function(entry){
                if(!entry.isIntersecting) return;
                loadSectionImages(entry.target);
                imageObserver.unobserve(entry.target);
            });
        }, {rootMargin:'240px 0px', threshold:0});
        parts.forEach(function(part){
            revealObserver.observe(part);
            if(part.querySelector('img[data-section-src]')) imageObserver.observe(part);
        });
    }else{
        revealVisibleParts();
        function scheduleReveal(){
            if(fallbackFrame === null) fallbackFrame = requestAnimationFrame(revealVisibleParts);
        }
        window.addEventListener('scroll', scheduleReveal, {passive:true});
        window.addEventListener('resize', scheduleReveal, {passive:true});
    }
    portfolio.addEventListener('focusin', function(event){
        var part = parts.find(function(candidate){return candidate.contains(event.target);});
        if(part) enterPart(part, part.getBoundingClientRect(), false);
    });
    function stopActiveAnimations(){active.forEach(finishAnimation);}
    reducedMotion.addEventListener('change', function(){if(reducedMotion.matches) stopActiveAnimations();});
    document.addEventListener('visibilitychange', function(){if(document.hidden) stopActiveAnimations();});

    // The portfolio CSS already disables the old offscreen fade/grid effect.
    // Keep its public hook for dialogs, but avoid measuring every card on each
    // scroll frame and promoting invisible filters to compositor layers.
    window.__updatePassedSections = function(){};
})();

function handleEmailClick(e){
    var isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if(isMobile){
        e.preventDefault();
        window.location.href = 'mailto:nattanantreetos@gmail.com';
    }
}
function openLink(url){window.open(url,'_blank','noopener,noreferrer');}
function triggerDownload(url){
    var a=document.createElement('a');
    a.href=url;
    a.download=url.split('/').pop()||url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}
(function(){
'use strict';
var elUDays=document.getElementById('u-days'),
    elUHours=document.getElementById('u-hours'),
    elUMins=document.getElementById('u-mins'),
    elUSecs=document.getElementById('u-secs'),
    myAge=document.getElementById('my-age'),
    elBDays=document.getElementById('b-days'),
    elBHours=document.getElementById('b-hours'),
    elBMins=document.getElementById('b-mins'),
    elBSecs=document.getElementById('b-secs'),
    birth=new Date(2010,3,26,0,0,0);

var visibleTimers = new Set();
var timerInterval = null;
var timerTargets = [myAge, elUDays.closest('.timer-block'), elBDays.closest('.timer-block')];

function setCounter(el, value){
    value = String(value);
    if(el && el.textContent !== value) el.textContent = value;
}

function tick(){
    if(document.hidden || visibleTimers.size === 0)return;
    var now=new Date(),diff=now-birth;
    var d=Math.floor(diff/86400000),
        h=Math.floor((diff%86400000)/3600000),
        m=Math.floor((diff%3600000)/60000),
        s=Math.floor((diff%60000)/1000);

    if(visibleTimers.has(timerTargets[1])){
        setCounter(elUDays,d);
        setCounter(elUHours,h<10?'0'+h:h);
        setCounter(elUMins,m<10?'0'+m:m);
        setCounter(elUSecs,s<10?'0'+s:s);
    }

    var yAge=now.getFullYear()-2010,
        mAge=now.getMonth()-3,
        dAge=now.getDate()-26;
    if(dAge<0){mAge--;dAge+=new Date(now.getFullYear(),now.getMonth(),0).getDate();}
    if(mAge<0){yAge--;mAge+=12;}
    if(visibleTimers.has(myAge))setCounter(myAge,yAge+'y '+mAge+'m '+dAge+'d');

    var nextBday=new Date(now.getFullYear(),3,26,0,0,0);
    if(now>nextBday)nextBday.setFullYear(nextBday.getFullYear()+1);
    var bdiff=nextBday-now;
    var bd=Math.floor(bdiff/86400000),
        bh=Math.floor((bdiff%86400000)/3600000),
        bm=Math.floor((bdiff%3600000)/60000),
        bs=Math.floor((bdiff%60000)/1000);

    if(visibleTimers.has(timerTargets[2])){
        setCounter(elBDays,bd<100?(bd<10?'00'+bd:'0'+bd):bd);
        setCounter(elBHours,bh<10?'0'+bh:bh);
        setCounter(elBMins,bm<10?'0'+bm:bm);
        setCounter(elBSecs,bs<10?'0'+bs:bs);
    }
}

function syncTimerActivity(){
    clearInterval(timerInterval);
    timerInterval = null;
    if(!document.hidden && visibleTimers.size > 0){
        tick();
        // Age changes daily; only the two visible clocks need second-by-second updates.
        timerInterval = setInterval(tick, visibleTimers.size === 1 && visibleTimers.has(myAge) ? 60000 : 1000);
    }
}
if('IntersectionObserver' in window){
    var timerObserver = new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
            if(entry.isIntersecting) visibleTimers.add(entry.target);
            else visibleTimers.delete(entry.target);
        });
        syncTimerActivity();
    });
    timerTargets.forEach(function(el){ if(el) timerObserver.observe(el); });
}else{
    timerTargets.forEach(function(el){ if(el) visibleTimers.add(el); });
    syncTimerActivity();
}
document.addEventListener('visibilitychange',syncTimerActivity);

var avatarModalEl=document.getElementById('avatar-modal');
var certificateModalEl=document.getElementById('certificate-modal');
var certificateModalImage=document.getElementById('certificate-modal-image');
var certificateLastFocus=null;

window.openCertificate=function(src,alt){
    if(!certificateModalEl||!certificateModalImage)return;
    stopScrollTween();
    certificateLastFocus=document.activeElement;
    certificateModalImage.src=src;
    certificateModalImage.alt=alt||'';
    certificateModalEl.classList.add('active');
    document.documentElement.classList.add('modal-active');
    document.body.classList.add('modal-active');
    var closeButton=certificateModalEl.querySelector('.certificate-modal-close');
    if(closeButton)closeButton.focus({preventScroll:true});
};
window.closeCertificate=function(){
    if(!certificateModalEl||!certificateModalEl.classList.contains('active'))return;
    certificateModalEl.classList.remove('active');
    document.documentElement.classList.remove('modal-active');
    document.body.classList.remove('modal-active');
    if(certificateLastFocus&&certificateLastFocus.focus)certificateLastFocus.focus({preventScroll:true});
};
document.addEventListener('keydown',function(event){
    if(event.key==='Escape'&&certificateModalEl&&certificateModalEl.classList.contains('active')){
        event.preventDefault();
        closeCertificate();
    }
});

window.openAvatar=function(idx){
    if(typeof idx === 'number' && avatarImages[idx]) currentSlide = idx;
    if(avatarModalEl){
        if(full){
            full.style.backgroundImage="url('"+avatarImages[currentSlide]+"')";
            if(slides[currentSlide]) full.style.setProperty('--avatar-full-position',getComputedStyle(slides[currentSlide]).objectPosition);
        }
        avatarModalEl.classList.add('active');
        document.documentElement.classList.add('modal-active');
        document.body.classList.add('modal-active');
        syncAvatarActivity();
    }
};
window.closeAvatar=function(){
    if(avatarModalEl){
        avatarModalEl.classList.remove('active');
        document.documentElement.classList.remove('modal-active');
        document.body.classList.remove('modal-active');
        syncAvatarActivity();
    }
};

var slides=document.querySelectorAll('.avatar-slide'),
    full=document.getElementById('avatar-full'),
    avatarImages=Array.from(slides,function(slide){return slide.getAttribute('src');}),
    currentSlide=0;
var avatarRoot=document.querySelector('.avatar');
var avatarVisible=false, avatarInterval=null, avatarHovered=false, avatarFocused=false;
function markAvatarPage(){
    if(avatarRoot)avatarRoot.setAttribute('data-profile-page',String(currentSlide+1).padStart(2,'0')+' / '+String(slides.length).padStart(2,'0'));
}
function nextSlide(){
    return; // Circular dual profile mode: both circles are always visible; no shuffling needed
    if(document.hidden||slides.length<2||isAnyModalOrPopupActive())return;
    var outgoing=slides[currentSlide],incoming=slides[(currentSlide+1)%slides.length];
    var from=getComputedStyle(incoming),front=getComputedStyle(outgoing);
    var incomingFrom={transform:from.transform,opacity:from.opacity,boxShadow:from.boxShadow,zIndex:1};
    var outgoingFrom={transform:front.transform,opacity:front.opacity,boxShadow:front.boxShadow,zIndex:3};
    Array.from(slides).forEach(function(slide){slide.getAnimations().forEach(function(animation){animation.cancel();});});
    currentSlide=(currentSlide+1)%slides.length;
    Array.from(slides).forEach(function(slide,index){slide.classList.toggle('active',index===currentSlide);});
    markAvatarPage();
    if(incoming.animate){
        var target=getComputedStyle(incoming),back=getComputedStyle(outgoing);
        var distance=Math.min(128,outgoing.offsetWidth*.36),ease='cubic-bezier(.22,1,.36,1)';
        // One shared shuffle for automatic changes, pointer entry and keyboard focus.
        incoming.animate([
            {...incomingFrom,offset:0,easing:ease},
            {transform:'translate('+distance*.08+'px,-12px) rotate(3deg) scale(1.005)',opacity:1,zIndex:2,offset:.44,easing:ease},
            {transform:target.transform,opacity:1,boxShadow:target.boxShadow,zIndex:2,offset:1}
        ],{duration:780,easing:'linear'});
        outgoing.animate([
            {...outgoingFrom,offset:0,easing:ease},
            {transform:'translate(-'+distance+'px,-24px) rotate(-13deg) scale(.98)',opacity:1,zIndex:3,offset:.42},
            {transform:'translate(-'+distance+'px,-24px) rotate(-13deg) scale(.98)',opacity:1,zIndex:0,offset:.48,easing:ease},
            {transform:back.transform,opacity:back.opacity,boxShadow:back.boxShadow,zIndex:0,offset:1}
        ],{duration:780,easing:'linear'});
    }
    if(full&&avatarModalEl?.classList.contains('active')){
        full.style.backgroundImage="url('"+avatarImages[currentSlide]+"')";
        full.style.setProperty('--avatar-full-position',getComputedStyle(incoming).objectPosition);
    }
}
function syncAvatarActivity(){
    clearInterval(avatarInterval);avatarInterval=null;
    if(!document.hidden&&avatarVisible&&slides.length>1&&!isAnyModalOrPopupActive())avatarInterval=setInterval(nextSlide,2500);
}
if(avatarRoot){
    markAvatarPage();
    avatarRoot.addEventListener('pointerenter',function(event){
        if(event.pointerType==='touch'||avatarHovered)return;
        avatarHovered=true;nextSlide();syncAvatarActivity();
    });
    avatarRoot.addEventListener('pointerleave',function(){avatarHovered=false;syncAvatarActivity();});
    avatarRoot.addEventListener('focus',function(){
        avatarFocused=avatarRoot.matches(':focus-visible');
        if(avatarFocused&&!avatarHovered)nextSlide();
        syncAvatarActivity();
    });
    avatarRoot.addEventListener('blur',function(){avatarFocused=false;syncAvatarActivity();});
    avatarRoot.addEventListener('keydown',function(){avatarFocused=true;});
    if('IntersectionObserver' in window){
        new IntersectionObserver(function(entries){avatarVisible=entries[0].isIntersecting;syncAvatarActivity();}).observe(avatarRoot);
    }else{avatarVisible=true;syncAvatarActivity();}
}
document.addEventListener('visibilitychange',syncAvatarActivity);
reducedMotion.addEventListener('change',syncAvatarActivity);

function isAnyModalOrPopupActive(){
    return !!(
        document.querySelector('.modal-avatar.active, .modal-certificate.active, .modal.active, [aria-modal="true"].active') ||
        (document.body && (document.body.classList.contains('modal-active') || document.body.style.overflow === 'hidden'))
    );
}

// Idle showcase: one cancellable animation, separate from manual/menu scrolling.
(function initIdleShowcase(){
    var idleDelay = 3000;
    var pixelsPerSecond = 90;
    var idleTimer = null;
    var frame = null;
    var direction = 1;
    var heldPointers = new Set();
    var touching = false;
    var pointerPosition = null;
    var lastActivity = performance.now();
    var root = document.documentElement;

    function blocked(){
        var focused = document.activeElement;
        return document.hidden || heldPointers.size > 0 || touching || avatarHovered || avatarFocused ||
            root.classList.contains('section-nav-engaged') ||
            root.style.overflow === 'hidden' ||
            isAnyModalOrPopupActive() || document.querySelector('dialog[open]') ||
            (focused && focused.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])'));
    }

    function stop(){
        clearTimeout(idleTimer);
        idleTimer = null;
        if(frame !== null) cancelAnimationFrame(frame);
        frame = null;
        root.classList.remove('seen-idle-scrolling');
    }

    function schedule(){
        clearTimeout(idleTimer);
        if(document.hidden) return;
        var remaining = Math.max(0, idleDelay - (performance.now() - lastActivity));
        // A transient focus/modal state must not permanently drop the idle timer.
        idleTimer = setTimeout(start, blocked() ? Math.max(500, remaining) : remaining);
    }

    function activity(){
        stop();
        lastActivity = performance.now();
        schedule();
    }

    function start(){
        idleTimer = null;
        if(blocked()){ schedule(); return; }
        // Finish a user's navigation/wheel tween before taking over.
        if(isProgrammaticScrolling || wheelTweenRunning){
            idleTimer = setTimeout(start, 300);
            return;
        }
        var scroller = document.scrollingElement || root;
        var maxY = Math.max(0, scroller.scrollHeight - window.innerHeight);
        if(maxY < 2){ root.classList.remove('seen-idle-scrolling'); return; }
        var from = window.scrollY;
        if(from >= maxY - 1) direction = -1;
        else if(from <= 1) direction = 1;
        var to = direction > 0 ? maxY : 0;
        var distance = to - from;
        // Explicitly requested idle scrolling remains available with reduced motion;
        // use a gentler speed, rather than silently disabling it altogether.
        var rampTime = reducedMotion.matches ? 1800 : 1200;
        var travelSpeed = reducedMotion.matches ? pixelsPerSecond * 0.7 : pixelsPerSecond;
        var duration = Math.max(3000, Math.abs(distance) / travelSpeed * 1000 + rampTime);
        var ramp = Math.min(rampTime, duration / 2);
        var speed = Math.abs(distance) / (duration - ramp);
        var started = performance.now();

        function tick(now){
            if(blocked() || isProgrammaticScrolling || wheelTweenRunning){
                activity();
                return;
            }
            var elapsed = Math.min(duration, Math.max(0, now - started));
            // Cosine velocity ramps at the edges, steady readable speed in between.
            function rampDistance(time){
                return speed * (time / 2 - ramp * Math.sin(Math.PI * time / ramp) / (2 * Math.PI));
            }
            var travel = elapsed < ramp ? rampDistance(elapsed) :
                elapsed > duration - ramp ? Math.abs(distance) - rampDistance(duration - elapsed) :
                speed * (elapsed - ramp / 2);
            window.scrollTo({ top: from + Math.sign(distance) * travel, behavior: 'instant' });
            if(elapsed < duration) frame = requestAnimationFrame(tick);
            else {
                frame = null;
                // Lazy-loaded content may have extended the page during this leg.
                if(direction < 0 || window.scrollY >= scroller.scrollHeight - window.innerHeight - 1) direction *= -1;
                start();
            }
        }
        root.classList.add('seen-idle-scrolling');
        frame = requestAnimationFrame(tick);
    }

    // Do not count our own scroll events as activity. Actual input cancels immediately.
    function pointerActivity(event){
        // Scrolling/hover retargeting can emit move events under a stationary cursor.
        // Only actual coordinate changes count; pointer+mouse duplicates count once.
        if(pointerPosition && pointerPosition.x === event.clientX && pointerPosition.y === event.clientY) return;
        pointerPosition = { x: event.clientX, y: event.clientY };
        activity();
    }
    ['pointermove', 'mousemove'].forEach(function(name){
        window.addEventListener(name, pointerActivity, { capture: true, passive: true });
    });
    ['wheel', 'keydown', 'keyup', 'click', 'input'].forEach(function(name){
        window.addEventListener(name, activity, { capture: true, passive: true });
    });
    window.addEventListener('pointerdown', function(event){ heldPointers.add(event.pointerId); activity(); }, { capture: true, passive: true });
    ['pointerup', 'pointercancel'].forEach(function(name){
        window.addEventListener(name, function(event){ heldPointers.delete(event.pointerId); activity(); }, { capture: true, passive: true });
    });
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function(name){
        window.addEventListener(name, function(event){ touching = event.touches.length > 0; activity(); }, { capture: true, passive: true });
    });
    window.addEventListener('blur', function(){ heldPointers.clear(); touching = false; activity(); });
    ['focus', 'pageshow', 'resize'].forEach(function(name){ window.addEventListener(name, activity); });
    window.addEventListener('pagehide', stop);
    document.addEventListener('visibilitychange', activity);
    document.addEventListener('focusin', activity);
    document.addEventListener('focusout', activity);
    reducedMotion.addEventListener('change', activity);
    var wasBlocked = !!blocked();
    var modalObserver = new MutationObserver(function(){
        var nowBlocked = !!blocked();
        if(nowBlocked !== wasBlocked){ wasBlocked = nowBlocked; activity(); }
    });
    [root, document.body].concat(Array.from(document.querySelectorAll('dialog,[id$="-modal"],.modal'))).forEach(function(element){
        modalObserver.observe(element, { attributes: true, attributeFilter: ['class', 'open', 'style'] });
    });
    schedule();
})();

window.addEventListener('paste',function(e){
    if(isAnyModalOrPopupActive()) return;
    var target = e.target;
    if(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable || (target.closest && target.closest('input, textarea, [contenteditable="true"]')))){
        return;
    }
    if(!e.clipboardData)return;
    var items=e.clipboardData.items;
    var imageItem=null;
    for(var i=0;i<items.length;i++){
        if(items[i].type.indexOf('image')!==-1){
            imageItem=items[i];
            break;
        }
    }
    var now=new Date();
    var pad=function(n){return n<10?'0'+n:n;};
    var timestamp=now.getFullYear()+''+pad(now.getMonth()+1)+''+pad(now.getDate())+'_'+pad(now.getHours())+''+pad(now.getMinutes())+''+pad(now.getSeconds());

    if(imageItem){
        var file=imageItem.getAsFile();
        if(file){
            var ext='png';
            if(file.type==='image/jpeg')ext='jpg';
            else if(file.type==='image/webp')ext='webp';
            else if(file.type==='image/png')ext='png';
            else if(file.name&&file.name.indexOf('.')!==-1){
                ext=file.name.split('.').pop();
            }
            var url=URL.createObjectURL(file);
            var a=document.createElement('a');
            a.href=url;
            a.download='pasted_image_'+timestamp+'.'+ext;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function(){URL.revokeObjectURL(url);},2000);
            return;
        }
    }

    var text=e.clipboardData.getData('text/plain')||e.clipboardData.getData('text');
    if(text&&text.trim().length>0){
        var blob=new Blob([text],{type:'text/plain;charset=utf-8'});
        var url=URL.createObjectURL(blob);
        var a=document.createElement('a');
        a.href=url;
        a.download='pasted_text_'+timestamp+'.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function(){URL.revokeObjectURL(url);},2000);
    }
});




// Wheel, touch and keyboard scrolling use the browser's native input handling.


// Continuous Dynamic Starfield with Ambient Motion & Comet Trails on Scroll.
// Ultra-Low Overhead: Batched paths, LUT trigonometry, zero string allocations, hardware-composited canvas.
(function initInteractiveStarfield(){
    var canvas = document.getElementById('space-stars-canvas');
    if(!canvas) return;
    // The page behind the stars is solid black; an opaque surface avoids
    // blending a full-screen transparent texture on every animation frame.
    var ctx = canvas.getContext('2d', {alpha: false});
    if(!ctx) return;

    var stars = [];
    var paletteStars = [[], [], []];
    var TOUCH = window.matchMedia('(pointer: coarse)').matches;
    var baseSpeed = 0.85;
    var scrollVelocity = 0;
    var rafId = null;
    var wakeTimer = null;
    var lastPaint = 0;
    var lastScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    var w = 0, h = 0, dpr = 1;
    var resizeTimer = null;

    // Fast PRNG for consistent initial placement
    function mulberry32(a){
        return function(){
            var t = a += 0x6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    // Precomputed Sine LUT for twinkling (32 steps, 0 Math.sin calls per frame)
    var SINE_LUT = new Float32Array(32);
    for(var i = 0; i < 32; i++){
        SINE_LUT[i] = Math.sin((i / 32) * 6.2831853) * 0.16;
    }

    // Precomputed RGBA strings: 3 color palettes (white, cyan, lavender) x 21 alpha steps
    // Completely eliminates string concatenation and GC churn during animation frames!
    var COLOR_STRINGS = [[], [], []];
    var rgbBases = ['255, 255, 255', '186, 230, 253', '221, 214, 254'];
    for(var p = 0; p < 3; p++){
        for(var a = 0; a <= 20; a++){
            COLOR_STRINGS[p][a] = 'rgba(' + rgbBases[p] + ', ' + (a * 0.05).toFixed(2) + ')';
        }
    }
    // Precomputed pure white head colors
    var WHITE_HEADS = [];
    for(var a = 0; a <= 20; a++){
        WHITE_HEADS[a] = 'rgba(255, 255, 255, ' + (a * 0.05).toFixed(2) + ')';
    }

    function createStar(width, height, rng, startAtBottom){
        var roll = rng();
        var r, alpha, speedMult, tailMult;
        var isMobile = width < 768;
        var minR = isMobile ? 0.90 : 0.65;

        // 3 depth tiers: distant (60%), mid-depth (30%), foreground (10%)
        if(roll < 0.60){
            r = minR + rng() * 0.35;
            alpha = 0.55 + rng() * 0.25;
            speedMult = 0.75 + rng() * 0.35;
            tailMult = 1.4 + rng() * 0.8;
        } else if(roll < 0.90){
            r = (minR + 0.35) + rng() * 0.40;
            alpha = 0.75 + rng() * 0.20;
            speedMult = 1.05 + rng() * 0.40;
            tailMult = 2.1 + rng() * 0.9;
        } else {
            r = (minR + 0.80) + rng() * 0.55;
            alpha = 0.95 + rng() * 0.05;
            speedMult = 1.45 + rng() * 0.50;
            tailMult = 2.9 + rng() * 1.1;
        }

        // Color tints matching the website theme:
        var colorRoll = rng();
        var palette = 0; // white
        if(colorRoll < 0.16){
            palette = 1; // cyan
        } else if(colorRoll < 0.26){
            palette = 2; // lavender
        }

        return {
            x: rng() * width,
            y: startAtBottom ? (height + 5 + rng() * 35) : (rng() * height),
            r: r,
            alpha: alpha,
            phase: (rng() * 32) | 0,
            step: rng() > 0.5 ? 1 : 2,
            palette: palette,
            speedMult: speedMult,
            tailMult: tailMult
        };
    }

    function initStars(){
        var rng = mulberry32(88812345);
        // Optimized density: rich visuals with minimal draw-call count
        var count = Math.max(40, Math.min(100, Math.round(w * h / 16000)));
        stars = [];
        for(var i = 0; i < count; i++){
            stars.push(createStar(w, h, rng, false));
        }
    }

    function resizeCanvas(){
        var oldW = w;
        var oldH = h;
        var newW = window.innerWidth;
        var newH = window.innerHeight;

        // On mobile, if only height changed slightly due to address bar show/hide, avoid clearing canvas
        if(oldW > 0 && newW === oldW && Math.abs(newH - oldH) < 140){
            h = newH;
            canvas.style.setProperty('--starfield-height', h + 'px');
            return;
        }

        w = newW;
        h = newH;
        canvas.style.setProperty('--starfield-width', w + 'px');
        canvas.style.setProperty('--starfield-height', h + 'px');
        // This is a decorative backdrop. Keep text/photos at native resolution,
        // but bound its full-screen surface even on high-DPI and 4K displays.
        dpr = Math.min(window.devicePixelRatio || 1, 1, Math.sqrt(1600000 / (w * h)));
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        if(stars.length === 0){
            initStars();
        } else if(oldW > 0 && oldH > 0){
            var scaleX = w / oldW;
            var scaleY = h / oldH;
            for(var i = 0; i < stars.length; i++){
                stars[i].x *= scaleX;
                stars[i].y *= scaleY;
            }
            var targetCount = Math.max(40, Math.min(100, Math.round(w * h / 16000)));
            var rng = Math.random;
            while(stars.length < targetCount){
                stars.push(createStar(w, h, rng, false));
            }
            if(stars.length > targetCount){
                stars.length = targetCount;
            }
        }
        // Palette membership is static until the viewport changes.
        for(var p = 0; p < paletteStars.length; p++) paletteStars[p].length = 0;
        for(var i = 0; i < stars.length; i++) paletteStars[stars[i].palette].push(stars[i]);
    }

    // Three reusable gradient strips replace a new gradient per comet per frame.
    var trails = document.createElement('canvas');
    trails.width = 3; trails.height = 96;
    var trailContext = trails.getContext('2d');
    for(var palette = 0; palette < 3; palette++){
        var gradient = trailContext.createLinearGradient(0, 0, 0, 96);
        gradient.addColorStop(0, COLOR_STRINGS[palette][20]);
        gradient.addColorStop(.35, COLOR_STRINGS[palette][9]);
        gradient.addColorStop(1, COLOR_STRINGS[palette][0]);
        trailContext.fillStyle = gradient;
        trailContext.fillRect(palette, 0, 1, 96);
    }

    function render(frameStep){
        ctx.clearRect(0, 0, w, h);

        var totalSpeed = baseSpeed + scrollVelocity;
        var hasTails = scrollVelocity > (TOUCH ? 2.5 : 1.2);

        if(!hasTails){
            // AMBIENT DRIFT MODE (99% of browsing time):
            // Ultra-fast batched drawing: group stars into 3 color palettes.
            // Result: only 3 path constructions and 3 fill calls per frame!
            // Reuse pre-grouped stars; no arrays or palette sorting per frame.
            var p0 = paletteStars[0], p1 = paletteStars[1], p2 = paletteStars[2];
            for(var i = 0; i < stars.length; i++){
                var s = stars[i];
                s.y -= totalSpeed * s.speedMult * frameStep;
                if(s.y < -5){
                    s.y = h + 10 + Math.random() * 20;
                    s.x = Math.random() * w;
                }
                s.phase = (s.phase + s.step) & 31;
            }

            // Draw white stars in 1 batch
            if(p0.length > 0){
                ctx.fillStyle = COLOR_STRINGS[0][17]; // ~0.85 alpha
                ctx.beginPath();
                for(var j = 0; j < p0.length; j++){
                    var st = p0[j];
                    ctx.moveTo(st.x + st.r, st.y);
                    ctx.arc(st.x, st.y, st.r, 0, 6.2831853);
                }
                ctx.fill();
            }
            // Draw cyan stars in 1 batch
            if(p1.length > 0){
                ctx.fillStyle = COLOR_STRINGS[1][16]; // ~0.80 alpha
                ctx.beginPath();
                for(var j = 0; j < p1.length; j++){
                    var st = p1[j];
                    ctx.moveTo(st.x + st.r, st.y);
                    ctx.arc(st.x, st.y, st.r, 0, 6.2831853);
                }
                ctx.fill();
            }
            // Draw lavender stars in 1 batch
            if(p2.length > 0){
                ctx.fillStyle = COLOR_STRINGS[2][16]; // ~0.80 alpha
                ctx.beginPath();
                for(var j = 0; j < p2.length; j++){
                    var st = p2[j];
                    ctx.moveTo(st.x + st.r, st.y);
                    ctx.arc(st.x, st.y, st.r, 0, 6.2831853);
                }
                ctx.fill();
            }
            return;
        }

        // SCROLL ACCELERATION MODE: Stars accelerate upward with luminous comet tails
        for(var i = 0; i < stars.length; i++){
            var s = stars[i];
            var speed = totalSpeed * s.speedMult;
            s.y -= speed * frameStep;

            var tailLen = Math.min(80, scrollVelocity * s.speedMult * s.tailMult);

            if(s.y + tailLen < -10){
                s.y = h + 10 + Math.random() * 25;
                s.x = Math.random() * w;
                continue;
            } else if(s.y > h + 25){
                s.y = -10;
                s.x = Math.random() * w;
                continue;
            }

            s.phase = (s.phase + s.step) & 31;
            var twinkle = SINE_LUT[s.phase];
            var rawAlpha = s.alpha + twinkle;
            var alphaIdx = Math.max(3, Math.min(20, Math.round(rawAlpha * 20)));

            // Draw comet tail if noticeable during scroll
            if(tailLen >= 1.5){
                var tailWidth = Math.max(1, s.r * 1.4);
                ctx.globalAlpha = alphaIdx / 20;
                ctx.drawImage(trails, s.palette, 0, 1, 96, s.x - tailWidth / 2, s.y, tailWidth, tailLen);
                ctx.globalAlpha = 1;
            }

            // Draw star head
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, 6.2831853);
            ctx.fillStyle = tailLen >= 1.5 ? WHITE_HEADS[Math.min(20, alphaIdx + 3)] : COLOR_STRINGS[s.palette][alphaIdx];
            ctx.fill();
        }
    }

    function loop(now){
        rafId = null;
        if(document.hidden){
            return;
        }
        var elapsed = lastPaint ? Math.min(100, now - lastPaint) : 1000 / 60;
        lastPaint = now;
        var frameStep = elapsed / (1000 / 60);
        // Time-based movement is consistent on 60/120/240 Hz monitors.
        scrollVelocity *= Math.pow(0.92, frameStep);
        if(scrollVelocity < 0.005) scrollVelocity = 0;

        render(frameStep);
        rafId = requestAnimationFrame(loop);
    }

    function startLoop(){
        if(rafId === null && !document.hidden){
            rafId = requestAnimationFrame(loop);
        }
    }

    function stopLoop(){
        lastPaint = 0;
        if(rafId){
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    }


    function onScroll(){
        var currentY = window.pageYOffset || document.documentElement.scrollTop || 0;
        var deltaY = currentY - lastScrollY;
        lastScrollY = currentY;

        // Trigger tails and upward flight on scroll DOWN
        if(deltaY > 0){
            scrollVelocity = Math.min(scrollVelocity + deltaY * 0.20, 28);
        } else if(deltaY < 0){
            scrollVelocity = Math.max(0, scrollVelocity - Math.abs(deltaY) * 0.15);
        }
        startLoop();
    }

    // Touch gesture acceleration for mobile devices (matches PC mouse wheel response)
    var touchStartY = 0;
    var touchActive = false;
    window.addEventListener('touchstart', function(e){
        if(e.touches && e.touches[0]){
            touchStartY = e.touches[0].clientY;
            touchActive = true;
        }
    }, {passive: true});

    window.addEventListener('touchmove', function(e){
        if(!touchActive || !e.touches || !e.touches[0]) return;
        var currentY = e.touches[0].clientY;
        var delta = touchStartY - currentY; // positive when dragging finger up (scrolling down)
        touchStartY = currentY;
        if(delta > 0){
            scrollVelocity = Math.min(scrollVelocity + delta * 0.28, 28);
            startLoop();
        } else if(delta < 0){
            scrollVelocity = Math.max(0, scrollVelocity - Math.abs(delta) * 0.15);
        }
    }, {passive: true});

    window.addEventListener('touchend', function(){
        touchActive = false;
    }, {passive: true});
    window.addEventListener('touchcancel', function(){
        touchActive = false;
    }, {passive: true});

    resizeCanvas();
    startLoop();

    window.addEventListener('resize', function(){
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function(){
            resizeCanvas();
            startLoop();
        }, 150);
    }, {passive: true});

    window.addEventListener('scroll', onScroll, {passive: true});

    // Auto pause when tab is in background, resume when tab is active
    document.addEventListener('visibilitychange', function(){
        if(document.hidden){
            stopLoop();
        } else {
            startLoop();
        }
    });

    // Mobile app lifecycle resumption
    window.addEventListener('pagehide', stopLoop, {passive: true});
    window.addEventListener('pageshow', startLoop, {passive: true});
    window.addEventListener('focus', startLoop, {passive: true});
})();

// Start every visit at the top; a history snapshot must also fetch a new page.
window.scrollTo({top:0, left:0, behavior:'instant'});
window.addEventListener('pageshow', function(event){
    if(event.persisted){ location.reload(); return; }
    window.scrollTo({top:0, left:0, behavior:'instant'});
});

})();
