// Built-in Node tests; no extra dependencies. Uses only its own ephemeral server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const test = require('node:test');
const zlib = require('node:zlib');
const web = path.join(__dirname, '..');

test('entry resources are deferred and static styles load separately', () => {
  const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script defer src="([^"]+)"/g)].map(match => match[1].split('?')[0]);
  assert.deepEqual(scripts, ['website-runtime.js', 'ui-polish.js', 'section-navigation.js']);
  for (const file of scripts) assert.ok(fs.statSync(path.join(web, file)).isFile());
  assert.ok(html.indexOf('as="font"') < html.indexOf('<link rel="stylesheet"'));
  assert.ok(html.indexOf('fetchpriority="high"') < html.indexOf('<link rel="stylesheet"'));
  assert.ok(!html.includes('// LANGUAGE TOGGLE ENGINE'));
  assert.ok(fs.readFileSync(path.join(web, 'website-runtime.js'), 'utf8').includes('initIdleShowcase'));
});

test('compressed reuse never serves stale text, caches downloads, or changes bytes', async t => {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const dir = fs.mkdtempSync(path.join(web, 'loading-test-'));
  const fixture = path.join(dir, 'version.txt');
  const url = `http://127.0.0.1:${port}/${path.basename(dir)}/version.txt`;
  const child = spawn(process.execPath, [path.join(web, 'server.js')], {env:{...process.env,PORT:String(port)}, windowsHide:true, stdio:['ignore','pipe','pipe']});
  t.after(async () => {
    if (child.exitCode === null) { const stopped = once(child,'exit'); child.kill(); await stopped; }
    if(fs.existsSync(fixture)) fs.unlinkSync(fixture);
    fs.rmdirSync(dir);
  });
  await Promise.race([once(child.stdout,'data'), once(child,'exit').then(()=>{throw Error('Server exited');})]);
  const http = require('node:http');
  function request(target, encoding, method = 'GET') {
    return new Promise((resolve,reject) => {
      http.request(target,{method,headers:{'Accept-Encoding':encoding}},response=>{
        const chunks=[];response.on('data',chunk=>chunks.push(chunk));
        response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));
      }).on('error',reject).end();
    });
  }
  for (const encoding of ['br','gzip']) {
    const decode = encoding === 'br' ? zlib.brotliDecompressSync : zlib.gunzipSync;
    fs.writeFileSync(fixture,'A'.repeat(4096));
    const responses = await Promise.all(Array.from({length:6},()=>request(url,encoding)));
    for (const response of responses) {
      assert.equal(response.status,200); assert.match(response.headers['cache-control'],/must-revalidate/);
      assert.equal(Number(response.headers['content-length']),response.body.length);
      assert.equal(decode(response.body).toString(),'A'.repeat(4096));
    }
    // Deliberately keep the same size and mtime: ctime must invalidate the entry.
    const stats = fs.statSync(fixture);
    await new Promise(resolve=>setTimeout(resolve,25));
    fs.writeFileSync(fixture,'B'.repeat(4096)); fs.utimesSync(fixture,stats.atime,stats.mtime);
    const updated = await request(url,encoding);
    assert.equal(decode(updated.body).toString(),'B'.repeat(4096));
    const head = await request(url,encoding,'HEAD');
    assert.equal(head.body.length,0); assert.equal(head.headers['content-length'],updated.headers['content-length']);
    fs.unlinkSync(fixture);
    assert.equal((await request(url,encoding)).status,404);
    fs.writeFileSync(fixture,'C'.repeat(4096));
    assert.equal(decode((await request(url,encoding)).body).toString(),'C'.repeat(4096));
    // Files beyond the bounded cache limit still stream and compress correctly.
    fs.writeFileSync(fixture,'stream '.repeat(80000));
    const large = await request(url,encoding);
    assert.deepEqual(decode(large.body),fs.readFileSync(fixture));
  }
  const image = await request(`http://127.0.0.1:${port}/paintstudio-preview-dark.webp`,'br');
  assert.equal(image.headers['content-type'],'image/webp');
  assert.equal(image.headers['content-encoding'],undefined);
  assert.deepEqual(image.body,fs.readFileSync(path.join(web,'paintstudio-preview-dark.webp')));
  const exe = await request(`http://127.0.0.1:${port}/PaintStudio.exe`,'br','HEAD');
  assert.equal(exe.headers['content-encoding'],undefined); assert.match(exe.headers['cache-control'],/no-store/);
  assert.equal(Number(exe.headers['content-length']),fs.statSync(path.join(web,'PaintStudio.exe')).size);
  const auto = await request(`http://127.0.0.1:${port}/Auto%20System.exe`,'br','HEAD');
  assert.equal(auto.status,200);
  assert.equal(Number(auto.headers['content-length']),fs.statSync(path.join(web,'Auto System.exe')).size);
  assert.equal(auto.headers['content-encoding'],undefined);
  assert.match(auto.headers['cache-control'],/no-store/);
});

test('local page resources, downloads, fonts and manifest icons resolve to real files', () => {
  const html = fs.readFileSync(path.join(web,'index.html'),'utf8');
  const refs = [...html.matchAll(/\b(?:src|href|data-section-src)="([^"]+)"/g)].map(match=>match[1]);
  const css = fs.readFileSync(path.join(web,'site.css'),'utf8');
  refs.push(...[...css.matchAll(/url\(['"]?([^'"\)]+)['"]?\)/g)].map(match=>match[1]));
  refs.push(...JSON.parse(fs.readFileSync(path.join(web,'manifest.json'),'utf8')).icons.map(icon=>icon.src));
  let checked = 0;
  for (const ref of refs) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(ref)) continue;
    const name = decodeURIComponent(ref.split(/[?#]/)[0]);
    // Route ownership is unchanged: this audit does not read the game folder.
    if (!name || name==='/' || name.startsWith('/game') || name.startsWith('game/')) continue;
    const file = path.resolve(web,name.replace(/^\//,''));
    const relative = path.relative(web,file);
    assert.ok(relative && relative!=='..' && !relative.startsWith('..'+path.sep),'Resource stays in web: '+ref);
    assert.ok(fs.existsSync(file) && fs.statSync(file).isFile(),'Missing local resource: '+ref);
    checked++;
  }
  assert.ok(checked>=30,'Audit includes active images, scripts, styles and downloads');
});
