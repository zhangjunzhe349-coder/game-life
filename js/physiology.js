/* ============ Game Life · 生理状态追踪（饮水 + 自定义字段） ============ */
(function () {
  'use strict';

  function P() { return GL.state.physiology; }

  function todayMl() {
    const key = GL.todayKey(Date.now());
    return P().hydration.logs.filter((l) => GL.todayKey(l.t) === key).reduce((s, l) => s + l.ml, 0);
  }

  function ringSvg(total, goal) {
    const pct = Math.min(1, goal ? total / goal : 0);
    const R = 52, C = 2 * Math.PI * R;
    return `<div class="ring-wrap">
      <svg width="128" height="128" viewBox="0 0 128 128">
        <circle cx="64" cy="64" r="${R}" fill="none" stroke="#262d45" stroke-width="10"/>
        <circle cx="64" cy="64" r="${R}" fill="none" stroke="url(#hydrog)" stroke-width="10"
          stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/>
        <defs><linearGradient id="hydrog" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#7c5cff"/>
        </linearGradient></defs>
      </svg>
      <div class="ring-txt"><b>${total}</b><small>/ ${goal} ml</small>
        <small style="color:#22d3ee">${Math.round(pct * 100)}%</small></div>
    </div>`;
  }

  function fieldCard(f) {
    let ops = '';
    if (f.type === 'number') {
      ops = `<input type="number" step="any" data-fnum="${f.id}" placeholder="数值" style="width:90px">
             <button class="btn mini primary" data-frec="${f.id}">打卡</button>`;
    } else if (f.type === 'toggle') {
      ops = `<button class="btn mini ${f.value ? 'primary' : ''}" data-ftoggle="${f.id}">
               ${f.value === null ? '打卡' : f.value ? '✅ 是' : '⬜ 否'} · 记录</button>`;
    } else {
      ops = `<input type="text" data-ftext="${f.id}" placeholder="记录内容" style="flex:1 1 110px">
             <button class="btn mini primary" data-frec="${f.id}">打卡</button>`;
    }
    const hist = (f.history || []).slice(-10).reverse()
      .map((h) => `<li>${GL.fmtClock(h.t)} — ${GL.esc(h.v)}${f.unit ? ' ' + GL.esc(f.unit) : ''}</li>`).join('');
    return `<div class="stat-item" data-fid="${f.id}">
      <div class="stat-main">
        <div class="stat-name">${GL.esc(f.name)}</div>
        <div class="stat-val">${f.value === null || f.value === undefined || f.value === '' ? '待记录' : GL.esc(f.value) + (f.unit ? ' ' + GL.esc(f.unit) : '')}</div>
        <div class="stat-time">上次打卡：${GL.fmtRel(f.lastAt)}</div>
      </div>
      <div class="stat-ops">${ops}
        <button class="btn mini danger" data-fdel="${f.id}" title="删除该字段">✕</button></div>
      ${hist ? `<details class="hist" style="flex-basis:100%"><summary>历史记录（${(f.history || []).length} 条）</summary><ul>${hist}</ul></details>` : ''}
    </div>`;
  }

  function render() {
    const el = document.getElementById('panel-body');
    if (!el) return;
    const hy = P().hydration;
    const total = todayMl();
    const last = hy.logs.length ? hy.logs[hy.logs.length - 1].t : null;

    el.innerHTML = `
    <div class="card">
      <div class="card-head"><span class="card-title">💧 饮水状态</span>
        <button class="btn mini ${hy.remindOn ? 'primary' : ''}" id="hy-remind">🔔 提醒 ${hy.remindOn ? '开' : '关'}</button></div>
      <div class="hydro-top">
        ${ringSvg(total, hy.goal)}
        <div class="hydro-info">
          <div class="big">⏱ 距上次喝水：${last ? GL.fmtRel(last) : '今天还没喝过'}</div>
          <div class="muted">今日已喝 <b style="color:#22d3ee">${total}</b> ml · 目标 ${hy.goal} ml</div>
          <div class="muted">共 ${(hy.logs || []).length} 条记录</div>
          <div class="quick-btns">
            <button class="btn mini" data-drink="100">+100</button>
            <button class="btn mini" data-drink="250">+250 ☕</button>
            <button class="btn mini" data-drink="500">+500 🍾</button>
            <input type="number" id="hy-custom" placeholder="自定义ml" style="width:96px">
            <button class="btn mini primary" id="hy-add">记录</button>
            <button class="btn mini ghost" id="hy-undo" title="撤销上一条">↩</button>
          </div>
          <div class="quick-btns">
            <label class="dim" style="display:flex;align-items:center;gap:6px">每日目标
              <input type="number" id="hy-goal" value="${hy.goal}" style="width:84px"> ml</label>
          </div>
        </div>
      </div>
      ${last ? `<details class="hist"><summary>今日喝水明细</summary><ul>${hy.logs.filter((l) => GL.todayKey(l.t) === GL.todayKey(Date.now())).reverse().map((l) => `<li>${GL.fmtClock(l.t)} — ${l.ml} ml</li>`).join('') || '<li>今天还没有记录</li>'}</ul></details>` : ''}
    </div>

    <div class="card">
      <div class="card-head"><span class="card-title">🩺 自定义生理状态</span><span class="card-hint">自由增删 · 手动打卡</span></div>
      <div class="stat-list">${P().fields.map(fieldCard).join('') || '<span class="dim">还没有自定义字段</span>'}</div>
      <div class="edit-box">
        <div class="form-row">
          <input type="text" id="f-name" placeholder="字段名，如 睡眠时长">
          <select id="f-type"><option value="number">数值</option><option value="toggle">是否</option><option value="text">文本</option></select>
          <input type="text" id="f-unit" placeholder="单位(可选)" style="flex:0 1 90px">
          <button class="btn primary mini" id="f-add">＋添加</button>
        </div>
        <div class="dim">💡 预留智能硬件同步接口：所有记录均为标准时间戳结构，后续可直接对接自动写入。</div>
      </div>
    </div>`;
  }

  function bind() {
    const el = document.getElementById('panel-body');
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';

    el.addEventListener('click', (e) => {
      const hy = P().hydration;

      const d = e.target.closest('[data-drink]');
      if (d) { drink(Number(d.dataset.drink)); return; }
      if (e.target.id === 'hy-add') {
        const v = Number(el.querySelector('#hy-custom').value);
        if (v > 0) drink(v); else GL.toast('请输入喝水量', 'err');
        return;
      }
      if (e.target.id === 'hy-undo') {
        if (hy.logs.length) { const l = hy.logs.pop(); GL.toast('已撤销上一条：' + l.ml + ' ml'); GL.changed(); }
        return;
      }
      if (e.target.id === 'hy-goal') return;
      if (e.target.id === 'hy-remind') {
        hy.remindOn = !hy.remindOn;
        if (hy.remindOn && 'Notification' in window && Notification.permission !== 'granted') {
          Notification.requestPermission();
        }
        GL.toast(hy.remindOn ? '喝水提醒已开启（页面打开期间有效）' : '喝水提醒已关闭');
        GL.changed();
        return;
      }

      // 自定义字段
      const frec = e.target.closest('[data-frec]');
      if (frec) {
        const f = P().fields.find((x) => x.id === frec.dataset.frec);
        const box = frec.closest('.stat-item');
        const inp = box.querySelector(f.type === 'number' ? '[data-fnum]' : '[data-ftext]');
        const v = f.type === 'number' ? Number(inp.value) : inp.value.trim();
        if (f.type === 'number' ? !(v > 0 || v <= 0) || inp.value === '' : !v) { GL.toast('先填写数值', 'err'); return; }
        recordField(f, v);
        return;
      }
      const ft = e.target.closest('[data-ftoggle]');
      if (ft) {
        const f = P().fields.find((x) => x.id === ft.dataset.ftoggle);
        recordField(f, !(f.value === true));
        return;
      }
      const fd = e.target.closest('[data-fdel]');
      if (fd) {
        if (!confirm('确定删除该字段及其全部历史记录吗？')) return;
        P().fields = P().fields.filter((x) => x.id !== fd.dataset.fdel);
        GL.changed();
        return;
      }
      if (e.target.id === 'f-add') {
        const name = el.querySelector('#f-name').value.trim();
        const type = el.querySelector('#f-type').value;
        const unit = el.querySelector('#f-unit').value.trim();
        if (!name) { GL.toast('先填写字段名', 'err'); return; }
        P().fields.push({ id: GL.uid(), name, unit, type, value: null, lastAt: null, history: [] });
        GL.toast('已添加「' + name + '」');
        GL.changed();
      }
    });

    el.addEventListener('change', (e) => {
      if (e.target.id === 'hy-goal') {
        const v = Number(e.target.value);
        if (v > 0) { P().hydration.goal = v; GL.changed(); }
      }
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target.id === 'hy-custom' || e.target.id === 'f-name')) {
        el.querySelector(e.target.id === 'hy-custom' ? '#hy-add' : '#f-add').click();
      }
    });
  }

  function drink(ml) {
    if (!(ml > 0)) return;
    P().hydration.logs.push({ t: Date.now(), ml });
    GL.toast('💧 已记录 ' + ml + ' ml', 'ok');
    GL.changed();
  }

  function recordField(f, v) {
    f.value = v;
    f.lastAt = Date.now();
    (f.history = f.history || []).push({ t: Date.now(), v });
    GL.toast('📝 ' + f.name + '：' + v + (f.unit ? ' ' + f.unit : ''), 'ok');
    GL.changed();
  }

  /* 喝水提醒检查（app.js 定时调用） */
  GL.checkHydration = function () {
    const hy = P().hydration;
    if (!hy.remindOn) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const logs = hy.logs;
    const last = logs.length ? logs[logs.length - 1].t : null;
    if (!last) return;
    if (Date.now() - last > (hy.remindMin || 90) * 60000) {
      if (!GL._hyReminded || Date.now() - GL._hyReminded > (hy.remindMin || 90) * 60000) {
        GL._hyReminded = Date.now();
        try { new Notification('💧 该喝水啦', { body: '距离上次喝水已经超过 ' + (hy.remindMin || 90) + ' 分钟了' }); } catch (e) { /* ignore */ }
      }
    }
  };

  GL.hooks.push(() => { render(); });
  GL.renderBody = function () { render(); bind(); };
})();
