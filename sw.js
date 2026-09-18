const CACHE = 'gamelife-v4';
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/storage.js',
  'js/avatar.js',
  'js/physiology.js',
  'js/attributes.js',
  'js/skills.js',
  'js/life.js',
  'js/app.js',
  'manifest.webmanifest',
  'icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.allSettled(ASSETS.map((u) => c.add(u)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // 本地资源：缓存优先
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res.clone();
      }).catch(() => hit))
    );
  } else {
    // CDN 资源：网络优先，失败回退缓存
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res.clone();
      }).catch(() => caches.match(req))
    );
  }
});
