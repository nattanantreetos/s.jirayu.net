// Migration only: retire older SEEN workers and their offline caches.
// No fetch handler, offline copy, or response storage is installed.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => /^seen-v\d+$/.test(key)).map(key => caches.delete(key)));
    await self.registration.unregister();
  })());
});
