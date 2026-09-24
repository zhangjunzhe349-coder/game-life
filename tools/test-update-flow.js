/* ============================================================
   升级链路校验：用户装上新版之后，**打开一次**就该看到新内容
   ------------------------------------------------------------
   为什么需要它（v1.7.4 实机事故）：
   三处改动都写对了、四层校验全绿、APK 里也确实是新代码 ——
   但用户实机反馈「没有任何变化」。根因不在业务代码，在这条链路上：
     ① 旧版 Service Worker 是「缓存优先」，用户手里那张页面由它供货，
        它会把旧 index.html / 旧 app.js 一直供下去；
     ② 装新缓存时 `cache.add(u)` 默认走 HTTP 缓存，若浏览器手里还留着
        旧副本，新缓存里装的仍是旧文件；
     ③ sw.js 自己也被 HTTP 缓存住 → 更新检查拿到旧字节 → 浏览器认定「没有新版」；
     ④ 就算新 SW 装上了，「让旧页面刷新」这一步也差点做不成：从 activate 的
        waitUntil 里调 `Client.navigate()` 会**死锁**（本 SW 在 activate 落地前
        不处理 fetch，导航请求没人应答），实测挂 37 秒后报
        「Cannot navigate to URL」。所以客户端刷新必须放在页面侧
        （app.js 监听 controllerchange），SW 侧只留延迟兜底。
   四层叠加 = 「改了也白改」，而且从任何静态检查、甚至从 APK 拆包都看不出来。
   前端没有比这更隐蔽的失败方式了，只能真跑。

   本脚本做的事：
     阶段 1 · 用**旧提交**（默认 HEAD~1）的 sw.js / app.js / style.css 起一个站，
              让浏览器把旧 SW 装好、缓存吃满 —— 这就是用户手里那台机器。
     阶段 2 · 同一端口、同一浏览器 profile，换成新产物（= 用户装上新版），
              然后**只打开一次**，断言看到的已经是新版本、且应用真的启动完好。
     阶段 3 · 再打开一次，确认稳定（不是靠反复刷新碰运气）。
     可选  · --simulate-no-fix：把新版的三处修复全摘掉，预期断言失败。
              用来证明「这条断言真的有牙」—— 没有负向验证的测试是橡皮图章。

   用法：
     node tools/build-dist.js && node tools/test-update-flow.js
     node tools/build-dist.js && node tools/test-update-flow.js --simulate-no-fix
   依赖：ws（同 browser-check.js，用 NODE_PATH 指向其 node_modules）
   ============================================================ */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NEW_DIST = path.join(ROOT, 'dist');
const OLD_REV = (process.argv.find((a) => a.startsWith('--old=')) || '').slice(6) || 'HEAD~1';
const SIMULATE_NO_FIX = process.argv.includes('--simulate-no-fix');
/* HTTP 缓存模式：默认**允许**缓存（max-age），模拟真机上资源被 HTTP 缓存接管的常态。
   这一条很关键 —— 若关掉它（no-store），阶段 2 的失败模式根本复现不出来，
   脚本就会变成一张永远打勾的橡皮图章。 */
const NO_HTTP_CACHE = process.argv.includes('--no-http-cache');
const PORT = 8141;
const CDP_PORT = 9351;
const NewDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-upd-new-'));
const OldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-upd-old-'));
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-upd-profile-'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let SERVE = OldDir;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  /* SW 的自报信道：不依赖 clients、不依赖缓存，直接打到服务器。
     为什么需要它：activate 里用 postMessage 报步骤时，若 clients.matchAll 拿不到客户端，
     消息就永远发不出来 —— 那会让人误以为「activate 没跑」。这条信道堵不上这个漏洞。 */
  if (p === '/__swlog') {
    const q = new URLSearchParams((req.url.split('?')[1] || ''));
    console.log('      [' + new Date().toISOString().slice(11, 23) + ' SW自报] ' + (q.get('d') || ''));
    res.writeHead(204).end();
    return;
  }
  if (p === '/') p = '/index.html';
  const fp = path.join(SERVE, p);
  if (!fp.startsWith(SERVE)) { res.writeHead(403).end(); return; }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404).end('404'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream',
      'Cache-Control': NO_HTTP_CACHE ? 'no-store' : 'max-age=600',
    });
    res.end(buf);
  });
});

