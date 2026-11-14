/* ============ Game Life · 电子衣橱（v1.13.0 可自己加衣服） ============
   v1.13.0（用户 2026-11-14）：「点击电子衣橱界面的『添加』按钮，进入衣服编辑界面，
     上传照片之后就能录入衣橱，然后它和编辑信息能同时编辑信息那些。」
   → 「＋ 添加单品」按钮 → 就地展开的添加面板（上传 + 名称/类别/季节/年份 一次填完）
     → 保存即入橱，之后跟内置单品一样可 ✎ 编辑、可穿、可筛。
   ⚠ **只收透明底 PNG**：导入时先扫 alpha 通道，没有透明像素就拒收并说明原因
     —— 花底/实景照片直接塞进深色衣橱会是一块白方块，必须在上传这步拦掉。
   ⚠ 图片**存进 localStorage**（512 画布 WebP，单件约 20–60 KB）：
     不联网、不上云，代价是本地存储有 5 MB 上限，所以保存前先做体积预检。

   以下为 v1.11.0 的重整要求（逐条对位）：
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

  /* ---------- v1.13.0 添加单品：草稿状态 ----------
     draft 放在模块作用域而不是 DOM 里：面板每次重绘（切分类 / 改筛选）都会重建
     <input>，草稿要是存在 DOM 上，选好的图一重绘就没了。 */
  const CANVAS = 512;
  const MAX_URL = 190000;    // 单件 base64 上限（≈140 KB 二进制），超了就降质量重编
  const STORE_GUARD = 4.4e6; // localStorage 预检阈值（各浏览器上限约 5 MB）
  /* 归一框与 build-wardrobe.py 的 BOXES 保持一致 —— 用户新加的衣服和内置件
     在网格里视觉大小要一样，不能一件占满格、一件只占角落。 */
  const FIT = {
    top: [0.88, 0.94], bottom: [0.70, 0.92], shoes: [0.88, 0.58],
    bag: [0.80, 0.88], accessory: [0.90, 0.42]
  };
  let adding = false;
  let draft = newDraft();

  function newDraft() {
    return { img: null, preview: '', name: '新单品', slot: 'top', season: '', year: '', msg: '' };
  }

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

  /* ---------- v1.13.0 图片处理链（上传 → 512 透明画布 → WebP dataURL） ----------
     与 build-wardrobe.py 的 normalize() 同一套逻辑：按 alpha 外接框裁切 →
     按类别目标框等比缩放 → 居中（纵向 0.48 略上移）。
     ⚠ 判「透明底」只看 alpha：JPEG 没有 alpha 通道（扫描出来 clear=0）会直接被拒，
       所以「文件后缀是 .png 但其实不透明」也拦得住。 */
  function scratch(img) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return null;
    const MAX = 1100;                     // 逐像素扫 alpha，先缩到 1100 再扫，手机也不卡
    const s = Math.min(1, MAX / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * s));
    const h = Math.max(1, Math.round(ih * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, w, h);
    return { c, g };
  }

  function alphaInfo(c, g) {
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let minX = c.width, minY = c.height, maxX = -1, maxY = -1, clear = 0;
    for (let y = 0, i = 3; y < c.height; y++) {
      for (let x = 0; x < c.width; x++, i += 4) {
        if (d[i] < 20) { clear++; continue; }
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return {
      clear: clear / (c.width * c.height),
      box: maxX < 0 ? null : [minX, minY, maxX + 1, maxY + 1]
    };
  }

  /* 返回 { url, box, color } 或 { err }。slot 决定缩放框，所以改类别要重跑一次。 */
  function compose(img, slot) {
    const sc = scratch(img);
    if (!sc) return { err: '这张图读不出来' };
    const info = alphaInfo(sc.c, sc.g);
    if (!info.box) return { err: '这张 PNG 没有可见内容' };
    if (info.clear < 0.02) return { err: '不是透明底 PNG —— 扫不到透明像素' };
    const [x0, y0, x1, y1] = info.box;
    const bw = x1 - x0, bh = y1 - y0;
    const fit = FIT[slot] || FIT.top;
    const k = Math.min((fit[0] * CANVAS) / bw, (fit[1] * CANVAS) / bh);
    const dw = Math.max(1, Math.round(bw * k));
    const dh = Math.max(1, Math.round(bh * k));
    const dx = Math.round((CANVAS - dw) / 2);
    const dy = Math.round((CANVAS - dh) * 0.48);

    const out = document.createElement('canvas');
    out.width = out.height = CANVAS;
    const g2 = out.getContext('2d');
    g2.imageSmoothingEnabled = true;
    g2.imageSmoothingQuality = 'high';
    g2.drawImage(sc.c, x0, y0, bw, bh, dx, dy, dw, dh);

    /* 编码：优先 WebP（透明底 + 体积小）。浏览器不支持 WebP 编码时会静默回退 PNG，
       那就体积大得多 —— 所以带降质量重试，并给一个兜底上限。 */
    let url = out.toDataURL('image/webp', 0.82);
    const qs = [0.72, 0.62, 0.5];
    for (let i = 0; i < qs.length && url.length > MAX_URL; i++) {
      url = out.toDataURL('image/webp', qs[i]);
    }
    if (url.length > MAX_URL) return { err: '这张图太细碎，压不进本地存储（请先裁掉多余空白）' };

    return { url: url, box: [dx, dy, dw, dh], color: avgColor(out, dx, dy, dw, dh) };
  }

  /* 主体平均色（给未来矢量立绘留的口子，与 build-wardrobe.py 的 dominant_color 同义） */
  function avgColor(canvas, x, y, w, h) {
    const c = document.createElement('canvas');
    c.width = 48; c.height = 48;
    const g = c.getContext('2d');
    g.drawImage(canvas, x, y, w, h, 0, 0, 48, 48);
    const d = g.getImageData(0, 0, 48, 48).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++;
    }
    if (!n) return '#5b6472';
    return '#' + [r, gg, b].map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('');
  }

  function readPNG(file) {
    return new Promise((res, rej) => {
      const isPng = /^image\/png$/i.test(file.type || '') || /\.png$/i.test(file.name || '');
      if (!isPng) { rej(new Error('只支持 PNG')); return; }
      const fr = new FileReader();
      fr.onerror = () => rej(new Error('读取文件失败'));
      fr.onload = () => {
        const im = new Image();
        im.onerror = () => rej(new Error('图片解码失败'));
        im.onload = () => res(im);
        im.src = String(fr.result);
      };
      fr.readAsDataURL(file);
    });
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
    /* 自己加的单品（id 以 u 开头）才给「删除」—— 内置件删了下次加载也会被
       resyncBuiltinWardrobe() 补回来，给个按钮纯属骗人。 */
    const own = String(it.id).charAt(0) === 'u';
    return `
      <div class="wr-editbox" data-editbox="${it.id}">
        <div class="wr-eb-head">
          <span class="wr-eb-title">编辑单品</span>
          <span class="wr-eb-tools">
            ${own ? `<button class="btn mini" type="button" data-edit-del="${it.id}">删除</button>` : ''}
            <button class="btn mini" type="button" data-edit-close>收起</button>
          </span>
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

  /* 添加单品面板（v1.13.0）——同样就地展开，不弹浮层。
     一次把「图 + 名称 + 类别 + 季节 + 年份」填完，保存即入橱；
     之后还能用卡片上的 ✎ 继续改，两者读写的是同一份 state。 */
  function addboxHTML() {
    if (!adding) return '';
    const d = draft;
    const opts = (pairs, cur) => pairs.map(([v, n]) =>
      `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${n}</option>`).join('');
    const thisYear = new Date().getFullYear();
    const yearOpts = [['', '未填']];
    for (let y = thisYear; y >= thisYear - 20; y--) yearOpts.push([String(y), String(y)]);
    return `
      <div class="wr-addbox" data-addbox>
        <div class="wr-eb-head">
          <span class="wr-eb-title">添加单品</span>
          <button class="btn mini" type="button" data-add-close>取消</button>
        </div>
        <div class="wr-add-row">
          <button class="wr-drop${d.preview ? ' has' : ''}" type="button" data-add-file>
            ${d.preview
              ? `<img class="wr-add-prev" src="${d.preview}" alt="预览">`
              : '<span class="wr-drop-tip">＋<i>选透明底 PNG</i></span>'}
          </button>
          <input type="file" accept="image/png,.png" data-add-input hidden>
          <div class="wr-add-fields">
            <label class="field-label">名称</label>
            <input type="text" data-add-name value="${GL.esc(d.name)}" aria-label="单品名称">
            <div class="wr-eb-row">
              <div>
                <label class="field-label">类别</label>
                <select data-add-slot aria-label="类别">
                  ${opts([['top', '上衣'], ['bottom', '下装'], ['shoes', '鞋'],
                    ['bag', '包'], ['accessory', '配饰']], d.slot)}
                </select>
              </div>
              <div>
                <label class="field-label">季节</label>
                <select data-add-season aria-label="季节">
                  ${opts([['', '未标注'], ['summer', '夏装'], ['winter', '冬装'], ['all', '四季']], d.season)}
                </select>
              </div>
              <div>
                <label class="field-label">买入年份</label>
                <select data-add-year aria-label="买入年份">${opts(yearOpts, d.year)}</select>
              </div>
            </div>
          </div>
        </div>
        <div class="wr-eb-note">只收<b>透明底 PNG</b>（手机相册里的实景照不行）：存图时会自动裁到
          512 画布，并按类别缩放到跟其它单品一样大。图片只存在本机浏览器里。</div>
        <div class="wr-add-foot">
          <button class="btn primary mini" type="button" data-add-save>保存到衣橱</button>
          <span class="wr-add-msg" data-add-msg>${GL.esc(d.msg || '')}</span>
        </div>
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
      /* v1.13.0 起空衣橱不再是死局：至少能自己加第一件。
         （以前这里只提示「去跑构建脚本」，对用户来说等于「这页坏了」。） */
      a.wardrobe = [];
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
          ${addboxHTML()}
          ${editorHTML(editing)}
          <div class="wr-tools">
            <button class="wr-add${adding ? ' on' : ''}" type="button" data-add-open>＋ 添加单品</button>
            <span class="wr-count">${items.length} 件符合筛选</span>
          </div>
          <div class="wr-cats">
            ${CATS.map(([k, n]) => {
              const c = k === 'all' ? a.wardrobe.length
                : a.wardrobe.filter((i) => i.slot === k).length;
              return `<button class="wr-cat${cat === k ? ' on' : ''}" data-cat="${k}"
                        type="button">${n}<i>${c}</i></button>`;
            }).join('')}
          </div>
          <div class="wr-grid">${items.map(cardHTML).join('')
            || `<div class="wr-empty">这里还没有单品${season !== 'all'
              ? '——点卡片右上角的 ✎ 把季节标上，它就会出现在这一栏' : ''}${!a.wardrobe.length
              ? '——点上面的「＋ 添加单品」，上传一张透明底 PNG 就能进橱' : ''}</div>`}</div>
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

  /* ---------- v1.13.0 添加入橱 / 删除 ---------- */
  function addMsg(text, bad) {
    draft.msg = text || '';
    const box = document.querySelector('#wardrobe-ctrl [data-add-msg]');
    if (box) {
      box.textContent = draft.msg;
      box.classList.toggle('err', !!bad);
    }
  }

  /* 只换预览，不整块重绘 —— 重绘会把用户刚敲进去的名称一起刷掉 */
  function setPreview(url) {
    const btn = document.querySelector('#wardrobe-ctrl [data-add-file]');
    if (!btn) return;
    btn.classList.add('has');
    btn.innerHTML = '<img class="wr-add-prev" src="' + url + '" alt="预览">';
  }

  function saveNew() {
    const d = draft;
    if (!d.img) { addMsg('先点左边方块选一张透明底 PNG', true); return; }
    const built = compose(d.img, d.slot);   // 存的时候按当前类别重算一次缩放
    if (built.err) { addMsg(built.err, true); return; }

    const item = {
      /* id 前缀 u = 用户自建。内置件是 wNN，resyncBuiltinWardrobe() 只补 wNN，
         所以 u 开头的永远不会被清单冲掉，也永远不该被它碰。 */
      id: 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36),
      name: String(d.name || '').trim() || '未名单品',
      slot: d.slot,
      cat: d.slot,
      color: built.color,
      box: built.box,
      img: built.url,                        // data URL：离线、不联网
      season: d.season || null,
      year: d.year ? Number(d.year) : null
    };

    /* 存储预检：localStorage 上限约 5 MB。写满时 GL.save() 只会弹「保存失败」，
       而对象已经进 state 了，刷新后又消失 —— 比直接拦住更让人懵。
       所以先估体积，超阈值就不入库。 */
    let size = 0;
    try { size = JSON.stringify(GL.state).length; } catch (err) { size = 0; }
    if (size + item.img.length > STORE_GUARD) {
      addMsg('本地存储快满了：先删几件自己加的衣服，或导出备份后清理旧数据', true);
      return;
    }

    A().wardrobe.push(item);
    GL.save();

    const added = item.name;
    adding = false;
    draft = newDraft();
    /* 新件必须立刻可见 —— 当前筛选很可能把它挡在外面（比如正筛着「冬装」，
       新加的默认未标季节）。一键回到「全部」，比让用户自己找更合适。 */
    cat = 'all'; season = 'all'; year = 'all';
    editingId = null;
    render();
    const card = document.querySelector('.wr-card[data-item="' + item.id + '"]');
    if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest' });
    GL.toast('已加入衣橱「' + added + '」', 'ok');
  }

  function removeItem(id) {
    const it = itemOf(id);
    if (!it) return;
    if (!confirm('删除「' + it.name + '」？这张图会一起从本机删掉，撤不回来。')) return;
    const a = A();
    a.wardrobe = a.wardrobe.filter((w) => w.id !== id);
    Object.keys(a.outfit || {}).forEach((k) => { if (a.outfit[k] === id) a.outfit[k] = null; });
    if (editingId === id) editingId = null;
    GL.save();
    render();
    GL.toast('已删除「' + it.name + '」');
  }

  /* ---------- 事件 ---------- */
  function bind() {
    const host = document.getElementById('wardrobe-ctrl');
    if (!host || host.dataset.bound) return;
    host.dataset.bound = '1';

    host.addEventListener('click', (e) => {
      /* ---------- v1.13.0：添加单品 ---------- */
      if (e.target.closest('[data-add-open]')) {
        adding = !adding;
        if (adding) draft = newDraft();
        editingId = null;
        render();
        if (adding) {
          const n = host.querySelector('[data-add-name]');
          if (n) { n.focus(); n.select(); }
        }
        return;
      }
      if (e.target.closest('[data-add-close]')) {
        adding = false; draft = newDraft(); render(); return;
      }
      if (e.target.closest('[data-add-file]')) {
        const inp = host.querySelector('[data-add-input]');
        if (inp) inp.click();       // 外观是那张大方块，真正的 file 藏在它下面
        return;
      }
      if (e.target.closest('[data-add-save]')) { saveNew(); return; }
      const del = e.target.closest('[data-edit-del]');
      if (del) { removeItem(del.dataset.editDel); return; }

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

      /* ---------- v1.13.0：添加面板的四个字段 + 选图 ---------- */
      if (t.matches('[data-add-input]')) {
        const f = t.files && t.files[0];
        if (!f) return;
        addMsg('正在处理图片…');
        readPNG(f).then((im) => {
          const built = compose(im, draft.slot);
          if (built.err) {
            draft.img = null; draft.preview = '';
            addMsg(built.err, true);
            return;
          }
          draft.img = im;
          draft.preview = built.url;
          setPreview(built.url);
          addMsg('已就位，点「保存到衣橱」');
        }).catch((err) => {
          draft.img = null; draft.preview = '';
          const m = err && err.message === '只支持 PNG' ? '只支持 PNG（透明底）' : (err && err.message) || '读取失败';
          addMsg(m, true);
        });
        return;
      }
      if (t.matches('[data-add-name]')) { draft.name = t.value; return; }
      if (t.matches('[data-add-slot]')) {
        draft.slot = t.value;
        /* 类别决定缩放框（上衣高、鞋扁），换了类别要按新框重算预览 */
        if (draft.img) {
          const built = compose(draft.img, draft.slot);
          if (!built.err) { draft.preview = built.url; setPreview(built.url); }
        }
        return;
      }
      if (t.matches('[data-add-season]')) { draft.season = t.value; return; }
      if (t.matches('[data-add-year]')) { draft.year = t.value; return; }

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

    /* 名称用 input 而不是 change 兜着：用户敲完名字直接点「保存」时，
       某些浏览器不保证先发 change（blur 与 click 的先后由实现决定），
       只靠 change 会把他刚敲的名字丢掉。 */
    host.addEventListener('input', (e) => {
      if (e.target.matches('[data-add-name]')) draft.name = e.target.value;
    });

    host.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.dataset.editName !== undefined) {
        e.target.blur();
      }
      if (e.key === 'Enter' && e.target.matches('[data-add-name]')) {
        e.preventDefault();
        saveNew();
      }
      if (e.key === 'Escape' && editingId) { editingId = null; render(); }
      else if (e.key === 'Escape' && adding) { adding = false; draft = newDraft(); render(); }
    });
  }

  const renderAll = function () { render(); bind(); };
  GL.hooks.push(renderAll);
  GL.renderWardrobe = renderAll;
})();
