const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const zlib = require('node:zlib');
const vm = require('node:vm');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const test = require('node:test');
const root = path.resolve(__dirname, '..');

async function startServer(file, t) {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, [file], {env:{...process.env, PORT:String(port)}, windowsHide:true, stdio:['ignore','pipe','pipe']});
  t.after(async () => {if(child.exitCode === null) {const closed = once(child,'exit'); child.kill(); await closed;}});
  await Promise.race([once(child.stdout,'data'), once(child,'exit').then(() => {throw Error('Server failed to start');})]);
  return (url, headers = {}, method = 'GET') => new Promise((resolve,reject) => {
    const start = performance.now();
    http.request({hostname:'127.0.0.1', port, path:url, headers, method}, response => {
      const chunks=[];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({status:response.statusCode, headers:response.headers, body:Buffer.concat(chunks), ms:performance.now()-start}));
    }).on('error',reject).end();
  });
}

test('preserved server content, compression, no-store policy and API protections', async t => {
  const request = await startServer(path.join(root,'server.js'), t);
  const html = fs.readFileSync(path.join(root,'index.html'));
  const timings=[];
  for(let i=0;i<3;i++) {
    const response = await request('/', {'Accept-Encoding':'br'});
    assert.equal(response.status,200);
    assert.deepEqual(zlib.brotliDecompressSync(response.body),html);
    assert.equal(response.headers['x-content-type-options'],'nosniff');
    assert.equal(response.headers['x-frame-options'],'SAMEORIGIN');
    assert.match(response.headers['cache-control'],/no-store/);
    timings.push({ms:+response.ms.toFixed(2),bytes:response.body.length});
    const conditional = await request('/',{'Accept-Encoding':'br','If-None-Match':'*'});
    assert.equal(conditional.status,200);
    assert.deepEqual(zlib.brotliDecompressSync(conditional.body),html);
  }
  for(const encoding of ['gzip','identity']) {
    const response=await request('/',{'Accept-Encoding':encoding});
    assert.deepEqual(encoding==='gzip'?zlib.gunzipSync(response.body):response.body,html);
    const head=await request('/',{'Accept-Encoding':encoding},'HEAD');
    assert.equal(head.body.length,0);
    assert.equal(head.headers['content-length'],response.headers['content-length']);
    assert.equal(head.headers['content-encoding'],response.headers['content-encoding']);
  }
  assert.equal((await request('/',{'Accept-Encoding':'br;q=0,gzip;q=0'})).headers['content-encoding'],undefined);
  assert.equal((await request('/api/unknown')).status,404);
  for (const url of ['/api/translate','/api/status','/api/health']) {
    assert.equal((await request(url)).status,404);
    assert.equal((await request(url,{},'POST')).status,404);
  }
  const range=await request('/PaintStudio.exe',{Range:'bytes=0-15'});
  assert.equal(range.status,206);
  assert.equal(range.body.length,16);
  assert.match(range.headers['cache-control'],/no-store/);
  t.diagnostic('Fresh server Brotli responses: '+JSON.stringify(timings));
  if(process.env.PRESERVED_BASELINE_DIR) {
    const before=await startServer(path.join(process.env.PRESERVED_BASELINE_DIR,'server-before.js'),t);
    const cold=await before('/baseline.html',{'Accept-Encoding':'br'});
    const warm=await before('/baseline.html',{'Accept-Encoding':'br'});
    assert.equal(cold.status,200);
    t.diagnostic('User baseline server cold/warm Brotli: '+JSON.stringify([cold,warm].map(r=>({ms:+r.ms.toFixed(2),bytes:r.body.length}))));
  }
});
