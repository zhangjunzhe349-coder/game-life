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
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT)) { res.writeHead(403).end(); return; }
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
  check(S.dataVersion === 2, '数据版本为 v2（迁移已完成）', `实际 v${S.dataVersion}`);
  check(S.attrGroups === 3, '属性面板渲染 3 个分组', `实际 ${S.attrGroups} —— 为 0 说明属性面板没渲染`);
  check(S.attrRows === 14, '属性面板渲染 14 行细刻度', `实际 ${S.attrRows}`);
  check(S.attrNegGroups === 1, '熵值组带负向标记（.ag.neg）', `实际 ${S.attrNegGroups}`);
  check(S.attrNegRows === 4, '负向行 4 个（熵值3 + 困倦度）', `实际 ${S.attrNegRows}`);
  check(S.attrMidRows === 2, '双向行 2 个（社交度、稳定度）', `实际 ${S.attrMidRows}`);
  check(S.attrHasSub >= 8, '副标题已渲染（.ag-sub）', `实际 ${S.attrHasSub}`);
  check(S.overall !== null && S.overall > 0, 'GL.overallScore() 可用', `实际 ${S.overall}`);
  check(S.skillGroups === 5, '技能页渲染 5 个分组', `实际 ${S.skillGroups} —— 注意技能在独立 tab，需确认已渲染`);
  check(S.skillCards === 13, '技能卡片 13 张', `实际 ${S.skillCards}`);

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

  /* ---------- 交互测试：折叠 + 微调（v1.5.0 新组件，必须真点一遍） ---------- */
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
  } else {
    check(false, '交互：测试脚本执行失败', inter && inter.__err ? String(inter.__err).slice(0, 120) : '未知');
  }

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
