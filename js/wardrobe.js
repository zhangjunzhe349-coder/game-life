/* ============ Game Life · 电子衣橱（照片版） ============
   左「搭配框」+ 右「选择区」，挂在舞台下方的折叠面板里。

   设计要点（用户 2026-09-26 定案）：
   · **展示全部衣服**：41 件真实白底图，等宽等高卡片铺成网格。
     图片已在构建时按类别归一（tools/build-wardrobe.py），
     所以「鞋子跟鞋子一样大、衣服跟衣服差不多大」，卡片本身不必再缩放。
   · **搭配框三格**：上衣 / 下装 / 鞋·配饰（鞋和配饰合并一格，按用户要求）。
   · **手机端左搭配 / 右选择**：左侧固定 92px，右侧自适应 2 列卡片。
   · **入口就在折叠面板里**，不另开页；默认展示衣橱，体型参数收在另一个页签。

   状态契约（只读 GL.state.avatar，不新增结构）：
     wardrobe[]  单品库（由 storage.js 从 GL.WARDROBE_LIB 播种）
     outfit{}    { top, bottom, shoes, accessory } → 单品 id 或 null

   ⚠ 换装后**不要走 GL.changed()** —— 那是整页重渲染，会把右侧网格的滚动位置
     和所有已加载的图片一起推倒重来（41 张图会重新解码闪烁）。
     这里走 paint()：只重画搭配框 + 翻转卡片选中态 + 单独刷立绘。
   ============================================================ */
(function () {
  'use strict';

  /* 分类页签：[键, 标签]。'all' 之外的键与单品 slot 同名 */
  const CATS = [
    ['all', '全部'], ['top', '上衣'], ['bottom', '下装'],
    ['shoes', '鞋'], ['accessory', '配饰']
  ];

  /* 搭配框三格。slots 决定这一格纳管哪些 outfit 槽位：
     「鞋 · 配饰」一格管两个槽，两件可以同时在框里（并排显示）。 */
  const BOXES = [
    { key: 'top', label: '上衣', slots: ['top'] },
    { key: 'bottom', label: '下装', slots: ['bottom'] },
    { key: 'shoes', label: '鞋 · 配饰', slots: ['shoes', 'accessory'] }
  ];

  let filter = 'all';

  function A() { return GL.state.avatar; }
  function itemOf(id) { return A().wardrobe.find((w) => w.id === id) || null; }
  function equippedIds() {
    const o = A().outfit;
    return Object.keys(o).map((k) => o[k]).filter(Boolean);
  }

  /* ---------- 片段 ---------- */
  function slotHTML(b, a) {
    const picked = b.slots
      .map((s) => ({ slot: s, it: itemOf(a.outfit[s]) }))
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
    return `
      <button class="wr-card${on ? ' on' : ''}" data-item="${it.id}" type="button">
        <img src="${it.img}" alt="" loading="lazy" decoding="async">
        <span class="wr-label">${GL.esc(it.name)}</span>
      </button>`;
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

    const prev = host.querySelector('.wr-pick');
    const keepY = prev ? prev.scrollTop : 0;

    const list = a.wardrobe.filter((it) => filter === 'all' || it.slot === filter);

    host.innerHTML = `
      <div class="wr">
        <div class="wr-look">
          <div class="wr-lookhead">当前搭配</div>
          ${BOXES.map((b) => slotHTML(b, a)).join('')}
          <div class="wr-foot">共 ${a.wardrobe.length} 件 · 点卡片穿 / 脱下</div>
        </div>
        <div class="wr-pick">
          <div class="wr-cats">
            ${CATS.map(([k, n]) => {
              const c = k === 'all' ? a.wardrobe.length
                : a.wardrobe.filter((i) => i.slot === k).length;
              return `<button class="wr-cat${filter === k ? ' on' : ''}" data-cat="${k}"
                        type="button">${n}<i>${c}</i></button>`;
            }).join('')}
          </div>
          <div class="wr-grid">${list.map(cardHTML).join('')}</div>
        </div>
      </div>`;

    const np = host.querySelector('.wr-pick');
    if (np) np.scrollTop = keepY;
  }

  /* 局部刷新：只重画搭配框 + 卡片选中态 + 立绘。不动网格 DOM，滚动与图片都保留。 */
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
    if (GL.renderPortrait) GL.renderPortrait();
  }

  function wear(it) {
    const a = A();
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
      const cat = e.target.closest('[data-cat]');
      if (cat && filter !== cat.dataset.cat) {
        filter = cat.dataset.cat;
        render();
        return;
      }
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
      const card = e.target.closest('[data-item]');
      if (card) {
        const it = itemOf(card.dataset.item);
        if (it) wear(it);
      }
    });
  }

  const renderAll = function () { render(); bind(); };
  GL.hooks.push(renderAll);
  GL.renderWardrobe = renderAll;
})();
