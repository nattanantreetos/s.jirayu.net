const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const test = require('node:test');
const zlib = require('node:zlib');
const vm = require('node:vm');
const WEB_ROOT = path.join(__dirname, '..');

test('fresh static responses, compression and downloads', async (t) => {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const fixtureDir = fs.mkdtempSync(path.join(WEB_ROOT, 'server-test-'));
  const fixturePath = path.join(fixtureDir, 'freshness.txt');
  const fixtureUrl = `/${path.basename(fixtureDir)}/freshness.txt`;
  fs.writeFileSync(fixturePath, 'initial contents '.repeat(200));
  const child = spawn(process.execPath, [path.join(WEB_ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
    // Delete only the exact fixture and empty temporary directory created here.
    fs.unlinkSync(fixturePath);
    fs.rmdirSync(fixtureDir);
  });
  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(() => { throw new Error('Test server exited before listening'); }),
  ]);

  function request(url, headers = {}, method = 'GET') {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      http.request({ hostname: '127.0.0.1', port, path: url, headers, method }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({
          status: response.statusCode, headers: response.headers,
          body: Buffer.concat(chunks), ms: performance.now() - start,
        }));
      }).on('error', reject).end();
    });
  }

  await t.test('Brotli/gzip/identity negotiation and matching HEAD headers', async () => {
    const original = fs.readFileSync(fixturePath);
    for (const encoding of ['br', 'gzip', 'identity']) {
      const response = await request(fixtureUrl, { 'Accept-Encoding': encoding });
      assert.equal(response.status, 200);
      assert.equal(response.headers.vary, 'Accept-Encoding');
      const decoded = encoding === 'br' ? zlib.brotliDecompressSync(response.body)
        : encoding === 'gzip' ? zlib.gunzipSync(response.body) : response.body;
      assert.deepEqual(decoded, original);
      if (encoding === 'identity') assert.equal(Number(response.headers['content-length']), response.body.length);
      const head = await request(fixtureUrl, { 'Accept-Encoding': encoding }, 'HEAD');
      assert.equal(head.body.length, 0);
      assert.equal(head.headers['content-length'], response.headers['content-length']);
      assert.equal(head.headers['content-encoding'], response.headers['content-encoding']);
    }
    assert.equal((await request(fixtureUrl, { 'Accept-Encoding': 'br;q=0, gzip;q=0' })).headers['content-encoding'], undefined);
    assert.equal((await request(fixtureUrl, { 'Accept-Encoding': 'br;q=0.2, gzip;q=1' })).headers['content-encoding'], 'gzip');
  });

  await t.test('conditional requests still fetch complete fresh files', async () => {
    const initial = await request(fixtureUrl);
    assert.match(initial.headers['cache-control'], /must-revalidate/);
    assert.ok(initial.headers.etag);
    const conditional = await request(fixtureUrl, {'If-None-Match': initial.headers.etag});
    assert.equal(conditional.status, 304);
    assert.equal(conditional.body.length, 0);
    fs.writeFileSync(fixturePath, 'updated contents '.repeat(200));
    const updated = await request(fixtureUrl, {'If-None-Match': initial.headers.etag});
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body, fs.readFileSync(fixturePath));
    assert.notDeepEqual(updated.body, initial.body);
  });

  await t.test('download ranges, suffixes, If-Range and cache policy', async () => {
    const head = await request('/PaintStudio.exe', {}, 'HEAD');
    const size = Number(head.headers['content-length']);
    assert.match(head.headers['cache-control'], /no-store/);
    for (const [range, start, end] of [
      ['bytes=0-31', 0, 31], ['bytes=-32', size - 32, size - 1],
      [`bytes=${size - 32}-`, size - 32, size - 1],
    ]) {
      const result = await request('/PaintStudio.exe', { Range: range, 'Accept-Encoding': 'br' });
      assert.equal(result.status, 206);
      assert.equal(result.headers['content-range'], `bytes ${start}-${end}/${size}`);
      assert.equal(result.headers['content-encoding'], undefined);
      assert.deepEqual(result.body, fs.readFileSync(path.join(WEB_ROOT, 'PaintStudio.exe')).subarray(start, end + 1));
    }
    assert.equal((await request('/PaintStudio.exe', { Range: `bytes=${size}-` })).status, 416);
    assert.equal((await request('/PaintStudio.exe', { Range: 'bytes=0-31', 'If-Range': '"old"' }, 'HEAD')).status, 200);
    assert.match((await request('/icon-192.webp')).headers['cache-control'], /must-revalidate/);
    assert.match((await request('/')).headers['cache-control'], /no-store/);
  });

  await t.test('repeat page responses each return the current full document', async () => {
    const samples = [];
    for (let index = 0; index < 5; index += 1) {
      const response = await request('/', { 'Accept-Encoding': 'br' });
      assert.equal(response.status, 200);
      assert.deepEqual(zlib.brotliDecompressSync(response.body), fs.readFileSync(path.join(WEB_ROOT, 'index.html')));
      samples.push({ ms: Number(response.ms.toFixed(2)), bytes: response.body.length });
    }
    t.diagnostic(`HTML Brotli requests: ${JSON.stringify(samples)}`);
  });
  await t.test('retired upload routes and scripts are no longer served', async () => {
    for(const route of ['/api/drive','/api/drive/upload','/game/api/drive','/game/api/drive/upload','/drive.js','/drive-storage.js']) {
      assert.equal((await request(route)).status,404,route);
      assert.equal((await request(route,{},'POST')).status,route.endsWith('.js')?405:404,route);
    }
    const page=(await request('/')).body.toString();
    assert.doesNotMatch(page,/drive|dirve/i);
    for(const route of ['/site.css','/website-runtime.js','/ui-polish.js','/section-navigation.js']) {
      const first=await request(route);
      const repeated=await request(route,{'If-None-Match':first.headers.etag});
      assert.equal(first.status,200);assert.equal(repeated.status,304);assert.equal(repeated.body.length,0);
    }
  });
});

test('retiring worker deletes only SEEN caches and unregisters without caching', async () => {
  const listeners = new Map(), deleted = [];
  let claimed = false, unregistered = false;
  vm.runInNewContext(fs.readFileSync(path.join(WEB_ROOT, 'sw.js'), 'utf8'), {
    self: {
      addEventListener(name, handler) { listeners.set(name, handler); },
      async skipWaiting() {},
      clients: {async claim() {claimed = true;}},
      registration: {async unregister() {unregistered = true;}}
    },
    caches: {
      async keys() {return ['seen-v1', 'seen-v113', 'another-application'];},
      async delete(key) {deleted.push(key);}
    }
  });
  let pending;
  listeners.get('activate')({waitUntil(promise) {pending = promise;}});
  await pending;
  assert.deepEqual(deleted, ['seen-v1', 'seen-v113']);
  assert.ok(claimed && unregistered);
  assert.equal(listeners.has('fetch'), false);
});