const EXE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((p) => fs.existsSync(p));

function loadWS() {
  try { return require('ws'); } catch (e) {}
  try { return require(path.join(ROOT, 'node_modules', 'ws')); } catch (e) {}
  return null;
}

function cdpGet(port, p) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port, path: p }, (x) => {
      let d = ''; x.on('data', (c) => (d += c)); x.on('end', () => res(d));
    });
    r.on('error', rej); r.end();
  });
}

/* ---------- 页面上的「地面真值」 ----------
   docId 用 performance.timeOrigin（每个文档一份，跨重新加载必然不同）：
   harness 收集本阶段见过的**不同** docId，就能判出「换版到底刷新了几次」。
   早先用 sessionStorage 自增计数是错的 —— 它每次求值都涨，
   量出来的其实是「我采样了几次」，不是「页面加载了几次」。 */
const MARKS = `(async () => {
  const g = window.GL || {};
  const sb = document.getElementById('stage-base');
  const main = document.getElementById('main');
  /* SW 生命周期的**现场记录**：光看「缓存建没建」会骗人 ——
     新 SW 完全可能已经把缓存建好了却停在 waiting（install 的 waitUntil 没结束、
     或 skipWaiting 没生效）。只有 registration 的三个槽位 + statechange 时间线
     能说清「它到底走到哪一步」。挂在 window 上，同一文档内多次求值不断累加。 */
  if (!window.__swHooked && navigator.serviceWorker) {
    window.__swHooked = true;
    window.__swLog = [];
    const hook = (name, w) => {
      if (!w) return;
      window.__swLog.push(name + '=' + w.state);
      w.addEventListener('statechange', () => window.__swLog.push(name + '→' + w.state));
    };
    navigator.serviceWorker.getRegistration().then((r) => {
      if (!r) { window.__swLog.push('无注册'); return; }
      hook('installing', r.installing); hook('waiting', r.waiting); hook('active', r.active);
    }).catch((e) => window.__swLog.push('注册读取失败：' + e.message));
    navigator.serviceWorker.addEventListener('controllerchange', () => window.__swLog.push('controllerchange'));
    /* SW 自己报的步骤（校验脚本会往 sw.js 里注入 tell()），比任何外部观测都权威 */
    navigator.serviceWorker.addEventListener('message', (ev) => {
      try { window.__swLog.push('SW: ' + JSON.stringify(ev.data)); } catch (e) {}
    });
  }
  const names = await caches.keys().catch(() => []);
  const cacheDetail = {};
  for (const n of names) {
    cacheDetail[n] = await caches.open(n).then((c) => c.keys()).then((k) => k.length).catch(() => -1);
  }
  return {
    docId: String(performance.timeOrigin),
    ver: g.VERSION || null,
    stageText: sb ? sb.innerText.replace(/\\s+/g, ' ').trim() : null,
    stageLines: sb ? sb.innerText.trim().split('\\n').filter(Boolean).length : -1,
    padTop: main ? parseFloat(getComputedStyle(main).paddingTop) : null,
    /* 「看到版本号」不够 —— 页面可能已经换版但还没启动完（<head> 的 CSS 已生效、
       <body> 末尾的脚本还没跑）。所以额外记录「应用真的起来了」的证据。 */
    booted: !!(g.state && g.state.attributes),
    hudReadouts: (document.getElementById('hud-readouts') || { children: [] }).children.length,
    portraitPaths: document.querySelectorAll('#portrait-svg path').length,
    controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
    ctrlName: (navigator.serviceWorker && navigator.serviceWorker.controller)
      ? navigator.serviceWorker.controller.scriptURL.split('/').pop() : null,
    swLog: window.__swLog || [],
    swCaches: names,
    cacheDetail: cacheDetail,
  };
})()`;

