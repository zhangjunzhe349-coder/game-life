/* ============ Game Life · 生命时长可视化（周刻度） ============ */
(function () {
  'use strict';

  const INK_PAST = ['#ffc24b', '#f59e0b'];   // 已度过：琥珀
  const INK_FUTURE = '#191d27';              // 未来：低对比暗格
  const INK_NOW = '#3ce8b0';                 // 当前周：信号青描边
  const INK_LABEL = '#646d84';

  function drawGrid(canvas, birthDate, expectancy) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cols = 52, rows = expectancy;
    const W = canvas.clientWidth || 560;
    const left = 34, top = 4, gap = 1;
    const cell = Math.max(5, Math.floor((W - left - (cols - 1) * gap) / cols));
    const H = top + rows * (cell + gap) + 6;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const birthMs = GL.lifeInfo().birth.getTime();
    const lived = Math.max(0, Math.floor((Date.now() - birthMs) / (7 * 86400e3)));

    for (let r = 0; r < rows; r++) {
      if (r % 10 === 0) {                     // 每 10 年标注年龄
        ctx.fillStyle = INK_LABEL;
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textBaseline = 'top';
        ctx.fillText(r + '岁', 2, top + r * (cell + gap) + cell / 3);
      }
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const x = left + c * (cell + gap);
        const y = top + r * (cell + gap);
        if (idx < lived) {
          const g = ctx.createLinearGradient(x, y, x + cell, y + cell);
          g.addColorStop(0, INK_PAST[0]); g.addColorStop(1, INK_PAST[1]);
          ctx.fillStyle = g;
        } else {
          ctx.fillStyle = INK_FUTURE;
        }
        ctx.fillRect(x, y, cell, cell);
        if (idx === lived) {                  // 当前周高亮
          ctx.strokeStyle = INK_NOW;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x - 1, y - 1, cell + 2, cell + 2);
        }
      }
    }
  }

  function render() {
    const el = document.getElementById('panel-life');
    if (!el) return;
    const L = GL.state.life;
    const info = GL.lifeInfo();

    el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <span class="card-title">⏳ 生命刻度</span>
        <span class="card-hint">以「周」为单位的一生</span>
      </div>
      <div class="form-row">
        <label class="dim" style="display:flex;align-items:center;gap:8px">出生日期
          <input type="date" id="l-birth" value="${L.birthDate}"></label>
        <label class="dim" style="display:flex;align-items:center;gap:8px">预期寿命
          <input type="number" id="l-exp" value="${L.expectancy}" min="30" max="120" style="width:78px"> 岁</label>
      </div>
      <div class="life-stats" style="margin-top:20px">
        <div class="life-stat"><b>${info.ageY}<i>岁</i> ${info.ageD}<i>天</i></b><span>当前精确年龄</span></div>
        <div class="life-stat"><b>${info.livedW.toLocaleString()}<i>周</i></b><span>已度过</span></div>
        <div class="life-stat hl"><b>≈ ${info.remainW.toLocaleString()}<i>周</i></b><span>剩余生命 · 约 ${Math.floor(info.remainW / 52)} 年</span></div>
        <div class="life-stat"><b>${info.pct.toFixed(1)}<i>%</i></b><span>人生进度条</span></div>
      </div>
      <div id="life-grid-wrap"><canvas id="life-grid"></canvas></div>
      <div class="life-legend">
        <span><i style="background:#ffc24b"></i>已度过的一周</span>
        <span><i style="background:#191d27;border:1px solid #2a3040"></i>未来的一周</span>
        <span><i style="background:#0d1017;box-shadow:0 0 0 2px #3ce8b0"></i>当前这一周</span>
      </div>
      <div class="dim" style="margin-top:14px">
        「你可以活 ${info.totalW.toLocaleString()} 个星期。」每一格就是一周 —— 用好手里还剩下的
        <b style="color:var(--xp)">${info.remainW.toLocaleString()}</b> 格。
      </div>
    </div>`;

    requestAnimationFrame(() => drawGrid(document.getElementById('life-grid'), L.birthDate, L.expectancy));
    window.addEventListener('resize', () => drawGrid(document.getElementById('life-grid'), L.birthDate, L.expectancy), { once: true });
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

  GL.hooks.push(render);
  GL.renderLife = function () { render(); bind(); };
})();
