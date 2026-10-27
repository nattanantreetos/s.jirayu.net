// Pixel comparison against a saved page: node tests/starfield-visual.cjs <baseline.html>
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
function starfield(html) {
  const start = html.indexOf('(function initInteractiveStarfield(){');
  const end = html.indexOf("if('serviceWorker' in navigator)", start);
  assert(start >= 0 && end > start);
  return html.slice(start, end).trim();
}
const before = fs.readFileSync(process.argv[2], 'utf8');
const after = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
assert.equal(after.match(/<style>[\s\S]*?<\/style>/)[0], before.match(/<style>[\s\S]*?<\/style>/)[0], 'CSS is unchanged');
const stripScripts = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
assert.equal(stripScripts(after), stripScripts(before), 'All markup, text, assets, and inline event handlers are unchanged');
(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}), headless:true });
  try {
    const page = await browser.newPage();
    const result = await page.evaluate(({ before, after }) => {
      function create(source, width, height, dpr) {
        const canvas = document.createElement('canvas');
        const events = {}, docEvents = {};
        const win = {innerWidth:width, innerHeight:height, devicePixelRatio:dpr, pageYOffset:0,
          addEventListener(name, callback) {(events[name] ||= []).push(callback);} };
        const doc = {hidden:false, documentElement:{scrollTop:0}, getElementById:() => canvas,
          addEventListener(name, callback) {(docEvents[name] ||= []).push(callback);} };
        let callback, id = 0, seed = 987654321, timer;
        const math = Object.create(Math);
        math.random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296;};
        new Function('window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'Math', source)(
          win, doc, fn => {callback = fn; return ++id;}, () => {callback = null;}, fn => {timer = fn; return 1;}, () => {timer = null;}, math);
        return {canvas, win, doc, frame() {const fn = callback; callback = null; if(fn) fn(16.666 * id);},
          emit(name, event = {}) {for(const fn of events[name] || []) fn(event);},
          visibility(hidden) {doc.hidden = hidden; for(const fn of docEvents.visibilitychange || []) fn();},
          resize(w, h) {win.innerWidth = w; win.innerHeight = h; for(const fn of events.resize || []) fn(); if(timer) {const fn = timer; timer = null; fn();}},
          pending() {return !!callback;}};
      }
      const samples = [];
      for(const [width, height, dpr] of [[1440,900,1], [390,844,2]]) {
        const a = create(before, width, height, dpr), b = create(after, width, height, dpr);
        let compared = 0, differences = 0, maxChannelDifference = 0;
        for(let frame = 0; frame < 150; frame++) {
          if(frame === 20 || frame === 45 || frame === 80) {
            a.win.pageYOffset += 240; b.win.pageYOffset += 240;
            a.emit('scroll'); b.emit('scroll');
          }
          if(frame === 55) {a.resize(width + 100, height + 150); b.resize(width + 100, height + 150);}
          a.frame(); b.frame();
          if(frame % 10 === 0 || frame === 56 || frame === 149) {
            const left = a.canvas.getContext('2d').getImageData(0,0,a.canvas.width,a.canvas.height).data;
            const right = b.canvas.getContext('2d').getImageData(0,0,b.canvas.width,b.canvas.height).data;
            if(left.length !== right.length) throw Error('Canvas size changed');
            for(let i = 0; i < left.length; i++) {const delta = Math.abs(left[i]-right[i]); if(delta) differences++; maxChannelDifference = Math.max(maxChannelDifference, delta);}
            compared++;
          }
        }
        b.visibility(true); b.emit('focus'); b.emit('scroll');
        if(b.pending()) throw Error('Hidden tab restarted starfield');
        b.visibility(false);
        if(!b.pending()) throw Error('Visible tab did not resume starfield');
        samples.push({width, height, compared, differences, maxChannelDifference});
      }
      return samples;
    }, {before:starfield(before), after:starfield(after)});
    console.log(JSON.stringify(result, null, 2));
    assert.ok(result.every(sample => sample.differences === 0), 'Animation pixels must match the user baseline exactly');
    console.log('PASS: markup/CSS unchanged, animation pixels identical, hidden-tab pause/resume intact.');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
