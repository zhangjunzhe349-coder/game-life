/* ============ Game Life · 每日必做（v1.10.0） ============
   用户诉求原文（2026-10-31）：
   「这是我在像素习惯里确定的一些每日必做事项。我现在需要在我这个软件里加一个类似的页面……
     这个页面里那些日历啊什么各种经验啊，这种乱七八糟的先不用加，只要把这几项给我加进去就行了，
     就是做成一种可以自定义添加一个每日的项目的话，还可以编辑一下小字的这么一个功能界面。
     现在想法是你直接把原来首界面那个个人信息栏目给去掉，就是在角色状态这个栏目下面
     直接就是这一排排的每日必做事项。每个事项要保持一种可编辑的状态。」

   所以本模块刻意**只做三件事**：列出来 / 打勾 / 增删改。
   没有日历、没有经验值、没有连续天数、没有统计图 —— 那些是「像素习惯」的，不是这里要的。

   ── 数据契约 ──
   GL.state.dailies = [{ id, title, note, emoji, doneOn }]
     doneOn   完成那天的 YYYY-MM-DD；不相等即为「今天还没做」
              （不存布尔值：跨日要能自动回到未完成，存日期最省事）
     emoji    老码位（Emoji 12.0 及更早），见 verify-wiring 的区段断言

   ── 编辑为什么不走 GL.changed() ──
   整页重渲染会把正在编辑的 input 连同光标一起换掉（同 attributes.js 的教训）。
   所以编辑期间只写 state + GL.save()，退出编辑时才 GL.changed()。
   ============================================================ */
