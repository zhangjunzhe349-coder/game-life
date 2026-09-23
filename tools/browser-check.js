/* ============================================================
   浏览器冒烟测试：内置静态服务器 + CDP 真实跑页面
   ------------------------------------------------------------
   为什么需要它（v1.4.2 事故教训）：
   verify-portrait / verify-wiring 都是「静态分析」——查语法、查脚本清单、
   查宿主节点是否存在。它们抓不到「页面启动了但运行时抛异常、导致整页白屏」
   这类问题。v1.4.0 就出过这个事故：index.html 漏了 js/avatar.js，
   app.js 调 GL.initAvatar() 抛异常中断启动，所有 .rv 元素永久 opacity:0，
   而两个静态校验工具全绿。

   本脚本做静态工具做不到的三件事：
   ① 真跑一遍页面，抓 pageerror / console.error
   ② 断言关键渲染产物真的存在（立绘 path 数、hooks 执行数、.rv 是否点亮）
   ③ 出整页 + 局部 PNG，供肉眼确认

   用法：
     node tools/browser-check.js                # 跑默认检查并出图
     node tools/browser-check.js --no-shot      # 只跑断言，不截图
     node tools/browser-check.js --keep         # 保留截图（默认也会保留，见下）
   依赖：ws（装在托管工作区，用 NODE_PATH 指向其 node_modules）
   ============================================================ */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
/* --dist：把整组断言跑在**部署产物** dist/ 上，而不是仓库根目录。
   为什么需要：静态扫引用查不出两类问题 ——
     ① 动态拼接加载的资源（构建时扫不到）没进 dist；
     ② 某些文件被平台规则吃掉（如 GitHub Pages 的 Jekyll 会忽略下划线开头文件）。
   只有真起一个 http 服务把 dist/ 跑一遍，才算证明了「部署上去能用」。
   用法：node tools/build-dist.js && node tools/browser-check.js --dist */
const DIST_MODE = process.argv.includes('--dist');
const SERVE = DIST_MODE ? path.join(ROOT, 'dist') : ROOT;
const SRV_PORT = 8127;
const CDP_PORT = 9337;
const WANT_SHOT = !process.argv.includes('--no-shot');
const W = 1600, H = 1100;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(SERVE, p);
  if (!fp.startsWith(SERVE)) { res.writeHead(403).end(); return; }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404).end('404'); return; }
    // 禁缓存：确保读到磁盘最新文件，而不是 Service Worker 里的旧副本
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    res.end(buf);
  });
});

const EXE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((p) => fs.existsSync(p));

function cdpGet(p) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port: CDP_PORT, path: p }, (x) => {
      let d = ''; x.on('data', (c) => (d += c)); x.on('end', () => res(d));
    });
    r.on('error', rej); r.end();
  });
}
function loadWS() {
  for (const r of ['C:/Users/ZHANG/.workbuddy/binaries/node/workspace/node_modules', path.join(ROOT, 'node_modules')]) {
    try { return require(path.join(r, 'ws')); } catch (e) {}
  }
  return null;
}

/* ---------- 断言框架 ---------- */
const results = [];
function check(ok, label, detail) {
  results.push({ ok, label, detail });
}

