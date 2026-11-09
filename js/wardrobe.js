/* ============ Game Life · 电子衣橱（v1.11.0 重整） ============
   用户 2026-11-09 的要求（逐条对位）：
     · 「底部的四个总栏目现在新增一个电子衣橱的页面」→ 独立页签 panel-wardrobe，
       不再挂在总览页底部当折叠块。
     · 「左边：上衣 / 下装 / 鞋 / 包 / 配饰」→ 五个分类，包从配饰里拆出来
       （内置 w33~w35 三只包在 v5 迁移里改成了 slot='bag'）。
     · 「右边上方加一个顶层筛选 夏装、冬装」→ 季节筛选；「分类属性可以按年分
       也可以按季节分」→ 年份也做成一行筛选。
     · 「每一个衣服可以点开编辑设定买入的年份，然后设定他是冬夏，还是上衣，
       还是内衣」→ 卡片右上角「✎」就地展开编辑面板：名称 / 类别 / 季节 / 年份。

   状态契约：
     GL.state.avatar.wardrobe[]  { id, name, slot, cat, color, box, img, season, year }
     GL.state.avatar.outfit      { top, bottom, shoes, bag, accessory } → id | null

   ⚠ 换装后**不要走 GL.changed()** —— 那是整页重渲染，会把右侧网格的滚动位置
     和已加载的图片全部推倒（41 张图重新解码会闪）。走 paint() 只重画局部。
   ⚠ 编辑输入同样只 GL.save()、不 GL.changed()（会换掉正在输入的框、丢光标）。
   ============================================================ */