(function () {
  'use strict';

  /* 默认的 5 项在 js/storage.js 的 docDailies() 里（数据默认值统一由数据层负责）。
     新建条目的图标固定用 📌（老码位），不给选图标 —— 用户没要求，少一个入口少一处 bug。 */
  const NEW_EMOJI = '📌';

  let editFor = null;   // 正在编辑的条目 id（会话内状态，不进 GL.state）

  function list() {
    if (!Array.isArray(GL.state.dailies)) GL.state.dailies = [];
    return GL.state.dailies;
  }
  function find(id) { return list().find((d) => d.id === id); }
  function today() { return GL.todayKey(Date.now()); }
  function isDone(d) { return !!d.doneOn && d.doneOn === today(); }
  function doneCount() { return list().filter(isDone).length; }

  function emojiOf(d) { return d.emoji || NEW_EMOJI; }

  /* ---------- 普通行 ---------- */
  function rowHtml(d) {
    const done = isDone(d);
    /* 没小字就整行不渲染第二行 —— 正常查看时**不留占位文案**：
       「点这里补一句小字」在列表里读起来像未完成的报错，不像提示。
       行高由 CSS 的 min-height 兜住，所以缺一行不会让节奏乱掉。 */
    const note = d.note ? `<span class="dl-s">${GL.esc(d.note)}</span>` : '';
    return `<div class="dl-item${done ? ' done' : ''}" data-did="${d.id}">
      <span class="dl-emoji" aria-hidden="true">${GL.esc(emojiOf(d))}</span>
      <div class="dl-body" data-dl-edit="${d.id}" role="button" tabindex="0"
           aria-label="编辑「${GL.esc(d.title)}」">
        <span class="dl-t">${GL.esc(d.title)}</span>
        ${note}
      </div>
      <button type="button" class="dl-check${done ? ' on' : ''}" data-dl-toggle="${d.id}"
              aria-pressed="${done}" aria-label="${done ? '取消完成' : '标记完成'}"></button>
    </div>`;
  }

  /* ---------- 编辑态 ---------- */
  function editHtml(d) {
    return `<div class="dl-item dl-editing" data-did="${d.id}">
      <span class="dl-emoji" aria-hidden="true">${GL.esc(emojiOf(d))}</span>
      <div class="dl-edit">
        <input type="text" class="dl-in-t" data-dl-title value="${GL.esc(d.title)}"
               placeholder="事项名称" aria-label="事项名称">
        <input type="text" class="dl-in-s" data-dl-note value="${GL.esc(d.note || '')}"
               placeholder="小字说明（可留空）" aria-label="小字说明">
        <div class="dl-ops">
          <button type="button" class="btn mini danger" data-dl-del="${d.id}">删除</button>
          <button type="button" class="btn mini primary" data-dl-ok="${d.id}">完成</button>
        </div>
      </div>
    </div>`;
  }

  function render() {
    const el = document.getElementById('dailies-card');
    if (!el) return;
    const arr = list();
    const n = doneCount();
    el.innerHTML = `
      <div class="dl-head">
        <span class="dl-title">每日必做</span>
        <span class="dl-hint">${arr.length ? `今天 ${n} / ${arr.length}` : '还没有事项'}</span>
        <button type="button" class="btn mini dl-add" id="dl-add" aria-label="新增事项">＋</button>
      </div>
      <div class="dl-list">
        ${arr.map((d) => (editFor === d.id ? editHtml(d) : rowHtml(d))).join('')
          || '<div class="dl-empty">点右上角「＋」加第一条</div>'}
      </div>`;
  }

  /* 编辑期间只落盘、不重渲染 —— 保住光标与输入内容 */
  function commit(d) {
    const t = String(d.title || '').trim();
    if (!t) {
      /* 新建后什么都没填就退出 → 直接丢掉这条草稿，别在列表里留一行空壳 */
      GL.state.dailies = list().filter((x) => x.id !== d.id);
      GL.toast('空标题，已丢弃', 'err');
    } else {
      d.title = t;
      d.note = String(d.note || '').trim();
    }
    editFor = null;
    GL.changed();
  }

  function bind() {
    const el = document.getElementById('dailies-card');
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';

    el.addEventListener('click', (e) => {
      /* 新增：插一条草稿并立刻进入编辑态 */
      if (e.target.id === 'dl-add' || e.target.closest('#dl-add')) {
        const d = { id: GL.uid(), title: '', note: '', emoji: NEW_EMOJI, doneOn: null };
        list().push(d);
        editFor = d.id;
        GL.changed();
        requestAnimationFrame(() => {
          const inp = el.querySelector('.dl-item[data-did="' + d.id + '"] .dl-in-t');
          if (inp) inp.focus();
        });
        return;
      }

      /* 打勾 / 取消 */
      const tog = e.target.closest('[data-dl-toggle]');
      if (tog) {
        const d = find(tog.dataset.dlToggle);
        if (!d) return;
        d.doneOn = isDone(d) ? null : today();
        GL.changed();
        return;
      }

      /* 点文字 → 进入编辑态（同一时刻只编辑一条） */
      const body = e.target.closest('[data-dl-edit]');
      if (body && editFor !== body.dataset.dlEdit) {
        editFor = body.dataset.dlEdit;
        GL.changed();
        requestAnimationFrame(() => {
          const inp = el.querySelector('.dl-item[data-did="' + editFor + '"] .dl-in-t');
          if (inp) { inp.focus(); inp.select(); }
        });
        return;
      }

      const del = e.target.closest('[data-dl-del]');
      if (del) {
        const d = find(del.dataset.dlDel);
        if (!d) return;
        if (!confirm('删除「' + (d.title || '未命名') + '」？')) return;
        GL.state.dailies = list().filter((x) => x.id !== d.id);
        editFor = null;
        GL.toast('已删除', 'ok');
        GL.changed();
        return;
      }

      const okBtn = e.target.closest('[data-dl-ok]');
      if (okBtn) {
        const d = find(okBtn.dataset.dlOk);
        if (d) commit(d);
      }
    });

    /* 输入即时落盘（不重渲染）。这样即使切页签 / 刷新，也只丢「还没退出编辑」这一层，
       内容本身不会没。 */
    el.addEventListener('input', (e) => {
      const item = e.target.closest('.dl-item[data-did]');
      if (!item) return;
      const d = find(item.dataset.did);
      if (!d) return;
      if (e.target.dataset.dlTitle !== undefined) d.title = e.target.value;
      else if (e.target.dataset.dlNote !== undefined) d.note = e.target.value;
      else return;
      GL.save();
    });

    /* 失焦即提交（点页面别处 = 收起编辑态）。
       用 relatedTarget 判断：在同一个编辑块内从标题跳到小字，不算离开。 */
    el.addEventListener('focusout', (e) => {
      if (!e.target.dataset || (e.target.dataset.dlTitle === undefined
        && e.target.dataset.dlNote === undefined)) return;
      const item = e.target.closest('.dl-item[data-did]');
      if (!item) return;
      const to = e.relatedTarget;
      if (to && item.contains(to)) return;
      const d = find(item.dataset.did);
      /* 延后一拍：让「点完成 / 点删除」的 click 先到达，避免抢在前面重建 DOM */
      setTimeout(() => {
        if (d && editFor === d.id) commit(d);
      }, 0);
    });

    el.addEventListener('keydown', (e) => {
      const item = e.target.closest('.dl-item[data-did]');
      if (!item) return;
      const d = find(item.dataset.did);
      if (!d) return;
      if (e.key === 'Enter') {
        /* 两个都是单行输入框 → Enter 直接提交 */
        e.preventDefault();
        commit(d);
      } else if (e.key === 'Escape') {
        e.target.blur();
        editFor = null;
        GL.changed();
      }
    });
  }

  function ensureArray() {
    if (!Array.isArray(GL.state.dailies)) GL.state.dailies = [];
  }

  const renderAll = function () { ensureArray(); render(); bind(); };
  GL.hooks.push(renderAll);
  GL.renderDailies = renderAll;   // 供校验与调试直接调用
})();
