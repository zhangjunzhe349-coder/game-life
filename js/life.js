/* ============ Game Life · 生命时长可视化（周刻度） ============ */
(function () {
  'use strict';

  function drawGrid(canvas, birth, expectancy) {
    const dpr = window.devicePixelRatio || 1;
    const cols = 52;
    const rows = expectancy;
    const W = canvas.clientWidth || 560;
    const left = 34, top = 4, gap = 1;
    const cell = Math.max(5, Math.floor((W - left - (cols - 1) * gap) / cols));
    const H = top + rows * (cell + gap) + 6;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const birthMs = localDate(birth).getTime();
    const weekMs = 7 * 86400e3;
    const lived = Math.max(0, Math.floor((Date.now() - birthMs) / weekMs));

    for (let r = 0; r < rows; r++) {
      // 每 10 年标注年龄
      if (r % 10 === 0) {
        ctx.fillStyle = '#6d7284';
        ctx.font = '10px sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(r + '岁', 2, top + r * (cell + gap) + cell / 3);
      }
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const x = left + c * (cell + gap);
        const y = top + r * (cell + gap);
        if (idx < lived) {
          const g = ctx.createLinearGradient(x, y, x + cell, y + cell);
          g.addColorStop(0, '#fbbf24'); g.addColorStop(1, '#f59e0b');
          ctx.fillStyle = g;
        } else {
          ctx.fillStyle = '#e7e8f2';
        }
        ctx.fillRect(x, y, cell, cell);
        if (idx === lived) { // 当前周高亮
          ctx.strokeStyle = '#5b4df0';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x - 1, y - 1, cell + 2, cell + 2);
        }
      }
    }
  }

  function localDate(str) {
    const [y, m, d] = String(str).split('-').map(Number);
    return new Date(y || 1996, (m || 1) - 1, d || 1);
  }

  function render() {
    const el = document.getElementById('panel-life');
    if (!el) return;
    const L = GL.state.life;
    const birth = localDate(L.birthDate);
    const now = new Date();

    // 精确年龄：X 岁 Y 天
    let ageY = now.getFullYear() - birth.getFullYear();
    const anniv = new Date(now.getFullYear(), birth.getMonth(), birth.getDate());
    if (anniv > now) ageY--;
    const lastBd = new Date(now.getFullYear() - (anniv > now ? 1 : 0), birth.getMonth(), birth.getDate());
    const ageD = Math.floor((now - lastBd) / 86400e3);

    const weekMs = 7 * 86400e3;
    const livedW = Math.max(0, Math.floor((Date.now() - birth.getTime()) / weekMs));
    const totalW = L.expectancy * 52;
    const remainW = Math.max(0, totalW - livedW);
    const pct = Math.min(100, (livedW / totalW) * 100);

    el.innerHTML = `
    <div class="card">
      <div class="card-head"><span class="card-title">⏳ 生命刻度</span><span class="card-hint">以「周」为单位的一生</span></div>
      <div class="form-row">
        <label class="dim" style="display:flex;align-items:center;gap:6px">出生日期
          <input type="date" id="l-birth" value="${L.birthDate}"></label>
        <label class="dim" style="display:flex;align-items:center;gap:6px">预期寿命
          <input type="number" id="l-exp" value="${L.expectancy}" min="30" max="120" style="width:76px"> 岁</label>
      </div>
      <div class="life-stats" style="margin-top:12px">
        <div class="life-stat"><b>${ageY}<span style="font-size:13px">岁</span> ${ageD}<span style="font-size:13px">天</span></b><span>当前精确年龄</span></div>
        <div class="life-stat"><b>${livedW.toLocaleString()} 周</b><span>已度过</span></div>
        <div class="life-stat hl"><b>≈ ${remainW.toLocaleString()} 周</b><span>剩余生命（约 ${Math.floor(remainW / 52)} 年）</span></div>
        <div class="life-stat"><b>${pct.toFixed(1)}%</b><span>人生进度条</span></div>
      </div>
      <div id="life-grid-wrap"><canvas id="life-grid"></canvas></div>
      <div class="life-legend">
        <span><i style="background:#fbbf24"></i>已度过的一周</span>
        <span><i style="background:#e7e8f2;border:1px solid #d8dae8"></i>未来的一周</span>
        <span><i style="background:#f4f4f8;box-shadow:0 0 0 2px #5b4df0"></i>当前这一周</span>
      </div>
      <div class="dim" style="margin-top:10px">「你可以活 ${totalW.toLocaleString()} 个星期。」每一格就是一周 —— 用好手里还剩下的格子。</div>
    </div>`;

    requestAnimationFrame(() => drawGrid(document.getElementById('life-grid'), L.birthDate, L.expectancy));
  }

  function bind() {
    const el = document.getElementById('panel-life');
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('change', (e) => {
      const L = GL.state.life;
      if (e.target.id === 'l-birth' && e.target.value) { L.birthDate = e.target.value; GL.changed(); }
      if (e.target.id === 'l-exp') {
        const v = Number(e.target.value);
        if (v >= 30 && v <= 120) { L.expectancy = v; GL.changed(); }
      }
    });
  }

  GL.hooks.push(() => { render(); });
  GL.renderLife = function () { render(); bind(); };
})();
