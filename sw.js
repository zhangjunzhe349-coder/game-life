/* ============================================================
   Service Worker · 离线缓存
   ------------------------------------------------------------
   v12 的改动：
   ① 「去黑边」—— icon.svg / 四个 Web 图标 / 安卓全部图标重做：
      原先紫色块外面还套了一圈 #0d0f1a 近黑，在启动器的圆形遮罩下就是一圈黑边。
   ② 安卓图标改由 tools/gen-icons.js 与 Web 图标**同源生成**（5 密度 × 3 张 + 自适应 XML）。
   ③ 立绘下方读数精简、手机端顶部预留系统状态栏。
   三者都改了前端资源 → 必须升版，否则用户拿到的是旧图标 + 旧布局。

   v10 的改动：
   ① 字体本地化后，页面已**零跨域请求**，于是删掉了原「CDN 资源网络优先」那条分支
      —— 留着它只会在断网或域名不可达时多等一次失败。
   ② ASSETS 补齐自托管字体与全部图标尺寸（之前只有 icon.svg，
      而 iOS 不认 SVG 的 apple-touch-icon，离线安装会缺图标）。
   ③ 非本源的请求一律**不接管**，交给浏览器自己处理，避免误缓存第三方内容。

   改任何前端资源都必须升 CACHE 版本号，否则用户浏览器里的旧缓存会继续供应旧文件，
   表现为「我明明修好了，他打开还是坏的」。
   ============================================================ */
const CACHE = 'gamelife-v12';

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',

  'fonts/chakra-petch-latin-500-normal.woff2',
  'fonts/chakra-petch-latin-600-normal.woff2',
  'fonts/chakra-petch-latin-700-normal.woff2',
  'fonts/jetbrains-mono-latin-400-normal.woff2',
  'fonts/jetbrains-mono-latin-500-normal.woff2',
  'fonts/jetbrains-mono-latin-700-normal.woff2',

  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',

  'js/storage.js',
  'js/portrait.js',
  'js/avatar.js',
  'js/physiology.js',
  'js/attributes.js',
  'js/skills.js',
  'js/life.js',
  'js/app.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    // allSettled：个别资源缺失不应让整次安装失败，否则 SW 永远装不上
    caches.open(CACHE)
      .then((c) => Promise.allSettled(ASSETS.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 只接管同源资源；跨域请求（正常情况下已不存在）交给浏览器原生处理
  if (url.origin !== location.origin) return;

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;                    // 缓存优先：秒开，且断网完全可用
      return fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
    })
  );
});
