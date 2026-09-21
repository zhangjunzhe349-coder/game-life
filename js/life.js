/* ============ Game Life · 生命时长可视化（周刻度） ============ */
(function () {
  'use strict';

  const INK_PAST = ['#ffc24b', '#f59e0b'];   // 已度过：琥珀
  const INK_FUTURE = '#191d27';              // 未来：低对比暗格
  const INK_NOW = '#3ce8b0';                 // 当前周：信号青描边
  const INK_LABEL = '#8b95ad';               // 左侧年龄刻度
  const INK_NODE = 'rgba(233,237,246,0.92)'; // 十年节点圈（琥珀底与暗底上都看得清）
  const INK_TICK_PAST = 'rgba(8,9,13,0.38)';        // 年度刻度：琥珀底上用暗线
  const INK_TICK_FUTURE = 'rgba(233,237,246,0.22)'; // 年度刻度：暗底上用亮线

  /* ============================================================
     一周一格的一生 · 格子固定大小，列数随容器宽度自适应
     ------------------------------------------------------------
     旧实现的两个坑（v1.6.0 修）：
     ① 量的是 canvas.clientWidth —— canvas 没有 CSS 宽度时默认就是 300px，
        量自己等于拿「上一次的自己」当基准，永远填不满。
        正确做法是量**外层容器** #life-grid-wrap。
     ② 用 window.resize + { once: true } 只重画一次，而且每次 render 都会
        再叠加一个监听。改用 ResizeObserver 持续跟随容器宽度，
        并用 lastW 去重防止「改高度 → 触发观察 → 再改高度」的自激循环。

     v1.6.1 把「52 列 × 预期寿命行」倒过来 —— 列数由宽度算，行数是结果：
     - 格子边长从 CELL_MAX 往下试，**同一屏内所有格子一样大、正方形，绝不拉伸**
     - 列数 = 可用宽度能放下几个格子；行数 = ceil(总周数 ÷ 列数)
       （总格子数恒等于总周数，只是排布方式换了）
     - 挑格子的规则：在「整块高度 ≤ H_TARGET」的前提下取最大的边长。
       窗口变宽 → 列变多、行变少 → 整块变矮；窗口变窄 → 格子自动降一档。
       这样**一生始终能一眼看全** —— 锚定的是「现在处在整段生命的什么位置」，
       而不是某一年的细节（用户原意）
     - 宽度方向除不尽的余数按「均匀分摊」加到各列间距上，整块恰好铺满容器

     标尺：行不再等于一年，「每 10 行标一次」随之失效。改为按**周序号**定位：
     第 age×52 周那一格 = age 岁生日所在格 → 该格画白圈（十年节点），
     左侧数字按该格所在行对齐，后面带一小段刻度线。
     另外每 52 周画 1px 年度刻度，让网格自带尺子节奏。
     ============================================================ */
  const GAP = 2;                          // 格间距
  const PAD_L = 40, PAD_R = 2, TOP = 4;   // 左留白给年龄刻度，右留白防裁边
  const CELL_MIN = 4, CELL_MAX = 14;      // 格子边长可选区间（正方形，不拉伸）
  const H_TARGET = 520;                   // 整块高度上限：超了就降一档格子
  const YEAR = 52;                        // 一年 52 周

  let ro = null;      // 唯一的 ResizeObserver，render 时重建
  let lastW = -1;     // 上次绘制的可用宽度，用于去重

  /* 在「列数由宽度算」的前提下挑格子边长：
     从大到小试，第一个高度不超限的就是答案；全超限则取最矮的（最小格子） */
  function planCells(usableW, totalWeeks) {
    let fallback = null;
    for (let cell = CELL_MAX; cell >= CELL_MIN; cell--) {
      const cols = Math.max(6, Math.floor((usableW + GAP) / (cell + GAP)));
      const rows = Math.ceil(totalWeeks / cols);
      const H = TOP + rows * cell + (rows - 1) * GAP + 6;
      const p = { cell, cols, rows, H };
      if (H <= H_TARGET) return p;
      fallback = p;
    }
    return fallback;
  }

  function drawGrid() {
    const canvas = document.getElementById('life-grid');
    const wrap = document.getElementById('life-grid-wrap');
    if (!canvas || !wrap) return;

    const L = GL.state.life;
    const dpr = window.devicePixelRatio || 1;
    const avail = Math.floor(wrap.clientWidth);
    if (avail < 160) return;                      // 面板尚未完成布局（hidden 时宽度为 0）
    if (avail === lastW) return;                  // 宽度没变 → 不重画（防自激）
    lastW = avail;

    const totalWeeks = Math.max(52, Math.round((Number(L.expectancy) || 80) * 52));
    const usableW = avail - PAD_L - PAD_R;
    const plan = planCells(usableW, totalWeeks);
    const cell = plan.cell, cols = plan.cols, rows = plan.rows;

    /* 列数算下来除不尽的余数（< 一个 pitch）均匀摊到各列间距上：
       整块恰好铺满容器宽度，且每列左边缘都落在整数像素上（不糊边） */
    const gaps = Math.max(1, cols - 1);
    const rest = usableW - (cols * cell + gaps * GAP);
    const extraOf = (i) => Math.floor((rest * (i + 1)) / gaps) - Math.floor((rest * i) / gaps);

    const H = TOP + rows * cell + (rows - 1) * GAP + 6;
    canvas.width = Math.round(avail * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = avail + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    // setTransform 而非 scale：同一个 canvas 被重画多次时 scale 会累乘
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, avail, H);

    const birthMs = GL.lifeInfo().birth.getTime();
    const lived = Math.max(0, Math.floor((Date.now() - birthMs) / (7 * 86400e3)));

    // 预计算每列左边缘
    const xs = new Array(cols);
    let x = PAD_L;
    for (let c = 0; c < cols; c++) { xs[c] = x; if (c < gaps) x += cell + GAP + extraOf(c); }
    const yOf = (r) => TOP + r * (cell + GAP);

    /* ① 格子本体：总格子数恒等于总周数，最后一行不满就不画满 */
    for (let r = 0; r < rows; r++) {
      const y = yOf(r);
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (idx >= totalWeeks) break;
        if (idx < lived) {
          const g = ctx.createLinearGradient(xs[c], y, xs[c] + cell, y + cell);
          g.addColorStop(0, INK_PAST[0]); g.addColorStop(1, INK_PAST[1]);
          ctx.fillStyle = g;
        } else {
          ctx.fillStyle = INK_FUTURE;
        }
        ctx.fillRect(xs[c], y, cell, cell);
      }
    }

    /* ② 年度刻度：第 n×52 周那一格的左缘画 1px 起始线（格子小，够用且不喧宾夺主）。
       颜色按所在区域反转 —— 琥珀底用暗线、暗底用亮线，两边都看得见 */
    for (let w = YEAR; w < totalWeeks; w += YEAR) {
      const r = Math.floor(w / cols), c = w % cols;
      if (r >= rows) break;
      ctx.fillStyle = w < lived ? INK_TICK_PAST : INK_TICK_FUTURE;
      ctx.fillRect(xs[c], yOf(r), 1, cell);
    }

    /* ③ 十年节点：该格画白圈，左侧数字按该格所在行对齐 + 一小段刻度线 */
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    let lastLabelRow = -1;
    for (let age = 10; age * YEAR < totalWeeks; age += 10) {
      const w = age * YEAR;
      const r = Math.floor(w / cols), c = w % cols;
      if (r >= rows) break;
      const y = yOf(r);
      ctx.strokeStyle = INK_NODE;
      ctx.lineWidth = 1;
      ctx.strokeRect(xs[c] + 1.5, y + 1.5, cell - 3, cell - 3);
      if (r === lastLabelRow) continue;      // 极宽容器下一行可能含两个十年，只标第一个
      lastLabelRow = r;
      ctx.fillStyle = INK_LABEL;
      ctx.fillText(age + '岁', PAD_L - 14, y + cell / 2);
      ctx.fillStyle = INK_TICK_FUTURE;
      ctx.fillRect(PAD_L - 10, Math.round(y + cell / 2) + 0.5, 7, 1);
    }

    /* ④ 当前周：最外层强调，最后画（压在最上面） */
    if (lived < totalWeeks) {
      const r = Math.floor(lived / cols), c = lived % cols;
      if (r < rows) {
        const y = yOf(r);
        ctx.strokeStyle = INK_NOW;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(xs[c] - 1.5, y - 1.5, cell + 3, cell + 3);
      }
    }

    /* 留一份布局真值：校验脚本要用，也方便在控制台看当前排布 */
    GL.lifeGrid = { cell, cols, rows, totalWeeks, avail, w: avail, h: H, remainder: rest };

    const note = document.getElementById('life-scale');
    if (note) {
      note.textContent = `${totalWeeks.toLocaleString()} 格（${L.expectancy} 年 × 52 周）`
        + ` · 每格 ${cell}px · 当前 ${rows} 行 × ${cols} 列`
        + ` · 窗口变宽会自动增列、减少行数`;
    }
  }

  /* 兜底：极老的环境没有 ResizeObserver 时，退回窗口 resize */
  window.addEventListener('resize', () => { drawGrid(); });

  function render() {
    const el = document.getElementById('panel-life');
    if (!el) return;
    const L = GL.state.life;
    const info = GL.lifeInfo();

    el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <span class="card-title">⏳ 生命刻度</span>
        <span class="card-hint">以「周」为单位的一生 · 格子固定大小，列数随宽度自适应</span>
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
      <div class="life-scale" id="life-scale"></div>
      <div class="life-legend">
        <span><i style="background:#ffc24b"></i>已度过的一周</span>
        <span><i style="background:#191d27;border:1px solid #2a3040"></i>未来的一周</span>
        <span><i style="background:#0d1017;box-shadow:0 0 0 2px #3ce8b0"></i>当前这一周</span>
        <span><i style="background:#191d27;box-shadow:inset 1px 0 0 rgba(233,237,246,0.5)"></i>每年起始（52 周）</span>
        <span><i style="background:#191d27;box-shadow:inset 0 0 0 1px rgba(233,237,246,0.92)"></i>十年节点 · 左侧数字是岁数</span>
      </div>
      <div class="dim" style="margin-top:14px">
        「你可以活 ${info.totalW.toLocaleString()} 个星期。」每一格就是一周 —— 用好手里还剩下的
        <b style="color:var(--xp)">${info.remainW.toLocaleString()}</b> 格。
      </div>
    </div>`;

    /* 面板重建后 canvas / wrap 都是新节点，必须重画 —— 先清掉宽度去重标记 */
    lastW = -1;
    requestAnimationFrame(drawGrid);

    const wrap = document.getElementById('life-grid-wrap');
    if (ro) { ro.disconnect(); ro = null; }
    if (wrap && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => drawGrid());
      ro.observe(wrap);
    }
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

  /* hooks 里必须带 bind()，否则 GL.changed() 只重绘不绑事件（页面能看、点不动）。
     bind() 内有 dataset.bound 幂等保护，重复调用安全。 */
  const renderAll = function () { render(); bind(); };
  GL.hooks.push(renderAll);
  GL.renderLife = renderAll;
})();
