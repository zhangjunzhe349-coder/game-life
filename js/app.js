/* ============ Game Life · 应用入口 / 导航 / 顶栏 / 设置 ============ */
(function () {
  'use strict';

  const APP_VERSION = '1.4.0';
  GL.VERSION = APP_VERSION;

  /* ---------- 工具：今日饮水 ---------- */
  function todayMl() {
    const k = GL.todayKey(Date.now());
    return GL.state.physiology.hydration.logs
      .filter((l) => GL.todayKey(l.t) === k).reduce((s, l) => s + l.ml, 0);
  }
  function lastDrink() {
    const logs = GL.state.physiology.hydration.logs;
    return logs.length ? logs[logs.length - 1].t : null;
  }
  function recordDays() {
    const days = new Set();
    const add = (arr) => (arr || []).forEach((x) => days.add(GL.todayKey(x.t)));
    add(GL.state.physiology.hydration.logs);
    GL.state.physiology.fields.forEach((f) => add(f.history));
    GL.state.attributes.forEach((a) => add(a.history));
    GL.state.skills.forEach((s) => add(s.logs));
    return days.size;
  }

  /* ---------- 顶部 HUD 读数 ---------- */
  function renderHudBar() {
    const lvEl = document.getElementById('hud-lv');
    const boxEl = document.getElementById('hud-readouts');
    if (!lvEl || !boxEl) return;
    const hero = GL.heroLevel();
    const life = GL.lifeInfo();
    const avg = GL.state.attributes.length
      ? Math.round(GL.state.attributes.reduce((s, a) => s + a.value, 0) / GL.state.attributes.length)
      : 0;
    lvEl.textContent = hero.level;
    boxEl.innerHTML = `
      <div class="readout"><b>${recordDays()}<i>天</i></b><span>记录天数</span></div>
      <div class="readout warn"><b>${life.remainW.toLocaleString()}<i>周</i></b><span>剩余生命</span></div>
      <div class="readout xp"><b>${hero.total.toLocaleString()}<i>XP</i></b><span>累计经验</span></div>
      <div class="readout"><b>${avg}<i>/100</i></b><span>状态均值</span></div>`;
  }

  /* ---------- 舞台底部读数 ---------- */
  function renderStageBase() {
    const el = document.getElementById('stage-base');
    if (!el) return;
    const a = GL.state.avatar;
    const style = HAIR_NAMES[a.hairStyle] || a.hairStyle;
    el.innerHTML = `
      <span>身高 <b>${a.height}</b>cm · 体重 <b>${a.weight}</b>kg · 肌肉 <b>${a.muscle}</b></span>
      <span>发型 <b>${style}</b> · 衣橱 <b>${(a.wardrobe || []).length}</b> 件</span>
      <span>今日饮水 <b>${todayMl()}</b>ml · 距上次 <b>${lastDrink() ? GL.fmtRel(lastDrink()) : '未记录'}</b></span>`;
  }

  const HAIR_NAMES = { short: '短发', buzz: '寸头', long: '长发', ponytail: '马尾', bald: '光头' };

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
      if (id === 'life') GL.renderLife();
      reveal(document.getElementById('panel-' + id));
      window.scrollTo({ top: 0 });
    });
  }

  /* ---------- 体型 / 衣橱折叠 ---------- */
  function initCtrlToggle() {
    const btn = document.getElementById('ctrl-toggle');
    const box = document.getElementById('avatar-ctrl');
    if (!btn || !box) return;
    btn.addEventListener('click', () => {
      const open = box.hidden;
      box.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? '× 收起面板' : '🎚 体型与衣橱';
      if (open) GL.renderAvatarCtrl && GL.renderAvatarCtrl();
    });
  }

  /* ---------- 设置面板 ---------- */
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
      <div class="dim" style="margin-top:12px">
        · <b>换设备 / 换浏览器</b>：先「导出备份」，在新设备「导入备份」即可完整迁移。<br>
        · 清除浏览器数据会清空记录，建议定期导出备份。
      </div>
    </div>

    <div class="card">
      <div class="card-head"><span class="card-title">📋 技能篇预设</span><span class="card-hint">元技能与方法论</span></div>
      <div class="muted">一键写入《【游戏人生(技能篇)】元技能与方法论》中的全部内容：</div>
      <div class="dim">
        · <b>技能</b>：语言（写作 / 口头表达）· 社交（small talk）· 生理（力量 / 敏捷）· 阅历 / 眼界 / 审美力<br>
        · <b>属性</b>：精力管理 4 值（体能 / 情绪 / 思维 / 意志）+ 外貌 4 项（皮肤 / 穿搭 / 发型 / 牙齿）<br>
        · <b>生理指标</b>：睡眠时长 · 肌肉量 · 喉咙(咽部) · 鼻炎
      </div>
      <div class="set-row">
        <button class="btn primary" id="btn-preset">⚡ 应用技能篇预设</button>
      </div>
      <div class="dim" style="margin-top:10px">⚠ 会覆盖现有技能 / 属性 / 生理指标（形象、饮水记录、生命参数保留）。</div>
    </div>

    <div class="card">
      <div class="card-head"><span class="card-title">🧬 版本与回滚</span><span class="card-hint">v${APP_VERSION} · Git 版本管理</span></div>
      <div class="dim">
        本项目已纳入 Git 版本管理，<b>每个可运行版本都会打一个 tag</b>，改坏了可以随时回到任意一版。
      </div>
      <div class="edit-box">
        <div class="field-label">回到上一个版本（在 game-life 目录执行）</div>
        <div class="dim" style="font-family:var(--font-mono);font-size:12px;line-height:2">
          git tag&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;# 列出所有版本<br>
          git checkout v1.1.0 -- .&nbsp;&nbsp;# 把文件整体恢复到 v1.1.0<br>
          git checkout -b fix&nbsp;v1.1.0&nbsp;&nbsp;# 或从该版本开一条修复分支
        </div>
        <div class="field-label">只撤销某一次改动（保留之后的改动）</div>
        <div class="dim" style="font-family:var(--font-mono);font-size:12px;line-height:2">
          git log --oneline&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;# 找到要撤销的提交号<br>
          git revert &lt;commit-id&gt;&nbsp;&nbsp;# 生成一次反向提交
        </div>
      </div>
      <div class="dim" style="margin-top:10px">
        规范：提交信息遵循 <b>Conventional Commits</b>（feat / fix / style / refactor / chore），
        版本号遵循 <b>SemVer</b>——新功能 +0.1.0，纯视觉/修复 +0.0.1。每次交付前先提交并打 tag。
      </div>
    </div>

    <div class="card">
      <div class="card-head"><span class="card-title">📲 安装到桌面</span></div>
      <div class="dim">
        · <b>Android / Chrome：</b>浏览器菜单 → 「添加到主屏幕 / 安装应用」。<br>
        · <b>iOS / Safari：</b>分享按钮 → 「添加到主屏幕」。<br>
        · <b>电脑端：</b>地址栏右侧安装图标，或菜单 → 「安装 Game Life」。<br>
        安装后离线也能打开，体验和原生 App 一致。
      </div>
    </div>

    <div class="card">
      <div class="card-head"><span class="card-title">ℹ️ 关于</span><span class="card-hint">LOCAL-FIRST</span></div>
      <div class="dim">
        Game Life v${APP_VERSION} · 人物立绘 / 生理追踪 / 属性面板 / 技能成长 / 生命刻度<br>
        本地优先 · 无需登录 · 数据自主可控。后续可拓展：智能硬件自动同步、多端云同步、照片生成真实比例模型。
      </div>
    </div>`;
  }

  function bindSettings() {
    const el = document.getElementById('panel-settings');
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';

    el.addEventListener('click', (e) => {
      if (e.target.id === 'btn-export') {
        const blob = new Blob([JSON.stringify(GL.state, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        a.href = URL.createObjectURL(blob);
        a.download = 'gamelife-backup-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
        GL.toast('备份已导出', 'ok');
      } else if (e.target.id === 'btn-import') {
        el.querySelector('#file-import').click();
      } else if (e.target.id === 'btn-preset') {
        if (!confirm('⚠ 应用《技能篇》预设将覆盖现有的技能 / 属性 / 生理指标，确定继续吗？')) return;
        GL.applyDocPreset();
        GL.toast('技能篇预设已写入', 'ok');
        GL.changed();
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
  function start() {
    GL.load();
    GL.renderBody();
    GL.renderAttrs();
    GL.renderSkills();
    GL.renderLife();
    renderSettings();
    bindSettings();
    GL.initAvatar();
    GL.renderAvatarCtrl();
    initTabs();
    initCtrlToggle();

    GL.hooks.push(renderHudBar, renderStageBase);
    renderHudBar();
    renderStageBase();
    reveal();

    // Service Worker（PWA 离线 + 安装）
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
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
