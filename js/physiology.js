/* ============ Game Life · 生理状态（HUD 右翼） ============
   饮水进度 + 距上次喝水 + 全自定义字段打卡，围绕 3D 形象实时呈现
   ============================================================ */
(function () {
  'use strict';

  let addOpen = false;                      // 「添加字段」表单展开状态

  function P() { return GL.state.physiology; }
  function find(id) { return P().fields.find((f) => f.id === id); }

  function todayMl() {
    const key = GL.todayKey(Date.now());
    return P().hydration.logs.filter((l) => GL.todayKey(l.t) === key).reduce((s, l) => s + l.ml, 0);
  }

  function ring(total, goal) {
    const pct = Math.min(1, goal ? total / goal : 0);
    const R = 46, C = 2 * Math.PI * R;
    return `<div class="ring-wrap">
      <svg width="112" height="112" viewBox="0 0 112 112" role="img" aria-label="今日饮水 ${total} 毫升">
        <circle cx="56" cy="56" r="${R}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="9"/>
        <circle cx="56" cy="56" r="${R}" fill="none" stroke="url(#hg)" stroke-width="9"
          stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"
          transform="rotate(-90 56 56)"/>
        <defs><linearGradient id="hg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#4cc9f0"/><stop offset="1" stop-color="#3ce8b0"/>
        </linearGradient></defs>
      </svg>
      <div class="ring-txt">
        <b>${total}</b><small>/ ${goal} ml</small><em>${Math.round(pct * 100)}%</em>
      </div>
    </div>`;
  }

  function fieldRow(f) {
    const empty = f.value === null || f.value === undefined || f.value === '';
    const ops = f.type === 'toggle'
      ? `<button class="btn mini ${f.value === true ? 'primary' : ''}" data-ftoggle="${f.id}">
           ${empty ? '打卡' : f.value ? '✅ 是' : '⬜ 否'}
         </button>`
      : `<input type="${f.type === 'number' ? 'number' : 'text'}" step="any"
           data-fval="${f.id}" placeholder="${f.type === 'number' ? '数值' : '记录内容'}"
           aria-label="${GL.esc(f.name)}">
         <button class="btn mini primary" data-frec="${f.id}">打卡</button>`;
    return `<div class="field-row" data-fid="${f.id}">
      <div class="field-top">
        <span class="field-name">${GL.esc(f.name)}</span>
        <span class="field-val ${empty ? 'idle' : ''}">${empty ? '待记录' : GL.esc(f.value) + (f.unit ? ' ' + GL.esc(f.unit) : '')}</span>
      </div>
      <div class="field-time">上次打卡 ${GL.fmtRel(f.lastAt)}</div>
      <div class="field-ops">${ops}</div>
    </div>`;
  }

  function manageRow(f) {
    return `<div class="edit-box" data-fid="${f.id}">
      <div class="card-head" style="margin:0;padding:0 0 6px;border:0">
        <span class="card-title" style="font-size:14px">${GL.esc(f.name)}</span>
        <button class="btn mini danger" data-fdel="${f.id}">删除字段</button>
      </div>
      <details class="hist"><summary>历史记录（${(f.history || []).length} 条）</summary>
        <ul>${(f.history || []).slice(-14).reverse()
          .map((h) => `<li>${GL.fmtClock(h.t)} — ${GL.esc(h.v)}${f.unit ? ' ' + GL.esc(f.unit) : ''}</li>`).join('') || '<li>暂无记录</li>'}</ul>
      </details>
    </div>`;
  }

  function render() {
    const el = document.getElementById('wing-body');
    if (!el) return;
    const hy = P().hydration;
    const total = todayMl();
    const last = hy.logs.length ? hy.logs[hy.logs.length - 1].t : null;
    const todayCount = hy.logs.filter((l) => GL.todayKey(l.t) === GL.todayKey(Date.now())).length;

    el.innerHTML = `
      <div class="wing-head">
        <span class="wing-title">生理状态</span>
        <span class="wing-note">今日 ${total} / ${hy.goal} ml</span>
      </div>

      <div class="hydro">
        ${ring(total, hy.goal)}
        <div class="hydro-side">
          <div class="kv"><span>距上次喝水</span><b class="amber">${last ? GL.fmtRel(last) : '未记录'}</b></div>
          <div class="kv"><span>今日次数</span><b class="hot">${todayCount}</b></div>
          <div class="kv"><span>累计记录</span><b>${(hy.logs || []).length}</b></div>
          <div class="kv"><span>每日目标</span><b><input type="number" id="hy-goal" value="${hy.goal}"
            style="width:72px;min-height:26px;padding:0 6px;text-align:right" aria-label="每日饮水目标"> ml</b></div>
        </div>
      </div>

      <div class="chips">
        <button class="chip" data-drink="100">+100</button>
        <button class="chip" data-drink="250">+250 ☕</button>
        <button class="chip" data-drink="500">+500 🍾</button>
        <button class="chip" id="hy-undo" title="撤销上一条">↩ 撤销</button>
        <button class="chip ${hy.remindOn ? 'equipped' : ''}" id="hy-remind">🔔 ${hy.remindOn ? '提醒开' : '提醒关'}</button>
      </div>
      <div class="field-ops" style="margin-top:8px">
        <input type="number" id="hy-custom" placeholder="自定义 ml" aria-label="自定义饮水量">
        <button class="btn mini primary" id="hy-add">记录</button>
      </div>

      <div class="wing-head" style="margin-top:12px">
        <span class="wing-title">自定义指标</span>
        <span class="wing-note">${P().fields.length} 项</span>
      </div>
      ${P().fields.map(fieldRow).join('') || '<span class="dim">还没有自定义指标</span>'}

      <button class="btn mini wide" id="f-add-toggle" aria-expanded="${addOpen}">${addOpen ? '× 收起' : '＋ 新增指标'}</button>
      ${addOpen ? `<div class="xp-add" id="f-add-box">
        <input type="text" id="f-name" placeholder="指标名，如 睡眠时长" aria-label="指标名">
        <select id="f-type" style="min-height:34px">
          <option value="number">数值</option><option value="toggle">是否</option><option value="text">文本</option>
        </select>
        <input type="text" id="f-unit" placeholder="单位" style="width:70px" aria-label="单位">
        <button class="btn mini primary" id="f-add">添加</button>
      </div>` : ''}
      ${P().fields.length ? `<details class="hist" id="f-manage"><summary>管理指标 · 删除 / 历史</summary>
        ${P().fields.map(manageRow).join('')}
      </details>` : ''}`;
  }

  function bind() {
    const el = document.getElementById('wing-body');
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';

    el.addEventListener('click', (e) => {
      const hy = P().hydration;

      const d = e.target.closest('[data-drink]');
      if (d) { drink(Number(d.dataset.drink)); return; }
      if (e.target.id === 'hy-add') {
        const v = Number(el.querySelector('#hy-custom').value);
        if (v > 0) drink(v); else GL.toast('请输入饮水量', 'err');
        return;
      }
      if (e.target.id === 'hy-undo') {
        if (hy.logs.length) { const l = hy.logs.pop(); GL.toast('已撤销 ' + l.ml + ' ml'); GL.changed(); }
        else GL.toast('没有可撤销的记录', 'err');
        return;
      }
      if (e.target.id === 'hy-remind') {
        hy.remindOn = !hy.remindOn;
        if (hy.remindOn && 'Notification' in window && Notification.permission !== 'granted') {
          Notification.requestPermission();
        }
        GL.toast(hy.remindOn ? '喝水提醒已开启（页面打开时生效）' : '喝水提醒已关闭', 'ok');
        GL.changed();
        return;
      }
      if (e.target.id === 'f-add-toggle') { addOpen = !addOpen; render(); return; }
      if (e.target.id === 'f-add') {
        const name = (el.querySelector('#f-name').value || '').trim();
        const type = el.querySelector('#f-type').value;
        const unit = el.querySelector('#f-unit').value.trim();
        if (!name) { GL.toast('先填写指标名', 'err'); return; }
        P().fields.push({ id: GL.uid(), name, unit, type, value: null, lastAt: null, history: [] });
        addOpen = false;
        GL.toast('已添加「' + name + '」', 'ok');
        GL.changed();
        return;
      }

      const frec = e.target.closest('[data-frec]');
      if (frec) {
        const f = find(frec.dataset.frec);
        const inp = frec.closest('.field-row').querySelector('[data-fval]');
        if (!f || !inp) return;
        const raw = inp.value.trim();
        if (!raw) { GL.toast('先填写记录内容', 'err'); return; }
        recordField(f, f.type === 'number' ? Number(raw) : raw);
        return;
      }
      const ft = e.target.closest('[data-ftoggle]');
      if (ft) {
        const f = find(ft.dataset.ftoggle);
        if (f) recordField(f, !(f.value === true));
        return;
      }
      const fd = e.target.closest('[data-fdel]');
      if (fd) {
        const f = find(fd.dataset.fdel);
        if (!confirm('确定删除「' + (f ? f.name : '') + '」及其全部历史吗？')) return;
        P().fields = P().fields.filter((x) => x.id !== fd.dataset.fdel);
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
      if (e.key !== 'Enter') return;
      if (e.target.id === 'hy-custom') el.querySelector('#hy-add').click();
      if (e.target.id === 'f-name') el.querySelector('#f-add').click();
      if (e.target.dataset && e.target.dataset.fval) {
        const f = find(e.target.dataset.fval);
        const raw = e.target.value.trim();
        if (f && raw) recordField(f, f.type === 'number' ? Number(raw) : raw);
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

  /* 喝水提醒（app.js 定时调用） */
  GL.checkHydration = function () {
    const hy = P().hydration;
    if (!hy.remindOn) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const last = hy.logs.length ? hy.logs[hy.logs.length - 1].t : null;
    if (!last) return;
    const gap = (hy.remindMin || 90) * 60000;
    if (Date.now() - last > gap && (!GL._hyReminded || Date.now() - GL._hyReminded > gap)) {
      GL._hyReminded = Date.now();
      try {
        new Notification('💧 该喝水啦', { body: '距离上次喝水已经超过 ' + (hy.remindMin || 90) + ' 分钟了' });
      } catch (e) { /* ignore */ }
    }
  };

  GL.hooks.push(render);
  GL.renderBody = function () { render(); bind(); };
})();
