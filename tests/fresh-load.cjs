// Real browser/server regression check for network-only visits and staged reveal.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const vm = require('node:vm');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const probe=net.createServer(); probe.listen(0,'127.0.0.1'); await once(probe,'listening');
  const port=probe.address().port; await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,[path.join(root,'server.js')],{env:{...process.env,PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let browser;
  try {
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Server did not start');})]);
    const origin=`http://127.0.0.1:${port}`;
    for(const file of ['/', '/FC-Mittraphap.woff2?fresh=114', '/1778995068748.webp?fresh=114', '/sw.js']) {
      const response=await fetch(origin+file,{headers:{'If-None-Match':'*','If-Modified-Since':new Date().toUTCString()}});
      assert.equal(response.status,200);
      assert.match(response.headers.get('cache-control'),/no-store/);
      assert.equal(response.headers.get('etag'),null);
      await response.arrayBuffer();
    }
    browser=await chromium.launch({...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),headless:true});
    for(const mobile of [false,true]) {
      const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},isMobile:mobile,hasTouch:mobile});
      const page=await context.newPage();const errors=[];const responses=[];
      page.on('pageerror',e=>errors.push(e.message));
      page.on('response',r=>responses.push(r.url()));
      await page.addInitScript(()=>{
        window.revealTimes=[];const seen=new WeakSet();
        new MutationObserver(entries=>{for(const {target} of entries){
          if(target.matches?.('.bento > .load-ready')&&!seen.has(target)){seen.add(target);window.revealTimes.push(performance.now());}
        }}).observe(document,{subtree:true,attributes:true,attributeFilter:['class']});
      });
      await page.goto(origin,{waitUntil:'load'});
      await page.waitForTimeout(1200);
      assert.equal(await page.evaluate(()=>scrollY),0);
      const initial=await page.evaluate(()=>({ready:document.querySelectorAll('.bento > .load-ready').length,total:document.querySelectorAll('.bento > .item, .bento > .footer').length,times:window.revealTimes}));
      assert(initial.ready>0&&initial.ready<initial.total,'Only initial sections revealed');
      assert(initial.times.length>=2&&initial.times[1]-initial.times[0]>=95,'Sections appear in staggered sequence');
      assert(!responses.some(url=>url.includes('certificate-soft-power.webp')),'Distant certificate image is not requested on entry');
      assert.equal(await page.evaluate(async()=> (await navigator.serviceWorker.getRegistrations()).length),0);
      await page.locator('#btn-lang-en').click();
      assert.equal(await page.locator('html').getAttribute('lang'),'en');
      assert(await page.locator('#t-food-lbl').evaluate(el=>el.getAnimations().length>0),'Language change dissolves visible text');
      await page.waitForTimeout(850);
      assert.equal(await page.locator('#t-food-lbl').textContent(),'Favorite Food');
      await page.evaluate(()=>{setLanguage('th');setLanguage('en');setLanguage('th');});
      await page.waitForTimeout(850);
      assert.equal(await page.locator('#t-food-lbl').textContent(),'อาหารที่ชอบ','Last language wins during rapid switches');
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.evaluate(()=>setLanguage('en'));
      assert(await page.locator('#t-food-lbl').evaluate(el=>el.getAnimations().length>0),'Reduced motion keeps a gentle fade');
      await page.waitForTimeout(400);
      assert.equal(await page.locator('#t-food-lbl').textContent(),'Favorite Food');
      assert.equal(await page.locator('#t-food-lbl').evaluate(el=>el.getAnimations().length),0);
      await page.emulateMedia({reducedMotion:'no-preference'});
      await page.evaluate(async()=>{
        localStorage.setItem('user_lang','en');
        const old=await caches.open('seen-v999'); await old.put('/old-page',new Response('old'));
        const unrelated=await caches.open('unrelated-test'); await unrelated.put('/other',new Response('keep'));
      });
      await page.reload({waitUntil:'load'});
      await page.evaluate(()=>window.__seenCacheCleanup);
      await page.waitForTimeout(1100);
      assert.equal(await page.locator('html').getAttribute('lang'),'th');
      assert.equal(await page.evaluate(()=>localStorage.getItem('user_lang')),null);
      assert.deepEqual(await page.evaluate(()=>caches.keys()),['unrelated-test']);
      const assets=await page.evaluate(()=>performance.getEntriesByType('resource').filter(e=>/1778995068748|FC-Mittraphap/.test(e.name)).map(e=>({name:e.name,bytes:e.transferSize})));
      assert(assets.length>=2&&assets.every(e=>e.bytes>0),'Hero and font fetched from network on reload');
      await page.locator('#btn-nav-certificates').click(); await page.waitForTimeout(1800);
      await page.waitForFunction(()=>{const img=document.querySelector('.certificate-card img');return img.complete&&img.naturalWidth>0;});
      assert(await page.locator('#certificates-section').evaluate(el=>el.classList.contains('load-ready')));
      await page.locator('#btn-nav-dl').click(); await page.waitForTimeout(1800);
      assert.equal(await page.locator('#downloads-section a[download]').count(),4);
      assert.equal(errors.length,0,errors.join('; '));
      console.log(JSON.stringify({device:mobile?'mobile':'desktop',initial,assets,errors}));
      await context.close();
    }
    const listeners={},deleted=[];let claimed=false,unregistered=false;
    vm.runInNewContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),{
      self:{addEventListener:(name,fn)=>listeners[name]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{claimed=true;}},registration:{unregister:async()=>{unregistered=true;}}},
      caches:{keys:async()=>['seen-v1','seen-v113','unrelated'],delete:async key=>deleted.push(key)}
    });
    let activation;listeners.activate({waitUntil:p=>activation=p});await activation;
    assert.deepEqual(deleted,['seen-v1','seen-v113']);assert(claimed&&unregistered);assert(!listeners.fetch);
    console.log('PASS: no-store responses, real network reloads, selective cleanup, staggered/lazy sections, language reset, retiring worker.');
  } finally {
    if(browser)await browser.close();
    if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
