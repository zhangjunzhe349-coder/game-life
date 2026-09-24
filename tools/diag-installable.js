#!/usr/bin/env node
'use strict';
/* 诊断一个线上地址「为什么没有安装到主屏幕的入口」。

   浏览器只在**满足全部可安装条件**时才显示「安装应用」——Chrome 108 起已取消
   无条件的「添加到主屏幕」，不满足条件时菜单里连这一项都没有。于是「没这个选项」
   到底是配置缺失还是浏览器不支持，从界面上看不出来。

   这里用 Chrome DevTools 协议里两个专管此事的命令，让浏览器自己说出原因：
     Page.getAppManifest          manifest 有没有解析错误
     Page.getInstallabilityErrors Chrome 判定不可安装的具体条目
   （headless 与真机判定基本一致；若浏览器不报任何条目，即视为可安装。）

   用法：
     node tools/diag-installable.js https://example.com/
   依赖与浏览器的定位方式同 browser-check.js（ws 走 NODE_PATH 或仓库 node_modules）。
   本工具**只读**：不改任何文件，只访问给定 URL。
*/

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CDP_PORT = 9341;
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Mobile Safari/537.36';

const CANDIDATES = [
  process.env.BROWSER_EXE,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const EXE = CANDIDATES.find((p) => fs.existsSync(p));

function loadWS() {
  try { return require('ws'); } catch (e) {}
  try { return require(path.join(ROOT, 'node_modules', 'ws')); } catch (e) {}
  return null;
}

const cdpGet = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: CDP_PORT, path: p }, (r) => {
    let s = ''; r.on('data', (c) => (s += c)); r.on('end', () => res(s));
  }).on('error', rej);
});

/* 把 CDP 的 errorId 翻成能照着做的话 */
const HINTS = {
  'no-icon-available': ['一个图标都取不到。清单里的图标路径必须真实存在', '检查 icons[].src，逐个下载确认 200'],
  'no-acceptable-icon': ['图标尺寸不合规。必须至少有一张 ≥192×192 且 ≥512×512 的 any 图标', '补 192 与 512 两档，purpose 用 any'],
  'manifest-missing-suitable-icon': ['缺少适用于首页/启动图的图标尺寸', '同上'],
  'manifest-missing-name-or-short-name': ['manifest 缺 name 或 short_name', '补上'],
  'manifest-display-not-standalone': ['display 不是 standalone / fullscreen / minimal-ui', '改成 fullscreen 或 standalone'],
  'start-url-not-valid': ['start_url 无效或跨出 scope', '用相对路径 "./index.html"'],
  'no-matching-service-worker': ['Service Worker 与页面不在同一 scope 下', 'SW 必须放在站点根、scope 覆盖 start_url'],
  'no-service-worker': ['没有注册 Service Worker', 'app.js 里注册 sw.js'],
  'service-worker-not-registered': ['Service Worker 没注册成功。常见于 MIME 不是 JS 类型，或注册失败被 catch 静默吞掉', '查 sw.js 响应头 content-type 是否 text/javascript'],
  'no-fetch-handler': ['SW 里没有 fetch 事件监听。Chrome 认为这不构成可离线应用', "sw.js 加 self.addEventListener('fetch', ...)"],
  'not-offline-capable': ['SW 没有真正能离线供应资源', '确认缓存里装了页面与静态资源'],
  'prefer-related-applications': ['manifest 里 prefer_related_applications: true 会让浏览器不给安装入口', '删掉或置为 false'],
  'not-in-main-frame': ['当前页面不是主框架（被嵌在 iframe 里）', '从顶层页面访问'],
  'in-incognito': ['无痕模式下不允许安装', '换普通窗口'],
  'platform-not-supported': ['该平台/浏览器不支持安装 PWA', '换 Chrome / Edge / 三星浏览器'],
  'no-gesture': ['需要用户手势才能安装（本工具为纯诊断，可忽略此条）', '真机上点一下页面再开菜单'],
};

