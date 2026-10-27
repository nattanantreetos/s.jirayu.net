(function(){
  'use strict';
  var root=document.documentElement, portfolio=document.querySelector('main.bento');
  if(!portfolio)return;
  var button=document.createElement('button');
  button.type='button';button.id='section-step';button.className='section-step';
  button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v16M5 13l7 7 7-7"/></svg>';
  document.body.appendChild(button);
  var positions=[], maxY=0, pending=null, updateFrame=null, measureFrame=null;
  var hovered=false, focused=false;
  function layoutTop(element){var top=0;for(var node=element;node;node=node.offsetParent)top+=node.offsetTop;return top;}
  function measure(){
    maxY=Math.max(0,(document.scrollingElement||root).scrollHeight-window.innerHeight);
    var header=document.querySelector('.site-header');
    var offset=Math.max(20,header ? header.getBoundingClientRect().bottom+18 : 65);
    positions=Array.from(portfolio.children).filter(function(el){return el.getClientRects().length&&el.offsetHeight>0;}).map(function(el){
      var heading=el.querySelector('h1,h2,h3,.item-label');
      return {element:el,name:heading?heading.textContent.trim().replace(/\s+/g,' ').slice(0,80):'',y:el.id==='hero-section'?0:Math.max(0,Math.min(maxY,layoutTop(el)-offset))};
    }).sort(function(a,b){return a.y-b.y;}).filter(function(item,index,all){return !index||Math.abs(item.y-all[index-1].y)>8;});
    if(pending!==null)pending=Math.min(pending,maxY);
    update();
  }
  function scheduleMeasure(){if(measureFrame!==null)return;measureFrame=requestAnimationFrame(function(){measureFrame=null;measure();});}
  function nextTarget(base){return positions.find(function(item){return item.y>base+12;})||{element:null,y:maxY};}
  function update(){
    var y=window.scrollY, atBottom=maxY>0&&y>=maxY-4;
    if(pending!==null&&Math.abs(y-pending)<3)pending=null;
    var busy=String(pending!==null);
    if(button.getAttribute('aria-busy')!==busy)button.setAttribute('aria-busy',busy);
    var returning=atBottom||(pending===0&&y>4);
    button.hidden=maxY<2||root.classList.contains('modal-active')||Boolean(document.querySelector('dialog[open]'));
    button.classList.toggle('is-top',returning);
    var english=root.lang==='en';
    var target=nextTarget(y), name=target.name||'';
    var label=returning?(english?'Back to top':'กลับขึ้นด้านบน'):(english?'Next section':'เลื่อนไปหมวดถัดไป');
    if(!returning&&name)label+=': '+name;
    if(button.getAttribute('aria-label')!==label){button.setAttribute('aria-label',label);button.title=label;}
    button.dataset.direction=returning?'up':'down';
    button.dataset.target=returning?'hero-section':target.element?.id||'page-bottom';
  }
  function scheduleUpdate(){if(updateFrame!==null)return;updateFrame=requestAnimationFrame(function(){updateFrame=null;update();});}
  button.addEventListener('click',function(){
    // Remeasure layout, then use the previous requested destination for quick repeated taps.
    measure();
    var bottom=window.scrollY>=maxY-4;
    var destination=(bottom||pending===0)?0:nextTarget(pending===null?window.scrollY:Math.max(window.scrollY,pending)).y;
    pending=destination;
    // This button explicitly requests a visible animated journey. Keep passive
    // effects under the OS motion preference, but do not turn this click into a jump.
    if(typeof smoothScrollTo==='function')smoothScrollTo(destination,false,{
      duration:Math.min(1100,720+Math.abs(destination-window.scrollY)/12),easing:'in-out'
    });
    else window.scrollTo({top:destination,behavior:'smooth'});
    scheduleUpdate();
  });
  function engaged(){root.classList.toggle('section-nav-engaged',hovered||focused);}
  button.addEventListener('pointerenter',function(event){if(event.pointerType!=='touch'){hovered=true;engaged();}});
  button.addEventListener('pointerleave',function(){hovered=false;engaged();});
  button.addEventListener('focus',function(){focused=button.matches(':focus-visible');engaged();});
  button.addEventListener('keydown',function(){focused=true;engaged();});
  button.addEventListener('blur',function(){focused=false;engaged();});
  window.addEventListener('scroll',scheduleUpdate,{passive:true});
  window.addEventListener('resize',scheduleMeasure,{passive:true});
  window.addEventListener('load',scheduleMeasure,{once:true});
  function clearPending(){pending=null;scheduleUpdate();}
  window.addEventListener('pointerdown',function(event){if(!button.contains(event.target))clearPending();},{passive:true});
  window.addEventListener('wheel',clearPending,{passive:true});
  window.addEventListener('touchstart',function(event){if(!button.contains(event.target))clearPending();},{passive:true});
  window.addEventListener('keydown',function(event){if(/^(ArrowDown|ArrowUp|PageDown|PageUp|Home|End| )$/.test(event.key)&&event.target!==button)clearPending();});
  document.addEventListener('visibilitychange',function(){if(document.hidden)clearPending();});
  new MutationObserver(function(records){
    if(records.some(function(record){return record.attributeName==='lang';}))scheduleMeasure();
    else scheduleUpdate();
  }).observe(root,{attributes:true,attributeFilter:['lang','class']});
  new MutationObserver(scheduleUpdate).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
  if('ResizeObserver' in window)new ResizeObserver(scheduleMeasure).observe(portfolio);
  document.fonts?.ready.then(scheduleMeasure);
  measure();
})();
