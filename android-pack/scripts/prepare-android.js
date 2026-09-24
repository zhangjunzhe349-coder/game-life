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

const SIGNING = [
  '    signingConfigs {',
  '        // 固定签名。不固定的话，每次构建签名都不同，升级安装会被系统以「签名不符」',
  '        // 拒绝，而唯一的绕过方式是先卸载 —— 那会把 App 内的数据一起清掉。',
  '        // 密钥本身不入库，由 CI 从仓库 Secret 恢复到下面这个路径。',
  '        // 刻意放在 android-pack/keystore/ 而不是 ~/.android/：后者依赖 Gradle 对',
  '        // user.home 的推断，实测在 CI 上推断不到，会静默退回自动生成的临时签名',
  '        // （产物看着完全正常，只有对比证书指纹才发现不是同一把）。',
  '        debug {',
  "            storeFile file('../../keystore/debug.keystore')",
  "            storePassword 'android'",
  "            keyAlias 'androiddebugkey'",
  "            keyPassword 'android'",
  '        }',
  '    }',
  '',
].join('\n');

let changed = false;
const v1 = gradle;
gradle = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
if (gradle !== v1) changed = true;

if (!gradle.includes("storeFile file('../../keystore/debug.keystore')")) {
  const anchor = '    buildTypes {';
  if (!gradle.includes(anchor)) fail('app/build.gradle 里找不到 buildTypes 块，模板结构可能变了');
  gradle = gradle.replace(anchor, SIGNING + anchor);
  changed = true;
}
if (changed) fs.writeFileSync(gradlePath, gradle);

console.log(`  ① 版本号    ${version} / versionCode ${versionCode}（由 APP_VERSION 派生）`);
if (!gradle.includes('signingConfigs')) fail('签名配置没注入成功');
console.log('  ①b 签名     signingConfigs.debug → android-pack/keystore/debug.keystore（显式指定，不靠约定）');

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

/* ---------- ③b 启动器图标：把「一圈黑」和「一片白」这两次实机返工钉死 ----------
   两个都是**从源代码、从截图、从静态检查都看不出来**的问题（改的确实是图标文件，
   但系统怎么合成这两层才算数）。所以断言必须落在「合成规则」上，而不是「文件存在」。 */
{
  const bgPath = path.join(APP_RES, 'values', 'ic_launcher_background.xml');
  const bg = fs.readFileSync(bgPath, 'utf8');
  /* ① 背景层的纯色兜底不能是近黑 —— 系统遮罩裁圆后，圆内近黑 + 中间紫
       看起来就是「紫块外面套一圈黑边」。
       ⚠ 必须**读颜色值**再判，不能在文件里 grep `#08090d`：那个字符串会出现在
       注释里（写明「模板原值是 #08090d」），grep 会把注释当成实际取值 → 假失败。
       第一次用 CI 跑就栽在这上面（步骤 10 直接失败）。凡是断言，就要断在取值上。 */
  const bgM = bg.match(/<color name="ic_launcher_background">#([0-9A-Fa-f]{6})<\/color>/);
  if (!bgM) fail('读不到 ic_launcher_background 的颜色值 —— 模板结构变了，这条断言已失去意义，需要重写');
  const hex = bgM[1].toLowerCase();
  const lum = parseInt(hex.slice(0, 2), 16) + parseInt(hex.slice(2, 4), 16) + parseInt(hex.slice(4, 6), 16);
  if (lum < 150) fail(`自适应图标背景层是近黑 #${hex}（三通道和 ${lum} < 150）—— 启动器遮罩下会露出一圈黑边（模板原值就是 #08090d）`);
  /* ② 两处 anydpi XML 必须「背景层接紫色渐变 + 前景层接图标前景」。
       接错了（例如前景层指到 legacy 方图）就会把背景整块盖住。 */
  for (const f of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    const x = fs.readFileSync(path.join(APP_RES, 'mipmap-anydpi-v26', f), 'utf8');
    if (!/android:drawable="@drawable\/ic_launcher_background"/.test(x)) fail(`${f} 的背景层没指向紫色渐变 drawable`);
    if (!/android:drawable="@mipmap\/ic_launcher_foreground"/.test(x)) fail(`${f} 的前景层没指向 ic_launcher_foreground`);
  }
  /* ③ 前景层必须是**真透明**（PNG colorType=6）。
       它是要叠在背景层上的；一张带底色的不透明方图会把背景整块盖住 ——
       v1.7.4 就是这样从「紫」变成「一片白」的（无头浏览器默认白底被一起截了进去）。 */
  let fgChecked = 0;
  for (const d of fs.readdirSync(APP_RES).filter((n) => /^mipmap-/.test(n))) {
    const p = path.join(APP_RES, d, 'ic_launcher_foreground.png');
    if (!fs.existsSync(p)) continue;
    const ct = fs.readFileSync(p)[25];          // IHDR 里的 colorType
    if (ct !== 6) fail(`${d}/ic_launcher_foreground.png 没有 alpha 通道（colorType=${ct}）—— 前景层必须透明`);
    fgChecked++;
  }
  if (!fgChecked) fail('没有检查到任何 ic_launcher_foreground.png —— 镜像里前景层不见了');
  console.log(`  ③b 启动器图标  背景层紫色、前景层透明（${fgChecked} 个密度）`);
}

const wwwDir = path.join(PACK, 'www');
const webFiles = fs.existsSync(wwwDir) ? walk(wwwDir).length : 0;
if (!webFiles) fail('www/ 是空的 —— 页面资源没同步进来，装上去会是白屏');
const inj = (fs.readFileSync(path.join(wwwDir, 'index.html'), 'utf8').match(/data-page-node-id/g) || []).length;
if (inj) fail(`www/index.html 带编辑器注入 ${inj} 处 —— 会随 APK 分发出去`);

console.log(`  ③ 网页资源  ${webFiles} 个文件，index.html 注入 0 处`);
console.log(`${BAR}\n  工程就绪：android/ 可以开始构建\n`);
