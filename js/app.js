/* ============ Game Life · 应用入口 / 导航 / 顶栏 / 设置 ============ */
(function () {
  'use strict';

  const APP_VERSION = '1.8.2';
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
      /* 技能详情浮层挂在 <body> 上（不受 panel 的重渲染影响），
         所以切页签时必须显式关掉，否则它会浮在新页面上方。 */
      if (GL.closeSkillModal) GL.closeSkillModal();
      if (id === 'life') GL.renderLife();
      reveal(document.getElementById('panel-' + id));
      window.scrollTo({ top: 0 });
    });
  }

  /* ---------- 舞台下方折叠面板：电子衣橱 ----------
     v1.8.1 起中央立绘移除，衣橱面板不再嵌在中间栏（那样只有 300px 宽，
     41 张卡片的网格展不开），改为整宽块。原来的「体型」第二个页签也一并去掉 ——
     体型参数已变成顶部那条「个人信息」，不必再占衣橱面板的空间。 */
  function initCtrlToggle() {
    const btn = document.getElementById('ctrl-toggle');
    const panel = document.getElementById('avatar-panel');
    if (!btn || !panel) return;

    btn.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? '× 收起衣橱' : '👗 电子衣橱';
      if (open && GL.renderWardrobe) GL.renderWardrobe();
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
        Game Life v${APP_VERSION} · 个人信息 / 生理追踪 / 属性面板 / 技能成长 / 生命刻度 / 电子衣橱<br>
        本地优先 · 无需登录 · 数据自主可控。后续可拓展：智能硬件自动同步、多端云同步、照片生成真实比例模型。
      </div>
    </div>`;
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
    step('initCtrlToggle', () => initCtrlToggle());

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
        let reloadedForUpdate = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloadedForUpdate) return;
          reloadedForUpdate = true;
          location.reload();
        });
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
