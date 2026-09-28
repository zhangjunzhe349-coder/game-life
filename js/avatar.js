/* ============ Game Life · 个人信息（体型参数） ============
   v1.8.1：中央立绘（原 js/portrait.js）与休眠的 3D 建模段一并移除，
   本文件收缩为一条「个人信息」——身高 / 体重 / 肌肉量 / 发型，可直接改。

   ── 数据契约（与 v1.4 起完全相同，未做迁移）──
   GL.state.avatar：
     height / weight / muscle / hairStyle   本文件读写
     skin / hairColor                       仅保留数据，UI 已撤下
     wardrobe[] / outfit{} / outfits[]      由 js/wardrobe.js 消费（照片版衣橱）
     legacyWardrobe[]                       迁移 v3→v4 时的用户自建项留档

   为什么撤下肤色 / 发色：它们唯一的作用是给立绘上色，立绘没了就是两个
   永远不生效的死参数。数据仍留在 state 里 —— 将来若恢复立绘或改做别的
   可视化，直接读即可，不需要再动迁移。

   ── 历史 ──
   v1.3.0 是 Three.js 程序化 3D 模型（截面放样 + 分段关节）；
   v1.4.0 换成 SVG 分层 2D 立绘；v1.8.1 立绘整体移除。
   要回看任一版：git checkout <tag> -- .
   ============================================================ */
(function () {
  'use strict';

  const HAIR_NAMES = { short: '短发', buzz: '寸头', long: '长发', ponytail: '马尾', bald: '光头' };

  /* 三个滑块字段。顺序即渲染顺序。 */
  const FIELDS = [
    { p: 'height', label: '身高', unit: 'cm', min: 140, max: 210 },
    { p: 'weight', label: '体重', unit: 'kg', min: 40, max: 130 },
    { p: 'muscle', label: '肌肉量', unit: '', min: 0, max: 100 }
  ];

  function A() { return GL.state.avatar; }

  /* ---------- 渲染 ---------- */
  function render() {
    const el = document.getElementById('profile-card');
    if (!el) return;
    const a = A();
    el.innerHTML = `
      <div class="pf-head">
        <span class="pf-title">个人信息</span>
        <span class="pf-hint">拖动即存 · 数据在本机</span>
      </div>
      <div class="pf-fields">
        ${FIELDS.map((f) => `
          <label class="pf-field">
            <span class="pf-label">${f.label}${f.unit ? `<i>${f.unit}</i>` : ''}</span>
            <input type="range" min="${f.min}" max="${f.max}" step="1"
                   value="${a[f.p]}" data-p="${f.p}" aria-label="${f.label}">
            <output>${a[f.p]}</output>
          </label>`).join('')}
        <label class="pf-field">
          <span class="pf-label">发型</span>
          <select data-p="hairStyle" aria-label="发型">
            ${Object.keys(HAIR_NAMES).map((k) =>
              `<option value="${k}"${a.hairStyle === k ? ' selected' : ''}>${HAIR_NAMES[k]}</option>`).join('')}
          </select>
        </label>
      </div>`;
  }

  /* ---------- 交互 ----------
     ⚠ 拖动滑块**不走 GL.changed()**：那是整页重渲染，会在拖的过程中把
       input 本身换掉（滑块跳回起点、手指与控件失联）。这里只写 state + 存盘
       + 就地刷读数，与属性面板的就地编辑同一条原则。 */
  function bind() {
    const el = document.getElementById('profile-card');
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';

    el.addEventListener('input', (e) => {
      const p = e.target.dataset.p;
      if (!p || e.target.tagName === 'SELECT') return;
      const a = A();
      a[p] = Number(e.target.value);
      const out = e.target.parentElement.querySelector('output');
      if (out) out.textContent = a[p];
      GL.save();
    });

    el.addEventListener('change', (e) => {
      if (e.target.tagName !== 'SELECT') return;
      const p = e.target.dataset.p;
      if (!p) return;
      A()[p] = e.target.value;
      GL.save();
    });
  }

  /* hooks 里必须带 bind()，否则 GL.changed() 只重绘不绑事件（页面能看、点不动）。
     bind() 内有 dataset.bound 幂等保护，重复调用安全。 */
  const renderAll = function () { render(); bind(); };
  GL.hooks.push(renderAll);
})();
