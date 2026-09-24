/* ============================================================
   生成可部署的纯净站点目录 dist/
   ------------------------------------------------------------
   跑法：node tools/build-dist.js

   为什么需要它：
   仓库里除了运行时资源，还有 tools/（校验脚本 + 十几张调试截图）、README.md、.git。
   把这些直接拖上托管平台有两个坏处：
     ① 调试截图与源码会一起暴露在公网 URL 下；
     ② .git 目录体积白传（托管平台不需要它）。
   dist/ 只含运行时资源。

   清单以 sw.js 的 ASSETS 作为**唯一真值**：
   这样「Service Worker 能离线缓存的文件集」与「部署上去的文件集」永远是同一份，
   不会出现「线上有、离线没有」或「缓存清单里写了、线上 404」的错位。
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

/* ---------- 1. 从 sw.js 读权威资源清单 ---------- */
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const assetsBlock = (sw.split('const ASSETS = [')[1] || '').split('];')[0];
const rawAssets = [...assetsBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);

/* ---------- 0. 硬闸：源文件带编辑器注入时拒绝构建 ----------
   编辑器/预览工具会往 index.html 持续注入 data-page-node-id="..."。
   构建是可重复的，但这些注入一旦被拷进 dist/ 就会**随部署公开到公网 URL 上**，
   属于往线上泄漏开发工具内部标记。宁可不构建，也不发一份带注入的产物。 */
const htmlRaw = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const injected = (htmlRaw.match(/data-page-node-id/g) || []).length;
if (injected) {
  console.error(`❌ index.html 含 ${injected} 处编辑器注入（data-page-node-id），拒绝构建。`);
  console.error('   这些标记会随部署公开泄露。先清理再构建：');
  console.error('     node tools/patch-index-mobile.js');
  process.exit(1);
}