(async () => {
  if (!EXE) { console.error('✗ 找不到 Edge / Chrome，无法做浏览器校验'); process.exit(1); }
  const WS = loadWS();
  if (!WS) {
    console.error('✗ 缺少 ws 模块。请执行：');
    console.error('  cd C:/Users/ZHANG/.workbuddy/binaries/node/workspace && npm i ws');
    console.error('  并以 NODE_PATH 指向其 node_modules 运行本脚本');
    process.exit(1);
  }

  if (DIST_MODE) {
    if (!fs.existsSync(SERVE)) {
      console.error('✗ 找不到 dist/。先跑：node tools/build-dist.js');
      process.exit(1);
    }
    console.log(`  模式：部署产物校验（服务 ${path.relative(ROOT, SERVE)}/ 而不是仓库根）\n`);
  }

  await new Promise((r) => srv.listen(SRV_PORT, '127.0.0.1', r));
  const url = `http://127.0.0.1:${SRV_PORT}/index.html`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'glbrowser-'));

  const child = spawn(EXE, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox',
    '--hide-scrollbars', `--window-size=${W},${H}`, url,
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i++) {
    try {
      await cdpGet('/json/version');
      const l = JSON.parse(await cdpGet('/json/list'));
      target = l.find((t) => t.type === 'page' && /^https?:/.test(t.url));
      if (target) break;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!target) { child.kill(); srv.close(); console.error('✗ CDP 未就绪'); process.exit(1); }

  const ws = new WS(target.webSocketDebuggerUrl);
  const pageErrors = [];
  let id = 0; const pending = new Map();
  const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      pageErrors.push(`${d.exception?.description || d.text} @ ${d.url}:${d.lineNumber + 1}:${d.columnNumber + 1}`);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      pageErrors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error'
        && !/favicon|manifest|fonts\.googleapis/i.test(m.params.entry.text)) {
      pageErrors.push(`LOG: ${m.params.entry.text}`);
    }
  });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result ? r.result.value : undefined;
  };

  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  for (let i = 0; i < 60; i++) { if ((await ev('document.readyState')) === 'complete') break; await new Promise((r) => setTimeout(r, 200)); }
  await new Promise((r) => setTimeout(r, 2200));

  const S = await ev(`(() => {
    const gl = window.GL || {};
    const svg = document.getElementById('portrait-svg');
    const stage = document.getElementById('stage');
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const rows = document.querySelectorAll('.ag-row');
    const groups = document.querySelectorAll('.ag');
    return {
      hasGL: !!window.GL,
      version: gl.VERSION || null,
      hookCount: (gl.hooks || []).length,
      errors: __ERRS__,
      docH: document.documentElement.scrollHeight,
      portraitPaths: svg ? svg.querySelectorAll('path').length : -1,
      portraitInnerLen: svg ? svg.innerHTML.length : -1,
      portraitRect: rect(svg),
      stageRect: rect(stage),
      rvTotal: document.querySelectorAll('.rv').length,
      rvIn: document.querySelectorAll('.rv.in').length,
      cardCount: document.querySelectorAll('.card').length,
      tabCount: document.querySelectorAll('.tab').length,
      injectedAttrs: document.querySelectorAll('[data-page-node-id]').length,
      attrGroups: groups.length,
      attrRows: rows.length,
      attrNegGroups: document.querySelectorAll('.ag.neg').length,
      attrNegRows: document.querySelectorAll('.ag-row.neg').length,
      attrMidRows: document.querySelectorAll('.ag-row.mid').length,
      attrFirstLabel: rows.length ? rows[0].querySelector('.ag-t').textContent : null,
      attrHasSub: document.querySelectorAll('.ag-sub').length,
      /* 面板明细：分组 → 各行「名称 数值」，供人工核对文案与数值是否合理 */
      attrDump: Array.from(groups).map((sec) => {
        const gid = sec.getAttribute('data-gid');
        const mean = sec.querySelector('.ag-mean') ? sec.querySelector('.ag-mean').textContent : '?';
        const items = Array.from(sec.querySelectorAll('.ag-row')).map((r) => {
          const n = r.querySelector('.ag-t').textContent;
          const v = r.querySelector('.ag-num').textContent;
          const cls = r.classList.contains('neg') ? '[-]' : (r.classList.contains('mid') ? '[~]' : '');
          return n + ' ' + v + cls;
        });
        return gid + '(' + mean + ') ' + items.join(' / ');
      }),
      skillGroups: document.querySelectorAll('.sg').length,
      skillCards: document.querySelectorAll('.skill').length,
      skillNoteBtns: document.querySelectorAll('.skill-note-btn').length,
      skillSubCount: document.querySelectorAll('.skill-sub').length,
      skillNoteTxtCount: document.querySelectorAll('.skill-note-txt').length,
      /* v1.6.0：小字必须与用户原文逐字一致，抽查几项最容易被压缩的 */
      subMove: (gl.state && (gl.state.attributes.find((a) => a.id === 'move') || {}).sub) || null,
      noteDiet: (gl.state && (gl.state.attributes.find((a) => a.id === 'diet') || {}).note) || null,
      nameSmalltalk: (gl.state && (gl.state.skills.find((s) => s.id === 'smalltalk') || {}).name) || null,
      subMuscle: (gl.state && (gl.state.skills.find((s) => s.id === 'muscle') || {}).sub) || null,
      overall: typeof gl.overallScore === 'function' ? gl.overallScore() : null,
      attrCount: (gl.state && gl.state.attributes || []).length,
      skillCount: (gl.state && gl.state.skills || []).length,
      dataVersion: gl.state ? gl.state.version : null,
      firstGroupMean: document.querySelector('.ag-mean') ? document.querySelector('.ag-mean').textContent : null,
    };
  })()`.replace('__ERRS__', JSON.stringify(pageErrors)));

  if (S && S.__err) {
    console.error('✗ 页面求值失败：' + S.__err);
    ws.close(); child.kill(); srv.close();
    process.exit(1);
  }

  /* ---------- 断言 ---------- */
  check(S.errors.length === 0, '无运行时异常', S.errors.length ? S.errors.slice(0, 3).join(' | ') : `${S.errors.length} 条`);
  check(S.hasGL === true, 'GL 全局已建立');
  check(S.hookCount >= 7, 'GL.hooks 注册数 ≥ 7', `实际 ${S.hookCount}`);
  check(S.tabCount === 4, '主导航 4 个 tab', `实际 ${S.tabCount}`);
  check(S.portraitPaths >= 30, '中央立绘已绘制（path 数 ≥ 30）', `实际 ${S.portraitPaths} —— 为 0 说明 hooks 未执行`);
  check(S.portraitInnerLen > 3000, '立绘 SVG 有实际内容', `innerHTML ${S.portraitInnerLen} 字符`);
  check(S.portraitRect && S.portraitRect.w > 200 && S.portraitRect.h > 150, '立绘有可见尺寸',
    S.portraitRect ? `${S.portraitRect.w}×${S.portraitRect.h}` : 'null');
  check(S.rvTotal > 0 && S.rvIn === S.rvTotal, '入场动画元素全部点亮（.rv.in == .rv）',
    `${S.rvIn}/${S.rvTotal} —— 不相等说明 reveal() 未跑完，页面会白屏`);
  check(S.docH > 900, '页面有正常内容高度', `${S.docH}px`);
  check(S.cardCount >= 5, '卡片已渲染', `${S.cardCount} 张`);

  /* ---------- 属性分组体系（v1.5.0） ---------- */
  check(S.attrCount === 14, '属性共 14 项（3 大类）', `实际 ${S.attrCount}`);
  check(S.skillCount === 13, '技能共 13 项（5 大类）', `实际 ${S.skillCount}`);
  check(S.dataVersion === 3, '数据版本为 v3（迁移已完成）', `实际 v${S.dataVersion}`);
  check(S.attrGroups === 3, '属性面板渲染 3 个分组', `实际 ${S.attrGroups} —— 为 0 说明属性面板没渲染`);
  check(S.attrRows === 14, '属性面板渲染 14 行细刻度', `实际 ${S.attrRows}`);
  check(S.attrNegGroups === 1, '熵值组带负向标记（.ag.neg）', `实际 ${S.attrNegGroups}`);
  check(S.attrNegRows === 4, '负向行 4 个（熵值3 + 困倦度）', `实际 ${S.attrNegRows}`);
  check(S.attrMidRows === 2, '双向行 2 个（社交度、稳定度）', `实际 ${S.attrMidRows}`);
  check(S.overall !== null && S.overall > 0, 'GL.overallScore() 可用', `实际 ${S.overall}`);
  check(S.skillGroups === 5, '技能页渲染 5 个分组', `实际 ${S.skillGroups} —— 注意技能在独立 tab，需确认已渲染`);
  check(S.skillCards === 13, '技能卡片 13 张', `实际 ${S.skillCards}`);

  /* ---------- 小字照录原文 + 可编辑入口（v1.6.0） ---------- */
  check(S.attrHasSub === 5, '属性小字渲染 5 处（原文里带括号的 5 项）', `实际 ${S.attrHasSub}`);
  check(S.subMove === '（活动半径）（久坐值）',
    '小字按原文照录：运动度 =「（活动半径）（久坐值）」', `实际 ${S.subMove}`);
  check(S.noteDiet === '——（少油，少盐，少糖）（地中海饮食，高蛋白）',
    '说明按原文照录：饮食（含全角括号标点）', `实际 ${S.noteDiet}`);
  check(S.nameSmalltalk === 'small talk闲聊能力',
    '技能名按原文照录：small talk闲聊能力', `实际 ${S.nameSmalltalk}`);
  check(S.subMuscle === '（细狗——匀称——薄肌）',
    '技能小字按原文照录：肌肉量', `实际 ${S.subMuscle}`);
  check(S.skillSubCount === 3, '技能小字渲染 3 处（肌肉量 / 表达能力 / small talk）', `实际 ${S.skillSubCount}`);
  check(S.skillNoteBtns === 13, '每张技能卡片都有注释入口', `实际 ${S.skillNoteBtns}`);

  /* ---------- 出图 ---------- */
  let shotPaths = [];
  if (WANT_SHOT) {
    const s1 = await send('Page.captureScreenshot', { format: 'png' });
    const p1 = path.join(ROOT, 'tools', 'browser-shot-full.png');
    fs.writeFileSync(p1, Buffer.from(s1.data, 'base64'));
    shotPaths.push(p1);
    if (S.stageRect && S.stageRect.w > 100) {
      const r = S.stageRect;
      const s2 = await send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 10), width: r.w + 20, height: r.h + 20, scale: 1.4 },
      });
      const p2 = path.join(ROOT, 'tools', 'browser-shot-stage.png');
      fs.writeFileSync(p2, Buffer.from(s2.data, 'base64'));
      shotPaths.push(p2);
    }
    /* 逐 tab 截图：属性在「总览」、技能在「技能」——不同 tab 的渲染要分别看 */
    for (const tab of ['skills', 'life', 'settings']) {
      const clicked = await ev(`(() => {
        const b = document.querySelector('.tab[data-tab="${tab}"]');
        if (!b) return false;
        b.click();
        return true;
      })()`);
      if (!clicked) continue;
      await new Promise((r) => setTimeout(r, 700));
      const s = await send('Page.captureScreenshot', { format: 'png' });
      const p = path.join(ROOT, 'tools', `browser-shot-${tab}.png`);
      fs.writeFileSync(p, Buffer.from(s.data, 'base64'));
      shotPaths.push(p);
    }
    // 回到总览页，避免影响后续
    await ev(`(() => { const b = document.querySelector('.tab[data-tab="hud"]'); if (b) b.click(); })()`);
  }

  /* ---------- 生命刻度：格子固定大小 + 列数随容器宽度自适应（v1.6.1） ----------
     核心行为：列数由宽度算、行数是结果 —— 整块永远铺满宽度，且不高过高度上限。
     不只量宽度，还真的改一次视口宽度，看列数有没有跟着重排。 */
  const readGrid = `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await sleep(500);
    const c = document.getElementById('life-grid');
    const w = document.getElementById('life-grid-wrap');
    if (!c || !w) return { err: 'canvas or wrap missing' };
    const dpr = window.devicePixelRatio || 1;
    let rightInk = 0, whiteInk = 0;
    try {
      const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      const d = img.data;
      const rightFrom = c.width - Math.round(24 * dpr);
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] <= 20) continue;
        const x = (i / 4) % c.width;
        if (x >= rightFrom) rightInk++;
        if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) whiteInk++;
      }
    } catch (e) { rightInk = -1; whiteInk = -1; }
    return {
      canvasW: Math.round(c.getBoundingClientRect().width),
      canvasH: Math.round(c.getBoundingClientRect().height),
      wrapW: Math.round(w.clientWidth),
      bitmapW: c.width,
      dpr: dpr,
      scrollX: w.scrollWidth > w.clientWidth + 1,
      rightInk: rightInk,
      whiteInk: whiteInk,
      plan: window.GL.lifeGrid || null,
      scaleText: (document.getElementById('life-scale') || {}).textContent || '',
    };
  })()`;

  const backToHud = `(() => { const b = document.querySelector('.tab[data-tab="hud"]'); if (b) b.click(); return true; })()`;

  await ev(`(() => { const b = document.querySelector('.tab[data-tab="life"]'); if (b) b.click(); return true; })()`);
  const grid = await ev(readGrid);

  // 真改一次视口宽度，验证「列数由宽度算」确实生效
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1000, height: H, deviceScaleFactor: 1, mobile: false,
  });
  const gridNarrow = await ev(readGrid);
  await send('Emulation.clearDeviceMetricsOverride');
  await ev(backToHud);
  await new Promise((r) => setTimeout(r, 400));

  if (grid && !grid.__err && grid.plan) {
    const p = grid.plan;
    check(typeof grid.canvasW === 'number' && grid.canvasW > 320,
      '生命刻度：网格宽度不再是默认的 300px 底', `${grid.canvasW}px`);
    check(grid.canvasW >= grid.wrapW - 6 && grid.canvasW <= grid.wrapW + 2,
      '生命刻度：整块铺满容器宽度（自适应）',
      `canvas ${grid.canvasW}px / 容器 ${grid.wrapW}px`);
    check(grid.scrollX === false, '生命刻度：不产生横向滚动条（没有溢出）');
    check(p.cell >= 4 && p.cell <= 14,
      '生命刻度：格子边长固定在一档内（没有被拉伸变形）', `每格 ${p.cell}px`);
    check(p.rows === Math.ceil(p.totalWeeks / p.cols),
      '生命刻度：行列关系正确（行数 = ceil(总周数 ÷ 列数)）',
      `${p.rows} 行 × ${p.cols} 列 / 共 ${p.totalWeeks} 周`);
    check(p.cols * p.cell + (p.cols - 1) * 2 + p.remainder === p.avail - 42,
      '生命刻度：余数分摊后恰好占满可用宽度（不溢出也不留缝）',
      `格子区 ${p.cols * p.cell + (p.cols - 1) * 2}px + 余数 ${p.remainder}px`);
    check(grid.canvasH <= 520 + 8,
      '生命刻度：整块高度受限，一生一眼看全（旧版会随宽度涨到 1850px）', `${grid.canvasH}px`);
    check(grid.rightInk > 0,
      '生命刻度：网格画到了容器最右缘（旧版这里是整片空白）', `${grid.rightInk} px`);
    check(grid.whiteInk > 60,
      '生命刻度：十年节点白圈已绘制（按周序号定位，不依赖行号）', `${grid.whiteInk} px`);
    check(/行 × \d+ 列/.test(grid.scaleText),
      '生命刻度：排布读数已渲染（几行几列 / 每格几 px）', String(grid.scaleText).slice(0, 60));
  } else {
    check(false, '生命刻度：测量失败', grid && grid.err ? String(grid.err) : '未知');
  }

  if (gridNarrow && !gridNarrow.__err && gridNarrow.plan && grid.plan) {
    check(gridNarrow.plan.cols < grid.plan.cols,
      '生命刻度：视口变窄后列数真的减少了（重排生效）',
      `${grid.plan.cols} 列 → ${gridNarrow.plan.cols} 列`);
    check(Math.abs(gridNarrow.canvasW - gridNarrow.wrapW) <= 6,
      '生命刻度：窄视口下仍然铺满容器',
      `canvas ${gridNarrow.canvasW}px / 容器 ${gridNarrow.wrapW}px`);
    check(gridNarrow.canvasH <= 520 + 8,
      '生命刻度：窄视口下整块依然不高过上限（自动降一档格子）',
      `${gridNarrow.plan.cell}px 格子 → ${gridNarrow.canvasH}px 高`);
  } else {
    check(false, '生命刻度：窄视口重排测量失败',
      gridNarrow && gridNarrow.err ? String(gridNarrow.err) : '未知');
  }

  /* ---------- 交互测试：折叠 + 微调 + 就地编辑（v1.5.0 / v1.6.0 新组件，必须真点一遍） ---------- */
  const inter = await ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const itemsH = () => {
      const el = document.querySelector('.ag-items');
      return el ? Math.round(el.getBoundingClientRect().height) : -1;
    };
    const out = {};
    // 注意：每次操作都会触发 GL.changed() → 重渲染 → innerHTML 整个替换，
    // 旧元素引用会失效。所以每步操作前必须重新查询，否则点了没反应是测试自己的锅。
    const pick = (sel) => document.querySelector(sel);

    // ① 折叠：点组标题应收起该组
    out.headFound = !!pick('.ag-head');
    out.hBefore = itemsH();
    if (pick('.ag-head')) {
      pick('.ag-head').click(); await sleep(450);
      out.hCollapsed = itemsH();
      out.shutFlag = !!pick('.ag.shut');
      if (pick('.ag-head')) {
        pick('.ag-head').click(); await sleep(450);
        out.hBack = itemsH();
      }
    }

    // ② 微调：点小项行应展开微调条
    out.rowFound = !!pick('.ag-row[data-aid="throat"]');
    if (pick('.ag-row[data-aid="throat"]')) {
      out.v0 = pick('.ag-row[data-aid="throat"] .ag-num').textContent;
      pick('.ag-row[data-aid="throat"]').click(); await sleep(350);
      out.tuneOpen = !!pick('.ag-tune[data-aid="throat"]');
      out.stepBtnFound = !!pick('.ag-tune[data-aid="throat"] [data-attr-step="1"]');
      if (pick('.ag-tune[data-aid="throat"] [data-attr-step="1"]')) {
        pick('.ag-tune[data-aid="throat"] [data-attr-step="1"]').click(); await sleep(350);
        out.v1 = pick('.ag-row[data-aid="throat"]') ? pick('.ag-row[data-aid="throat"] .ag-num').textContent : null;
        // 恢复原值，避免污染后续状态
        if (pick('.ag-tune[data-aid="throat"] [data-attr-step="-1"]')) {
          pick('.ag-tune[data-aid="throat"] [data-attr-step="-1"]').click(); await sleep(350);
        }
        out.v2 = pick('.ag-row[data-aid="throat"]') ? pick('.ag-row[data-aid="throat"] .ag-num').textContent : null;
      }
    }

    // ③ 折叠状态是否持久化到 state
    if (pick('.ag-head')) {
      pick('.ag-head').click(); await sleep(400);
      out.persisted = !!(window.GL.state.ui && window.GL.state.ui.attrCollapsed.length);
      if (pick('.ag-head')) { pick('.ag-head').click(); await sleep(400); }
      out.restored = !pick('.ag.shut');
    }

    // ④ 极性文案方向：负向项绝不能显示「🔥 充沛」这类夸奖式等级。
    //    这是最容易悄悄回归的一类 bug（等级文案没跟着 polarity 走），必须断言。
    //    微调区同一时刻只开一个（tuneFor 单选），所以依次点开读取即可。
    const noteOf = (aid) => {
      const el = pick('.ag-tune[data-aid="' + aid + '"] .ag-tune-note');
      return el ? el.textContent.trim() : null;
    };
    const noteAfterOpen = async (aid) => {
      if (pick('.ag-tune[data-aid="' + aid + '"]')) return noteOf(aid);
      const r = pick('.ag-row[data-aid="' + aid + '"]');
      if (!r) return null;
      r.click(); await sleep(360);
      return noteOf(aid);
    };
    out.noteNeg = await noteAfterOpen('drowse');   // 困倦度：neg
    out.noteMid = await noteAfterOpen('social');   // 社交度：mid
    out.notePos = await noteAfterOpen('mood');     // 情绪值：pos
    // 收起微调条，避免影响后续
    if (pick('.ag-row[data-aid="mood"]')) { pick('.ag-row[data-aid="mood"]').click(); await sleep(300); }

    // ⑤ 文字就地编辑：写进 state + 行内小字同步，且**不整页重渲染**
    //    （重渲染会把正在编辑的输入框换掉，光标丢 —— 所以要断言旧引用仍然连着）
    if (pick('.ag-row[data-aid="throat"]')) {
      pick('.ag-row[data-aid="throat"]').click(); await sleep(350);
      const box = pick('.ag-tune[data-aid="throat"]');
      out.txBoxFound = !!box;
      out.txFields = box ? box.querySelectorAll('.tx-edit input, .tx-edit textarea').length : 0;
      const inp = box ? box.querySelector('[data-attr-sub]') : null;
      out.origSub = inp ? inp.value : null;
      if (inp) {
        inp.value = '（测试小字）';
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(250);
        out.subAfter = (window.GL.state.attributes.find((a) => a.id === 'throat') || {}).sub;
        out.subDom = pick('.ag-row[data-aid="throat"] .ag-sub')
          ? pick('.ag-row[data-aid="throat"] .ag-sub').textContent : null;
        out.inputStillConnected = inp.isConnected;      // 没被重渲染换掉 = 焦点不会丢
        // 还原
        const back = pick('.ag-tune[data-aid="throat"] [data-attr-sub]');
        if (back) {
          back.value = out.origSub;
          back.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(250);
        }
        out.subRestored = (window.GL.state.attributes.find((a) => a.id === 'throat') || {}).sub;
      }
      if (pick('.ag-row[data-aid="throat"]')) { pick('.ag-row[data-aid="throat"]').click(); await sleep(300); }
    }

    // ⑥ 技能注释栏：点开可编辑，说明写进 state 并渲染到卡片
    const nb = pick('.skill-note-btn');
    out.noteBtnFound = !!nb;
    if (nb) {
      const sid = nb.dataset.noteToggle;
      nb.click(); await sleep(350);
      const box = pick('.skill[data-sid="' + sid + '"] .tx-edit');
      out.skillTxBox = !!box;
      const ta = box ? box.querySelector('[data-skill-note]') : null;
      if (ta) {
        ta.value = '测试说明';
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(250);
        out.skillNoteAfter = (window.GL.state.skills.find((s) => s.id === sid) || {}).note;
        const txt = pick('.skill[data-sid="' + sid + '"] .skill-note-txt');
        out.skillNoteDom = txt ? txt.textContent : null;
        const back = pick('.skill[data-sid="' + sid + '"] [data-skill-note]');
        if (back) {
          back.value = '';
          back.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(250);
        }
        out.skillNoteRestored = (window.GL.state.skills.find((s) => s.id === sid) || {}).note;
      }
    }

    return out;
  })()`);

  if (inter && !inter.__err) {
    check(inter.headFound === true, '交互：找到分组标题');
    check(inter.hBefore > 50, '交互：组内容默认展开', `高 ${inter.hBefore}px`);
    check(inter.hCollapsed < inter.hBefore, '交互：点标题可折叠（高度收缩）',
      `${inter.hBefore} → ${inter.hCollapsed}`);
    check(inter.shutFlag === true, '交互：折叠后带 .shut 类');
    check(inter.hBack > inter.hCollapsed, '交互：再点可展开', `恢复到 ${inter.hBack}px`);
    check(inter.rowFound === true, '交互：找到细刻度行');
    check(inter.tuneOpen === true, '交互：点行可展开微调条');
    check(inter.stepBtnFound === true, '交互：微调条里有步进按钮');
    check(Number(inter.v1) === Number(inter.v0) + 1, '交互：＋1 生效',
      `${inter.v0} → ${inter.v1}`);
    check(Number(inter.v2) === Number(inter.v0), '交互：−1 可还原', `${inter.v1} → ${inter.v2}`);
    check(inter.persisted === true, '交互：折叠状态写入 GL.state.ui（刷新后保持）');
    /* 极性文案方向 —— 负向/双向项不得出现夸奖式等级文案 */
    check(inter.noteNeg === '越低越好',
      '交互：负向项微调提示为「越低越好」（绝不出现「🔥 充沛」）', String(inter.noteNeg));
    check(inter.noteMid === '中间最好',
      '交互：双向项微调提示为「中间最好」', String(inter.noteMid));
    check(inter.notePos !== null && /充沛|良好|一般|低迷|糟糕/.test(String(inter.notePos)),
      '交互：正向项微调提示走等级文案（越高越好）', String(inter.notePos));
    /* 文字就地编辑 */
    check(inter.txBoxFound === true, '编辑：点开小项后有文字编辑区');
    check(inter.txFields === 3, '编辑：名称 / 小字 / 说明 三个字段', `实际 ${inter.txFields}`);
    check(inter.subAfter === '（测试小字）', '编辑：小字改动写入 state', String(inter.subAfter));
    check(inter.subDom === '（测试小字）', '编辑：行内小字就地同步（未整页重渲染）', String(inter.subDom));
    check(inter.inputStillConnected === true,
      '编辑：输入框未被重渲染替换（说明编辑时不会丢焦点）');
    check(inter.subRestored === inter.origSub, '编辑：还原后小字回到原文', String(inter.subRestored));
    /* 技能注释栏 */
    check(inter.noteBtnFound === true, '编辑：技能卡片有注释入口', String(inter.noteBtnFound));
    check(inter.skillTxBox === true, '编辑：点开技能注释后出现编辑区');
    check(inter.skillNoteAfter === '测试说明', '编辑：技能说明写入 state', String(inter.skillNoteAfter));
    check(inter.skillNoteDom === '测试说明', '编辑：技能说明即时渲染到卡片', String(inter.skillNoteDom));
    check(inter.skillNoteRestored === '', '编辑：清空后说明被移除', String(inter.skillNoteRestored));
  } else {
    check(false, '交互：测试脚本执行失败', inter && inter.__err ? String(inter.__err).slice(0, 120) : '未知');
  }

  /* ---------- 出图：展开的小项编辑区（v1.6.0 新组件，值得单独看一眼） ---------- */
  if (WANT_SHOT) {
    const rect = await ev(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const row = document.querySelector('.ag-row[data-aid="move"]');
      if (!row) return null;
      row.click(); await sleep(500);
      const wing = document.getElementById('wing-attrs');
      if (!wing) return null;
      const r = wing.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
    if (rect && rect.w > 100) {
      const s = await send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: Math.max(0, rect.x - 8), y: Math.max(0, rect.y - 8), width: rect.w + 16, height: rect.h + 16, scale: 2 },
      });
      const p = path.join(ROOT, 'tools', 'browser-shot-editor.png');
      fs.writeFileSync(p, Buffer.from(s.data, 'base64'));
      shotPaths.push(p);
      await ev(`(() => { const r = document.querySelector('.ag-row[data-aid="move"]'); if (r) r.click(); })()`);
    }
  }

  /* ---------- 手机视口（v1.7.0）：真机尺寸下布局与字体是否成立 ----------
     为什么必须单独测：桌面全绿不代表手机能用 —— 这一层测的是「视口变窄后那些媒体查询
     到底有没有生效」。用 CDP 把视口切成 iPhone 尺寸（390×844 / dpr 3 / mobile），
     验证底部标签栏、横向溢出、安全区留白、输入框字号，以及**字体是不是真的从本机加载**。
     最后一项是 v1.7.0 的核心改动，也是唯一能证明「已切断 Google Fonts」的硬证据。 */
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
  });
  await ev(`(() => { const b = document.querySelector('.tab[data-tab="hud"]'); if (b) b.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 700));

  const mob = await ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // 先展开一个小项，让文字编辑区出现，否则量不到输入框字号
    const row = document.querySelector('.ag-row[data-aid="throat"]');
    if (row) { row.click(); await sleep(500); }

    const side = document.querySelector('.side');
    const main = document.getElementById('main');
    const tabs = [...document.querySelectorAll('.tab')];
    const cs = side ? getComputedStyle(side) : null;
    const r = side ? side.getBoundingClientRect() : null;
    const brand = document.querySelector('.brand');
    const input = document.querySelector('.tx-edit input');

    // 字体地面真值：看实际发出的资源请求，而不是猜
    const res = performance.getEntriesByType('resource').map((e) => e.name);
    // 注意：这段代码是塞进模板字符串传给浏览器的，正则里的反斜杠必须写双份 \\
    // 否则会被这一层 JS 先吃掉（\. 变 .、\? 变 ?），到浏览器就成了 /.woff2($|?)/ 这种非法正则
    const fontReqs = res.filter((n) => /\\.woff2($|\\?)/.test(n));
    const googleReqs = res.filter((n) => /fonts\\.(googleapis|gstatic)\\.com/.test(n));
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }

    return {
      vw: window.innerWidth,
      sidePos: cs ? cs.position : null,
      sideGapBottom: r ? Math.round(window.innerHeight - r.bottom) : null,
      sideW: r ? Math.round(r.width) : null,
      tabCount: tabs.length,
      tabMinH: tabs.length ? Math.round(Math.min(...tabs.map((t) => t.getBoundingClientRect().height))) : -1,
      brandHidden: brand ? getComputedStyle(brand).display === 'none' : null,
      footHidden: (() => { const f = document.querySelector('.side-foot'); return f ? getComputedStyle(f).display === 'none' : null; })(),
      mainPadBottom: main ? Math.round(parseFloat(getComputedStyle(main).paddingBottom)) : null,
      scrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      docW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      inputFont: input ? parseFloat(getComputedStyle(input).fontSize) : null,
      fontReqs: fontReqs.length,
      googleReqs: googleReqs.length,
      fontSample: fontReqs.length ? String(fontReqs[0]).split('/').pop() : null,
      chakraOk: document.fonts ? document.fonts.check('500 14px "Chakra Petch"') : null,
      monoOk: document.fonts ? document.fonts.check('400 14px "JetBrains Mono"') : null,
      // 按「实际已加载的 FontFace 数」判断，不按具体字重：
      // 浏览器不会加载页面从未使用过的字重（Chakra Petch 500/600 就没被用到），
      // 所以 check('500 ...') 为 false 是正常的，用它做断言属于预期写错。
      chakraLoaded: document.fonts ? [...document.fonts].filter((f) => f.family.indexOf('Chakra Petch') >= 0 && f.status === 'loaded').length : -1,
      monoLoaded: document.fonts ? [...document.fonts].filter((f) => f.family.indexOf('JetBrains Mono') >= 0 && f.status === 'loaded').length : -1,
    };
  })()`);

  if (mob && !mob.__err) {
    check(mob.sidePos === 'fixed',
      '手机：侧栏变为固定定位的底部标签栏', `position: ${mob.sidePos}`);
    check(mob.sideGapBottom !== null && mob.sideGapBottom >= 8 && mob.sideGapBottom <= 24,
      '手机：标签栏贴底悬浮（含安全区留白）', `距底 ${mob.sideGapBottom}px`);
    check(mob.sideW !== null && mob.sideW >= mob.vw - 32,
      '手机：标签栏横向铺开，不是窄条', `${mob.sideW}px / 视口 ${mob.vw}px`);
    check(mob.tabCount === 4, '手机：4 个页签全部保留', `实际 ${mob.tabCount}`);
    check(mob.tabMinH >= 44,
      '手机：页签触摸目标 ≥ 44px（手指点得中）', `最矮 ${mob.tabMinH}px`);
    check(mob.brandHidden === true && mob.footHidden === true,
      '手机：品牌区与页脚隐藏，不占标签栏空间');
    check(mob.mainPadBottom !== null && mob.mainPadBottom >= 112,
      '手机：主区底部留白够高，最后一屏不会被悬浮栏压住', `padding-bottom ${mob.mainPadBottom}px`);
    check(mob.scrollX === false,
      '手机：无横向溢出（不出现左右拖动）', `内容 ${mob.docW}px / 视口 ${mob.clientW}px`);
    check(mob.inputFont !== null && mob.inputFont >= 16,
      '手机：输入框字号 ≥ 16px（否则 iOS 聚焦时会自动放大整页）', `${mob.inputFont}px`);

    /* 字体：唯一能证明「已切断 Google Fonts 且真正离线可用」的硬证据 */
    check(mob.fontReqs > 0,
      '字体：从本机加载了 woff2（不是系统回退字体）',
      `${mob.fontReqs} 个请求，如 ${mob.fontSample}`);
    check(mob.googleReqs === 0,
      '字体：没有任何 Google Fonts 请求（国内可达性 + 首屏不阻塞）',
      `外部字体请求 ${mob.googleReqs} 个`);
    check(mob.chakraLoaded > 0 && mob.monoLoaded > 0,
      '字体：两款自托管字体均已实际加载（不是系统回退字体）',
      `Chakra Petch ${mob.chakraLoaded} 个字重 / JetBrains Mono ${mob.monoLoaded} 个`);
  } else {
    check(false, '手机视口：测量失败', mob && mob.__err ? String(mob.__err) : '未知');
  }

  /* 手机尺寸截图：三个主页面各出一张，直观看窄屏布局。
     切页要留足时间 —— 生命页的 canvas 是切过去那一刻才绘制的。 */
  if (WANT_SHOT) {
    for (const [tab, name] of [['hud', 'mobile'], ['skills', 'mobile-skills'], ['life', 'mobile-life']]) {
      await ev(`(() => { window.scrollTo(0, 0); const b = document.querySelector('.tab[data-tab="${tab}"]'); if (b) b.click(); return true; })()`);
      await new Promise((r) => setTimeout(r, tab === 'hud' ? 200 : 900));
      try {
        const s = await send('Page.captureScreenshot', {
          format: 'png',
          clip: { x: 0, y: 0, width: 390, height: 844, scale: 1 },
        });
        const p = path.join(ROOT, 'tools', 'browser-shot-' + name + '.png');
        fs.writeFileSync(p, Buffer.from(s.data, 'base64'));
        shotPaths.push(p);
      } catch (e) { /* 截图失败不影响断言结果 */ }
    }
  }

  // 收尾：先切回总览页，收起展开的编辑区，再恢复桌面视口
  await ev(`(() => { window.scrollTo(0, 0); const b = document.querySelector('.tab[data-tab="hud"]'); if (b) b.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 400));
  await ev(`(() => { const r = document.querySelector('.ag-row[data-aid="throat"]'); if (r) r.click(); return true; })()`);
  await send('Emulation.clearDeviceMetricsOverride');
  await new Promise((r) => setTimeout(r, 300));

  /* ---------- 汇总 ---------- */
  console.log('=== 浏览器冒烟测试 ===\n');
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.label}${r.detail ? '（' + r.detail + '）' : ''}`);
  }
  if (pageErrors.length) {
    console.log('\n--- 运行时错误明细 ---');
    [...new Set(pageErrors)].slice(0, 10).forEach((e) => console.log('  ' + e));
  }
  /* 面板明细：不是断言，是给人眼看一眼文案/数值合不合理的地面真值 */
  if (grid && !grid.__err) {
    console.log('\n生命刻度：' + grid.canvasW + 'px 网格 / ' + grid.wrapW + 'px 容器'
      + '  · 位图 ' + grid.bitmapW + 'px @dpr' + grid.dpr
      + '  · 行内宽度 ' + (grid.inlineW || '（无）'));
  }
  if (mob && !mob.__err) {
    console.log('\n手机视口（390×844 @dpr3）：标签栏 ' + mob.sidePos
      + ' · 距底 ' + mob.sideGapBottom + 'px · 宽 ' + mob.sideW + 'px'
      + ' · 页签 ' + mob.tabCount + ' 个（最矮 ' + mob.tabMinH + 'px）'
      + ' · 主区底部留白 ' + mob.mainPadBottom + 'px'
      + ' · 输入框 ' + mob.inputFont + 'px');
    console.log('字体请求：本机 woff2 ' + mob.fontReqs + ' 个 · Google Fonts ' + mob.googleReqs + ' 个'
      + ' · 已加载字重 Chakra Petch ' + mob.chakraLoaded + ' / JetBrains Mono ' + mob.monoLoaded);
  }
  if (Array.isArray(S.attrDump) && S.attrDump.length) {
    console.log('\n属性面板明细（[-] 负向 / [~] 双向）：');
    S.attrDump.forEach((l) => console.log('  ' + l));
  }
  if (shotPaths.length) {
    console.log('\n截图：');
    shotPaths.forEach((p) => console.log('  ' + path.relative(ROOT, p)));
  }
  const bad = results.filter((r) => !r.ok);
  console.log('\n' + (bad.length ? `✗ 未通过（${bad.length}/${results.length}）` : `✅ 全部通过（${results.length} 项）`));

  ws.close(); child.kill(); srv.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('browser-check 失败：', e); process.exit(1); });
