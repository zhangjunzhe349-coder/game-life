/* ============================================================
   Service Worker · 离线缓存
   ------------------------------------------------------------
   v13 的改动（都是「用户看不到新版本」这一个问题的修复）：
   ① **装缓存时绕开 HTTP 缓存**：原来 `c.add(u)` 默认走浏览器 HTTP 缓存，
      升级后若手里还留着旧副本，新缓存里装的仍是**旧文件** ——
      缓存版本号变了、内容却没变，界面上完全看不出来。
      改成 `c.add(new Request(url, { cache: 'reload' }))` 强制取真身。
   ② **换版后主动刷新已打开的页面**：旧版 SW 是「缓存优先」，会把旧
      index.html / 旧 app.js 一直供下去；新 SW 接管时，用户手里那张页面
      早已用旧脚本跑起来了。不主动刷，就得「关掉再开」才看得到新界面 ——
      实机表现就是「我明明发了新版，他说没有任何变化」（v1.7.4 事故）。
      两条并行、互为兜底：
        · 页面侧（主）：app.js 监听 controllerchange 自刷一次 —— 最可靠。
        · SW 侧（补）：这里延迟一拍 navigate 各窗口 —— 只为救「页面上跑的还是
          没有 controllerchange 监听的旧代码」那一次（例如 v1.7.4 → v1.7.5）。
      两者都**不能**放进 activate 的 waitUntil，否则死锁（见下面的注释）。
   ③ 图标去黑边（前景层必须是透明底，见 tools/gen-icons.js 的 alpha 断言）。
   ④ **`install` 里跳过 HTTP 缓存**（见 ①）+ app.js 的 `register(…, { updateViaCache:
      'none' })`：sw.js 自己也会被 HTTP 缓存住，更新检查拿到旧字节就认定「没有新版」，
      新 SW 根本装不上。这两处是同一个问题的两端。

   v12 的改动：
   ① 「去黑边」—— icon.svg / 四个 Web 图标 / 安卓全部图标重做。
   ② 安卓图标改由 tools/gen-icons.js 与 Web 图标**同源生成**。
   ③ 立绘下方读数精简、手机端顶部预留系统状态栏。

   v10 的改动：
   ① 字体本地化后，页面已**零跨域请求**，于是删掉了原「CDN 资源网络优先」那条分支。
   ② ASSETS 补齐自托管字体与全部图标尺寸。
   ③ 非本源的请求一律**不接管**，交给浏览器自己处理。

   改任何前端资源都必须升 CACHE 版本号，否则用户浏览器里的旧缓存会继续供应旧文件，
   表现为「我明明修好了，他打开还是坏的」。
   ============================================================ */
const CACHE = 'gamelife-v13';

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
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // allSettled：个别资源缺失不应让整次安装失败，否则 SW 永远装不上
    // cache:'reload'：见文件头 ①，必须绕开 HTTP 缓存取真身
    await Promise.allSettled(ASSETS.map((u) =>
      c.add(new Request(new URL(u, self.location.href).href, { cache: 'reload' }))));
  })());
  /* ⚠⚠ 这一句**绝对不可以 await**（v1.7.5 差点发布出去的坑）：
     skipWaiting() 返回的 promise 要等「本 SW 变成 active」才 resolve，
     而变成 active 又必须等 install 事件完成 —— 也就是等这个 waitUntil 的 promise。
     一 await 就是死锁：install 永远不结束、新版永远停在 waiting，
     旧 SW 继续供旧文件，用户永远看不到更新（而且 install 已经把新缓存建出来了，
     所以从 caches.keys() 看「像是装成功了」，只有对比「谁是现役」才看得出来）。
     原来写成 `.then(() => self.skipWaiting())` 是对的 —— 顺手的 await 化把它变成了死锁。
     这不是理论风险，是 tools/test-update-flow.js 实测抓到的：新缓存已建、旧缓存仍现役。 */
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const stale = keys.filter((k) => k !== CACHE);
    await Promise.all(stale.map((k) => caches.delete(k)));
    await self.clients.claim();

    /* 换版后主动刷新已打开的页面（见文件头 ②）。
       ⚠⚠ 这一句**绝对不能放进上面的 waitUntil**（v1.7.5 又一个实测抓到的死锁）：
       本 SW 在 activate 的 waitUntil 落地之前**不处理 fetch 事件**，
       而 navigate 会触发的正是同源导航请求 —— 没人应答，navigate 就挂死。
       实测（tools/test-update-flow.js）：挂 37 秒后返回
       "Cannot navigate to URL: http://127.0.0.1:8141/"，用户侧就是「新版发不出去」。
       改成 activate 结束后延迟一拍再发，此时 fetch 已生效，刷新立刻完成。 */
    if (stale.length) {
      setTimeout(() => {
        self.clients.matchAll({ type: 'window' })
          .then((cs) => Promise.all(cs.map((c) => c.navigate(c.url).catch(() => {}))))
          .catch(() => {});
      }, 250);
    }
  })());
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