// './' 表示根路径，实际内容就是 index.html
const files = rawAssets.map((u) => (u === './' ? 'index.html' : u.replace(/^\.\//, '')));

/* ---------- 1b. 只被 JS 字符串引用、因而不在 ASSETS 里的文件 ----------
   踩过的坑（本脚本第一版就漏了）：
   Service Worker **不会把自己写进 ASSETS**（自己缓存自己没意义），
   于是「以 ASSETS 为唯一真值」导致 sw.js 根本没被拷进 dist。
   线上表现极具欺骗性 —— 页面照常打开、数据照常保存，只是**静默失去离线能力**；
   而且 app.js 里是 `register('sw.js').catch(() => {})`，失败被吞掉，连控制台都不闹。
   最后由 headless 校验报 "bad HTTP response code (404) fetching the script" 才暴露。
   => 凡是被 JS 字符串引用的资源，一律纳入产物清单。 */
const JS_REF_RE = /['"]([A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:png|jpe?g|svg|webp|woff2?|json|webmanifest|js|css|mp3|wav|ogg))['"]/g;
const jsRefs = new Set();
for (const rel of [...files]) {
  if (!rel.startsWith('js/') || !fs.existsSync(path.join(ROOT, rel))) continue;
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const m of src.matchAll(JS_REF_RE)) jsRefs.add(m[1].replace(/^\.\//, ''));
}
for (const rel of jsRefs) if (!files.includes(rel)) files.push(rel);

const uniq = [...new Set(files)];

/* ---------- 2. 清空并重建 dist/ ---------- */
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

let bytes = 0;
const missing = [];
for (const rel of uniq) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) { missing.push(rel); continue; }
  const dst = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  bytes += fs.statSync(src).size;
}

/* ---------- 3. 托管平台配置文件 ---------- */
// .nojekyll：GitHub Pages 会跑 Jekyll，它会忽略下划线开头的文件；
// 虽然本项目没有这类文件，但这个文件是零成本的保险（同时替代 _headers 被吞的风险）。
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

// _headers：Cloudflare Pages / Netlify 支持。核心是 sw.js 与 index.html 必须立即回源校验，
// 否则用户被旧 SW 或旧 HTML 钉住，"我明明修好了他打开还是坏的"。
// (GitHub Pages 与 EdgeOne Pages 会忽略该文件，留着无害)
fs.writeFileSync(path.join(DIST, '_headers'), [
  '/*.woff2',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
  '/icon-*.png',
  '  Cache-Control: public, max-age=604800',
  '',
  '/apple-touch-icon.png',
  '  Cache-Control: public, max-age=604800',
  '',
  '/sw.js',
  '  Cache-Control: no-cache',
  '',
  '/index.html',
  '  Cache-Control: no-cache',
  '',
  '/*',
  '  X-Content-Type-Options: nosniff',
  ''
].join('\n'));

// _redirects：所有未知路径回落 index.html（本项目是单页，多了也不会错）
fs.writeFileSync(path.join(DIST, '_redirects'), '/*  /index.html  404\n');

/* ---------- 4. 自检：dist 必须自给自足 ---------- */
const problems = [];

// 4a. sw.js ASSETS 里的文件都得真的进了 dist
for (const rel of uniq) if (!fs.existsSync(path.join(DIST, rel))) problems.push(`dist 缺少 sw.js ASSETS 里的 ${rel}`);

// 4b. index.html / css / js 引用的本地资源都得在 dist 里
//     这是最关键的一层：仓库里存在 ≠ 部署后存在（很容易漏拷某个目录）
const scan = [];
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
scan.push(['index.html', html]);
for (const rel of uniq) {
  if (/\.(css|js)$/.test(rel)) scan.push([rel, fs.readFileSync(path.join(DIST, rel), 'utf8')]);
}
const refRe = /(?:href|src)="((?!https?:|data:|#)[^"]+)"|url\(\s*['"]?((?!https?:|data:)[^'")]+)['"]?\s*\)/g;
let dataUris = 0;
for (const [who, text] of scan) {
  for (const m of text.matchAll(refRe)) {
    const u = m[1] || m[2];
    if (!u) continue;
    // 内联 data URI（如 .grain 的 SVG 噪点）不产生外部依赖，跳过。
    // 但**必须计数**：这里的父子嵌套极易误报 —— 该 data URI 内部还有一层
    // filter='url(%23n)'，正则会把内层当成本地文件引用（v1.7.x 构建时踩过）。
    // 静默跳过就等于放走真实缺失，所以只放行「纯路径字符」，其余一律计入 payload。
    if (u.startsWith('data:')) { dataUris++; continue; }
    const clean = u.split(/[?#]/)[0].replace(/^\.\//, '');
    if (!clean) continue;
    if (!/^[A-Za-z0-9_@.\/-]+$/.test(clean)) { dataUris++; continue; }
    if (!fs.existsSync(path.join(DIST, clean))) problems.push(`${who} 引用了 dist 里不存在的 ${u}`);
  }
}

// 4c. 不得混入开发产物
for (const junk of ['tools', 'README.md', '.git']) {
  if (fs.existsSync(path.join(DIST, junk))) problems.push(`dist 混入了开发产物：${junk}`);
}

// 4d. 零跨域引用（断网可用的前提）
const cross = [...html.matchAll(/(?:href|src)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
if (cross.length) problems.push(`index.html 仍有跨域引用（会被墙 / 断网即挂）：${cross.join(', ')}`);

// 4e. 离线能力守卫：sw.js 必须在产物里，且版本号与仓库一致
//     这一条是「页面能开但离线全废」的直接防线，必须显式断言，不能靠肉眼
if (!fs.existsSync(path.join(DIST, 'sw.js'))) {
  problems.push('dist 里没有 sw.js —— 页面照常打开但会**静默失去离线能力**（第一版构建脚本就漏了它）');
} else {
  const dv = (fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8').match(/gamelife-v(\d+)/) || [])[1];
  const rv = (sw.match(/gamelife-v(\d+)/) || [])[1];
  if (dv !== rv) problems.push(`dist/sw.js 缓存版本 v${dv} 与仓库 v${rv} 不一致（产物是旧的）`);
}

/* ---------- 5. 报告 ---------- */
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('  dist/ 文件清单');
for (const rel of uniq) {
  const p = path.join(DIST, rel);
  if (fs.existsSync(p)) console.log(`    ${kb(fs.statSync(p).size).padStart(9)}  ${rel}`);
}
for (const f of ['.nojekyll', '_headers', '_redirects']) {
  console.log(`    ${String((fs.statSync(path.join(DIST, f)).size) + ' B').padStart(9)}  ${f}`);
}
console.log(`\n  合计 ${uniq.length} 个运行时文件，${kb(bytes)}`);
console.log(`  输出目录：${DIST}`);
console.log(`  已扫描并跳过的内联 data URI：${dataUris} 处（不产生外部依赖）`);
if (jsRefs.size) console.log(`  由 JS 字符串引用而额外纳入：${[...jsRefs].join(', ')}`);

if (missing.length) console.log(`\n  ✗ 仓库里就缺这些文件：${missing.join(', ')}`);
if (problems.length) {
  console.log('');
  problems.forEach((s) => console.log('  ✗ ' + s));
  console.log(`\n❌ 构建产物自检未通过（${problems.length} 处）`);
  process.exit(1);
}
console.log(`\n✅ dist/ 自给自足：清单齐全、引用全部落盘、无跨域依赖、无开发产物`);

/* ---------- 可选：同步到「发布目录」----------
   内置托管（workbuddy_sites_deploy）会把名为 dist 的目录当作构建产物排除 ——
   实测直接发布 dist 得到的是空站点。所以发布要用另一个名字的目录，
   用 --mirror=<绝对路径> 一次完成，免得手抄漏文件，更免得发布一份陈旧产物。
   只在上面自检全部通过后才执行：绝不把不合格的产物镜像出去。 */
const mirrorArg = (process.argv.find((a) => a.startsWith('--mirror=')) || '').slice(9);
if (mirrorArg) {
  const target = path.resolve(mirrorArg);
  const refuse =
    !mirrorArg.trim() || target === DIST || target === ROOT ||
    ROOT.startsWith(target + path.sep);
  if (refuse) {
    console.log(`\n  ✗ --mirror 目标不合法（不能是 dist/ 本身、仓库根、或仓库的上级目录）：${target}`);
    process.exit(1);
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(DIST, target, { recursive: true });
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
    .reduce((a, e) => a + (e.isDirectory() ? walk(path.join(d, e.name)) : 1), 0);
  const n = walk(target);
  const inj = (fs.readFileSync(path.join(target, 'index.html'), 'utf8').match(/data-page-node-id/g) || []).length;
  console.log(`\n  ✅ 已同步到发布目录：${target}`);
  console.log(`     ${n} 个文件 · index.html 注入 ${inj} 处${inj ? '（异常！）' : ''}`);
  console.log('     发布方式：把该目录交给内置托管（别直接发布 dist/，会被当构建产物排除）');
}
