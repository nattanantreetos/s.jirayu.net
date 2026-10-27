const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {loadPolicy, createSecurity, baseHeaders, documentPolicy, safeStaticPath, contains} = require('./security.cjs');
let gameHandler;
function handleGame(...args) {
  gameHandler ||= require('../game/server/auth.cjs')();
  return gameHandler(...args);
}

const port = Number(process.env.PORT || 3000);
const root = __dirname;
const gameRoot = path.resolve(root, '..', 'game', 'public');
let stopping = false;
const activeSockets = new Set();
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.svg', '.txt', '.xml']);
const mimeTypes = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.apk': 'application/vnd.android.package-archive',
  '.css': 'text/css; charset=utf-8',
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

const policy = loadPolicy(root);
const security = createSecurity(policy);
const setSecurityHeaders = baseHeaders;

function sendError(response, statusCode, message, contentType = 'text/plain; charset=utf-8') {
  if (response.destroyed || response.writableEnded) return;
  if (response.headersSent) { response.destroy(); return; }
  setSecurityHeaders(response);
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  response.end(message);
}

// Reuse small text buffers and compressed representations after validating the
// filesystem version. Large downloads stay streamed with bounded backpressure.
const brotliOptions = {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: 6}};
const gzipOptions = {level: 6};
const maxBufferedTextBytes = 512 * 1024;
const maxCompressedEntries = 16;
const compressedFiles = new Map();
const sourceFiles = new Map();
let sourceBytes = 0;
const maxSourceBytes = 2 * 1024 * 1024;
function sourceFile(filePath, stats) {
  const version = fileVersion(stats), old = sourceFiles.get(filePath);
  if(old?.version === version) {
    sourceFiles.delete(filePath); sourceFiles.set(filePath, old); return old.pending;
  }
  if(old) {sourceFiles.delete(filePath); sourceBytes -= old.size;}
  const entry = {version, size:stats.size, pending:null};
  entry.pending = fs.promises.readFile(filePath).catch(error => {
    if(sourceFiles.get(filePath) === entry) {sourceFiles.delete(filePath); sourceBytes -= entry.size;}
    throw error;
  });
  sourceFiles.set(filePath, entry); sourceBytes += entry.size;
  while(sourceBytes > maxSourceBytes || sourceFiles.size > 16) {
    const key = sourceFiles.keys().next().value, evicted = sourceFiles.get(key);
    sourceFiles.delete(key); sourceBytes -= evicted.size;
  }
  return entry.pending;
}

