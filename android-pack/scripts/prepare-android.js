#!/usr/bin/env node
'use strict';
/* 把 Capacitor 从模板生成的安卓工程，改造成 Game Life 的壳。

   为什么需要这一步：
   `npx cap add android` 每次都是从官方模板**重新生成**的（android/ 不入库 —— 否则
   仓库里躺着整个 Gradle 工程，且每次升级 Capacitor 都会产生巨大 diff）。
   所以任何定制都不能"手动改一次就算完"：下次重建就全丢了。
   凡是需要长期存在的改动，都必须落在本脚本里，让它可重放。

   做的事情：
   ① 版本号从 js/app.js 的 APP_VERSION 派生 —— 单一真值，不手写两份
   ② 把 res/ 整棵镜像覆盖进原生工程（启动器图标 + 自适应图标前景层 + 11 张启动画面 + 背景色）
   ③ 尺寸自检：覆盖的 PNG 若与模板原图尺寸不符，直接失败 —— 启动器缩放比例错了很难看出来
*/

const fs = require('fs');
const path = require('path');

const PACK = path.resolve(__dirname, '..');
const REPO = path.resolve(PACK, '..');
const ANDROID = path.join(PACK, 'android');
const APP_RES = path.join(ANDROID, 'app', 'src', 'main', 'res');
const SRC_RES = path.join(PACK, 'res');
const BAR = '─'.repeat(58);

const fail = (m) => { console.error('\n✗ ' + m); process.exit(1); };
const ok = (m) => console.log('  ✓ ' + m);

/* 只读 PNG 头判尺寸，不引入任何图像库（CI 上也不装） */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p));
  }
  return out;
}

console.log(`\n准备安卓工程\n${BAR}`);

if (!fs.existsSync(APP_RES)) fail('找不到原生工程。先跑 `npx cap add android`。');
if (!fs.existsSync(SRC_RES)) fail('找不到 res/ 源目录。');

/* ---------- ① 版本号：单一真值 ---------- */
const appJs = fs.readFileSync(path.join(REPO, 'js', 'app.js'), 'utf8');
const vm = appJs.match(/APP_VERSION\s*=\s*'(\d+)\.(\d+)\.(\d+)'/);
if (!vm) fail('读不到 js/app.js 里的 APP_VERSION（形如 1.7.1）');
const version = `${vm[1]}.${vm[2]}.${vm[3]}`;
const versionCode = Number(vm[1]) * 10000 + Number(vm[2]) * 100 + Number(vm[3]);

const gradlePath = path.join(ANDROID, 'app', 'build.gradle');
let gradle = fs.readFileSync(gradlePath, 'utf8');
if (!/versionCode\s+\d+/.test(gradle) || !/versionName\s+"[^"]*"/.test(gradle)) {
  fail('app/build.gradle 里找不到 versionCode / versionName，模板结构可能变了');
}
const before = gradle;
gradle = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
if (gradle !== before) fs.writeFileSync(gradlePath, gradle);
console.log(`  ① 版本号    ${version} / versionCode ${versionCode}（由 APP_VERSION 派生）`);

/* ---------- ② 镜像覆盖 res/ ---------- */
const files = walk(SRC_RES);
const sizeMismatch = [];
for (const rel of files) {
  const src = path.join(SRC_RES, rel);
  const dst = path.join(APP_RES, rel);

  if (rel.toLowerCase().endsWith('.png') && fs.existsSync(dst)) {
    const a = pngSize(fs.readFileSync(dst));
    const b = pngSize(fs.readFileSync(src));
    if (a && b && (a.w !== b.w || a.h !== b.h)) {
      sizeMismatch.push(`${rel.padEnd(52)} 模板 ${a.w}x${a.h} → 本次 ${b.w}x${b.h}`);
    }
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
if (sizeMismatch.length) {
  fail('以下图片尺寸与模板原图不一致（启动器缩放比例会错，且很难从截图上发现）：\n   ' +
    sizeMismatch.join('\n   '));
}

/* 复制后逐个复查，避免"报告成功但文件没落地" */
const missing = files.filter((rel) => !fs.existsSync(path.join(APP_RES, rel)));
if (missing.length) fail('复制后仍缺失：' + missing.join(', '));

const byKind = {};
for (const rel of files) {
  const k = rel.includes('mipmap') ? '启动器图标与前景层'
    : rel.includes('splash') ? '启动画面'
    : '其他资源';
  byKind[k] = (byKind[k] || 0) + 1;
}
console.log(`  ② 资源覆盖  ${files.length} 个文件`);
for (const [k, v] of Object.entries(byKind)) console.log(`       ${k.padEnd(12)} ${v} 个`);

/* ---------- ③ 结果自检 ---------- */
const mf = fs.readFileSync(path.join(ANDROID, 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
if (!/android:icon="@mipmap\/ic_launcher"/.test(mf)) fail('AndroidManifest 没引用 @mipmap/ic_launcher');
if (!/android:roundIcon="@mipmap\/ic_launcher_round"/.test(mf)) fail('AndroidManifest 没引用 @mipmap/ic_launcher_round');

const wwwDir = path.join(PACK, 'www');
const webFiles = fs.existsSync(wwwDir) ? walk(wwwDir).length : 0;
if (!webFiles) fail('www/ 是空的 —— 页面资源没同步进来，装上去会是白屏');
const inj = (fs.readFileSync(path.join(wwwDir, 'index.html'), 'utf8').match(/data-page-node-id/g) || []).length;
if (inj) fail(`www/index.html 带编辑器注入 ${inj} 处 —— 会随 APK 分发出去`);

console.log(`  ③ 网页资源  ${webFiles} 个文件，index.html 注入 0 处`);
console.log(`${BAR}\n  工程就绪：android/ 可以开始构建\n`);
