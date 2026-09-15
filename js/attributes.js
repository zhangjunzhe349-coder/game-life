/* ============ Game Life · 属性面板（HUD 左翼） ============
   以「此刻状态」为核心：每行 = 名称 / 等级 / 数值 / 进度条 / ± 调节
   配置类操作（区间、等级描述、删除、新增）收进底部管理区
   ============================================================ */
(function () {
  'use strict';

  let addOpen = false;                      // 新增维度表单是否展开

  function list() { return GL.state.attributes; }
  function find(id) { return list().find((a) => a.id === id); }

  function pct(a) {
    const lo = a.min, hi = Math.max(a.max, a.min + 1);
    return Math.max(0, Math.min(100, Math.round(((a.value - lo) / (hi - lo)) * 100)));
  }

  function row(a) {
    return `<div class="attr-row" data-aid="${a.id}">
      <div class="attr-top">
        <span class="attr-name">${GL.esc(a.name)}</span>
        <span class="attr-lv">${GL.esc(GL.attrLevel(a))}</span>
      </div>
      <div class="attr-val-line">
        <span class="attr-num">${a.value}</span>
        <span class="attr-max">/ ${a.max}</span>
        <div class="stepper">
          <button type="button" data-attr-step="-1" title="−1">−</button>
          <button type="button" data-attr-step="1" title="＋1">＋</button>
        </div>
      </div>
      <div class="meter"><i style="width:${pct(a)}%"></i></div>
    </div>`;
  }

  function manageRow(a) {
    const lvText = (a.levels || []).slice().sort((x, y) => y.min - x.min)
      .map((l) => `${l.min === -999 ? '最低' : l.min}|${l.label}`).join('\n');
    return `<div class="edit-box" data-aid="${a.id}">
      <div class="card-head" style="margin:0;padding:0 0 8px;border:0">
        <span class="card-title" style="font-size:14px">${GL.esc(a.name)}</span>
        <span class="card-hint">${a.min} ~ ${a.max}</span>
      </div>
      <div class="form-row">
        <input type="number" value="${a.min}" data-attr-min style="width:76px" aria-label="最小分">
        <input type="number" value="${a.max}" data-attr-max style="width:76px" aria-label="最大分">
        <button class="btn mini" data-attr-range>更新区间</button>
      </div>
      <label class="field-label">等级描述（每行一条：分数|描述，从高到低）</label>
      <textarea data-attr-levels rows="4">${GL.esc(lvText)}</textarea>
      <div class="form-row">
        <button class="btn mini primary" data-attr-save>保存配置</button>
        <button class="btn mini danger" data-attr-del>删除维度</button>
      </div>
      <canvas class="spark" style="width:100%;height:34px;display:block"></canvas>
      <details class="hist"><summary>历史记录（${(a.history || []).length} 条）</summary>
        <ul>${(a.history || []).slice(-14).reverse().map((h) => `<li>${GL.fmtClock(h.t)} — ${h.v}</li>`).join('') || '<li>暂无记录</li>'}</ul>
      </details>
    </div>`;
  }

  function render() {
    const el = document.getElementById('wing-attrs');
    if (!el) return;
    const avg = list().length
      ? Math.round(list().reduce((s, a) => s + a.value, 0) / list().length) : 0;
    const maxAvg = list().length
      ? Math.round(list().reduce((s, a) => s + a.max, 0) / list().length) : 100;

    el.innerHTML = `
      <div class="wing-head">
        <span class="wing-title">属性面板</span>
        <span class="wing-note">均值 ${avg} / ${maxAvg}</span>
      </div>
      <div id="attr-list">
        ${list().map(row).join('') || '<span class="dim">还没有属性维度，点下方按钮添加</span>'}
      </div>
      <button class="btn mini wide" id="attr-add-toggle" aria-expanded="${addOpen}">${addOpen ? '× 收起' : '＋ 新增属性维度'}</button>
      ${addOpen ? `<div class="xp-add" id="attr-add-box">
        <input type="text" id="a-name" placeholder="维度名，如 心情值" aria-label="维度名">
        <input type="number" id="a-min" value="0" style="width:68px" aria-label="最小分">
        <input type="number" id="a-max" value="100" style="width:68px" aria-label="最大分">
        <button class="btn mini primary" id="a-add">添加</button>
      </div>` : ''}
      ${list().length ? `<details class="hist" id="attr-manage"><summary>管理维度 · 区间 / 等级 / 趋势</summary>
        ${list().map(manageRow).join('')}
      </details>` : ''}`;

    // 管理区趋势图（按需绘制）
    el.querySelectorAll('#attr-manage canvas.spark').forEach((c, i) => sparkline(c, list()[i]));
  }

  function sparkline(canvas, a) {
    if (!a) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 260, H = 34;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const data = (a.history || []).slice(-30);
    if (data.length < 2) {
      ctx.fillStyle = '#646d84'; ctx.font = '10px monospace';
      ctx.fillText('打卡 2 次以上生成趋势', 2, H / 2 + 3);
      return;
    }
    const lo = a.min, hi = Math.max(a.max, a.min + 1);
    const clip = (v) => Math.min(hi, Math.max(lo, v));
    const px = (i) => 2 + (i / (data.length - 1)) * (W - 4);
    const py = (v) => H - 3 - ((clip(v) - lo) / (hi - lo)) * (H - 8);
    ctx.beginPath();
    data.forEach((d, i) => (i ? ctx.lineTo(px(i), py(d.v)) : ctx.moveTo(px(i), py(d.v))));
    ctx.strokeStyle = 'rgba(60,232,176,.85)'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.beginPath();
    ctx.arc(px(data.length - 1), py(data[data.length - 1].v), 2.2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffc24b'; ctx.fill();
  }

  function setValue(a, v) {
    const lo = a.min, hi = Math.max(a.max, a.min + 1);
    a.value = Math.round(Math.min(hi, Math.max(lo, v)));
    (a.history = a.history || []).push({ t: Date.now(), v: a.value });
    GL.changed();
  }

  function defaultLevels(min, max) {
    const span = max - min;
    return [
      { min: Math.round(min + span * 0.8), label: '🔥 充沛' },
      { min: Math.round(min + span * 0.6), label: '😊 良好' },
      { min: Math.round(min + span * 0.4), label: '😐 一般' },
      { min: Math.round(min + span * 0.2), label: '😕 低迷' },
      { min: -999, label: '😫 糟糕' }
    ];
  }

  function bind() {
    const el = document.getElementById('wing-attrs');
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';

    el.addEventListener('click', (e) => {
      const step = e.target.closest('[data-attr-step]');
      if (step) {
        const a = find(step.closest('[data-aid]').dataset.aid);
        if (a) setValue(a, a.value + Number(step.dataset.attrStep));
        return;
      }
      if (e.target.id === 'attr-add-toggle') { addOpen = !addOpen; render(); return; }
      if (e.target.id === 'a-add') {
        const name = (el.querySelector('#a-name').value || '').trim();
        const min = Number(el.querySelector('#a-min').value) || 0;
        const max = Number(el.querySelector('#a-max').value) || 100;
        if (!name) { GL.toast('先填写维度名', 'err'); return; }
        if (max <= min) { GL.toast('最大分必须大于最小分', 'err'); return; }
        list().push({
          id: GL.uid(), name, min, max, value: Math.round((min + max) / 2),
          levels: defaultLevels(min, max), history: []
        });
        addOpen = false;
        GL.toast('已添加「' + name + '」', 'ok');
        GL.changed();
        return;
      }

      const box = e.target.closest('.edit-box[data-aid]');
      if (!box) return;
      const a = find(box.dataset.aid);
      if (!a) return;

      if (e.target.dataset.attrRange !== undefined) {
        const min = Number(box.querySelector('[data-attr-min]').value);
        const max = Number(box.querySelector('[data-attr-max]').value);
        if (!(max > min)) { GL.toast('最大分必须大于最小分', 'err'); return; }
        a.min = min; a.max = max;
        a.value = Math.round(Math.min(max, Math.max(min, a.value)));
        GL.toast('区间已更新', 'ok');
        GL.changed();
      } else if (e.target.dataset.attrSave !== undefined) {
        const lines = box.querySelector('[data-attr-levels]').value.split('\n')
          .map((l) => l.trim()).filter(Boolean)
          .map((l) => {
            const [minS, ...rest] = l.split('|');
            return {
              min: minS.trim() === '最低' ? -999 : (Number(minS.trim()) || 0),
              label: rest.join('|').trim() || '未命名'
            };
          });
        a.levels = lines.length ? lines : GL.defLevels();
        GL.toast('评分框架已保存', 'ok');
        GL.changed();
      } else if (e.target.dataset.attrDel !== undefined) {
        if (!confirm('确定删除「' + a.name + '」及其全部历史吗？')) return;
        GL.state.attributes = list().filter((x) => x.id !== a.id);
        GL.changed();
      }
    });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'a-name') el.querySelector('#a-add').click();
    });
  }

  GL.hooks.push(render);
  GL.renderAttrs = function () { render(); bind(); };
})();
