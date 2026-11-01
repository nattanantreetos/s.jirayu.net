// Entry intro: black screen, the Seen signature draws itself in white, then dissolves into the page.
(function(){
    var overlay = document.getElementById('intro-overlay');
    var svg = document.getElementById('intro-svg');
    var writer = document.getElementById('intro-writer');
    var pen = document.getElementById('intro-pen');
    if(!overlay || !svg || !writer || !pen) return;
    if(!document.documentElement.classList.contains('page-loading')){ overlay.remove(); return; }

    window.__introHold = true;
    document.documentElement.style.overflow = 'hidden';

    var DRAW = 3000, HOLD = 500, FADE = 900;
    var total = writer.getTotalLength();
    writer.style.strokeDasharray = total;
    writer.style.strokeDashoffset = total;
    var start = null, finished = false;

    function ease(p){ return p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }

    function frame(now){
        if(start === null) start = now;
        var p = Math.min(1, (now - start) / DRAW);
        var e = ease(p);
        writer.style.strokeDashoffset = String(total * (1 - e));
        var point = writer.getPointAtLength(e * total);
        pen.setAttribute('cx', point.x);
        pen.setAttribute('cy', point.y);
        pen.setAttribute('opacity', p > 0.005 ? '1' : '0');
        if(p < 1) window.requestAnimationFrame(frame);
        else window.setTimeout(dissolve, HOLD);
    }

    function dissolve(){
        if(finished) return;
        finished = true;
        window.__introHold = false;
        if(window.__seenIntroRelease) window.__seenIntroRelease();
        document.documentElement.style.overflow = '';
        overlay.style.pointerEvents = 'none';
        pen.setAttribute('opacity', '0');
        svg.animate([
            {transform:'scale(1)', opacity:1, filter:'blur(0px)'},
            {transform:'scale(1.06)', opacity:0, filter:'blur(7px)'}
        ], {duration:700, easing:'ease', fill:'forwards'});
        var fade = overlay.animate([{opacity:1},{opacity:0}], {duration:FADE, easing:'ease', fill:'forwards'});
        fade.onfinish = function(){ overlay.remove(); };
        window.setTimeout(function(){ if(overlay.parentNode) overlay.remove(); }, FADE + 300);
    }

    // Fail open: a stalled tab or blocked animation must never trap the visitor.
    window.setTimeout(dissolve, DRAW + HOLD + 2500);
    window.requestAnimationFrame(frame);
})();