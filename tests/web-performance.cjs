// Focused local browser benchmark. No API calls or installer downloads are made.
// PLAYWRIGHT_MODULE and CHROME_PATH can override the locally installed runtimes.
// node tests/web-performance.cjs <html-file> <asset-directory> <report-file> [--functional]
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const [htmlFile, assetDirectory, reportFile, functional] = process.argv.slice(2);
if (!htmlFile || !assetDirectory || !reportFile) throw new Error('Pass HTML, asset directory, and report paths.');
const html = fs.readFileSync(htmlFile);
const assetsRoot = path.resolve(assetDirectory);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.css': 'text/css' };
const blockedRequests = [];
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (pathname.startsWith('/api/') || /\.(exe|apk)$/i.test(pathname)) {
    blockedRequests.push(pathname);
    response.writeHead(403).end('Blocked by local verification server');
    return;
  }
  const file = path.resolve(assetsRoot, '.' + pathname);
  const relative = path.relative(assetsRoot, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) { response.writeHead(403).end(); return; }
  const extension = pathname === '/' ? '.html' : path.extname(pathname);
  let body;
  try { body = pathname === '/' || pathname === '/index.html' ? html : fs.readFileSync(file); }
  catch { response.writeHead(404).end(); return; }
  const headers = { 'Content-Type': mime[extension] || 'application/octet-stream', 'Cache-Control': 'no-store' };
  if (['.html', '.js', '.json', '.svg', '.css'].includes(extension) && /\bbr\b/.test(request.headers['accept-encoding'] || '')) {
    body = zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } });
    headers['Content-Encoding'] = 'br';
  }
  headers['Content-Length'] = body.length;
  response.writeHead(200, headers).end(body);
});

