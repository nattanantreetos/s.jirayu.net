// Check rendered intermediate styles, not just animation existence.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const port=probe.address().port;await new Promise(r=>probe.close(r));
  const server=spawn(process.execPath,[path.resolve(__dirname,'../web/server.js')],{env:{...process.env,PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let browser;
  const shots=fs.mkdtempSync(path.join(os.tmpdir(),'seen-language-'));
  try{
    await Promise.race([once(server.stdout,'data'),once(server,'exit').then(()=>{throw Error('Server exited');})]);
    browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
    for(const width of [1440,390])for(const reducedMotion of ['no-preference','reduce']){
      const page=await browser.newPage({viewport:{width,height:900},reducedMotion});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${port}`);await page.waitForTimeout(1200);
      const label=page.locator('#t-nav-home');
      assert.equal(await label.textContent(),'หน้าหลัก');
      // Pause each outgoing animation immediately after the actual click handler runs.
      await page.evaluate(()=>document.querySelector('#btn-lang-en').addEventListener('click',()=>{
        document.getAnimations().filter(a=>a.effect?.target?.id?.startsWith('t-')).forEach(a=>{a.pause();a.currentTime=a.effect.getTiming().duration*.6;});
      },{once:true}));
      await page.locator('#btn-lang-en').click();
      const mid=await label.evaluate(el=>({text:el.textContent,opacity:+getComputedStyle(el).opacity,filter:getComputedStyle(el).filter}));
      assert.equal(mid.text,'หน้าหลัก','Old text remains during outgoing phase');
      assert(mid.opacity>0&&mid.opacity<.7,JSON.stringify(mid));
      if(reducedMotion==='reduce')assert.equal(mid.filter,'none');
      else assert.match(mid.filter,/blur\([1-6]/);
      if(reducedMotion==='no-preference')await page.screenshot({path:path.join(shots,`${width}-dissolve.png`)});
      await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='paused').forEach(a=>a.finish()));
      const incoming=await label.evaluate(el=>{
        const a=el.getAnimations()[0];a.pause();a.currentTime=a.effect.getTiming().duration*.4;
        return {text:el.textContent,opacity:+getComputedStyle(el).opacity};
      });
      assert.equal(incoming.text,'Home');assert(incoming.opacity>0&&incoming.opacity<1);
      await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='paused').forEach(a=>a.play()));
      await page.waitForTimeout(850);
      assert.equal(await label.evaluate(el=>getComputedStyle(el).opacity),'1');
      assert.equal(await label.evaluate(el=>el.getAnimations().length),0);
      await page.evaluate(()=>setLanguage('th'));await page.waitForTimeout(100);
      await page.evaluate(()=>setLanguage('en'));await page.waitForTimeout(100);
      await page.evaluate(()=>setLanguage('th'));await page.waitForTimeout(850);
      assert.equal(await label.textContent(),'หน้าหลัก');
      assert.equal(await page.locator('#t-food-lbl').textContent(),'อาหารที่ชอบ');
      assert.deepEqual(errors,[]);
      if(reducedMotion==='no-preference')await page.screenshot({path:path.join(shots,`${width}-settled.png`)});
      console.log(JSON.stringify({width,reducedMotion,mid,incoming,errors}));
      await page.close();
    }
    console.log('PASS: outgoing Thai, incoming English, actual intermediate opacity/blur, rapid reversal, reduced-motion fade. Screenshots: '+shots);
  }finally{
    if(browser)await browser.close();
    if(server.exitCode===null){const exited=once(server,'exit');server.kill();await exited;}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
