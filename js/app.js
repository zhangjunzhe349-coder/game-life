/* ============ Game Life · 应用入口 / 导航 / 顶栏 / 设置 ============ */
(function () {
  'use strict';

  const APP_VERSION = '1.13.0';
  GL.VERSION = APP_VERSION;

  /* ---------- 顶部 HUD 读数 ----------
     v1.8.2 按用户要求重做：只留三格，且三格都要「像游戏」——
       剩余生命（周）· 年龄（精确到天）· 电量（一个电池）
     删掉的三格是「记录天数 / 累计经验 / 状态均值」：前两个是记账信息、
     最后一个是抽象均值，都跟「角色此刻处在什么状态」无关。
     用户原话：「展现的信息不贴近游戏感，记录天数不要了，累计经验页不要了，
     状态均值也不要了，加一个年龄，要精确到天的那种，还有当前显示当前电量，
     一个电池，这个跟踪底下的生理值。」 */

  /* 电池：电量 = 属性面板「生理值」组的综合状态（按极性反转，困倦度低=电量高）。
     颜色三档：≥70 信号青 / ≥40 琥珀 / 其余红 —— 与全站语义色一致。 */
  function batterySvg(pct) {
    const color = pct >= 70 ? '#3ce8b0' : (pct >= 40 ? '#ffc24b' : '#ff5f6d');
    const w = Math.max(0, Math.round(32 * Math.max(0, Math.min(100, pct)) / 100));
    return `<svg class="batt" viewBox="0 0 46 22" width="46" height="22" role="img" aria-label="电量 ${pct}%">
      <rect x="1" y="1" width="38" height="20" rx="5" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="2"/>
      <rect x="41" y="7" width="4" height="8" rx="2" fill="rgba(255,255,255,0.28)"/>
      ${w > 0 ? `<rect x="4" y="4" width="${w}" height="14" rx="3" fill="${color}"/>` : ''}
    </svg>`;
  }

  function renderHudBar() {
    const lvEl = document.getElementById('hud-lv');
    const boxEl = document.getElementById('hud-readouts');
    if (!lvEl || !boxEl) return;
    const hero = GL.heroLevel();
    const life = GL.lifeInfo();
    const batt = GL.groupScore('physio');
    lvEl.textContent = hero.level;
    boxEl.innerHTML = `
      <div class="readout warn"><b>${life.remainW.toLocaleString()}<i>周</i></b><span>剩余生命</span></div>
      <div class="readout"><b>${life.ageY}<i>岁</i> ${life.ageD}<i>天</i></b><span>年龄</span></div>
      <div class="readout batt-readout" title="电量 = 属性面板「生理值」6 项的综合状态">
        <b>${batterySvg(batt === null ? 0 : batt)}<span class="batt-pct">${batt === null ? '—' : batt}<i>%</i></span></b>
        <span>电量</span>
      </div>`;
  }

  /* ---------- 入场序列 ---------- */
  function reveal(scope) {
    const els = (scope || document).querySelectorAll('.rv');
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.05 });
    els.forEach((e) => io.observe(e));
  }

  /* ---------- 导航 ---------- */
  function initTabs() {
    const tabs = document.getElementById('tabs');
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === btn));
      const id = btn.dataset.tab;
      document.querySelectorAll('.panel').forEach((p) => (p.hidden = p.id !== 'panel-' + id));
      /* v1.8.2 起技能详情是**就地展开**（完整卡在 panel-skills 内部），
         切页签时不需要任何收尾 —— 展开态跟着面板一起隐藏、切回来还在。 */
      if (id === 'life') GL.renderLife();
      /* v1.11.0：衣橱独立成页。切进来时重画一次 —— 41 张图带 loading="lazy"，
         首屏不加载，切页时才解码。 */
      if (id === 'wardrobe' && GL.renderWardrobe) GL.renderWardrobe();
      reveal(document.getElementById('panel-' + id));
      window.scrollTo({ top: 0 });
    });
  }

  /* ---------- 设置面板 ----------
     v1.8.2 按用户要求瘦身，只留「数据管理」与「关于」两张卡。
     撤掉的三张是「技能篇预设」「版本与回滚」「安装到桌面」——
     用户原话：「这都属于和用户体验无关的信息」。
     数据管理反过来做厚了一点：导出后必须**明确告诉用户文件去哪了**
     （「不然用户找不到」），否则导出等于没导出。 */
  function renderSettings() {
    const el = document.getElementById('panel-settings');
    if (!el) return;
    const bytes = new Blob([JSON.stringify(GL.state)]).size;
    const count = (GL.state.physiology.hydration.logs.length || 0)
      + GL.state.physiology.fields.reduce((s, f) => s + (f.history || []).length, 0)
      + GL.state.attributes.reduce((s, a) => s + (a.history || []).length, 0)
      + GL.state.skills.reduce((s, k) => s + (k.logs || []).length, 0);
    el.innerHTML = `
    <div class="card">
      <div class="card-head"><span class="card-title">💾 数据管理</span><span class="card-hint">全部数据存于本机浏览器</span></div>
      <div class="muted">当前数据量 <b>${(bytes / 1024).toFixed(1)} KB</b> · 历史记录 <b>${count}</b> 条</div>
      <div class="set-row">
        <button class="btn primary" id="btn-export">⬇ 导出备份</button>
        <button class="btn" id="btn-import">⬆ 导入备份</button>
        <input type="file" id="file-import" accept=".json,application/json" hidden>
        <button class="btn danger" id="btn-reset">🗑 恢复默认</button>
      </div>
      <div id="export-result" class="save-path" hidden></div>
      <div class="dim" style="margin-top:12px">
        · <b>换设备 / 换浏览器</b>：先「导出备份」，在新设备「导入备份」即可完整迁移。<br>
        · 清除浏览器数据会清空记录，建议定期导出备份。
      </div>
    </div>

    <div class="card">
      <div class="card-head"><span class="card-title">ℹ️ 关于</span><span class="card-hint">LOCAL-FIRST · v${APP_VERSION}</span></div>
      <div class="dim">
        Game Life v${APP_VERSION} · 每日必做 / 生理追踪 / 属性面板 / 技能成长 / 电子衣橱 / 生命刻度<br>
        本地优先 · 无需登录 · 数据自主可控。后续可拓展：智能硬件自动同步、多端云同步、照片生成真实比例模型。
      </div>
      <div class="set-row">
        <button class="btn" id="btn-check-update">🔄 检查更新</button>
        <span class="upd-state" id="upd-state"><i>当前</i> v${APP_VERSION}</span>
      </div>
      <div class="dim" id="upd-note" style="margin-top:12px"></div>
    </div>`;

    /* 说明文案按运行形态分开写 —— 网页与原生包能做的事**根本不同**，
       写成一样就等于骗原生包用户（用户的「APP」多半是主屏上的 PWA，但要如实区分）。 */
    const note = el.querySelector('#upd-note');
    if (note) {
      note.innerHTML = GL.isNativeApp()
        ? '安卓安装包（APK）的网页资源<b>打包在包体里</b>，应用内换不了包体本身 —— '
          + '但这里会去<b>线上核对版本</b>：有新版本就给出「下载安装」按钮，装上即可覆盖（数据不丢）。'
        : '点一下会同时核对<b>线上版本清单</b>与离线缓存：有新版本立即下载并自动刷新，<b>不用退出 App 重开</b>。<br>'
          + '平时每次打开 App 也会自动检查一次；从主屏图标唤起时若复用了后台那张页面，就靠这个按钮补一下。';
    }
  }

  /* 导出结果面板：文件名 / 大小 / 保存位置（按平台判定）+ 复制路径 + 另存一份。
     位置说明来自 GL.saveLocation()：浏览器读不到真实下载目录，
     所以给的是「该平台默认落到哪」+「怎么找到它」—— 这是纯网页能做到的上限。 */
  function showExportResult(name, byteLen, file, canShare) {
    const box = document.getElementById('export-result');
    if (!box) return;
    const loc = GL.saveLocation();
    box.dataset.path = loc.path;
    box._file = file || null;
    box.innerHTML = `
      <div class="sp-head">✅ 备份已导出</div>
      <div class="sp-row"><span>文件名</span><b>${GL.esc(name)}</b></div>
      <div class="sp-row"><span>大小</span><b>${(byteLen / 1024).toFixed(1)} KB</b></div>
      <div class="sp-row"><span>保存位置</span><b class="sp-path">${GL.esc(loc.path)}</b></div>
      <div class="sp-how">${loc.how}</div>
      <div class="sp-how dim">浏览器出于安全限制，<b>网页读不到实际下载目录</b>，上面是所在平台的默认位置；按文件名就能找到它。</div>
      <div class="set-row">
        <button class="btn mini" id="btn-copy-path">📋 复制路径</button>
        ${canShare ? '<button class="btn mini" id="btn-share-file">📤 另存 / 分享一份</button>' : ''}
      </div>`;
    box.hidden = false;
  }

  function bindSettings() {
    const el = document.getElementById('panel-settings');
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';

    el.addEventListener('click', (e) => {
      if (e.target.id === 'btn-export') {
        const json = JSON.stringify(GL.state, null, 2);
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const name = 'gamelife-backup-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
        const blob = new Blob([json], { type: 'application/json' });
        const file = new File([blob], name, { type: 'application/json' });
        const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));

        /* 安卓 App（Capacitor 的 WebView）不一定处理 blob 下载 → 优先交给系统分享，
           用户自己选位置；网页端照旧用 <a download>，那才是桌面用户的预期。 */
        if (GL.isNativeApp() && canShare) {
          navigator.share({ files: [file], title: name }).catch(() => { /* 用户取消 */ });
        } else {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = name;
          a.click();
          /* 立刻 revoke 有可能把还没开始的下载掐掉，留 4 秒缓冲 */
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        }
        showExportResult(name, blob.size, file, canShare);
        GL.toast('备份已导出', 'ok');
      } else if (e.target.id === 'btn-import') {
        el.querySelector('#file-import').click();
      } else if (e.target.id === 'btn-copy-path') {
        const box = el.querySelector('#export-result');
        GL.copy((box && box.dataset.path) || '')
          .then((ok) => GL.toast(ok ? '路径已复制' : '复制失败，请手动选中复制', ok ? 'ok' : 'err'));
      } else if (e.target.id === 'btn-share-file') {
        const box = el.querySelector('#export-result');
        const f = box && box._file;
        if (f && navigator.share) navigator.share({ files: [f], title: f.name }).catch(() => {});
      } else if (e.target.id === 'btn-check-update') {
        GL.checkUpdate();
      } else if (e.target.id === 'btn-reset') {
        if (!confirm('⚠️ 将清空全部数据并恢复默认（含所有历史记录），确定继续吗？')) return;
        GL.reset();
        GL.toast('已恢复默认数据');
        GL.changed();
      }
    });

    el.addEventListener('change', (e) => {
      if (e.target.id !== 'file-import' || !e.target.files.length) return;
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = () => {
        try {
          GL.importData(reader.result);
          GL.toast('导入成功', 'ok');
          GL.changed();
        } catch (err) {
          GL.toast('导入失败：' + err.message, 'err');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }

  /* ---------- 换版自愈 · 共用件（v1.9.0） ----------
     「自动（打开页面时）」与「手动（点检查更新）」两条路都汇到 reloadForUpdate()：
     刷新前先落盘 + **单次守卫**（两个入口可能几乎同时到达，
     各自 location.reload() 会让页面抖两下）。 */
  let reloadedForUpdate = false;
  const UPD_FLAG = 'gamelife-updated';

  function reloadForUpdate() {
    if (reloadedForUpdate) return;
    reloadedForUpdate = true;
    try { GL.save(); } catch (e) { /* 状态本来就存着，这里只为万一 */ }
    location.reload();
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- 权威版本源（v1.10.1） ----------
     为什么必须有这一层：SW 的 update() 只回答「sw.js 这个文件有没有变」，
     它**回答不了**「线上现在是什么版本」。而原生 APK 的网页资源是打包进包体的，
     它读到的 sw.js 永远是包内那份 —— reg.update() 必然得出「没变化」，
     于是老按钮在 APK 里**永远显示「已是最新」**（用户 2026-11-01 报的正是这个）。

     所以判据换成两条腿：
       ① 权威清单：线上到底是多少版（与 SW 无关，跨域也可读）；
       ② SW 更新：网页端真正换资源的那条路。
     两者矛盾时（清单说新、SW 说没新）信清单，走 hardReload 清缓存。

     全部免费：GitHub Pages / Releases API 都返回 `Access-Control-Allow-Origin: *`，
     不需要任何付费服务，也不需要自建服务器。 */

  const UPD_FEED_SAME = 'version.json';
  const UPD_FEED_REMOTE = [
    'https://zhangjunzhe349-coder.github.io/game-life/version.json',
    'https://api.github.com/repos/zhangjunzhe349-coder/game-life/releases/tags/android-latest',
  ];
  const APK_URL = 'https://github.com/zhangjunzhe349-coder/game-life/releases/download/android-latest/GameLife.apk';

  /* 语义化版本比较：必须按数字段比。字符串比较里 '1.10.1' < '1.9.0' 是 true，
     这个坑会让「发了新版却说没更新」再犯一次。 */
  function cmpVer(a, b) {
    const pa = String(a || '0').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }
  /* 暴露出去只为让校验脚本能直接钉住「按数字段比」这条 —— 界面不消费它。 */
  GL.cmpVer = cmpVer;

  /* 两种响应归一：自家 version.json 与 GitHub Releases API 结构不同，这里抹平。 */
  function pickVer(d) {
    if (!d) return null;
    if (typeof d.version === 'string' && /^\d+\.\d+\.\d+/.test(d.version.trim())) {
      return { version: d.version.trim(), apkUrl: (d.apk && d.apk.url) || APK_URL };
    }
    /* Releases API：title 形如「Game Life 安卓版 v1.10.1」 */
    const m = /v?(\d+\.\d+\.\d+)/.exec(String(d.name || '') + ' ' + String(d.body || ''));
    if (!m) return null;
    const asset = (d.assets || []).find((a) => /\.apk$/i.test(a.name || ''));
    return { version: m[1], apkUrl: (asset && asset.browser_download_url) || APK_URL };
  }

  function fetchJson(url, ms) {
    return new Promise((resolve, reject) => {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = setTimeout(() => {
        if (ctl) { try { ctl.abort(); } catch (e) { /* ignore */ } }
        reject(new Error('timeout'));
      }, ms || 6000);
      fetch(url, {
        cache: 'no-store',
        signal: ctl ? ctl.signal : undefined,
        headers: { Accept: 'application/json' },
      }).then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then((d) => { clearTimeout(timer); resolve(d); })
        .catch((e) => { clearTimeout(timer); reject(e); });
    });
  }

  /* 竞速取第一个可用结果：单个源慢/被墙时不让用户干等。
     不用 Promise.any —— Android 7/8 的老 WebView 未必有。 */
  function firstOk(tasks, ms) {
    return new Promise((resolve) => {
      let left = tasks.length;
      let done = false;
      const timer = setTimeout(() => {
        if (!done) { done = true; resolve(null); }
      }, ms);
      if (!left) { clearTimeout(timer); resolve(null); }
      tasks.forEach((run) => {
        Promise.resolve().then(run).then((v) => {
          if (!done && v) { done = true; clearTimeout(timer); resolve(v); }
        }).catch(() => { /* 单源失败不影响其他源 */ })
          .then(() => {
            left -= 1;
            if (left <= 0 && !done) { done = true; clearTimeout(timer); resolve(null); }
          });
      });
    });
  }

  async function fetchLatest() {
    const stamp = () => Date.now();
    /* 原生包：只信 **GitHub Releases** —— 它是唯一能反映「包体真的出好了没有」的源。
       自家 version.json 是跟着网页一起发布的，可能比 APK 早 1~2 分钟落地；
       拿它判断，用户会下载到一个还是旧版的包，装完再检查又是一样的话，白跑一趟。
       而且原生包**绝不能**读同源 version.json —— 那份是打包时的旧快照，
       读它就会永远得出「已是最新」，正是这次要修的假象。 */
    if (GL.isNativeApp()) {
      const gh = await firstOk([
        () => fetchJson(UPD_FEED_REMOTE[1] + '?t=' + stamp(), 6000).then(pickVer),
      ], 6500);
      if (gh) return gh;
      /* API 不通时的兜底：Pages 上的清单（比内置托管多 CORS 头，能跨域读） */
      return firstOk([
        () => fetchJson(UPD_FEED_REMOTE[0] + '?t=' + stamp(), 6000).then(pickVer),
      ], 6500);
    }
    /* 网页/PWA：同源清单最快，也与本次部署天然同步 */
    const tasks = [UPD_FEED_SAME].concat(UPD_FEED_REMOTE).map(
      (u) => () => fetchJson(u + (u.indexOf('?') < 0 ? '?t=' : '&t=') + stamp(), 6000).then(pickVer));
    return firstOk(tasks, 6500);
  }

  /* 硬重载：连 Cache Storage 一起清。
     只在「清单说新版、SW 却说没有」这种自相矛盾时用 ——
     正常换版走 skipWaiting + controllerchange，不动用户的离线缓存。 */
  async function hardReload() {
    try {
      if (window.caches && caches.keys) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.unregister();
      }
    } catch (e) { /* 清不掉也照刷：至少 HTML 会重新走网络 */ }
    reloadForUpdate();
  }

  /* 原生包专用：把「去下载」变成一个真按钮。
     Capacitor 的 WebView 对非 app 源的跳转会交给系统浏览器（allowNavigation 默认为空），
     所以 location.href 比 target=_blank 可靠 —— WebView 默认不开多窗口。 */
  function showApkDownload(url, ver) {
    const btn = document.getElementById('btn-check-update');
    if (!btn || !btn.parentNode) return;
    let a = document.getElementById('btn-download-apk');
    if (!a) {
      a = document.createElement('a');
      a.id = 'btn-download-apk';
      a.className = 'btn primary';
      a.rel = 'noopener';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        location.href = url;
      });
      btn.parentNode.insertBefore(a, btn.nextSibling);
    }
    a.href = url;
    a.textContent = `⬇ 下载安装 v${ver}`;
  }

  /* ---------- 检查更新（v1.9.0 起，v1.10.1 换成双判据） ----------
     为什么需要这个按钮：SW 的自动更新检查**只在页面加载时发生**（见 start() 里的
     register + reg.update）。手机上把 PWA 添加到主屏之后，从主屏图标唤起往往复用
     已在后台的那张页面 —— 注册流程不会再跑一次，自动检查也就不会发生，用户看到的
     一直是旧界面，只能「完全退出 App 再重开一次」（v1.7.4 事故残留的那个场景）。
     按钮把这条链路变成显式可控：强制 reg.update() → 新 SW 装上 →
     install 里的 skipWaiting() + activate 里的 clients.claim() → controllerchange
     → 页面自刷一次。全程不需要用户退出 App。

     判据：SW 的更新检查**没有**「我没有新版本」这种直接回调，只能反推 ——
     `update()` 的 promise 在「sw.js 取回、字节比对完毕」之后 resolve，
     真有新版的话此刻 reg.installing（或 waiting）已经就位。
     所以「查完仍然没有新 worker 进来」= 已是最新。（Workbox 一类库也是这个思路。）

     三种形态如实说，不假装：
       · 网页 / PWA（https）—— 真能自更新；
       · 离线 —— 直说离线，不谎报「已是最新」；
       · 原生 APK —— 网页资源打包在包体里，应用内换不了，只做版本核对。 */
  const UPDATE_TIMEOUT = 8000;

  function newWorkerIn(reg, before) {
    return !!((reg.installing && reg.installing !== before)
      || (reg.waiting && reg.waiting !== before));
  }

  /* 兜底通道：新 SW 若卡在 waiting（理论上不该发生 —— 新版 install 里已 skipWaiting()），
     发条消息让它立刻上位。sw.js 里有对应的 message 处理。 */
  function promoteWaiting(reg) {
    if (reg && reg.waiting) {
      try { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) { /* ignore */ }
    }
  }

  GL.checkUpdate = async function () {
    const stateEl = document.getElementById('upd-state');
    const btn = document.getElementById('btn-check-update');
    const say = (text, kind) => {
      if (!stateEl) return;
      stateEl.textContent = text;
      stateEl.dataset.kind = kind || '';
    };
    const finish = (r) => { if (btn) btn.disabled = false; return r; };

    if (btn) btn.disabled = true;
    if (!navigator.onLine) { say('当前离线，无法检查更新', 'warn'); return finish('offline'); }

    say('正在检查…', 'busy');

    /* 第一判据：线上到底是多少版 —— 与 SW 无关。
       老实现只有 SW 一条判据，而 SW 在原生 APK 里必然说「没变化」，
       于是按钮永远是安慰剂。这一步就是那次「假绿」的修复。 */
    const latest = await fetchLatest();
    const newer = !!(latest && cmpVer(latest.version, APP_VERSION) > 0);

    /* ---- 原生 APK ----
       网页资源打包在包体里，应用内换不了包体本身，SW 这条路在 APK 里是空转的。
       能做的是「查版本 + 一键去下载」，剩下两步系统安装 —— 免费，但绕不过安卓的签名机制。 */
    if (GL.isNativeApp()) {
      if (!latest) { say('连不上版本服务器，请检查网络后重试', 'err'); return finish('error'); }
      if (newer) {
        say(`发现新版 v${latest.version} · 当前 v${APP_VERSION}`, 'warn');
        showApkDownload(latest.apkUrl || APK_URL, latest.version);
        GL.toast(`发现新版本 v${latest.version}`, 'ok');
        return finish('update-available');
      }
      say(`已是最新（v${APP_VERSION}）`, 'ok');
      GL.toast('已是最新版本 v' + APP_VERSION, 'ok');
      return finish('latest');
    }

    /* 没有 SW 的网页环境（file:// 或 http 非 localhost）：清单仍能核对版本 */
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.getRegistration) {
      if (!latest) { say('当前环境不支持自动更新（需用 https 打开）', 'warn'); return finish('unsupported'); }
      say(newer ? `线上已有 v${latest.version}（当前 v${APP_VERSION}）` : `已是最新（v${APP_VERSION}）`,
        newer ? 'warn' : 'ok');
      return finish(newer ? 'update-available' : 'latest');
    }

    let reg = null;
    try { reg = await navigator.serviceWorker.getRegistration(); } catch (e) { reg = null; }
    if (!reg) {
      /* 没有注册记录（本页面是在 SW 被清掉之后打开的）→ 现注册一次；
         这次注册本身就会去取最新 sw.js。 */
      try { reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }); }
      catch (e) { say('检查失败：连不上更新服务', 'err'); return finish('error'); }
    }

    const before = reg.active || null;

    /* 还没有现役 SW = 首次安装，不是「有新版」——
       这时若往下走，下面「有新 worker 进来」的判据会把首次安装误报成「发现新版本」。
       但清单若说线上更新，说明手里这份页面本身就旧 → 硬刷。 */
    if (!before) {
      if (newer) {
        say(`线上已是 v${latest.version}，正在刷新…`, 'busy');
        hardReload();
        return 'hard-reload';
      }
      say('正在完成首次安装…', 'busy');
      await sleep(1500);
      say(`已是最新（v${APP_VERSION}）`, 'ok');
      return finish('latest');
    }

    /* 已经躺着一个「装好了但还没接管」的新 SW → 直接让它上位，省一次网络往返 */
    if (reg.waiting) {
      say('发现新版本，正在应用…', 'busy');
      GL.toast('发现新版本，正在更新…', 'ok');
      try { sessionStorage.setItem(UPD_FLAG, '1'); } catch (e) { /* ignore */ }
      promoteWaiting(reg);
      setTimeout(reloadForUpdate, 900);
      return 'updating';
    }

    /* 关键一步：强制重拉 sw.js。register 时写的 updateViaCache:'none' 保证这一步
       不会被 HTTP 缓存骗过去（否则拿回旧字节 → 浏览器认定「没有新版」）。 */
    let settled = false;
    let failed = false;
    const onFound = () => { settled = true; };
    try { reg.addEventListener('updatefound', onFound); } catch (e) { /* ignore */ }
    const doing = reg.update().then(
      () => { settled = true; },
      () => { settled = true; failed = true; });
    await Promise.race([doing, sleep(UPDATE_TIMEOUT)]);
    try { reg.removeEventListener('updatefound', onFound); } catch (e) { /* ignore */ }

    /* SW 这条路走不通，但清单说线上更新 → 说明是缓存/SW 卡住了，硬刷一次比报错有用 */
    if (failed || !settled) {
      if (newer) {
        say(`线上已是 v${latest.version}，正在强制刷新…`, 'busy');
        GL.toast('正在强制刷新到 v' + latest.version, 'ok');
        hardReload();
        return 'hard-reload';
      }
      say(failed ? '检查失败：连不上更新服务' : '检查超时，请检查网络后重试', failed ? 'err' : 'warn');
      return finish(failed ? 'error' : 'timeout');
    }

    /* 个别浏览器 updatefound 与 installing 的赋值差一拍，让一拍再判 */
    if (!newWorkerIn(reg, before)) await sleep(400);

    if (newWorkerIn(reg, before)) {
      say('发现新版本，正在更新…', 'busy');
      GL.toast('发现新版本，正在更新…', 'ok');
      const w = reg.installing || reg.waiting;
      if (w) {
        /* 等它走到 activated 再刷：新版 install 里已 skipWaiting()，正常立刻就到。
           若 2.5s 还没到位也刷一次（宁可多刷一下，不让用户干等）。
           `reloadForUpdate` 有单次守卫，与页面侧 controllerchange 那条路不会刷两回。 */
        const done = (certain) => {
          if (certain) { try { sessionStorage.setItem(UPD_FLAG, '1'); } catch (e) { /* ignore */ } }
          reloadForUpdate();
        };
        if (w.state === 'activated') setTimeout(() => done(true), 500);
        else {
          w.addEventListener('statechange', () => {
            if (w.state === 'activated') setTimeout(() => done(true), 500);
          });
          setTimeout(() => promoteWaiting(reg), 900);
          setTimeout(() => done(false), 2500);
        }
      }
      return 'updating';
    }

    /* 最后一道：SW 说没新版，但清单明确说线上更新 —— 二者矛盾时信清单。
       这种情况真实存在（HTTP 缓存钉住 sw.js、僵尸 SW、代理返回旧字节），
       老实现会在这里报「已是最新」，就是用户看到的那个谎。 */
    if (newer) {
      say(`线上已是 v${latest.version}，正在强制刷新…`, 'busy');
      GL.toast('正在强制刷新到 v' + latest.version, 'ok');
      hardReload();
      return 'hard-reload';
    }

    say(`已是最新（v${APP_VERSION}）`, 'ok');
    GL.toast('已是最新版本 v' + APP_VERSION, 'ok');
    return finish('latest');
  };

  /* ---------- 启动 ---------- */
  /* 每个步骤独立兜错：任何一个模块出问题，都不该让整页停在 opacity:0 的白屏。
     v1.4.1 事故复盘：曾因 js/avatar.js 漏加载，app.js 里调用的 GL.* 成了 undefined，
     一抛异常就中断了 start()，后面的 reveal() 没跑，所有 .rv 元素永久隐藏、整页白屏。
     教训是通用的：**启动链上任一环节都不许有能力带走整页**。 */
  function step(name, fn) {
    try { fn(); }
    catch (e) { console.error('[GameLife] 启动步骤失败：' + name, e); }
  }

  function start() {
    step('load', () => GL.load());
    step('renderSettings', () => renderSettings());
    step('bindSettings', () => bindSettings());
    step('initTabs', () => initTabs());

    // 本文件自己贡献的 HUD 视图挂进钩子链
    GL.hooks.push(renderHudBar);

    /* 首屏全量渲染：必须走 GL.changed() 而非逐个手动调用。
       原因：各模块（avatar / wardrobe / physiology / attributes / skills / life）都是把自己的
       渲染函数 push 进 GL.hooks，只有 GL.changed() 会遍历执行它们。
       v1.4.0 事故复盘：start() 曾只手动调用 renderBody/renderAttrs/... 而从未触发
       GL.changed()，于是「中央立绘」（当时由 portrait.js 提供，v1.8.1 已随立绘移除）
       始终空白。这条规矩对所有模块一视同仁。 */
    step('changed (首屏全量渲染)', () => GL.changed());

    // reveal 必须最后且必须成功执行 —— 它是唯一的"点亮全屏"动作
    step('reveal', () => reveal());
    // 兜底：若 IntersectionObserver 未触发（元素在视口外、观察器异常等），
    // 1.2s 后强制点亮所有仍未显示的 .rv，绝不留下白屏
    setTimeout(() => {
      document.querySelectorAll('.rv:not(.in)').forEach((e) => e.classList.add('in'));
    }, 1200);

    /* 换版回来：说一声「刚才那一下真的生效了」——
       点完按钮页面一闪就走，不提一句用户不知道到底更新没有。
       只在**确认走到 activated 之后**才留的旗标，所以不会谎报。 */
    try {
      if (sessionStorage.getItem(UPD_FLAG)) {
        sessionStorage.removeItem(UPD_FLAG);
        GL.toast('已更新到最新版本 v' + APP_VERSION, 'ok');
      }
    } catch (e) { /* sessionStorage 被禁也不影响主流程 */ }

    /* Service Worker（PWA 离线 + 安装 + 换版自愈）
       ─────────────────────────────────────────────────────────
       下面两段一起解决「装了新版却什么都没变」（v1.7.4 实机事故）：
       ① register 的 updateViaCache:'none' —— **sw.js 自己也会被 HTTP 缓存住**
          （GitHub Pages、内网服务器都会给 max-age）。更新检查拿到的是旧字节，
          浏览器就认定「没有新版」，新 SW 根本装不上 —— 资源改得再对也白搭。
       ② controllerchange → 自刷一次 —— 旧 SW 是缓存优先，会把旧 index.html /
          旧 app.js 一直供下去；新 SW 接管（clients.claim）那一刻刷一次，
          用户「打开一次」就看到新版，不必关掉再开。
          只在**本来就有 controller** 时挂监听：首次安装无旧版可换，白刷没意义。
          每次页面加载最多刷一次（reloadedForUpdate 兜底），刷新后 controller
          不再变化，不存在刷新循环。
       ⚠ 不把刷新交给 SW 的 activate 去做 —— 实测那条路必死锁：
         SW 在 activate 的 waitUntil 落地前不处理 fetch，navigate 触发的同源导航
         没人应答，挂 37 秒后失败（tools/test-update-flow.js 实测原话
         「Cannot navigate to URL」）。SW 侧只留一份延迟的兜底，主力是这里。 */
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
        .then((reg) => { reg.update().catch(() => {}); })
        .catch(() => {});

      if (navigator.serviceWorker.controller) {
        /* 自刷走 reloadForUpdate()，与「检查更新」按钮共用同一条路径 + 同一个单次守卫
           （按钮那条路可能先触发刷新，两个入口都各自 location.reload() 会让页面抖两下） */
        navigator.serviceWorker.addEventListener('controllerchange', reloadForUpdate);
      }
    }

    // 喝水提醒：每分钟检查一次
    setInterval(() => { try { GL.checkHydration(); } catch (e) { /* ignore */ } }, 60e3);

    // 跨日自动刷新视图
    let today = GL.todayKey(Date.now());
    setInterval(() => {
      const now = GL.todayKey(Date.now());
      if (now !== today) { today = now; GL.changed(); }
    }, 60e3);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