async function metrics(cdp) {
  return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({name, value}) => [name, value]));
}
function difference(before, after) {
  const wallSeconds = after.Timestamp - before.Timestamp;
  const result = { wallMs: +(wallSeconds * 1000).toFixed(2) };
  for (const key of ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration']) result[key + 'Ms'] = +((after[key] - before[key]) * 1000).toFixed(3);
  for (const key of ['LayoutCount', 'RecalcStyleCount']) result[key] = after[key] - before[key];
  result.mainThreadBusyPercent = +((after.TaskDuration - before.TaskDuration) / wallSeconds * 100).toFixed(3);
  return result;
}
async function counters(page) {
  return page.evaluate(() => ({ ...window.__performanceCounters }));
}
function counterDifference(before, after) {
  return Object.fromEntries(Object.entries(after).map(([key, value]) => [key, value - before[key]]));
}
async function functionalChecks(page, origin, mobile) {
  const checks = [];
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'Page starts at the top');
  checks.push('starts at top');
  await page.locator('#btn-lang-en').click();
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  await page.locator('#btn-lang-th').click();
  assert.equal(await page.locator('html').getAttribute('lang'), 'th');
  checks.push('Thai and English language buttons');
  for (const [button, section] of [['#btn-nav-story', '#story-section'], ['#btn-nav-certificates', '#certificates-section'], ['#btn-nav-dl', '#downloads-section'], ['#btn-nav-home', '#hero-section']]) {
    await page.locator(button).click();
    await page.waitForTimeout(1050);
    const state = await page.locator(section).evaluate(el => ({ top: el.getBoundingClientRect().top, height: window.innerHeight, y: window.scrollY }));
    assert.ok(section === '#hero-section' ? state.y < 2 : state.top < state.height && state.top > -10, `Navigation reaches ${section}: ${JSON.stringify(state)}`);
  }
  checks.push('home, story, certificates, and downloads navigation');
  await page.locator('.certificate-card').first().click();
  await page.waitForSelector('#certificate-modal.active');
  assert.ok(await page.locator('#certificate-modal-image').evaluate(img => img.complete && img.naturalWidth > 0), 'Certificate image decodes');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#certificate-modal').evaluate(el => el.classList.contains('active')), false);
  checks.push('certificate open, image, and Escape close');
  const links = await page.locator('#downloads-section a[download]').evaluateAll(elements => elements.map(el => ({ href: el.getAttribute('href'), onclick: el.getAttribute('onclick') })));
  assert.ok(links.length >= 3 && links.every(link => /\.(exe|apk)$/i.test(link.href)), 'Installer links remain intact');
  assert.equal(await page.locator('[id*="donat" i], [class*="donat" i], [src*="promptpay" i]').count(), 0);
  checks.push(`${links.length} download links intact; no donation UI`);
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'Reload starts at the top');
  checks.push('reload after scrolling returns to top');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#btn-nav-dl').click();
  await page.waitForTimeout(500);
  assert.ok(await page.locator('#downloads-section').evaluate(el => el.getBoundingClientRect().top < window.innerHeight));
  checks.push('reduced-motion navigation');
  assert.equal(blockedRequests.length, 0, 'No installer or API request attempted');
  return checks;
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true, args: ['--no-first-run', '--disable-background-networking'] });
  const report = { htmlFile, htmlBytes: html.length, assetsRoot, note: 'Local headless Chromium, isolated ephemeral contexts, no network/CPU throttling, service workers blocked for comparable page-only runs; not a physical GPU or disk benchmark.', browser: browser.version(), samples: [] };
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      const responses = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.url().startsWith(origin)) responses.push({ path: new URL(response.url()).pathname, status: response.status(), contentLength: +(response.headers()['content-length'] || 0) }); });
      await page.route('**/*', route => {
        const url = route.request().url();
        if (!url.startsWith(origin)) { blockedRequests.push(url); return route.abort(); }
        return route.continue();
      });
      await page.addInitScript(() => {
        window.__performanceCounters = { animationFrames: 0, intervalTicks: 0, canvasPaintCalls: 0 };
        window.__webVitals = { lcpMs: null, cls: 0, longTasks: [] };
        const requestFrame = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = callback => requestFrame(timestamp => { window.__performanceCounters.animationFrames++; callback(timestamp); });
        const startInterval = window.setInterval.bind(window);
        window.setInterval = (callback, delay, ...args) => startInterval(typeof callback === 'function' ? (...values) => { window.__performanceCounters.intervalTicks++; callback(...values); } : callback, delay, ...args);
        for (const method of ['clearRect', 'fill', 'stroke', 'drawImage']) {
          const original = CanvasRenderingContext2D.prototype[method];
          CanvasRenderingContext2D.prototype[method] = function(...args) { window.__performanceCounters.canvasPaintCalls++; return original.apply(this, args); };
        }
        new PerformanceObserver(list => { for (const entry of list.getEntries()) {
          window.__webVitals.lcpMs = entry.startTime;
          window.__webVitals.lcpElement = entry.element ? { tag: entry.element.tagName, id: entry.element.id, className: entry.element.className, text: entry.element.textContent.slice(0, 100) } : null;
        } }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__webVitals.cls += entry.value; }).observe({ type: 'layout-shift', buffered: true });
        new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__webVitals.longTasks.push(entry.duration); }).observe({ type: 'longtask', buffered: true });
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      await page.goto(origin, { waitUntil: 'load' });
      await page.waitForTimeout(1500);
      const initial = await page.evaluate(() => ({ ...window.__webVitals, navigation: performance.getEntriesByType('navigation')[0].toJSON(), scrollY: window.scrollY, documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth, canvasCount: document.querySelectorAll('canvas').length }));
      const initialResponses = responses.slice();
      const screenshotFile = reportFile.replace(/\.json$/i, '') + (mobile ? '-mobile.png' : '-desktop.png');
      await page.screenshot({ path: screenshotFile });
      const idleBefore = await metrics(cdp);
      const idleCounterBefore = await counters(page);
      await page.waitForTimeout(5000);
      const idleAfter = await metrics(cdp);
      const idleCounterAfter = await counters(page);
      const scrollBefore = await metrics(cdp);
      const scrollCounterBefore = await counters(page);
      for (let index = 0; index < 24; index++) { await page.mouse.wheel(0, 140); await page.waitForTimeout(16); }
      await page.waitForTimeout(1400);
      const scrollAfter = await metrics(cdp);
      const scrollCounterAfter = await counters(page);
      const scrollY = await page.evaluate(() => window.scrollY);
      const result = { device: mobile ? 'mobile' : 'desktop', initial, screenshotFile, initialRequests: initialResponses.length, initialBodyBytes: initialResponses.reduce((sum, value) => sum + value.contentLength, 0), initialResponses, idle: { ...difference(idleBefore, idleAfter), ...counterDifference(idleCounterBefore, idleCounterAfter) }, scroll: { ...difference(scrollBefore, scrollAfter), ...counterDifference(scrollCounterBefore, scrollCounterAfter), scrollY }, errors };
      if (functional === '--functional') {
        await page.goto(origin, { waitUntil: 'load' });
        await page.waitForTimeout(500);
        result.checks = await functionalChecks(page, origin, mobile);
      }
      assert.equal(errors.length, 0, `${result.device} has no page errors: ${errors.join(', ')}`);
      report.samples.push(result);
      console.log(JSON.stringify({ device: result.device, initialRequests: result.initialRequests, initialBodyBytes: result.initialBodyBytes, lcpMs: result.initial.lcpMs, cls: result.initial.cls, idle: result.idle, scroll: result.scroll, checks: result.checks, errors }));
      await context.close();
    }
    report.blockedRequests = blockedRequests;
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(`Report: ${reportFile}`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
