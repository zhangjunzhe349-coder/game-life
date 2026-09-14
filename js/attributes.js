/* ============ Game Life · 自定义属性打分系统 ============ */
(function () {
  'use strict';

  function sparkline(canvas, attr) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 300, H = 48;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const data = (attr.history || []).slice(-30);
    if (data.length < 2) {
      ctx.fillStyle = '#5e6787'; ctx.font = '11px sans-serif';
      ctx.fillText('历史数据不足，继续打卡后生成趋势', 4, H / 2 + 4);
      return;
    }
    const lo = attr.min, hi = Math.max(attr.max, attr.min + 1);
    const px = (i) => 4 + (i / (data.length - 1)) * (W - 8);
    const py = (v) => H - 4 - ((THREE_clip(v, lo, hi) - lo) / (hi - lo)) * (H - 10);
    function THREE_clip(v, a, b) { return Math.min(b, Math.max(a, v)); }
    // 填充
    ctx.beginPath();
    ctx.moveTo(px(0), py(data[0].v));
    data.forEach((d, i) => ctx.lineTo(px(i), py(d.v)));
    ctx.lineTo(px(data.length - 1), H); ctx.lineTo(px(0), H); ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(124,92,255,.35)'); g.addColorStop(1, 'rgba(124,92,255,0)');
    ctx.fillStyle = g; ctx.fill();
    // 折线
    ctx.beginPath();
    data.forEach((d, i) => (i ? ctx.lineTo(px(i), py(d.v)) : ctx.moveTo(px(i), py(d.v))));
    ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    // 末点
    ctx.beginPath();
    ctx.arc(px(data.length - 1), py(data[data.length - 1].v), 3, 0, Math.PI * 2);
    ctx.fillStyle = '#22d3ee'; ctx.fill();
  }

  function card(a) {
    const hist = (a.history || []).slice(-12).reverse()
      .map((h) => `<li>${GL.fmtClock(h.t)} — ${h.v}</li>`).join('');
    const lvText = (a.levels || []).slice().sort((x, y) => y.min - x.min)
      .map((l) => `${l.min === -999 ? '最低' : l.min + ' 分以下也含'}：${GL.esc(l.label)}`)
      .join('\n');
    return `<div class="card" data-aid="${a.id}">
      <div class="attr-top">
        <span class="card-title">📊 ${GL.esc(a.name)}</span>
        <span class="lvl-chip">${GL.esc(GL.attrLevel(a))}</span>
      </div>
      <div class="attr-val-row">
        <div class="attr-num">${a.value}</div>
        <div class="attr-ops">
          <button class="btn" data-attr-step="-1">−</button>
          <button class="btn" data-attr-step="1">＋</button>
        </div>
        <span class="dim">区间 ${a.min} ~ ${a.max}</span>
      </div>
      <input type="range" min="${a.min}" max="${a.max}" step="1" value="${a.value}" data-attr-slider="${a.id}" style="margin-top:10px">
      <canvas class="spark"></canvas>
      <div class="edit-box">
        <div class="form-row">
          <input type="number" value="${a.min}" data-attr-min style="width:80px" title="最小值">
          <input type="number" value="${a.max}" data-attr-max style="width:80px" title="最大值">
          <button class="btn mini" data-attr-range>更新区间</button>
        </div>
        <label class="field-label">等级描述（每行一条，格式：分数|描述，从高到低）</label>
        <textarea data-attr-levels>${GL.esc(lvText)}</textarea>
        <div class="form-row">
          <button class="btn mini primary" data-attr-save>保存配置</button>
          <button class="btn mini danger" data-attr-del>删除维度</button>
        </div>
      </div>
      ${hist ? `<details class="hist"><summary>历史记录（${(a.history || []).length} 条）</summary><ul>${hist}</ul></details>` : ''}
    </div>`;
  }

  function render() {
    const el = document.getElementById('panel-attrs');
    if (!el) return;
    el.innerHTML = `
      ${GL.state.attributes.map(card).join('')}
      <div class="card">
        <div class="card-head"><span class="card-title">＋ 新增属性维度</span><span class="card-hint">维度、区间、等级全部自定义</span></div>
        <div class="form-row">
          <input type="text" id="a-name" placeholder="属性名，如 精力值">
          <input type="number" id="a-min" value="0" style="width:80px" title="最小分">
          <input type="number" id="a-max" value="100" style="width:80px" title="最大分">
          <button class="btn primary mini" id="a-add">添加</button>
        </div>
        <div class="dim" style="margin-top:6px">默认按 20 分一档生成等级描述，创建后可自由修改。</div>
      </div>`;
    el.querySelectorAll('canvas.spark').forEach((c, i) => sparkline(c, GL.state.attributes[i]));
  }

  function bind() {
    const el = document.getElementById('panel-attrs');
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';

    el.addEventListener('click', (e) => {
      const cardEl = e.target.closest('[data-aid]');
      const a = cardEl ? GL.state.attributes.find((x) => x.id === cardEl.dataset.aid) : null;

      const step = e.target.closest('[data-attr-step]');
      if (step && a) {
        setValue(a, THREE_clamp(a.value + Number(step.dataset.attrStep), a.min, a.max));
        return;
      }
      if (!a) {
        if (e.target.id === 'a-add') {
          const name = el.querySelector('#a-name').value.trim();
          const min = Number(el.querySelector('#a-min').value) || 0;
          const max = Number(el.querySelector('#a-max').value) || 100;
          if (!name) { GL.toast('先填写属性名', 'err'); return; }
          GL.state.attributes.push({
            id: GL.uid(), name, min, max, value: Math.round((min + max) / 2),
            levels: defaultLevels(min, max), history: []
          });
          GL.toast('已添加「' + name + '」');
          GL.changed();
        }
        return;
      }
      if (e.target.dataset.attrRange !== undefined) {
        const min = Number(cardEl.querySelector('[data-attr-min]').value);
        const max = Number(cardEl.querySelector('[data-attr-max]').value);
        if (max <= min) { GL.toast('最大分必须大于最小分', 'err'); return; }
        a.min = min; a.max = max;
        a.value = clampV(a.value, min, max);
        GL.toast('区间已更新');
        GL.changed();
      } else if (e.target.dataset.attrSave !== undefined) {
        const lines = cardEl.querySelector('[data-attr-levels]').value.split('\n')
          .map((l) => l.trim()).filter(Boolean)
          .map((l) => {
            const [minS, ...rest] = l.split('|');
            return { min: minS.trim() === '最低' ? -999 : (Number(minS.trim()) || 0), label: rest.join('|').trim() || '未命名' };
          });
        a.levels = lines.length ? lines : GL.defLevels();
        GL.toast('评分框架已保存');
        GL.changed();
      } else if (e.target.dataset.attrDel !== undefined) {
        if (!confirm('确定删除「' + a.name + '」及其全部历史吗？')) return;
        GL.state.attributes = GL.state.attributes.filter((x) => x.id !== a.id);
        GL.changed();
      }
    });

    el.addEventListener('change', (e) => {
      const s = e.target.closest('[data-attr-slider]');
      if (!s) return;
      const a = GL.state.attributes.find((x) => x.id === s.dataset.attrSlider);
      if (a) setValue(a, Number(s.value));
    });
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

  function clampV(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function setValue(a, v) {
    a.value = Math.round(v);
    (a.history = a.history || []).push({ t: Date.now(), v: a.value });
    GL.changed();
  }

  GL.hooks.push(() => { render(); });
  GL.renderAttrs = function () { render(); bind(); };
})();
