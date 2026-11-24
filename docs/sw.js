const CACHE = 'jordan-v1';
const SHELL = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// 항상 최신 우선, 오프라인이면 캐시
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(e.request.url.split('?')[0], copy));
    return r;
  }).catch(() => caches.match(e.request.url.split('?')[0])));
});

self.addEventListener('push', e => {
  const m = e.data ? e.data.json() : { title: 'QQQM 조던 룰', body: '' };
  e.waitUntil(self.registration.showNotification(m.title, { body: m.body, tag: m.tag, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: './' } }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(ws => ws.length ? ws[0].focus() : clients.openWindow('./')));
});
