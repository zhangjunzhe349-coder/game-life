/* ============ Game Life · 技能经验值（v1.8.2 紧凑版） ============
   默认形态：**紧凑小卡**（图标 + 名称 + 等级 + 经验条），整块面积约原来大卡的 1/4。
   点任意一项 → 浮层弹出该技能的完整信息（本级进度 / 累计 XP / 加经验 / 注释 / 成长记录），
   每项可单独打开与关闭。
   顶部一个按钮在「紧凑网格」与「完整卡片」之间**一键收放**（快速展开 / 收拢全部）。

   为什么不再默认渲染完整卡片：用户原话「现在每个都太占地方了」——
   13 项一次铺开要滚好几屏，而绝大多数时候用户只想扫一眼等级与进度。
   ============================================================ */
(function () {
  'use strict';

  let addingFor = null;      // 当前展开加经验行的技能 id
  let noteFor = null;        // 当前展开注释编辑区的技能 id
  let openFor = null;        // 浮层里正在看详情的技能 id（null = 浮层关闭）
  let lastXp = 10;           // 记住上次填写的 XP，减少重复输入

  /* 密度偏好存独立 localStorage key，**不进 GL.state** ——
     它是纯 UI 偏好，混进数据结构就得为它动一次迁移，不值。 */
  const EXPAND_KEY = 'gamelife_ui_skills_expand';
  let expandAll = false;
  try { expandAll = localStorage.getItem(EXPAND_KEY) === '1'; } catch (e) { /* 隐私模式 */ }

  function list() { return GL.state.skills; }
  function find(id) { return list().find((s) => s.id === id); }

  /* 就地刷新要打中「用户正在看的那一份」：紧凑模式下完整信息只存在于浮层里，
     展开模式下才是内联卡片 —— 找错了就会出现「改了没反应」。 */
  function cardElOf(id) {
    return document.querySelector('#skill-modal .skill[data-sid="' + id + '"]')
      || document.querySelector('.skill-full[data-sid="' + id + '"]');
  }

  /* 就地刷新卡片上的名称与小字 —— 不走 GL.changed()，
     否则正在编辑的输入框会被整页重渲染换掉，光标和输入一起丢。 */
  function repaintCard(s) {
    const cardEl = cardElOf(s.id);
    if (!cardEl) return;
    const nameEl = cardEl.querySelector('.skill-name');
    if (nameEl) nameEl.textContent = s.name;
    const top = cardEl.querySelector('.skill-top');
    const oldSub = cardEl.querySelector('.skill-sub');
    if (s.sub) {
      if (oldSub) {
        oldSub.textContent = s.sub;
      } else if (top) {
        top.insertAdjacentHTML('afterend', '<div class="skill-sub"></div>');
        const made = cardEl.querySelector('.skill-sub');
        if (made) made.textContent = s.sub;
      }
    } else if (oldSub) {
      oldSub.remove();
    }
  }

  /* 说明改了 → 刷新卡片底部那行注释文本（没有就补一行，清空就删掉） */
  function repaintCardNote(s) {
    const cardEl = cardElOf(s.id);
    if (!cardEl) return;
    const holder = cardEl.querySelector('.skill-note');
    if (!holder) return;
    let txt = holder.querySelector('.skill-note-txt');
    if (s.note) {
      if (!txt) {
        holder.insertAdjacentHTML('afterbegin', '<p class="skill-note-txt"></p>');
        txt = holder.querySelector('.skill-note-txt');
      }
      txt.textContent = s.note;
    } else if (txt) {
      txt.remove();
    }
    holder.classList.toggle('has-note', !!s.note);
  }

  function logLine(s, l) {
    const act = (s.actions || []).find((x) => x.id === l.actionId);
    const what = l.note ? GL.esc(l.note) : (act ? GL.esc(act.name) : '自定义');
    return `<li>${GL.fmtClock(l.t)} — ${what} <span class="gold">+${l.xp} XP</span></li>`;
  }

  /* ---------- 紧凑小卡（默认形态） ----------
     图标 + 名称 + 等级 + 经验条。用 <span> 而非 <div>：<button> 里只允许短语内容。 */
  function tile(s) {
    const lv = GL.skillLevel(s);
    return `<button type="button" class="sk-tile" data-sid="${s.id}" data-skill-open="${s.id}"
        aria-haspopup="dialog" aria-label="查看 ${GL.esc(s.name)} 详情 · Lv.${lv.level}">
      <span class="sk-row">
        <span class="skill-emoji" aria-hidden="true">${s.emoji || '🎯'}</span>
        <span class="skill-name">${GL.esc(s.name)}</span>
        <span class="skill-lv">Lv.${lv.level}</span>
      </span>
      <span class="xp-bar"><i style="width:${lv.pct}%"></i></span>
    </button>`;
  }

  /* ---------- 完整详情（浮层内 / 展开模式内联，同一份 markup） ----------
     v1.8.2 起原名 card()，类名加 skill-full 以便与紧凑小卡区分开
     （校准脚本按类名分别数它们）。 */
  function detail(s) {
    const lv = GL.skillLevel(s);
    const open = addingFor === s.id;
    const noteOpen = noteFor === s.id;
    const logs = (s.logs || []).slice(-8).reverse().map((l) => logLine(s, l)).join('');
    return `<div class="skill skill-full" data-sid="${s.id}">
      <div class="skill-top">
        <span class="skill-emoji">${s.emoji || '🎯'}</span>
        <span class="skill-name">${GL.esc(s.name)}</span>
        <span class="skill-lv">Lv.${lv.level}</span>
      </div>
      ${s.sub ? `<div class="skill-sub">${GL.esc(s.sub)}</div>` : ''}
      <div class="xp-bar"><i style="width:${lv.pct}%"></i></div>
      <div class="xp-line">
        <span>本级 <b>${lv.into}</b> / ${lv.need} XP</span>
        <em>下一级 Lv.${lv.level + 1}</em>
      </div>
      <div class="skill-foot">
        <span class="skill-total">累计 <b>${s.xp}</b> XP</span>
        <button class="add-btn ${open ? 'open' : ''}" data-add="${s.id}"
          aria-label="给 ${GL.esc(s.name)} 加经验" title="加经验">${open ? '×' : '＋'}</button>
      </div>
      ${open ? `<div class="xp-add">
        <label for="xp-${s.id}">XP</label>
        <input type="number" id="xp-${s.id}" value="${lastXp}" min="1" step="1" data-xp-in>
        <input type="text" placeholder="做了什么（可选）" data-xp-note aria-label="做了什么">
        <button class="btn mini primary" data-xp-ok="${s.id}">✓ 加经验</button>
      </div>` : ''}
      <div class="skill-note${s.note ? ' has-note' : ''}">
        ${s.note ? `<p class="skill-note-txt">${GL.esc(s.note)}</p>` : ''}
        <button type="button" class="skill-note-btn" data-note-toggle="${s.id}" aria-expanded="${noteOpen}">
          ${noteOpen ? '× 收起注释' : ((s.note || s.sub) ? '✎ 编辑注释' : '＋ 添加注释')}
        </button>
        ${noteOpen ? GL.textEditBox(s, 'skill') : ''}
      </div>
      ${logs ? `<details class="hist"><summary>成长记录（${(s.logs || []).length} 条）</summary><ul>${logs}</ul></details>` : ''}
    </div>`;
  }

  /* ---------- 详情浮层 ----------
     挂在 <body> 上而不是 panel-skills 里：GL.changed() 会整个替换 panel 的 innerHTML，
     浮层若在里面，任何一次状态变更都会把它连同滚动位置一起抹掉。 */
  function modalHost() {
    let m = document.getElementById('skill-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'skill-modal';
    m.className = 'smodal';
    m.hidden = true;
    m.innerHTML = `<div class="smodal-mask" data-smodal-close></div>
      <div class="smodal-box" role="dialog" aria-modal="true" aria-labelledby="smodal-title">
        <button class="smodal-x" type="button" data-smodal-close aria-label="关闭">×</button>
        <div class="smodal-body"></div>
      </div>`;
    document.body.appendChild(m);
    /* 事件委托挂浮层自己身上：浮层里的事件不会冒泡到 panel-skills，反之亦然，
       所以同一个处理器绑两处不会重复触发。 */
    m.addEventListener('click', onClick);
    m.addEventListener('change', onChange);
    m.addEventListener('keydown', onKey);
    return m;
  }

  function renderModal() {
    const s = openFor ? find(openFor) : null;
    if (!s) openFor = null;
    const m = s ? modalHost() : document.getElementById('skill-modal');
    if (!m) return;
    if (!s) {
      m.hidden = true;
      document.body.classList.remove('modal-open');
      /* 关闭时必须把内容也清掉：只 hidden 的话，那张 .skill-full 还留在 DOM 里，
         任何按选择器数「当前有几张完整卡片」的地方都会多算一张（校验就踩了这个）。 */
      const stale = m.querySelector('.smodal-body');
      if (stale) stale.innerHTML = '';
      return;
    }
    const lv = GL.skillLevel(s);
    m.querySelector('.smodal-body').innerHTML =
      `<div class="smodal-head">
        <span class="smodal-title" id="smodal-title">${s.emoji || '🎯'} ${GL.esc(s.name)}</span>
        <span class="smodal-sub">Lv.${lv.level} · 累计 ${s.xp} XP</span>
      </div>${detail(s)}`;
    m.hidden = false;
    document.body.classList.add('modal-open');
  }

  /* 供 app.js 切页签时调用：浮层在 body 上，不关掉会浮在新页面上方 */
  GL.closeSkillModal = function () {
    if (!openFor) return;
    openFor = null;
    addingFor = null;
    noteFor = null;
    repaint();
  };

  function manage() {
    return `<details class="hist" style="margin-top:4px">
      <summary>管理技能 · 所属分组 / 升级曲线 / 删除</summary>
      <div style="margin-top:12px;display:flex;flex-direction:column;gap:14px">
        ${GL.skillByGroup().map((g) => {
          if (!g.items.length) return '';
          return `<div>
            <div class="subhead">${g.emoji} ${GL.esc(g.name)}</div>
            ${g.items.map((s) => `<div class="form-row" data-sid="${s.id}">
              <span class="dim" style="flex:1 1 120px">${s.emoji || '🎯'} ${GL.esc(s.name)}</span>
              <select data-skill-group="${s.id}" style="flex:0 1 96px" aria-label="所属分组">
                ${GL.SKILL_GROUPS.map((x) => `<option value="${x.id}"${(s.group || 'misc') === x.id ? ' selected' : ''}>${GL.esc(x.name)}</option>`).join('')}
              </select>
              <label class="dim" style="display:flex;align-items:center;gap:6px;letter-spacing:.06em">每级
                <input type="number" data-xp-per value="${s.xpPerLevel}" min="1" style="width:74px"> XP</label>
              <button class="btn mini danger" data-skill-del="${s.id}">删除</button>
            </div>`).join('')}
          </div>`;
        }).join('')}
      </div>
    </details>`;
  }

  /* 面板与浮层的局部重画：不触发整页 GL.changed()，
     否则浮层里正在编辑的输入框会被换掉（与属性面板的就地编辑同一条原则）。 */
  function repaint() { render(); renderModal(); }

  function render() {
    const el = document.getElementById('panel-skills');
    if (!el) return;
    const total = list().reduce((s, k) => s + (k.xp || 0), 0);
    const groups = GL.skillByGroup();

    el.innerHTML = `
      <div class="card">
        <div class="card-head">
          <span class="card-title">🎯 技能经验值</span>
          <span class="card-hint">${list().length} 项 · 累计 ${total} XP</span>
        </div>
        <div class="sk-tools">
          <button class="btn mini" id="sk-expand" aria-expanded="${expandAll}">
            ${expandAll ? '⤡ 收拢全部' : '⤢ 展开全部'}
          </button>
          <span class="dim">${expandAll
            ? '完整卡片：进度 / 加经验 / 注释 / 成长记录都在卡上'
            : '点任意一项看详情、加经验或编辑注释'}</span>
        </div>
        ${groups.map((g) => {
          if (!g.items.length) return '';
          const gxp = g.items.reduce((s, k) => s + (k.xp || 0), 0);
          return `<section class="sg" data-gid="${g.id}">
            <div class="sg-head">
              <span class="sg-glyph" aria-hidden="true">${g.emoji}</span>
              <span class="sg-name">${GL.esc(g.name)}</span>
              <span class="sg-meta">${g.items.length} 项 · ${gxp} XP</span>
            </div>
            <div class="skill-grid${expandAll ? '' : ' mini'}">${g.items.map(expandAll ? detail : tile).join('')}</div>
          </section>`;
        }).join('') || '<span class="dim">还没有技能，请点下方按钮创建</span>'}
        <div class="edit-box">
          <div class="form-row">
            <input type="text" id="s-emoji" placeholder="emoji" style="flex:0 1 72px" maxlength="4" aria-label="图标">
            <input type="text" id="s-name" placeholder="技能名，如 写作能力" style="flex:2 1 160px" aria-label="技能名">
            <select id="s-group" style="flex:0 1 100px" aria-label="所属分组">
              ${GL.SKILL_GROUPS.map((x) => `<option value="${x.id}">${GL.esc(x.name)}</option>`).join('')}
            </select>
            <input type="number" id="s-xp" value="100" min="1" title="每级基础XP" style="flex:0 1 92px" aria-label="每级基础经验">
            <button class="btn mini primary" id="s-add">＋ 创建技能</button>
          </div>
          <div class="dim">升级所需经验逐级递增：Lv2 → 100，Lv3 → 300，Lv4 → 600……（按每级基础 100 计）</div>
        </div>
        ${list().length ? manage() : ''}
      </div>`;
  }

  function gain(s, xp, note) {
    const before = GL.skillLevel(s).level;
    s.xp += xp;
    (s.logs = s.logs || []).push({ t: Date.now(), actionId: null, xp, note: note || '' });
    addingFor = null;
    GL.changed();
    const after = GL.skillLevel(s).level;
    if (after > before) GL.toast(`🎉 ${s.name} 升级！Lv.${before} → Lv.${after}`, 'lvlup');
    else GL.toast(`+${xp} XP · ${s.emoji || ''}${s.name}${note ? ' · ' + note : ''}`, 'ok');
  }

  /* 面板与浮层共用同一套处理器（委托挂在各自的容器上，互不干扰）。
     host = e.currentTarget，用于渲染后在新 DOM 里定位输入框。 */
  function onClick(e) {
    const host = e.currentTarget;
    const panel = document.getElementById('panel-skills');

    /* 关闭浮层（点遮罩 / 点 ×） */
    if (e.target.closest('[data-smodal-close]')) { GL.closeSkillModal(); return; }

    /* 点紧凑小卡 → 打开该技能的详情浮层 */
    const opener = e.target.closest('[data-skill-open]');
    if (opener) {
      const id = opener.dataset.skillOpen;
      openFor = openFor === id ? null : id;   // 同一张再点一次 = 关掉
      addingFor = null; noteFor = null;
      repaint();
      return;
    }

    /* 展开 / 收拢全部 —— 一个按钮来回切 */
    if (e.target.id === 'sk-expand') {
      expandAll = !expandAll;
      try { localStorage.setItem(EXPAND_KEY, expandAll ? '1' : '0'); } catch (err) { /* ignore */ }
      addingFor = null; noteFor = null; openFor = null;
      repaint();
      GL.toast(expandAll ? '已展开全部技能' : '已收拢为紧凑网格');
      return;
    }

    // 展开 / 收起注释编辑区
    const nt = e.target.closest('[data-note-toggle]');
    if (nt) {
      noteFor = noteFor === nt.dataset.noteToggle ? null : nt.dataset.noteToggle;
      addingFor = null;
      repaint();
      const inp = host.querySelector('.tx-edit [data-skill-name]');
      if (inp) { inp.focus(); inp.select(); }
      return;
    }
    // 展开 / 收起加经验行
    const add = e.target.closest('[data-add]');
    if (add) {
      addingFor = addingFor === add.dataset.add ? null : add.dataset.add;
      repaint();
      const inp = host.querySelector('#xp-' + add.dataset.add);
      if (inp) { inp.focus(); inp.select(); }
      return;
    }
    // 确认加经验
    const ok = e.target.closest('[data-xp-ok]');
    if (ok) {
      const s = find(ok.dataset.xpOk);
      const box = ok.closest('.xp-add');
      const xp = Math.round(Number(box.querySelector('[data-xp-in]').value));
      const note = box.querySelector('[data-xp-note]').value.trim();
      if (!(xp > 0)) { GL.toast('请输入大于 0 的经验值', 'err'); return; }
      lastXp = xp;
      if (s) gain(s, xp, note);
      return;
    }
    // 新建技能
    if (e.target.id === 's-add' && panel) {
      const name = (panel.querySelector('#s-name').value || '').trim();
      const emoji = panel.querySelector('#s-emoji').value.trim() || '🎯';
      const per = Math.max(1, Number(panel.querySelector('#s-xp').value) || 100);
      const group = panel.querySelector('#s-group').value || 'misc';
      if (!name) { GL.toast('先填写技能名', 'err'); return; }
      list().push({ id: GL.uid(), name, sub: '', note: '', emoji, group, xp: 0, xpPerLevel: per, actions: [], logs: [] });
      GL.toast('技能「' + name + '」已创建', 'ok');
      GL.changed();
      return;
    }
    // 删除技能
    const del = e.target.closest('[data-skill-del]');
    if (del) {
      const s = find(del.dataset.skillDel);
      if (!confirm('确定删除技能「' + (s ? s.name : '') + '」及其全部成长记录吗？')) return;
      GL.state.skills = list().filter((x) => x.id !== del.dataset.skillDel);
      openFor = null;
      GL.changed();
    }
  }

  function onChange(e) {
    /* 名称 / 小字 / 说明：写盘 + 就地刷新卡片上的名称与小字，不重渲染
       （重渲染会把正在编辑的输入框连光标一起换掉） */
    const d = e.target.dataset;
    const txKey = d.skillName !== undefined ? 'name'
      : (d.skillSub !== undefined ? 'sub' : (d.skillNote !== undefined ? 'note' : null));
    if (txKey) {
      const box = e.target.closest('[data-sid]');
      const s = box ? find(box.dataset.sid) : null;
      if (!s) return;
      const val = txKey === 'name' ? String(e.target.value).trim() : String(e.target.value);
      if (txKey === 'name' && !val) { GL.toast('名称不能为空', 'err'); e.target.value = s.name; return; }
      s[txKey] = val;
      GL.save();
      if (txKey === 'note') repaintCardNote(s);
      else repaintCard(s);
      return;
    }
    /* 切换所属分组 */
    if (e.target.dataset.skillGroup !== undefined) {
      const s = find(e.target.dataset.skillGroup);
      if (s) { s.group = e.target.value; GL.toast('已移至「' + (GL.SKILL_GROUPS.find((g) => g.id === s.group) || {}).name + '」', 'ok'); GL.changed(); }
      return;
    }
    if (e.target.dataset.xpPer === undefined) return;
    const row = e.target.closest('[data-sid]');
    const s = row ? find(row.dataset.sid) : null;
    if (s) { s.xpPerLevel = Math.max(1, Number(e.target.value) || 100); GL.changed(); }
  }

  function onKey(e) {
    if (e.key === 'Escape' && openFor) { GL.closeSkillModal(); return; }
    if (e.key !== 'Enter') return;
    const panel = document.getElementById('panel-skills');
    if (e.target.id === 's-name' && panel) { panel.querySelector('#s-add').click(); return; }
    /* 注释区的单行输入按 Enter = 提交（textarea 留给换行） */
    if (e.target.tagName === 'INPUT'
        && (e.target.dataset.skillName !== undefined || e.target.dataset.skillSub !== undefined)) {
      e.target.blur();
      return;
    }
    if (e.target.dataset.xpIn !== undefined || e.target.dataset.xpNote !== undefined) {
      const box = e.target.closest('.xp-add');
      if (box) box.querySelector('[data-xp-ok]').click();
    }
  }

  function bind() {
    const el = document.getElementById('panel-skills');
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('keydown', onKey);
  }

  /* hooks 里必须带 bind()：GL.changed() 是唯一重渲染入口，只注册 render 会导致
     事件委托从未绑定 —— 表现为「页面能看、点不动」。bind() 有幂等保护。 */
  const renderAll = function () { render(); renderModal(); bind(); };
  GL.hooks.push(renderAll);
  GL.renderSkills = renderAll;
})();
