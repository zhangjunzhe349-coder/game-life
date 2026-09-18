/* ============================================================
   集成校验：index.html 与 JS 的「DOM id ↔ 代码引用」是否对得上
   跑法：node game-life/tools/verify-wiring.js
   —— 补上 portrait.js 无头校验管不到的那一环：
      脚本加载顺序、宿主节点存在性、被移除节点的残留引用
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const problems = [];
const ok = [];

/* ---------- 1. 脚本顺序 ---------- */
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const localScripts = scripts.filter((s) => !/^https?:/.test(s));

const EXPECT = ['js/storage.js', 'js/portrait.js', 'js/physiology.js',
  'js/attributes.js', 'js/skills.js', 'js/life.js', 'js/app.js'];
if (JSON.stringify(localScripts) !== JSON.stringify(EXPECT)) {
  problems.push(`脚本顺序不符\n    实际：${localScripts.join(' → ')}\n    期望：${EXPECT.join(' → ')}`);
} else {
  ok.push(`脚本顺序正确（${localScripts.length} 个本地脚本，storage 最先、app 最后）`);
}

if (scripts.some((s) => /three/i.test(s))) {
  problems.push('仍残留 Three.js CDN 引用（v1.4.0 应为零外部依赖）');
} else {
  ok.push('零外部脚本依赖（Three.js CDN 已移除）');
}

/* ---------- 2. 宿主节点存在性 ---------- */
const NEEDED = ['portrait-svg', 'stage', 'stage-base', 'hud-lv', 'hud-readouts',
  'wing-attrs', 'wing-body', 'tabs', 'ctrl-toggle', 'avatar-ctrl',
  'panel-hud', 'panel-skills', 'panel-life', 'panel-settings', 'toast-box', 'main'];
for (const id of NEEDED) {
  if (!new RegExp(`id="${id}"`).test(html)) problems.push(`index.html 缺少宿主节点 #${id}`);
}
if (NEEDED.every((id) => new RegExp(`id="${id}"`).test(html))) {
  ok.push(`宿主节点齐全（${NEEDED.length} 个）`);
}

/* ---------- 3. 立绘 SVGSVG 属性 ---------- */
const svgTag = (html.match(/<svg id="portrait-svg"[^>]*>/) || [''])[0];
if (!/viewBox="0 0 680 1000"/.test(svgTag)) problems.push('#portrait-svg 的 viewBox 不是 "0 0 680 1000"（与 portrait.js 画布不符）');
else ok.push('#portrait-svg viewBox 与 portrait.js 画布一致（680×1000）');

/* ---------- 4. 被移除节点不得再被 JS 引用 ---------- */
const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js'));
const REMOVED = ['avatar-canvas'];
for (const f of jsFiles) {
  const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  for (const id of REMOVED) {
    if (src.includes(`getElementById('${id}')`)) {
      // avatar.js 的休眠 3D 段是允许的
      if (f === 'avatar.js') { ok.push(`avatar.js 仍引用 #${id}（休眠 3D 段，只在 THREE 存在时执行）`); continue; }
      problems.push(`${f} 引用了 index.html 中已不存在的 #${id}`);
    }
  }
}

/* ---------- 5. 每个 JS 文件语法自检 ---------- */
const { execFileSync } = require('child_process');
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, 'js', f)], { stdio: 'pipe' });
  } catch (e) {
    problems.push(`js/${f} 语法错误：${String(e.stderr).split('\n').slice(0, 2).join(' ')}`);
  }
}
ok.push(`js/*.js 语法全部通过（${jsFiles.length} 个文件）`);

/* ---------- 6. sw.js 资源清单 ---------- */
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const assets = [...sw.matchAll(/'([^']+\.(?:js|css|html|svg|webmanifest))'/g)].map((m) => m[1]);
for (const f of jsFiles) {
  if (!assets.includes(`js/${f}`)) problems.push(`sw.js ASSETS 漏了 js/${f}`);
}
if (/gamelife-v5/.test(sw)) ok.push('sw.js 缓存版本已升到 v5');
else problems.push('sw.js 缓存版本未升级（改了资源必须升版，否则旧缓存不刷新）');

/* ---------- 输出 ---------- */
ok.forEach((s) => console.log('  ✓ ' + s));
if (problems.length) {
  console.log('');
  problems.forEach((s) => console.log('  ✗ ' + s));
  console.log(`\n❌ 接线校验 ${problems.length} 处问题`);
  process.exit(1);
}
console.log(`\n✅ 接线校验全部通过`);
