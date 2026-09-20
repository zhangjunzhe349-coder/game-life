/* ============ Game Life · 技能经验值 ============
   极简操作：每项技能一个「＋」，加多少由你自己评判
   完整展示：等级 / 本级进度 / 累计经验 / 下一级需求 / 成长记录
   ============================================================ */
(function () {
  'use strict';

  let addingFor = null;      // 当前展开加经验行的技能 id
  let lastXp = 10;           // 记住上次填写的 XP，减少重复输入

  function list() { return GL.state.skills; }
  function find(id) { return list().find((s) => s.id === id); }

  function logLine(s, l) {
    const act = (s.actions || []).find((x) => x.id === l.actionId);
    const what = l.note ? GL.esc(l.note) : (act ? GL.esc(act.name) : '自定义');
    return `<li>${GL.fmtClock(l.t)} — ${what} <span class="gold">+${l.xp} XP</span></li>`;
  }

  function card(s) {
    const lv = GL.skillLevel(s);
    const open = addingFor === s.id;
    const logs = (s.logs || []).slice(-8).reverse().map((l) => logLine(s, l)).join('');
    return `<div class="skill" data-sid="${s.id}">
      <div class="skill-top">
        <span class="skill-emoji">${s.emoji || '🎯'}</span>
        <span class="skill-name">${GL.esc(s.name)}</span>
        <span class="skill-lv">Lv.${lv.level}</span>
      </div>
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
      ${logs ? `<details class="hist"><summary>成长记录（${(s.logs || []).length} 条）</summary><ul>${logs}</ul></details>` : ''}
    </div>`;
  }

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
        ${groups.map((g) => {
          if (!g.items.length) return '';
          const gxp = g.items.reduce((s, k) => s + (k.xp || 0), 0);
          return `<section class="sg" data-gid="${g.id}">
            <div class="sg-head">
              <span class="sg-glyph" aria-hidden="true">${g.emoji}</span>
              <span class="sg-name">${GL.esc(g.name)}</span>
              <span class="sg-meta">${g.items.length} 项 · ${gxp} XP</span>
            </div>
            <div class="skill-grid">${g.items.map(card).join('')}</div>
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

  function bind() {
    const el = document.getElementById('panel-skills');
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';

    el.addEventListener('click', (e) => {
      // 展开 / 收起加经验行
      const add = e.target.closest('[data-add]');
      if (add) {
        addingFor = addingFor === add.dataset.add ? null : add.dataset.add;
        render();
        const inp = el.querySelector('#xp-' + add.dataset.add);
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
      if (e.target.id === 's-add') {
        const name = (el.querySelector('#s-name').value || '').trim();
        const emoji = el.querySelector('#s-emoji').value.trim() || '🎯';
        const per = Math.max(1, Number(el.querySelector('#s-xp').value) || 100);
        const group = el.querySelector('#s-group').value || 'misc';
        if (!name) { GL.toast('先填写技能名', 'err'); return; }
        list().push({ id: GL.uid(), name, emoji, group, xp: 0, xpPerLevel: per, actions: [], logs: [] });
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
        GL.changed();
      }
    });

    el.addEventListener('change', (e) => {
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
    });

    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (e.target.id === 's-name') { el.querySelector('#s-add').click(); return; }
      if (e.target.dataset.xpIn !== undefined || e.target.dataset.xpNote !== undefined) {
        const box = e.target.closest('.xp-add');
        if (box) box.querySelector('[data-xp-ok]').click();
      }
    });
  }

  /* hooks 里必须带 bind()：GL.changed() 是唯一重渲染入口，只注册 render 会导致
     事件委托从未绑定 —— 表现为「页面能看、点不动」。bind() 有幂等保护。 */
  const renderAll = function () { render(); bind(); };
  GL.hooks.push(renderAll);
  GL.renderSkills = renderAll;
})();