(async () => {
  const url = (process.argv[2] || '').trim();
  if (!/^https?:\/\//.test(url)) {
    console.error('用法：node tools/diag-installable.js https://example.com/');
    process.exit(1);
  }
  if (!EXE) { console.error('✗ 找不到 Chrome / Edge'); process.exit(1); }
  const WS = loadWS();
  if (!WS) {
    console.error('✗ 缺少 ws 模块（要靠 WebSocket 连 CDP）。任选其一：');
    console.error('    npm i ws');
    console.error('    NODE_PATH=<含 node_modules 的目录> node tools/diag-installable.js <url>');
    process.exit(1);
  }

  console.log(`\n诊断目标：${url}`);
  console.log(`浏览器：${path.basename(EXE)}\n${'─'.repeat(64)}`);

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gldiag-'));
  const child = spawn(EXE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
    '--window-size=412,915', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i++) {
    try {
      const l = JSON.parse(await cdpGet('/json/list'));
      target = l.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!target) { child.kill(); console.error('✗ CDP 未就绪'); process.exit(1); }

  const ws = new WS(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p = {}) => new Promise((res) => {
    const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  /* 贴近真机：安卓 UA + 手机视口。UA 会影响浏览器对「该平台是否支持安装」的判定 */
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.6, mobile: true });
  await send('Emulation.setUserAgentOverride', { userAgent: ANDROID_UA, platform: 'Android' });
  await send('Page.navigate', { url });

  /* 等页面 + Service Worker 真正就位：SW 没激活时容易误报「不可安装」 */
  let ready = false;
  for (let i = 0; i < 100; i++) {
    const st = await ev(`(async () => {
      try {
        if (document.readyState !== 'complete') return 'loading';
        const r = await navigator.serviceWorker.getRegistration();
        if (!r) return 'no-sw';
        if (!navigator.serviceWorker.controller && !r.active) return 'sw-pending';
        return 'ready';
      } catch (e) { return 'err:' + e.message; }
    })()`);
    if (st === 'ready') { ready = true; break; }
    if (st && st.__err) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`Service Worker 就位：${ready ? '是' : '否（下面的判定可能因此偏严）'}\n`);

  /* ---------- ① manifest 解析 ---------- */
  const mf = await send('Page.getAppManifest');
  console.log('① manifest');
  if (mf && mf.url) {
    console.log(`   地址：${mf.url}`);
    if (mf.errors && mf.errors.length) {
      mf.errors.forEach((e) => console.log(`   ✗ ${e.critical ? '[致命] ' : '[警告] '}${e.message}（第 ${e.line} 行）`));
    } else {
      console.log('   ✓ 无解析错误');
    }
  } else {
    console.log('   ✗ 页面没有声明 manifest（缺 <link rel="manifest">）');
  }

  /* ---------- ② 浏览器判定不可安装的原因 ---------- */
  const inst = await send('Page.getInstallabilityErrors');
  const list = (inst && inst.installabilityErrors) || null;
  console.log('\n② 可安装性判定（浏览器原话）');
  if (list === null) {
    console.log('   · 该浏览器不支持这个诊断命令（老版本 Chrome/Edge 无此命令）');
  } else if (!list.length) {
    console.log('   ✓ 浏览器未报任何不可安装原因 —— 即「可安装」，菜单里应该出现「安装应用」');
  } else {
    list.forEach((e) => {
      const args = (e.errorArguments || []).map((a) => `${a.name}=${a.value}`).join(' ');
      console.log(`   ✗ ${e.errorId}${args ? '  (' + args + ')' : ''}`);
      const h = HINTS[e.errorId];
      if (h) { console.log(`       可能原因：${h[0]}`); console.log(`       对策：${h[1]}`); }
    });
  }

  /* ---------- ③ 现场事实（与判定交叉验证） ---------- */
  const facts = await ev(`(async () => {
    const out = {};
    out.href = location.href;
    out.isSecure = window.isSecureContext;
    try {
      const r = await navigator.serviceWorker.getRegistration();
      out.swScope = r ? r.scope : null;
      out.swActive = !!(r && r.active);
      out.swController = !!navigator.serviceWorker.controller;
      if (r && r.active) {
        const names = await caches.keys();
        out.caches = names;
        if (names.length) { const c = await caches.open(names[0]); out.cached = (await c.keys()).length; }
        /* fetch 监听无法直接探测，改为实测离线能力：缓存里有没有首页与 sw 自身之外的静态资源 */
      }
    } catch (e) { out.swErr = e.message; }
    out.manifestHref = (document.querySelector('link[rel=manifest]') || {}).href || null;
    return out;
  })()`);
  console.log('\n③ 现场事实');
  if (facts && !facts.__err) {
    console.log(`   页面：${facts.href}`);
    console.log(`   安全上下文：${facts.isSecure ? '是（HTTPS）' : '否 —— 非 HTTPS 一定不可安装'}`);
    console.log(`   manifest 声明：${facts.manifestHref || '（无）'}`);
    console.log(`   SW 作用域：${facts.swScope || '（未注册）'}`);
    console.log(`   SW 已激活：${facts.swActive ? '是' : '否'}   已接管页面：${facts.swController ? '是' : '否'}`);
    console.log(`   缓存空间：${(facts.caches || []).join(', ') || '（空）'}   已缓存资源：${facts.cached ?? '—'} 项`);
  } else {
    console.log(`   求值失败：${facts && facts.__err}`);
  }

  console.log(`\n${'─'.repeat(64)}`);
  console.log('结论怎么读：② 那一段是浏览器自己的判定。若它说「未报任何原因」，');
  console.log('那问题不在站点，而在你手机上用的那个浏览器（换 Chrome / Edge 即可）。\n');

  ws.close();
  child.kill();
  process.exit(0);
})().catch((e) => { console.error('✗ 诊断脚本异常：', e && e.message); process.exit(1); });
