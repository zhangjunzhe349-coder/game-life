/* ============ Game Life · 技能经验值成长系统 ============ */
(function () {
  'use strict';

  function card(s) {
    const lv = GL.skillLevel(s);
    const logs = (s.logs || []).slice(-6).reverse()
      .map((l) => {
        const act = s.actions.find((x) => x.id === l.actionId);
        return `<li>${GL.fmtClock(l.t)} — ${GL.esc(act ? act.name : '行动')} <span class="gold">+${l.xp} XP</span></li>`;
      }).join('');
    return `<div class="card" data-sid="${s.id}">
      <div class="skill-top">
        <span class="skill-name">${s.emoji || '🎯'} ${GL.esc(s.name)}</span>
        <span class="skill-lv">Lv.${lv.level}</span>
      </div>
      <div class="xp-bar"><div style="width:${lv.pct}%"></div></div>
      <div class="xp-txt">${lv.into} / ${lv.need} XP → Lv.${lv.level + 1} · 累计 ${s.xp} XP</div>
      <div class="action-chips">
        ${s.actions.map((act) => `<button class="action-chip" data-act="${act.id}">${GL.esc(act.name)}<b>+${act.xp}</b></button>`).join('')}
      </div>
      <div class="edit-box">
        <div class="form-row">
          <input type="text" data-act-name placeholder="新行动名称" style="flex:2 1 130px">
          <input type="number" data-act-xp placeholder="XP" min="1" style="flex:1 1 64px">
          <button class="btn mini primary" data-act-add>＋行动</button>
        </div>
        <div class="form-row">
          <label class="dim" style="display:flex;align-items:center;gap:6px">每级基础XP
            <input type="number" data-xp-per value="${s.xpPerLevel}" min="1" style="width:76px"></label>
          <button class="btn mini danger" data-skill-del>删除技能</button>
        </div>
        ${s.actions.length ? `<details class="hist"><summary>管理行动（点击 ✕ 删除）</summary><div class="chips" style="margin-top:6px">
          ${s.actions.map((act) => `<button class="chip" data-act-del="${act.id}">${GL.esc(act.name)} +${act.xp}<span class="x">✕</span></button>`).join('')}
        </div></details>` : ''}
      </div>
      ${logs ? `<details class="hist"><summary>成长记录（${(s.logs || []).length} 条）</summary><ul>${logs}</ul></details>` : ''}
    </div>`;
  }

  function render() {
    const el = document.getElementById('panel-skills');
    if (!el) return;
    el.innerHTML = `
      ${GL.state.skills.map(card).join('')}
      <div class="card">
        <div class="card-head"><span class="card-title">＋ 创建新技能</span><span class="card-hint">行动 → 经验值 → 升级</span></div>
        <div class="form-row">
          <input type="text" id="s-emoji" placeholder="emoji" style="flex:0 1 76px" maxlength="4">
          <input type="text" id="s-name" placeholder="技能名，如 写作能力">
          <input type="number" id="s-xp" value="100" min="1" title="每级基础XP" style="flex:0 1 90px">
          <button class="btn primary mini" id="s-add">创建</button>
        </div>
        <div class="dim" style="margin-top:6px">升级所需经验逐级递增：Lv2 需 100，Lv3 需 300，Lv4 需 600……（按每级基础 100 计）</div>
      </div>`;
  }

  function bind() {
    const el = document.getElementById('panel-skills');
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';

    function gainXp(s, xp, label) {
      const before = GL.skillLevel(s).level;
      s.xp += xp;
      (s.logs = s.logs || []).push({ t: Date.now(), actionId: label.id || null, xp });
      const after = GL.skillLevel(s).level;
      GL.changed();
      if (after > before) {
        GL.toast(`🎉 ${s.name} 升级！Lv.${before} → Lv.${after}`, 'lvlup');
      } else {
        GL.toast(`+${xp} XP · ${s.emoji || ''}${s.name}`, 'ok');
      }
    }

    el.addEventListener('click', (e) => {
      const cardEl = e.target.closest('[data-sid]');
      const s = cardEl ? GL.state.skills.find((x) => x.id === cardEl.dataset.sid) : null;

      const act = e.target.closest('[data-act]');
      if (act && s) {
        const a = s.actions.find((x) => x.id === act.dataset.act);
        if (a) gainXp(s, a.xp, a);
        return;
      }
      if (!s) {
        if (e.target.id === 's-add') {
          const name = el.querySelector('#s-name').value.trim();
          const emoji = el.querySelector('#s-emoji').value.trim() || '🎯';
          const per = Math.max(1, Number(el.querySelector('#s-xp').value) || 100);
          if (!name) { GL.toast('先填写技能名', 'err'); return; }
          GL.state.skills.push({ id: GL.uid(), name, emoji, xp: 0, xpPerLevel: per, actions: [], logs: [] });
          GL.toast('技能「' + name + '」已创建，去添加行动吧');
          GL.changed();
        }
        return;
      }
      if (e.target.dataset.actAdd !== undefined) {
        const name = cardEl.querySelector('[data-act-name]').value.trim();
        const xp = Number(cardEl.querySelector('[data-act-xp]').value);
        if (!name || !(xp > 0)) { GL.toast('填写行动名和 XP', 'err'); return; }
        s.actions.push({ id: GL.uid(), name, xp });
        GL.toast('行动已添加');
        GL.changed();
      } else if (e.target.dataset.actDel !== undefined) {
        if (!confirm('确定删除该行动吗？历史经验值保留。')) return;
        s.actions = s.actions.filter((x) => x.id !== e.target.dataset.actDel);
        GL.changed();
      } else if (e.target.dataset.skillDel !== undefined) {
        if (!confirm('确定删除技能「' + s.name + '」及其全部成长记录吗？')) return;
        GL.state.skills = GL.state.skills.filter((x) => x.id !== s.id);
        GL.changed();
      }
    });

    el.addEventListener('change', (e) => {
      if (e.target.dataset.xpPer !== undefined) {
        const cardEl = e.target.closest('[data-sid]');
        const s = GL.state.skills.find((x) => x.id === cardEl.dataset.sid);
        if (s) { s.xpPerLevel = Math.max(1, Number(e.target.value) || 100); GL.changed(); }
      }
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target.id === 's-name' || e.target.dataset.actName !== undefined)) {
        el.querySelector(e.target.id === 's-name' ? '#s-add' : '[data-act-add]').click();
      }
    });
  }

  GL.hooks.push(() => { render(); });
  GL.renderSkills = function () { render(); bind(); };
})();