function fileVersion(stats) {
  return `${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
}

function compressedFile(filePath, stats, encoding) {
  const key = `${filePath}:${encoding}`;
  const version = fileVersion(stats);
  const previous = compressedFiles.get(key);
  if (previous && previous.version === version) {
    compressedFiles.delete(key);
    compressedFiles.set(key, previous);
    return previous.pending;
  }
  const entry = {version, pending: null};
  entry.pending = sourceFile(filePath, stats).then(body => new Promise((resolve, reject) => {
    const finish = (error, result) => error ? reject(error) : resolve(result);
    if (encoding === 'br') zlib.brotliCompress(body, brotliOptions, finish);
    else zlib.gzip(body, gzipOptions, finish);
  })).catch(error => {
    if (compressedFiles.get(key) === entry) compressedFiles.delete(key);
    throw error;
  });
  compressedFiles.delete(key);
  compressedFiles.set(key, entry);
  while (compressedFiles.size > maxCompressedEntries) compressedFiles.delete(compressedFiles.keys().next().value);
  return entry.pending;
}

function preferredEncoding(header = '') {
  const weights = new Map(header.toLowerCase().split(',').map(part => {
    const [name, ...parameters] = part.trim().split(';');
    const q = parameters.find(value => /^\s*q\s*=/.test(value));
    return [name, q ? Number(q.split('=')[1]) || 0 : 1];
  }));
  const br = weights.get('br') ?? weights.get('*') ?? 0;
  const gzip = weights.get('gzip') ?? weights.get('*') ?? 0;
  return br > 0 && br >= gzip ? 'br' : gzip > 0 ? 'gzip' : null;
}

function createFileStream(filePath, range) {
  return fs.createReadStream(filePath, range ? { start: range.start, end: range.end } : undefined);
}

function stopServer() {
  if (stopping) return;
  stopping = true;
  gameHandler?.close();
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
  for (const socket of activeSockets) socket.destroy();
  setTimeout(() => process.exit(0), 500).unref();
}

const server = http.createServer({maxHeaderSize: 16 * 1024}, (request, response) => {
  setSecurityHeaders(response);
  if (!security.permitted(request)) {sendError(response, 403, 'Forbidden'); return;}
  request.securityClientIp = security.clientIp(request);
  if (!security.acquire(request, response)) {response.setHeader('Retry-After', '5'); sendError(response, 429, 'Too many active requests'); return;}
  if (request.url.length > 4096 || !request.url.startsWith('/') || request.url.startsWith('//')) {sendError(response, 400, 'Bad request'); return;}
  // Preserve traversal evidence before URL parsing normalizes dot segments.
  const rawPath = request.url.split('?')[0];
  let rawDecoded;
  try {rawDecoded = decodeURIComponent(rawPath);} catch {sendError(response, 400, 'Bad request'); return;}
  if (rawDecoded.replace(/\\/g, '/').split('/').some(s => s === '..' || s === '.') || /[\x00-\x1f\x7f]/.test(rawDecoded)) {sendError(response, 400, 'Bad request'); return;}
  const isProxyHttps = policy.trustedProxies.has(request.socket.remoteAddress.replace(/^::ffff:/, '')) && request.headers['x-forwarded-proto'] === 'https';
  if (request.socket.encrypted || isProxyHttps) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
  request.setTimeout(15000, () => {sendError(response, 408, 'Request timed out'); response.once('finish', () => request.destroy());});
  request.once('end', () => request.setTimeout(0));
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    sendError(response, 400, 'Bad request');
    return;
  }

  // Null byte injection protection
  if (pathname.includes('\0')) {
    sendError(response, 400, 'Bad request');
    return;
  }

  const gameApi = pathname.startsWith('/game/api/') || pathname.startsWith('/game/auth/');
  if (security.limited(request, gameApi ? 'game' : 'site', gameApi ? 1200 : 1024, gameApi ? 600 : 256)) {
    response.setHeader('Retry-After', '2'); sendError(response, 429, 'Too many requests'); return;
  }
  if (pathname === '/game') {
    setSecurityHeaders(response);
    response.writeHead(308, { Location: '/game/' }).end();
    return;
  }
  if (pathname.startsWith('/game/api/') || pathname.startsWith('/game/auth/')) {
    handleGame(request, response, pathname);
    return;
  }
  if (['/game-auth.js','/game-online.cjs'].includes(pathname.replace(/\\/g, '/').toLowerCase())) {
    sendError(response, 404, 'Not found');
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendError(response, 404, JSON.stringify({error:'Endpoint not found'}), 'application/json');
    return;
  }

  if (!['GET', 'HEAD'].includes(request.method)) {
    setSecurityHeaders(response);
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  // Keep the existing public URL while serving game files from their own folder.
  const isGameAsset = pathname.startsWith('/game/');
  const staticRoot = isGameAsset ? gameRoot : root;
  const relativePath = isGameAsset ? pathname === '/game/' ? 'index.html' : pathname.slice('/game/'.length)
    : pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (!safeStaticPath(relativePath)) {sendError(response, 404, 'Not found'); return;}
  const filePath = path.resolve(staticRoot, relativePath);

  if (path.relative(staticRoot, filePath).startsWith('..') || path.isAbsolute(path.relative(staticRoot, filePath))) {
    sendError(response, 403, 'Forbidden');
    return;
  }

  // Private directories stay outside the static route space.
  for(const privateDirectory of [path.resolve(root,'private'), path.resolve(root,'tests')]){
    const storageRelative = path.relative(privateDirectory, filePath);
    if (!storageRelative || (!storageRelative.startsWith('..') && !path.isAbsolute(storageRelative))) {
      sendError(response, 403, 'Forbidden');
      return;
    }
  }

  fs.realpath(filePath, (realError, resolvedFile) => {
    const privatePaths = ['private', 'tests'].map(name => path.resolve(root, name));
    if (realError || !contains(staticRoot, resolvedFile) || privatePaths.some(dir => contains(dir, resolvedFile))) {sendError(response, 404, 'Not found'); return;}
  fs.stat(resolvedFile, async (error, stats) => {
    if (error || !stats.isFile()) {
      sendError(response, 404, 'Not found');
      return;
    }

    setSecurityHeaders(response);
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.html') {
      try {
        if (stats.size > 512 * 1024) {sendError(response, 413, 'Document too large'); return;}
        let csp = documentPolicy(resolvedFile, fileVersion(stats));
        if(!csp) csp = documentPolicy(resolvedFile, fileVersion(stats), (await sourceFile(resolvedFile, stats)).toString('utf8'));
        if (response.destroyed) return;
        response.setHeader('Content-Security-Policy', csp);
      } catch {sendError(response, 500, 'Could not read document'); return;}
    }
    const commonHeaders = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': mimeTypes[extension] || 'application/octet-stream',
      ...(textExtensions.has(extension) ? { Vary: 'Accept-Encoding' } : {}),
    };

    const revalidate = !['.html', '.exe', '.apk', '.json'].includes(extension);
    const etag = 'W/"' + stats.size.toString(16) + '-' + stats.mtimeMs.toString(16) + '-' + stats.ctimeMs.toString(16) + '"';
    if(revalidate) {
      commonHeaders['Cache-Control'] = 'public, max-age=0, must-revalidate';
      commonHeaders.ETag = etag;
      response.removeHeader('Pragma'); response.removeHeader('Expires');
      if(!request.headers.range && String(request.headers['if-none-match'] || '').split(',').some(tag => tag.trim() === etag || tag.trim() === '*')) {
        response.writeHead(304, commonHeaders).end(); return;
      }
    }
    let range;
    // No stored validators remain: an If-Range request needs the full fresh file.
    const rangeMatch = !request.headers['if-range'] && /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || '');
    if (rangeMatch) {
      const suffix = rangeMatch[1] === '';
      const start = suffix ? Math.max(0, stats.size - Number(rangeMatch[2])) : Number(rangeMatch[1]);
      const end = suffix || rangeMatch[2] === '' ? stats.size - 1 : Number(rangeMatch[2]);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= stats.size) {
        response.writeHead(416, { ...commonHeaders, 'Content-Range': `bytes */${stats.size}` }).end();
        return;
      }
      range = { start, end: Math.min(end, stats.size - 1) };
    }

    const headers = {
      ...commonHeaders,
      'Content-Length': range ? range.end - range.start + 1 : stats.size,
      ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${stats.size}` } : {}),
    };

    const encoding = !range && textExtensions.has(extension)
      ? preferredEncoding(request.headers['accept-encoding']) : null;
    if (encoding) {
      headers['Content-Encoding'] = encoding;
      delete headers['Content-Length'];
    }

    if (encoding && stats.size <= maxBufferedTextBytes) {
      // Concurrent visitors share one asynchronous compression job per version.
      compressedFile(resolvedFile, stats, encoding).then(body => {
        if (response.destroyed) return;
        headers['Content-Length'] = body.length;
        response.writeHead(200, headers);
        response.end(request.method === 'HEAD' ? undefined : body);
      }).catch(() => {
        if (!response.destroyed) sendError(response, 500, 'Could not read file');
      });
      return;
    }

    if (!range && !encoding && textExtensions.has(extension) && stats.size <= maxBufferedTextBytes) {
      try {
        const body = await sourceFile(resolvedFile, stats);
        if(!response.destroyed) {response.writeHead(200, {...headers, 'Content-Length':body.length}); response.end(request.method === 'HEAD' ? undefined : body);}
      } catch {sendError(response, 500, 'Could not read file');}
      return;
    }
    if (request.method === 'HEAD') {
      response.writeHead(range ? 206 : 200, headers).end();
      return;
    }

    // Incoming-body deadlines do not bound a client that never reads a download.
    response.setTimeout(30000, () => response.destroy());
    const transferDeadline = setTimeout(() => response.destroy(), 15 * 60 * 1000);
    transferDeadline.unref();
    response.once('close', () => clearTimeout(transferDeadline));
    const stream = createFileStream(resolvedFile, range);
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());

    response.writeHead(range ? 206 : 200, headers);
    if (!encoding) {
      stream.pipe(response);
      return;
    }
    const compressor = encoding === 'br' ? zlib.createBrotliCompress(brotliOptions) : zlib.createGzip(gzipOptions);
    compressor.on('error', () => response.destroy());
    response.on('close', () => compressor.destroy());
    stream.pipe(compressor).pipe(response);
  });
  });
});

server.keepAliveTimeout = 5_000;
server.requestTimeout = 30_000;
server.maxHeadersCount = 64;
server.maxRequestsPerSocket = 1000;
server.maxConnections = 1024;
server.headersTimeout = 10_000;
server.on('connection', (socket) => {
  activeSockets.add(socket);
  socket.on('close', () => activeSockets.delete(socket));
});

server.once('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the other website server, then try again.`);
  } else {
    console.error('Website server could not start:', error.message);
  }
  process.exit(1);
});

// Warm the few entry resources without delaying startup or caching their validity.
for (const name of ['index.html', 'site.css', 'website-runtime.js', 'ui-polish.js']) {
  const filePath = path.join(root, name);
  fs.stat(filePath, (error, stats) => {
    if (!error && stats.isFile() && stats.size <= maxBufferedTextBytes) {
      compressedFile(filePath, stats, 'br').catch(() => {});
    }
  });
}

server.listen(port, '0.0.0.0', () => {
  const localUrl = `http://localhost:${port}`;
  console.log(`SEEN website is running at ${localUrl}`);
  console.log(`Network access is enabled on port ${port}.`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, stopServer);
}