/* 起一个浏览器、执行 fn、再干净地关掉。
   必须干净关 — Service Worker 的注册与缓存是落盘的，
   硬 kill 会丢状态，阶段 2 就复现不出「用户手里那台机器」了。

   ⚠ 每次求值都**新开一条 CDP 连接**。踩过：复用同一条连接时，
   页面被 SW 换版刷新后会整个失联 —— 命令发出去 40 秒零响应、全部超时，
   看上去像「页面什么都没有」，其实只是测量通道死了。
   每跑一次请求就重连，代价是几十毫秒，换来的是「看到的确实是当前页面」。 */
async function withPage(WS, fn) {
  const url = `http://127.0.0.1:${PORT}/`;
  const child = spawn(EXE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
    '--hide-scrollbars', '--window-size=420,900', url,
  ], { stdio: 'ignore' });

  const errors = [];
  const swEvents = [];
  const reqUrl = new Map();
  let evWs = null;
  try {
    let target = null;
    for (let i = 0; i < 80; i++) {
      try {
        const l = JSON.parse(await cdpGet(CDP_PORT, '/json/list'));
        target = l.find((t) => t.type === 'page' && /^http/.test(t.url));
        if (target) break;
      } catch (e) {}
      await sleep(250);
    }
    if (!target) throw new Error('CDP 未就绪');

    /* 事件连接只用来收集异常与失败请求，断了也不影响断言（尽力而为） */
    try {
      evWs = new WS(target.webSocketDebuggerUrl);
      evWs.on('message', (raw) => {
        let m; try { m = JSON.parse(raw); } catch (e) { return; }
        if (m.method === 'Runtime.exceptionThrown') {
          const d = m.params.exceptionDetails;
          errors.push(`异常：${d.exception?.description || d.text}`);
        } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
          errors.push('console.error：' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
        } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
          errors.push('日志：' + m.params.entry.text);
        } else if (m.method === 'Network.requestWillBeSent') {
          reqUrl.set(m.params.requestId, m.params.request.url);
        } else if (m.method === 'Network.loadingFailed') {
          errors.push(`加载失败：${reqUrl.get(m.params.requestId) || m.params.requestId} → ${m.params.errorText}`);
        } else if (m.method === 'ServiceWorker.workerVersionUpdated') {
          /* 浏览器视角的 SW 生命周期（比页面内自报更权威） */
          for (const v of m.params.versions) {
            swEvents.push(`v${(v.scriptURL || '').split('?')[0].split('/').pop()}:${v.status}/${v.runningStatus}`);
          }
        } else if (m.method === 'ServiceWorker.workerErrorReported') {
          swEvents.push('SW 报错：' + (m.params.errorMessage && m.params.errorMessage.errorMessage));
        }
      });
      await new Promise((res, rej) => { evWs.on('open', res); evWs.on('error', rej); });
      evWs.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
      evWs.send(JSON.stringify({ id: 2, method: 'Network.enable' }));
      evWs.send(JSON.stringify({ id: 3, method: 'ServiceWorker.enable' }));
    } catch (e) { evWs = null; }

    const ev = async (expr) => {
      let w = null;
      try {
        const l = JSON.parse(await cdpGet(CDP_PORT, '/json/list'));
        const t = l.find((x) => x.type === 'page' && /^http/.test(x.url));
        if (!t) return { __err: '找不到页面目标' };
        w = new WS(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => { w.on('open', res); w.on('error', rej); });
        const r = await new Promise((res) => {
          const to = setTimeout(() => res({ __timeout: true }), 9000);
          w.on('message', (raw) => {
            let m; try { m = JSON.parse(raw); } catch (e) { return; }
            if (m.id !== 7) return;
            clearTimeout(to);
            res(m.error ? { __cdpError: m.error.message } : m.result);
          });
          w.send(JSON.stringify({ id: 7, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
        });
        if (r.__timeout) return { __err: 'evaluate 超时（页面导航中？）' };
        if (r.__cdpError) return { __err: 'CDP：' + r.__cdpError };
        if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
        return r.result ? r.result.value : undefined;
      } catch (e) {
        return { __err: 'eval 异常：' + e.message };
      } finally {
        try { w && w.close(); } catch (e) {}
      }
    };

    await sleep(700);
    const out = await fn(ev);
    return { out, errors, swEvents };
  } finally {
    try { evWs && evWs.close(); } catch (e) {}
    try {
      const v = JSON.parse(await cdpGet(CDP_PORT, '/json/version'));
      const bws = new WS(v.webSocketDebuggerUrl);
      await new Promise((r) => { bws.on('open', r); bws.on('error', r); });
      bws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
      await sleep(900);
      try { bws.close(); } catch (e) {}
    } catch (e) {}
    try { child.kill(); } catch (e) {}
    await sleep(400);
  }
}

async function waitFor(ev, pred, ms) {
  let last = null;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const m = await ev(MARKS);
    if (m && !m.__err) last = m;
    else if (!last) last = m;
    if (m && !m.__err && pred(m)) return { hit: true, m, ms: Date.now() - t0 };
    await sleep(400);
  }
  return { hit: false, m: last, ms: Date.now() - t0 };
}

