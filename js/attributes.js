/* ============ Game Life · 属性面板（HUD 左翼） ============
   设计要点（v1.5.0 重做）
   ------------------------------------------------------------
   1. 三级视觉权重，让 14 项能挤进原来 8 项的地方：
        第 1 级 大类标题 —— 承担识别，正常字号 + 组均值 + 汇总条
        第 2 级 小项     —— 11px 灰字 + 等宽数字 + 2px 细刻度，一行约 20px
        第 3 级 调节     —— 点小项才展开，不操作时不占地方
      原本每项都是「34px 大数字 + 6px 粗条 + ±按钮」的重规格，14 项扛不住。

   2. 极性决定语义与配色（这是本次最容易读错的地方）：
        pos 越高越好 → 青色，条越长越好
        neg 越低越好 → 红色，条越长越需要注意（熵值三项、困倦度）
        mid 中间最好 → 琥珀，标出理想区间（社交度、稳定度）

   3. 组标题可点击折叠，折叠状态存 GL.state.ui.attrCollapsed。
   ============================================================ */
(function () {
  'use strict';

  let addOpen = false;
  let tuneFor = null;              // 当前展开微调的属性 id

  function list() { return GL.state.attributes; }
  function find(id) { return list().find((a) => a.id === id); }
  function collapsed() {
    if (!GL.state.ui) GL.state.ui = { attrCollapsed: [] };
    if (!Array.isArray(GL.state.ui.attrCollapsed)) GL.state.ui.attrCollapsed = [];
    return GL.state.ui.attrCollapsed;
  }
  function isCollapsed(gid) { return collapsed().indexOf(gid) !== -1; }

  function pct(a) {
    const lo = a.min, hi = Math.max(a.max, a.min + 1);
    return Math.max(0, Math.min(100, Math.round(((a.value - lo) / (hi - lo)) * 100)));
  }

  /* 极性 → CSS 类名后缀，样式表据此换色 */
  function pol(a) { return a.polarity === 'neg' ? 'neg' : (a.polarity === 'mid' ? 'mid' : ''); }

  /* ---------- 第 2 级：细刻度行 ---------- */
  function miniRow(a) {
    const p = pct(a);
    const open = tuneFor === a.id;
    const sub = a.sub ? `<span class="ag-sub" title="${GL.esc(a.sub)}">${GL.esc(a.sub)}</span>` : '';
    return `<button type="button" class="ag-row ${pol(a)}${open ? ' tune-open' : ''}"
        data-aid="${a.id}" aria-expanded="${open}"
        title="${GL.esc(a.name)} · ${GL.POL_NAME[a.polarity] || GL.POL_NAME.pos}">
      <span class="ag-label"><span class="ag-t">${GL.esc(a.name)}</span>${sub}</span>
      <span class="ag-num">${a.value}</span>
      <span class="ag-track">
        <i style="width:${p}%"></i>
        ${a.polarity === 'mid' ? '<b class="ag-ideal" title="理想区间"></b>' : ''}
      </span>
    </button>
      ${open ? `<div class="ag-tune" data-aid="${a.id}">
      <div class="ag-tune-row">
        <button type="button" class="btn mini" data-attr-step="-5">−5</button>
        <button type="button" class="btn mini" data-attr-step="-1">−1</button>
        <input type="number" data-attr-set value="${a.value}" min="${a.min}" max="${a.max}" aria-label="${GL.esc(a.name)} 数值">
        <button type="button" class="btn mini" data-attr-step="1">＋1</button>
        <button type="button" class="btn mini" data-attr-step="5">＋5</button>
        <span class="ag-tune-note">${GL.esc(tuneNote(a))}</span>
      </div>
      ${GL.textEditBox(a, 'attr')}
    </div>` : ''}`;
  }

  /* ---------- 第 1 级：大类分组 ---------- */
  function groupBlock(g) {
    if (!g.items.length) return '';
    const mean = GL.groupMean(g.items);
    const neg = GL.groupPolarity(g.items) === 'neg';
    const shut = isCollapsed(g.id);
    return `<section class="ag ${neg ? 'neg' : ''}${shut ? ' shut' : ''}" data-gid="${g.id}">
      <button class="ag-head" data-ag-toggle="${g.id}" aria-expanded="${!shut}">
        <span class="ag-glyph" aria-hidden="true">${g.emoji}</span>
        <span class="ag-name">${GL.esc(g.name)}</span>
        <span class="ag-tag" title="${GL.esc(g.note || '')}">${GL.esc(g.note || '')}</span>
        <span class="ag-mean">${mean}</span>
        <span class="ag-chev" aria-hidden="true">▾</span>
      </button>
      <span class="ag-bar"><i style="width:${mean}%"></i></span>
      <div class="ag-items">
        ${g.items.map(miniRow).join('')}
      </div>
    </section>`;
  }

  /* ---------- 管理区（区间 / 等级 / 删除 / 趋势） ---------- */
  function manageRow(a) {
    const lvText = (a.levels || []).slice().sort((x, y) => y.min - x.min)
      .map((l) => `${l.min === -999 ? '最低' : l.min}|${l.label}`).join('\n');
    return `<div class="edit-box" data-aid="${a.id}">
      <div class="card-head" style="margin:0;padding:0 0 8px;border:0">
        <span class="card-title" style="font-size:14px">${GL.esc(a.name)}</span>
        <span class="card-hint">${a.min} ~ ${a.max}</span>
      </div>
      <div class="form-row">
        <label class="field-label" style="margin:0;flex:1">刻度语义</label>
        <select data-attr-pol aria-label="刻度语义">
          ${Object.keys(GL.POL_NAME).map((k) => `<option value="${k}"${a.polarity === k ? ' selected' : ''}>${GL.POL_NAME[k]}</option>`).join('')}
        </select>
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
    const all = list();
    /* 综合分用 GL.overallScore()：负向指标取反后再平均，
       与顶栏 HUD 的「状态均值」保持同一口径。 */
    const avg = GL.overallScore();
    const groups = GL.attrByGroup();

    el.innerHTML = `
      <div class="wing-head">
        <span class="wing-title">属性面板</span>
        <span class="wing-note">${all.length} 项 · 综合 ${avg}</span>
      </div>
      <div class="ag-list">
        ${groups.map(groupBlock).join('') || '<span class="dim">还没有属性维度，点下方按钮添加</span>'}
      </div>
      <button class="btn mini wide" id="attr-add-toggle" aria-expanded="${addOpen}">${addOpen ? '× 收起' : '＋ 新增属性维度'}</button>
      ${addOpen ? `<div class="xp-add" id="attr-add-box">
        <input type="text" id="a-name" placeholder="维度名，如 专注度" aria-label="维度名">
        <input type="number" id="a-min" value="0" style="width:68px" aria-label="最小分">
        <input type="number" id="a-max" value="100" style="width:68px" aria-label="最大分">
        <button class="btn mini primary" id="a-add">添加</button>
      </div>` : ''}
      ${all.length ? `<details class="hist" id="attr-manage"><summary>管理维度 · 语义 / 区间 / 等级 / 趋势</summary>
        ${all.map(manageRow).join('')}
      </details>` : ''}`;

    // 管理区趋势图：details 展开后才测量宽度，因此展开时再绘制一次
    const mg = el.querySelector('#attr-manage');
    if (mg) {
      const paint = () => mg.querySelectorAll('canvas.spark').forEach((c, i) => sparkline(c, all[i]));
      mg.addEventListener('toggle', () => { if (mg.open) requestAnimationFrame(paint); });
      if (mg.open) requestAnimationFrame(paint);
    }
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
    // 负向指标的折线用红色，与刻度条保持一致，避免误读
    const stroke = a.polarity === 'neg' ? 'rgba(255,95,109,.85)'
      : (a.polarity === 'mid' ? 'rgba(255,194,75,.85)' : 'rgba(60,232,176,.85)');
    ctx.beginPath();
    data.forEach((d, i) => (i ? ctx.lineTo(px(i), py(d.v)) : ctx.moveTo(px(i), py(d.v))));
    ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
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

  /* 微调区右侧的语义提示：负向 / 双向项不给「🔥 充沛」这类夸奖式等级，
     直接说明刻度方向，避免误读。 */
  function tuneNote(a) {
    if (a.polarity === 'neg') return '越低越好';
    if (a.polarity === 'mid') return '中间最好';
    return GL.attrLevel(a);
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

  /* 文字字段改动后就地刷新刻度行上的「名称 + 小字」。
     走 DOM 直改而不是 GL.changed()：重渲染会把正在编辑的输入框整个换掉，
     光标和输入内容都会丢，编辑体验会碎掉。 */
  function repaintRow(a) {
    const row = document.querySelector('.ag-row[data-aid="' + a.id + '"]');
    if (!row) return;
    const lab = row.querySelector('.ag-label');
    if (lab) {
      lab.innerHTML = '<span class="ag-t">' + GL.esc(a.name) + '</span>'
        + (a.sub ? '<span class="ag-sub" title="' + GL.esc(a.sub) + '">' + GL.esc(a.sub) + '</span>' : '');
    }
    row.title = a.name + ' · ' + (GL.POL_NAME[a.polarity] || GL.POL_NAME.pos);
  }

  function bind() {
    const el = document.getElementById('wing-attrs');
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';

    el.addEventListener('click', (e) => {
      /* 折叠 / 展开大类 */
      const tog = e.target.closest('[data-ag-toggle]');
      if (tog) {
        const gid = tog.dataset.agToggle;
        const arr = collapsed();
        const i = arr.indexOf(gid);
        if (i === -1) arr.push(gid); else arr.splice(i, 1);
        GL.changed();
        return;
      }

      /* 步进微调 */
      const step = e.target.closest('[data-attr-step]');
      if (step) {
        const a = find(step.closest('[data-aid]').dataset.aid);
        if (a) setValue(a, a.value + Number(step.dataset.attrStep));
        return;
      }

      /* 点小项行 → 展开 / 收起微调 */
      const row = e.target.closest('.ag-row[data-aid]');
      if (row) {
        tuneFor = tuneFor === row.dataset.aid ? null : row.dataset.aid;
        GL.changed();
        const inp = el.querySelector('.ag-tune[data-aid="' + tuneFor + '"] input');
        if (inp) { inp.focus(); inp.select(); }
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
          id: GL.uid(), name, sub: '', group: 'physio', polarity: 'pos',
          min, max, value: Math.round((min + max) / 2),
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

    /* 直接输入数值 + 改刻度语义 + 编辑文字 */
    el.addEventListener('change', (e) => {
      /* 名称 / 小字 / 说明：三选一，命中就写盘并就地刷新小字，不重渲染 */
      const d = e.target.dataset;
      const txKey = d.attrName !== undefined ? 'name'
        : (d.attrSub !== undefined ? 'sub' : (d.attrNote !== undefined ? 'note' : null));
      if (txKey) {
        const box = e.target.closest('.ag-tune');
        const a = box ? find(box.dataset.aid) : null;
        if (!a) return;
        const val = txKey === 'name' ? String(e.target.value).trim() : String(e.target.value);
        if (txKey === 'name' && !val) { GL.toast('名称不能为空', 'err'); e.target.value = a.name; return; }
        a[txKey] = val;
        GL.save();
        if (txKey !== 'note') repaintRow(a);
        return;
      }
      if (e.target.dataset.attrSet !== undefined) {
        const box = e.target.closest('.ag-tune');
        const a = box ? find(box.dataset.aid) : null;
        const v = Number(e.target.value);
        if (a && !isNaN(v)) setValue(a, v);
        return;
      }
      if (e.target.dataset.attrPol !== undefined) {
        const box = e.target.closest('.edit-box[data-aid]');
        const a = box ? find(box.dataset.aid) : null;
        if (a) {
          /* 等级文案随极性同步 —— 否则负向项会显示「🔥 充沛」这种反义描述 */
          const wasDefault = JSON.stringify(a.levels) === JSON.stringify(GL.attrLevelsFor(a.polarity));
          a.polarity = e.target.value;
          if (wasDefault) a.levels = GL.attrLevelsFor(a.polarity);
          GL.toast('刻度语义改为「' + GL.POL_NAME[a.polarity] + '」', 'ok');
          GL.changed();
        }
      }
    });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'a-name') { el.querySelector('#a-add').click(); return; }
      /* 单行文字框里按 Enter = 提交（textarea 不拦，Enter 要留给换行） */
      if (e.key === 'Enter' && e.target.tagName === 'INPUT'
          && (e.target.dataset.attrName !== undefined || e.target.dataset.attrSub !== undefined)) {
        e.target.blur();
        return;
      }
      if (e.key === 'Enter' && e.target.dataset.attrSet !== undefined) {
        const box = e.target.closest('.ag-tune');
        const a = box ? find(box.dataset.aid) : null;
        const v = Number(e.target.value);
        if (a && !isNaN(v)) { tuneFor = null; setValue(a, v); }
      }
      /* Esc 收起微调区。先 blur 让正在编辑的字段触发 change 落盘，
         否则未失焦的改动会被随后的重渲染直接丢掉。 */
      if (e.key === 'Escape' && e.target.closest && e.target.closest('.ag-tune')) {
        if (e.target.blur) e.target.blur();
        tuneFor = null;
        GL.changed();
      }
    });
  }

  /* ---------- 注册 ----------
     hooks 里必须带 bind()：GL.changed() 是唯一的重渲染入口（app.js 首屏也走它），
     若只注册 render，事件委托就永远不会绑定 —— 表现为「页面能看、点不动」。
     bind() 内部有 el.dataset.bound 幂等保护，重复调用是安全的。 */
  const renderAll = function () { render(); bind(); };
  GL.hooks.push(renderAll);
  GL.renderAttrs = renderAll;
})();
