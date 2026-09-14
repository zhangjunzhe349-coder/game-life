/* ============ Game Life · 应用入口 / 导航 / 设置 ============ */
(function () {
  'use strict';

  function initTabs() {
    const tabs = document.getElementById('tabs');
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === btn));
      const id = btn.dataset.tab;
      document.querySelectorAll('.panel').forEach((p) => (p.hidden = p.id !== 'panel-' + id));
      if (id === 'avatar') GL.rebuildAvatar && GL.rebuildAvatar();
      window.scrollTo({ top: 0 });
    });
  }

  /* ---------- 角色档案卡 ---------- */
  function renderHero() {
    const lvEl = document.getElementById('hero-level');
    const stEl = document.getElementById('hero-stats');
    if (!lvEl || !stEl) return;
    const hero = GL.heroLevel();
    lvEl.textContent = 'LV.' + hero.level;

    // 记录天数：所有模块日志中出现的自然日去重
    const days = new Set();
    const addDays = (arr) => (arr || []).forEach((x) => days.add(GL.todayKey(x.t)));
    addDays(GL.state.physiology.hydration.logs);
    GL.state.physiology.fields.forEach((f) => addDays(f.history));
    GL.state.attributes.forEach((a) => addDays(a.history));
    GL.state.skills.forEach((s) => addDays(s.logs));
    const attrAvg = GL.state.attributes.length
      ? Math.round(GL.state.attributes.reduce((s, a) => s + a.value, 0) / GL.state.attributes.length)
      : 0;

    stEl.innerHTML = `
      <div class="hero-stat"><b>${days.size}</b><span>记录天数</span></div>
      <div class="hero-stat"><b>${hero.level}</b><span>角色等级</span></div>
      <div class="hero-stat"><b>${hero.total}<small style="font-size:12px"> XP</small></b><span>累计经验</span></div>
      <div class="hero-stat" style="display:none"><b>${attrAvg}</b><span>属性均值</span></div>`;
  }
  GL.hooks.push(renderHero);

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
      <div class="card-head"><span class="card-title">💾 数据管理</span><span class="card-hint">全部数据存储于本机浏览器</span></div>
      <div class="muted">当前数据量：${(bytes / 1024).toFixed(1)} KB · 历史记录 ${count} 条</div>
      <div class="set-row">
        <button class="btn primary" id="btn-export">⬇ 导出备份</button>
        <button class="btn" id="btn-import">⬆ 导入备份</button>
        <input type="file" id="file-import" accept=".json,application/json" hidden>
        <button class="btn danger" id="btn-reset">🗑 恢复默认</button>
      </div>
      <div class="dim" style="margin-top:10px">
        数据保存在浏览器 localStorage 中。<br>
        · <b>换设备 / 换浏览器</b>：先「导出备份」，在新设备「导入备份」即可完整迁移。<br>
        · 清除浏览器数据会清空记录，建议定期导出备份。
      </div>
    </div>
    <div class="card">
      <div class="card-head"><span class="card-title">📋 技能篇预设</span><span class="card-hint">元技能与方法论</span></div>
      <div class="muted">一键写入《【游戏人生(技能篇)】元技能与方法论》中的全部内容：</div>
      <div class="dim">
        · <b>技能</b>：语言（写作/口头表达）· 社交（small talk）· 生理（力量/敏捷）· 阅历/眼界/审美力<br>
        · <b>属性</b>：精力管理 4 值（体能/情绪/思维/意志）+ 外貌 4 项（皮肤/穿搭/发型/牙齿）<br>
        · <b>生理字段</b>：睡眠时长 · 肌肉量 · 喉咙(咽部) · 鼻炎
      </div>
      <div class="set-row">
        <button class="btn primary" id="btn-preset">⚡ 应用技能篇预设</button>
      </div>
      <div class="dim" style="margin-top:8px">⚠ 会覆盖现有技能 / 属性 / 生理字段（形象、饮水记录、生命参数保留）。</div>
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
      <div class="card-head"><span class="card-title">ℹ️ 关于</span></div>
      <div class="dim">
        Game Life v1.0 · 3D形象 / 生理追踪 / 属性打分 / 技能成长 / 生命刻度<br>
        本地优先 · 无需登录 · 数据自主可控。后续可拓展：智能硬件自动同步、多端云同步、3D 模型精细化。
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
        if (!confirm('⚠ 应用《技能篇》预设将覆盖现有的技能 / 属性 / 生理字段，确定继续吗？')) return;
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
    initTabs();

    // Service Worker（PWA 离线 + 安装）
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    // 喝水提醒：每分钟检查一次
    setInterval(() => { try { GL.checkHydration(); } catch (e) { /* ignore */ } }, 60e3);

    // 每天跨日自动刷新视图
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