const results = [];
const check = (ok, label, detail) => results.push({ ok, label, detail });

(async () => {
  if (!EXE) { console.error('✗ 找不到 Edge / Chrome，无法做升级链路校验'); process.exit(1); }
  const WS = loadWS();
  if (!WS) {
    console.error('✗ 缺少 ws 模块。先：cd <含 node_modules 的目录> && npm i ws，再用 NODE_PATH 指过去');
    process.exit(1);
  }
  if (!fs.existsSync(NEW_DIST)) { console.error('✗ 找不到 dist/。先跑：node tools/build-dist.js'); process.exit(1); }

  /* ---------- 造出「旧版」与「新版」两份产物 ---------- */
  fs.cpSync(NEW_DIST, NewDir, { recursive: true });
  fs.cpSync(NEW_DIST, OldDir, { recursive: true });
  for (const f of ['sw.js', 'js/app.js', 'css/style.css']) {
    let buf;
    try {
      buf = execFileSync('git', ['show', `${OLD_REV}:${f}`], { cwd: ROOT, maxBuffer: 1 << 28 });
    } catch (e) {
      console.error(`✗ 取不到旧版本文件 ${OLD_REV}:${f}（仓库里没有这个提交？）`);
      process.exit(1);
    }
    fs.writeFileSync(path.join(OldDir, f), buf);
  }

  if (SIMULATE_NO_FIX) {
    /* 负向验证：把新版的**三处**修复全摘掉，看断言是否真的会失败。
       三处缺一不可 —— 只摘一处而另一处兜住，测试就会变成橡皮图章。 */
    const p = path.join(NewDir, 'sw.js');
    let s = fs.readFileSync(p, 'utf8');
    s = s.replace(/\{ cache: 'reload' \}/g, '{}');
    const s2 = s.replace(/    if \(stale\.length\) \{[\s\S]*?\n    \}/, '    if (false) {}');
    if (s2 === s) { console.error('✗ 负向验证：摘不掉 sw.js 的延迟刷新'); process.exit(1); }
    fs.writeFileSync(p, s2, 'utf8');

    const q = path.join(NewDir, 'js/app.js');
    const j = fs.readFileSync(q, 'utf8');
    const j2 = j.replace(/      if \(navigator\.serviceWorker\.controller\) \{[\s\S]*?\n      \}/, '      if (false) {}');
    if (j2 === j) { console.error('✗ 负向验证：摘不掉 app.js 的 controllerchange 自刷'); process.exit(1); }
    fs.writeFileSync(q, j2, 'utf8');
  }

  /* ---------- 给新版 sw.js 注入「自报步骤」，让 activate 每一步都说话 ----------
     为什么必须这么做：外部只能看到「缓存建了没」「谁是现役」，
     而「activate 到底走到哪一行停住」只有 SW 自己知道。
     注入只发生在测试副本里，仓库里的 sw.js 保持干净。 */
  {
    const p = path.join(NewDir, 'sw.js');
    let s = fs.readFileSync(p, 'utf8');
    const orig = s;
    /* 观察者**追加**在文件末尾，而不是替换原 activate handler ——
       替换会让测试跑的根本不是生产逻辑：上一版注入版把 navigate 写在
       waitUntil 里（必死锁），而生产代码早已改成延迟发出，
       于是「测试绿不绿」和「生产对不对」彻底脱钩。
       追加的观察者不参与逻辑、不推迟 activate 落地。 */
    s += `
/* ---- 测试专用观察者（tools/test-update-flow.js 注入；生产 sw.js 不含此段）---- */
const __tell = (o) => { try { fetch('/__swlog?d=' + encodeURIComponent(JSON.stringify(o)), { cache: 'no-store', mode: 'no-cors' }).catch(() => {}); } catch (e) {} };
const __del = caches.delete.bind(caches);
caches.delete = (k) => __del(k).then(async (r) => {
  let left = [];
  try { left = await caches.keys(); } catch (e) {}
  __tell({ 观察: 'caches.delete', 缓存: k, 成功: r, 剩余: left });
  return r;
});
self.addEventListener('activate', () => {
  setTimeout(() => { caches.keys().then((k) => __tell({ 观察: 'activate 落地 1s 后的缓存', keys: k })).catch(() => {}); }, 1000);
});
`;
    if (s === orig) { console.error('✗ 无法注入 activate 追踪（sw.js 结构变了？）'); process.exit(1); }
    const s2 = s.replace(/\n  self\.skipWaiting\(\);/,
      "\n  fetch('/__swlog?d=' + encodeURIComponent(JSON.stringify({ step: 'I2 install 完成，即将 skipWaiting' })), { cache: 'no-store', mode: 'no-cors' }).catch(() => {});" +
      "\n  self.skipWaiting();");
    if (s2 === s) { console.error('✗ 无法注入 install 追踪'); process.exit(1); }
    fs.writeFileSync(p, s2, 'utf8');
    /* 注入后的文件必须语法正确 —— 否则 SW 会整份加载失败，
       表现成「什么都没发生」，而我们会去错误的地方找原因。 */
    try { execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' }); }
    catch (e) { console.error('✗ 注入追踪后的 sw.js 语法错误：\n' + String(e.stderr || e)); process.exit(1); }
  }
  /* ---------- 给**旧版** sw.js 也装上自报信道 ----------
     疑点：新 SW 明明删掉了 gamelife-v11，40 秒后它又带着完整 23 个文件回来了 ——
     而「往 gamelife-v11 灌 23 个文件」这件事只有旧 sw.js 的 install 会做。
     所以必须让旧 SW 开口：它到底有没有被重装、有没有还在替页面供货。 */
  {
    const p = path.join(OldDir, 'sw.js');
    let s = fs.readFileSync(p, 'utf8');
    const rep = (from, to, tag) => {
      const n = s.split(from).length - 1;
      if (n !== 1) { console.error(`✗ 旧 sw.js 注入「${tag}」失败（命中 ${n} 处）`); process.exit(1); }
      s = s.replace(from, to);
    };
    s = "const __ping = (m) => { try { fetch('/__swlog?d=' + encodeURIComponent(JSON.stringify({ 旧SW: true, m })), { cache: 'no-store', mode: 'no-cors' }).catch(() => {}); } catch (e) {} };\n" + s;
    rep("self.addEventListener('install', (e) => {", "self.addEventListener('install', (e) => {\n  __ping('install 开始');", 'install 开始');
    rep('.then(() => self.skipWaiting())', ".then(() => { __ping('install 已把全部资源灌进 ' + CACHE); return self.skipWaiting(); })", 'install 装完');
    rep("self.addEventListener('activate', (e) => {", "self.addEventListener('activate', (e) => {\n  caches.keys().then((k) => __ping('activate 看到 ' + k.join(',')));", 'activate 开始');
    rep('          const copy = res.clone();', "          __ping('接管并写缓存 ' + url.pathname);\n          const copy = res.clone();", '写缓存');
    fs.writeFileSync(p, s, 'utf8');
    try { execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' }); }
    catch (e) { console.error('✗ 注入追踪后的旧版 sw.js 语法错误：\n' + String(e.stderr || e)); process.exit(1); }
  }
  const readVer = (dir) => (fs.readFileSync(path.join(dir, 'js/app.js'), 'utf8').match(/APP_VERSION = '([^']+)'/) || [])[1];
  const readCache = (dir) => (fs.readFileSync(path.join(dir, 'sw.js'), 'utf8').match(/CACHE = '([^']+)'/) || [])[1];
  const OLD_VER = readVer(OldDir);
  const NEW_VER = readVer(NewDir);
  const OLD_CACHE = readCache(OldDir);
  const NEW_CACHE = readCache(NewDir);
  console.log(`  旧版 v${OLD_VER}（${OLD_REV}，缓存 ${OLD_CACHE}） → 新版 v${NEW_VER}（缓存 ${NEW_CACHE}）${SIMULATE_NO_FIX ? '  [负向验证：已摘掉修复]' : ''}`);
  console.log(`  HTTP 缓存：${NO_HTTP_CACHE ? '禁用（no-store）' : '允许（max-age=600，贴近真机）'}`);
  if (OLD_VER === NEW_VER) { console.error('✗ 新旧版本号相同，这个测试没有意义'); process.exit(1); }

  await new Promise((r) => srv.listen(PORT, '127.0.0.1', r));

  /* ---------- 阶段 1：把浏览器喂成「用户手里的旧机器」 ---------- */
  SERVE = OldDir;
  console.log('\n  阶段 1 · 装上旧版并让它把缓存吃满…');
  const baseRun = await withPage(WS, async (ev) => {
    const w = await waitFor(ev, (m) => m.controlled && m.swCaches.some((k) => k.includes('gamelife-v')), 25000);
    return w.m;
  });
  const base = baseRun.out;
  const okBase = !!base && base.ver === OLD_VER && base.booted;
  check(okBase, `基线就位：旧版 v${OLD_VER} 已由 SW 接管并启动完好（缓存 ${(base && base.swCaches || []).join('/') || '?'}）`,
    okBase ? '' : JSON.stringify(base) + '\n      ' + baseRun.errors.join('\n      '));

  /* ---------- 阶段 2：换上新版，**只打开一次** ---------- */
  SERVE = NewDir;
  console.log('  阶段 2 · 换成新版产物（= 用户装上新包），只打开一次…');
  const seenDocs = new Set();
  const updRun = await withPage(WS, async (ev) => {
    const rec = async (e) => {
      const m = await ev(e);
      if (m && !m.__err && m.docId) seenDocs.add(m.docId);
      return m;
    };
    const w = await waitFor(rec, (m) => m.ver === NEW_VER && m.booted && m.hudReadouts > 0, 40000);
    return { w, docs: seenDocs.size };
  });
  const one = (updRun.out && updRun.out.w) || {};
  const m1 = one.m || {};
  const docs = (updRun.out && updRun.out.docs) || 0;
  const oneTime = m1.ver === NEW_VER && m1.booted && m1.hudReadouts > 0;
  const detail = (extra) => [extra, JSON.stringify(m1),
    '缓存状态：' + JSON.stringify(m1.cacheDetail || {}),
    '现役 SW：' + (m1.ctrlName || '无'),
    '页面内 SW 日志：' + ((m1.swLog || []).join(' | ') || '(空)'),
    '浏览器 SW 事件：' + ((updRun.swEvents || []).slice(-12).join(' | ') || '(无)'),
    updRun.errors.length ? updRun.errors.join('\n      ') : '(无页面异常/失败请求)'].filter(Boolean).join('\n      ');
  if (SIMULATE_NO_FIX) {
    check(m1.ver !== NEW_VER, `负向验证：摘掉修复后，打开一次**看不到**新版（实测 v${m1.ver}）—— 说明这条断言真的有牙`,
      m1.ver === NEW_VER ? '竟然变成新版了，说明测试没复现出问题，断言不可信' : '');
  } else {
    check(oneTime, `打开一次即看到新版且启动完好（v${m1.ver}，读数 ${m1.hudReadouts} 项、立绘 ${m1.portraitPaths} 条路径${one.hit ? `，${one.ms}ms 内` : '，超时未完成'}）`,
      oneTime ? '' : detail(''));
    check(m1.stageLines === 1, `立绘下方读数只剩 1 行（实测 ${m1.stageLines} 行：${m1.stageText}）`);
    /* 这里断言的是**要求**（页头必须留出状态栏空间），不是**变化** ——
       早先写成「必须比旧版更大」，一旦拿 v1.7.4 当旧版（它已经有这条留白）
       就会无辜报错。校验脚本自己也要避免这种「只对某个特定旧版成立」的判据。 */
    check(m1.padTop >= 40, `顶部预留了系统状态栏（实测 ${m1.padTop}px ≥ 40px；旧版为 ${base && base.padTop}px）`);
    check((m1.swCaches || []).includes(NEW_CACHE) && !(m1.swCaches || []).includes(OLD_CACHE),
      `缓存已换代（现存 ${(m1.swCaches || []).join('/')}）`);
    check(docs <= 2, `换版只刷新一次、没有陷入刷新循环（本阶段见过 ${docs} 个不同文档）`);
  }

  /* ---------- 阶段 3：再打开一次，确认稳定 ---------- */
  const againRun = await withPage(WS, async (ev) => {
    await waitFor(ev, (m) => m.booted && m.hudReadouts > 0, 20000);
    return ev(MARKS);
  });
  const two = againRun.out;
  if (SIMULATE_NO_FIX) {
    /* 摘掉修复时，连「再打开」也仍是旧内容 —— 因为新缓存里装的是 HTTP 缓存里的
       旧文件（这正说明「装缓存时绕开 HTTP 缓存」那一处也是必需的，不是可选项）。 */
    check(!!two && !two.__err && two.ver !== NEW_VER,
      `负向验证：后续打开仍是旧内容（实测 v${two && two.ver}）—— 证明「绕开 HTTP 缓存」同样必需`);
  } else {
    check(!!two && !two.__err && two.ver === NEW_VER && two.booted, `再次打开仍是新版且启动完好（v${two && two.ver}）`);
    check(!!two && !two.__err && two.controlled, '新版下 SW 仍正常工作（离线能力没被破坏）');
  }

  /* ---------- 输出 ---------- */
  srv.close();
  console.log('');
  results.forEach((r) => console.log(`  ${r.ok ? '✓' : '✗'} ${r.label}${r.detail ? '\n      → ' + r.detail : ''}`));
  const bad = results.filter((r) => !r.ok).length;
  console.log(bad ? `\n❌ 升级链路校验 ${bad} 处未过` : '\n✅ 升级链路校验通过');
  process.exit(bad ? 1 : 0);
})();
