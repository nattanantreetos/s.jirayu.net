'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {createHash} = require('node:crypto');
const normalizeIp = ip => String(ip || '').replace(/^::ffff:/, '');
const loopback = ip => ['127.0.0.1', '::1'].includes(normalizeIp(ip));
function contains(root, file) {
  const relative = path.relative(root, file);
  return !relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}
function loadPolicy(root) {
  const file = process.env.SEEN_SECURITY_CONFIG || path.resolve(root, '..', '.runtime', 'security.json');
  let config = {};
  if (fs.existsSync(file)) config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const addresses = key => {
    const values = config[key] || [];
    if (!Array.isArray(values) || values.length > 32 || values.some(value => !net.isIP(normalizeIp(value)))) throw Error(`Invalid security setting: ${key}`);
    return new Set(values.map(normalizeIp));
  };
  const trustedProxies = addresses('trustedProxyIPs');
  const allowedPeers = addresses('allowedPeerIPs');
  const publicOrigin = new URL(config.publicOrigin || 'https://s.jirayu.net').origin;
  if (!publicOrigin.startsWith('https://')) throw Error('Public origin requires HTTPS');
  return {trustedProxies, allowedPeers, publicOrigin};
}
function createSecurity(policy) {
  const buckets = new Map();
  const active = new Map();
  function acquire(req, res, maximum = 128) {
    const key = req.securityClientIp || clientIp(req);
    if ((active.get(key) || 0) >= maximum) return false;
    active.set(key, (active.get(key) || 0) + 1);
    let released = false;
    const release = () => {
      if (released) return; released = true;
      const remaining = (active.get(key) || 1) - 1;
      if (remaining) active.set(key, remaining); else active.delete(key);
    };
    res.once('finish', release); res.once('close', release);
    return true;
  }
  function clientIp(req) {
    const peer = normalizeIp(req.socket.remoteAddress);
    if (!policy.trustedProxies.has(peer)) return peer;
    // Read from the trusted end of the proxy chain. A visitor's forged leftmost
    // X-Forwarded-For value cannot replace the real peer appended by the proxy.
    const chain = String(req.headers['x-forwarded-for'] || '').split(',').map(s => normalizeIp(s.trim()));
    if (!chain.length || chain.length > 8 || chain.some(ip => !net.isIP(ip))) return peer;
    for (let i = chain.length - 1; i >= 0; i--) if (!policy.trustedProxies.has(chain[i])) return chain[i];
    return peer;
  }
  function local(req) {
    if (!loopback(req.socket.remoteAddress) || req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'] || req.headers['x-forwarded-proto']) return false;
    try {return ['localhost', '127.0.0.1', '[::1]'].includes(new URL('http://' + req.headers.host).hostname);} catch {return false;}
  }
  const hostnames = new Set([new URL(policy.publicOrigin).hostname, 'localhost', '127.0.0.1', '[::1]', ...policy.allowedPeers]);
  function permitted(req) {
    return true;
  }
  function sameOrigin(req) {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    const origin = req.headers.origin;
    if (!origin) return true;
    if (origin === policy.publicOrigin) return true;
    try {
      const originHost = new URL(origin).host;
      if (originHost === req.headers.host) return true;
    } catch {}
    if (!local(req)) return false;
    return origin === 'http://' + req.headers.host;
  }
  function limited(req, category, capacity, refillPerSecond) {
    const now = Date.now(), key = category + ':' + (req.securityClientIp || clientIp(req));
    if (!buckets.has(key) && buckets.size >= 8192) {
      for (const [k, b] of buckets) if (now - b.time > 120000) buckets.delete(k);
      if (buckets.size >= 8192) return true;
    }
    const b = buckets.get(key) || {tokens: capacity, time: now};
    b.tokens = Math.min(capacity, b.tokens + (now - b.time) * refillPerSecond / 1000); b.time = now;
    buckets.set(key, b);
    if (b.tokens < 1) return true;
    b.tokens--; return false;
  }
  return {clientIp, local, permitted, sameOrigin, limited, acquire};
}
function baseHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache'); res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; form-action 'self'");
}
const cspCache = new Map();
function documentPolicy(file, version, html) {
  const old = cspCache.get(file);
  if (old?.version === version) return old.policy;
  const hash = s => "'sha256-" + createHash('sha256').update(s).digest('base64') + "'";
  const decode = s => s.replace(/&(?:quot|apos|amp|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const names = {'&quot;':'"', '&apos;':"'", '&amp;':'&', '&lt;':'<', '&gt;':'>'};
    if (names[entity]) return names[entity];
    const value = entity.slice(2, -1); return String.fromCodePoint(value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value));
  });
  if(typeof html !== 'string') return null;
  const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m => !/\bsrc\s*=/i.test(m[1])).map(m => hash(m[2].replace(/\r\n?/g, '\n')));
  const handlers = [...html.matchAll(/\son\w+\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map(m => hash(decode(m[1] ?? m[2]).replace(/\r\n?/g, '\n')));
  const policy = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; script-src 'self' " + [...new Set(inline)].join(' ') + "; script-src-attr 'unsafe-hashes' " + [...new Set(handlers)].join(' ') + "; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; form-action 'self'";
  cspCache.set(file, {version, policy});
  while (cspCache.size > 16) cspCache.delete(cspCache.keys().next().value);
  return policy;
}
function safeStaticPath(relative) {
  const segments = relative.replace(/\\/g, '/').split('/');
  if (segments.some(p => p.startsWith('.') || /[:\x00-\x1f\x7f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) return false;
  const name = segments.at(-1).toLowerCase();
  if (['server.js', 'security.cjs', 'controller.js', 'game-auth.js', 'game-online.cjs'].includes(name)) return false;
  const ext = path.extname(name);
  if (ext === '.json') return ['manifest.json'].includes(name);
  return staticExtensions.has(ext);
}
const staticExtensions = new Set(['.apk', '.exe', '.css', '.html', '.js', '.png', '.jpg', '.jpeg', '.gif', '.avif', '.svg', '.txt', '.webp', '.woff2', '.xml', '.glb', '.gltf', '.bin', '.mp3', '.ogg', '.wav']);
module.exports = {loadPolicy, createSecurity, baseHeaders, documentPolicy, safeStaticPath, contains, loopback, normalizeIp};