(function () {
  'use strict';

  /* 分类页签：[键, 标签]。'all' 之外的键与单品 slot 同名 */
  const CATS = [
    ['all', '全部'], ['top', '上衣'], ['bottom', '下装'],
    ['shoes', '鞋'], ['bag', '包'], ['accessory', '配饰']
  ];

  /* 季节：四季（all）在夏/冬两个筛选下都要出现 —— 它本来就两季都能穿 */
  const SEASONS = [['all', '全部'], ['summer', '夏装'], ['winter', '冬装']];
  const SEASON_LABEL = { summer: '夏装', winter: '冬装', all: '四季' };

  const SLOT_LABEL = { top: '上衣', bottom: '下装', shoes: '鞋', bag: '包', accessory: '配饰' };

  /* 搭配框四格：包与配饰合占一格（左栏只有 216px，五格竖排会把「当前搭配」拖太长） */
  const BOXES = [
    { key: 'top', label: '上衣', slots: ['top'] },
    { key: 'bottom', label: '下装', slots: ['bottom'] },
    { key: 'shoes', label: '鞋', slots: ['shoes'] },
    { key: 'bag', label: '包 · 配饰', slots: ['bag', 'accessory'] }
  ];

  let cat = 'all';
  let season = 'all';
  let year = 'all';          // 'all' | 'none'（未标注） | 具体年份数字字符串
  let editingId = null;

  function A() { return GL.state.avatar; }
  function itemOf(id) { return A().wardrobe.find((w) => w.id === id) || null; }
  function equippedIds() {
    const o = A().outfit || {};
    return Object.keys(o).map((k) => o[k]).filter(Boolean);
  }

  /* ---------- 筛选 ---------- */
  /* 季节：'all'=不筛；'summer'/'winter' 只在**明确标注过**的单品里筛，
     未标注（null）不算任何一季 —— 否则第一次点「冬装」会把 41 件全列出来，
     筛选看着像没生效。四季（season='all'）两季都在。 */
  function inSeason(it, s) {
    if (s === 'all') return true;
    return it.season === s || it.season === 'all';
  }

  function inYear(it, y) {
    if (y === 'all') return true;
    if (y === 'none') return !it.year;
    return String(it.year) === String(y);
  }

  function list() {
    return A().wardrobe.filter((it) =>
      (cat === 'all' || it.slot === cat) && inSeason(it, season) && inYear(it, year));
  }

  /* 年份筛选条：只列真实出现过的年份，倒序（新的在前） */
  function years() {
    const set = new Set();
    let none = false;
    A().wardrobe.forEach((it) => {
      if (it.year) set.add(Number(it.year));
      else none = true;
    });
    return { years: Array.from(set).sort((a, b) => b - a), none };
  }

  /* ---------- 片段 ---------- */
  function slotHTML(b, a) {
    const picked = b.slots
      .map((s) => ({ slot: s, it: itemOf((a.outfit || {})[s]) }))
      .filter((x) => x.it);
    const figs = picked.map((x) => `
      <img class="wr-fig" src="${x.it.img}" alt="${GL.esc(x.it.name)}"
           data-off="${x.slot}" title="点一下脱下">`).join('');
    const names = picked.map((x) => GL.esc(x.it.name)).join(' · ');
    return `
      <div class="wr-slot${picked.length ? ' has' : ''}">
        <span class="wr-tag">${b.label}</span>
        <span class="wr-stage">${figs || '<i class="wr-none">空</i>'}</span>
        <span class="wr-wear">${names || '右边点一件穿上'}</span>
      </div>`;
  }

  function cardHTML(it) {
    const on = equippedIds().indexOf(it.id) !== -1;
    const meta = [];
    if (it.season) meta.push(SEASON_LABEL[it.season] || '');
    if (it.year) meta.push(String(it.year));
    return `
      <div class="wr-card${on ? ' on' : ''}" data-item="${it.id}">
        <button class="wr-hit" type="button" aria-label="穿上 ${GL.esc(it.name)}">
          <img src="${it.img}" alt="" loading="lazy" decoding="async">
        </button>
        <button class="wr-edit" type="button" data-edit="${it.id}"
                aria-label="编辑 ${GL.esc(it.name)}">✎</button>
        <span class="wr-label"><b class="wr-name">${GL.esc(it.name)}</b>${meta.length
          ? `<i class="wr-meta">${GL.esc(meta.join(' · '))}</i>` : ''}</span>
      </div>`;
  }

  /* 就地编辑面板（不弹浮层 —— 用户对技能浮窗的态度是「不要浮窗，直接展开」） */
  function editorHTML(it) {
    if (!it) return '';
    const opts = (pairs, cur) => pairs.map(([v, n]) =>
      `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${n}</option>`).join('');
    const thisYear = new Date().getFullYear();
    const yearOpts = [['', '未填']];
    for (let y = thisYear; y >= thisYear - 20; y--) yearOpts.push([String(y), String(y)]);
    return `
      <div class="wr-editbox" data-editbox="${it.id}">
        <div class="wr-eb-head">
          <span class="wr-eb-title">编辑单品</span>
          <button class="btn mini" type="button" data-edit-close>收起</button>
        </div>
        <label class="field-label">名称</label>
        <input type="text" data-edit-name value="${GL.esc(it.name)}" aria-label="单品名称">
        <div class="wr-eb-row">
          <div>
            <label class="field-label">类别</label>
            <select data-edit-slot aria-label="类别">
              ${opts([['top', '上衣'], ['bottom', '下装'], ['shoes', '鞋'],
                ['bag', '包'], ['accessory', '配饰']], it.slot)}
            </select>
          </div>
          <div>
            <label class="field-label">季节</label>
            <select data-edit-season aria-label="季节">
              ${opts([['', '未标注'], ['summer', '夏装'], ['winter', '冬装'], ['all', '四季']], it.season || '')}
            </select>
          </div>
          <div>
            <label class="field-label">买入年份</label>
            <select data-edit-year aria-label="买入年份">${opts(yearOpts, it.year || '')}</select>
          </div>
        </div>
        <div class="wr-eb-note">改类别会把单品挪到对应栏目；已穿着的不会自动脱下。</div>
      </div>`;
  }

  function filterChip(kind, key, label, count, on) {
    return `<button class="wr-chip${on ? ' on' : ''}" type="button"
        data-f-${kind}="${key}">${label}${count !== undefined ? `<i>${count}</i>` : ''}</button>`;
  }

  /* ---------- 渲染 ---------- */
  function render() {
    const host = document.getElementById('wardrobe-ctrl');
    if (!host) return;
    const a = A();

    if (!a.wardrobe || !a.wardrobe.length) {
      host.innerHTML = '<div class="card"><div class="muted">'
        + '衣橱单品库为空 —— 请先跑 <code>python tools/build-wardrobe.py</code> 生成素材与清单。'
        + '</div></div>';
      return;
    }

    const prev = host.querySelector('.wr-grid');
    const keepY = prev ? prev.scrollTop : 0;

    const items = list();
    const y = years();
    const editing = editingId ? itemOf(editingId) : null;

    host.innerHTML = `
      <div class="wr">
        <div class="wr-look">
          <div class="wr-lookhead">当前搭配</div>
          ${BOXES.map((b) => slotHTML(b, a)).join('')}
          <div class="wr-foot">共 ${a.wardrobe.length} 件 · 点卡片穿 / 脱下</div>
        </div>
        <div class="wr-pick">
          <div class="wr-filters">
            <div class="wr-frow">
              <span class="wr-flabel">季节</span>
              <div class="wr-chips">${SEASONS.map(([k, n]) =>
                filterChip('season', k, n, undefined, season === k)).join('')}</div>
            </div>
            <div class="wr-frow">
              <span class="wr-flabel">年份</span>
              <div class="wr-chips">
                ${filterChip('year', 'all', '全部', undefined, year === 'all')}
                ${y.years.map((yy) => filterChip('year', String(yy), String(yy), undefined,
                  year === String(yy))).join('')}
                ${y.none ? filterChip('year', 'none', '未填', undefined, year === 'none') : ''}
              </div>
            </div>
          </div>
          ${editorHTML(editing)}
          <div class="wr-cats">
            ${CATS.map(([k, n]) => {
              const c = k === 'all' ? a.wardrobe.length
                : a.wardrobe.filter((i) => i.slot === k).length;
              return `<button class="wr-cat${cat === k ? ' on' : ''}" data-cat="${k}"
                        type="button">${n}<i>${c}</i></button>`;
            }).join('')}
          </div>
          <div class="wr-count">${items.length} 件符合筛选</div>
          <div class="wr-grid">${items.map(cardHTML).join('')
            || `<div class="wr-empty">这里还没有单品${season !== 'all'
              ? '——点卡片右上角的 ✎ 把季节标上，它就会出现在这一栏' : ''}</div>`}</div>
        </div>
      </div>`;

    const np = host.querySelector('.wr-grid');
    if (np) np.scrollTop = keepY;
  }

  /* 局部刷新：只重画搭配框 + 卡片选中态。不动网格 DOM，滚动与图片都保留。 */
  function paint() {
    const host = document.getElementById('wardrobe-ctrl');
    if (!host) return;
    const a = A();
    const wears = host.querySelectorAll('.wr-slot');
    BOXES.forEach((b, i) => {
      if (wears[i]) wears[i].outerHTML = slotHTML(b, a);
    });
    const ids = equippedIds();
    host.querySelectorAll('.wr-card').forEach((c) => {
      c.classList.toggle('on', ids.indexOf(c.dataset.item) !== -1);
    });
  }

  function wear(it) {
    const a = A();
    if (!a.outfit) a.outfit = {};
    a.outfit[it.slot] = a.outfit[it.slot] === it.id ? null : it.id;
    GL.save();
    paint();
    GL.toast(a.outfit[it.slot] ? '已穿上「' + it.name + '」' : '已脱下「' + it.name + '」');
  }

  /* ---------- 事件 ---------- */
  function bind() {
    const host = document.getElementById('wardrobe-ctrl');
    if (!host || host.dataset.bound) return;
    host.dataset.bound = '1';

    host.addEventListener('click', (e) => {
      /* 编辑 */
      const ed = e.target.closest('[data-edit]');
      if (ed) {
        editingId = editingId === ed.dataset.edit ? null : ed.dataset.edit;
        render();
        if (editingId) {
          const inp = host.querySelector('[data-edit-name]');
          if (inp) { inp.focus(); inp.select(); }
        }
        return;
      }
      if (e.target.closest('[data-edit-close]')) { editingId = null; render(); return; }

      /* 筛选 */
      const fs = e.target.closest('[data-f-season]');
      if (fs && season !== fs.dataset.fSeason) { season = fs.dataset.fSeason; render(); return; }
      const fy = e.target.closest('[data-f-year]');
      if (fy && year !== fy.dataset.fYear) { year = fy.dataset.fYear; render(); return; }

      /* 分类 */
      const c = e.target.closest('[data-cat]');
      if (c && cat !== c.dataset.cat) { cat = c.dataset.cat; render(); return; }

      /* 脱下 */
      const off = e.target.closest('[data-off]');
      if (off) {
        const a = A();
        const it = itemOf(a.outfit[off.dataset.off]);
        a.outfit[off.dataset.off] = null;
        GL.save();
        paint();
        if (it) GL.toast('已脱下「' + it.name + '」');
        return;
      }

      /* 穿上（只认卡片主体那个 button，避免和右上角的 ✎ 抢热区） */
      const hit = e.target.closest('.wr-hit');
      if (hit) {
        const card = hit.closest('[data-item]');
        const it = card ? itemOf(card.dataset.item) : null;
        if (it) wear(it);
      }
    });

    /* 编辑字段：change 即落盘，**不重渲染**（否则输入框会被换掉、光标丢失）
       ⚠ 一律用 `e.target.value`，**不能读 dataset** —— `data-edit-season` 这类
       属性是"无值属性"，dataset.editSeason 恒为空字符串，读它会把季节写成 null
       （v1.11.0 实测踩过：界面上选了冬装、保存下来却是未标注）。 */
    host.addEventListener('change', (e) => {
      const t = e.target;
      const box = t.closest('[data-editbox]');
      if (!box) return;
      const it = itemOf(box.dataset.editbox);
      if (!it) return;

      if (t.matches('[data-edit-name]')) {
        const v = String(t.value).trim();
        if (!v) { GL.toast('名称不能为空', 'err'); t.value = it.name; return; }
        it.name = v;
        GL.save();
        /* 名称变了，卡片标签与搭配框都要跟着更新 —— 但只改文本，不整块重绘 */
        const nm = host.querySelector('[data-item="' + it.id + '"] .wr-name');
        if (nm) nm.textContent = it.name;
        paint();
        return;
      }
      if (t.matches('[data-edit-slot]')) {
        it.slot = t.value;
        GL.save();
        GL.toast('已归到「' + (SLOT_LABEL[it.slot] || it.slot) + '」', 'ok');
        render();
        return;
      }
      if (t.matches('[data-edit-season]')) {
        it.season = t.value || null;
        GL.save();
        render();
        return;
      }
      if (t.matches('[data-edit-year]')) {
        it.year = t.value ? Number(t.value) : null;
        GL.save();
        render();
        return;
      }
    });

    host.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.dataset.editName !== undefined) {
        e.target.blur();
      }
      if (e.key === 'Escape' && editingId) { editingId = null; render(); }
    });
  }

  const renderAll = function () { render(); bind(); };
  GL.hooks.push(renderAll);
  GL.renderWardrobe = renderAll;
})();
