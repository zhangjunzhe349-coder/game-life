/* ============================================================
   图标生成：从同一套 SVG 源图，渲染出 Web 与安卓两边的全部图标
   ------------------------------------------------------------
   为什么需要这一步：
   ① iOS 的 apple-touch-icon **不认 SVG** —— Safari 会退化成白块或网页截图；
   ② 安卓各版本对 SVG 图标的支持不一致，可能直接让「添加到主屏幕」不可用；
   ③ maskable / 自适应图标要求内容落在中心安全区内，直接拿原图会被系统裁掉边缘。

   为什么 Web 和安卓放在同一个脚本里：
   图标只有**一份设计**，两边必须永远一致 —— 分成两个脚本迟早会漂移
   （改了一边忘了另一边，而且从界面上很难看出）。
   跑法：node tools/gen-icons.js
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ANDROID_RES = path.join(ROOT, 'android-pack', 'res');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-icon-'));

/* ---------- 唯一的一份图形定义 ---------- */
const BOLT = '296,64 152,288 240,288 216,448 376,208 280,208';
const GRADIENT = `  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5b4df0"/>
      <stop offset="1" stop-color="#8f7bff"/>
    </linearGradient>
  </defs>`;

/* 圆角版 —— Web 的 purpose:any。系统不会二次裁切，自己带圆角更精致。
   ⚠ 这里**只有一种颜色**：早先外面还套了一圈 #0d0f1a 近黑描边，
   在本机看着像精致的深色边框，到了手机启动器的遮罩下就变成一圈显眼的「黑边」。 */
const SVG_ROUNDED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
${GRADIENT}
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <polygon points="${BOLT}" fill="#0d0f1a"/>
</svg>`;

/* 满铺版 —— maskable / 安卓 legacy / apple-touch。
   底色必须铺满整块且不能再有第二种颜色：系统会按自己的形状裁切，
   底色与内容之间一旦夹了别的颜色，裁完就是一圈边。 */
const SVG_FULL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
${GRADIENT}
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="translate(256,256) scale(0.66) translate(-256,-256)">
    <polygon points="${BOLT}" fill="#0d0f1a"/>
  </g>
</svg>`;

/* 圆形版 —— 安卓 legacy round（圆形启动器直接用这张） */
const SVG_CIRCLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
${GRADIENT}
  <circle cx="256" cy="256" r="256" fill="url(#bg)"/>
  <g transform="translate(256,256) scale(0.6) translate(-256,-256)">
    <polygon points="${BOLT}" fill="#0d0f1a"/>
  </g>
</svg>`;

/* 前景层 —— 自适应图标（Android 8+）。**必须透明**：
   底色由 background 层提供，前景只画闪电；内容收进中心安全区（108dp 里 72dp 直径）。
   闪电原始高度占 512 的 75%，缩到 0.8 → 占 60%，落在安全区内。 */
const SVG_FOREGROUND = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <g transform="translate(256,256) scale(0.8) translate(-256,-256)">
    <polygon points="${BOLT}" fill="#0d0f1a"/>
  </g>
</svg>`;

function writeSvg(name, content) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

function findBrowser() {
  const cands = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error('未找到 Chrome / Edge，无法生成图标');
}

/* 用无头浏览器把 SVG 渲染成 size×size 的 PNG。
   ------------------------------------------------------------
   三个坑，都踩过：
   ① 相对路径的 --screenshot 不落在当前目录，而是浏览器自己的工作目录 —— 必须传绝对路径。
   ② --window-size 有**最小尺寸钳制**（远小于 500px 会被顶到最小值），
      于是「--window-size=48,48」实际渲染的是 ~500px 视口，截图只取左上角一小块，
      产出的是一张废图（而且文件很小、不报错）。
   解法：窗口一律开到 800px 以上（稳过钳制），再用 --force-device-scale-factor 缩回来。
   输出像素 = CSS 窗口尺寸 × DSF，所以 DSF 取 size/win，而不是写死的 0.25
   —— 安卓有 48px 这种小图，4 倍窗口也才 192px，仍会被钳制。
   ③ **无头浏览器默认把页面画在白底上**：不加 --default-background-color 时，
      截图是不带 alpha 通道的 RGB 白底图（colorType=2）。
      对满铺的图标看不出来，但「自适应图标前景层」本来就只有一支不透明闪电、
      其余该透明 —— 白底一截进去就成了一张不透明白方图，
      盖在背景层上 = 整个图标变成纯白（v1.7.4 实机事故，用户反馈「图标从紫色变成了白色」）。
   --virtual-time-budget 也必须给：否则可能在 SVG 绘制完成前就截图，得到空白图。 */
function shoot(srcSvg, out, size) {
  const win = Math.max(800, size * 2);
  const dsf = size / win;
  execFileSync(findBrowser(), [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--default-background-color=00000000',   // ← 见上面 ③，缺了它前景层必白
    '--force-device-scale-factor=' + dsf,
    '--virtual-time-budget=2000',
    '--window-size=' + win + ',' + win,
    '--screenshot=' + out,
    'file:///' + srcSvg.replace(/\\/g, '/'),
  ], { stdio: 'ignore' });
}

/* ---------- PNG 解码：只为「拿真实像素来断言」 ----------
   为什么非要读到像素不可：上面 ③ 那个 bug 从文件尺寸、脚本退出码、
   乃至肉眼看小图都发现不了 —— 白底 PNG 与透明 PNG 一样是「生成成功」。
   唯一能一眼判死的就是 alpha 通道本身。
   只支持 depth=8 的无隔行 PNG（Chrome 截图就是），够用。 */
function decodePng(file) {
  const b = fs.readFileSync(file);
  if (b.slice(1, 4).toString() !== 'PNG') throw new Error(file + ' 不是 PNG');
  let pos = 8, ihdr = null;
  const idat = [];
  while (pos + 8 <= b.length) {
    const len = b.readUInt32BE(pos);
    const type = b.toString('ascii', pos + 4, pos + 8);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr) throw new Error(file + ' 缺 IHDR');
  if (ihdr.depth !== 8 || ihdr.interlace !== 0) throw new Error(file + ` 不支持 depth=${ihdr.depth} interlace=${ihdr.interlace}`);
  const BPP = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.color];
  if (!BPP) throw new Error(file + ` 不支持的 colorType=${ihdr.color}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = ihdr.w * BPP;
  const rows = [];
  let p = 0, prev = Buffer.alloc(stride);
  for (let y = 0; y < ihdr.h; y++) {
    const f = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride)); p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= BPP ? line[i - BPP] : 0;
      const u = prev[i];
      const c = i >= BPP ? prev[i - BPP] : 0;
      let add = 0;
      if (f === 1) add = a;
      else if (f === 2) add = u;
      else if (f === 3) add = (a + u) >> 1;
      else if (f === 4) {
        const q = a + u - c, pa = Math.abs(q - a), pb = Math.abs(q - u), pc = Math.abs(q - c);
        add = (pa <= pb && pa <= pc) ? a : (pb <= pc ? u : c);
      }
      line[i] = (line[i] + add) & 255;
    }
    rows.push(line); prev = line;
  }
  return {
    w: ihdr.w, h: ihdr.h, hasAlpha: ihdr.color === 6 || ihdr.color === 4,
    /* 返回 [r,g,b,a]（无 alpha 通道的图一律视为不透明） */
    at(x, y) {
      const o = rows[y].subarray(x * BPP, (x + 1) * BPP);
      return BPP === 4 ? [o[0], o[1], o[2], o[3]] : [o[0], o[1], o[2], 255];
    },
  };
}

/* ---------- 断言：图标的透明/不透明必须是「设计上要的那样」 ----------
   corners-clear：四角透明、中心不透明（圆角 / 圆形 / 自适应前景层）
   opaque       ：四角与中心都不透明（满铺底）
   ⚠ 这条断言就是 v1.7.4 事故的守门人。少了它，白底前景层会一路静默通过。 */
function verifyAlpha(file, expect) {
  const png = decodePng(file);
  const pts = [[1, 1], [png.w - 2, 1], [1, png.h - 2], [png.w - 2, png.h - 2]];
  const corners = pts.map(([x, y]) => png.at(x, y));
  const mid = png.at(png.w >> 1, png.h >> 1);
  const cornerA = Math.max(...corners.map((c) => c[3]));
  if (expect === 'corners-clear') {
    if (!png.hasAlpha) return `没有 alpha 通道（被截成了白底图）`;
    if (cornerA !== 0) return `四角不透明（alpha=${cornerA}），应为透明 —— 又被截进白底了？`;
    if (mid[3] !== 255) return `中心透明（alpha=${mid[3]}），应为实心内容`;
  } else {
    if (cornerA !== 255) return `四角 alpha=${cornerA}，应为 255 不透明`;
    if (mid[3] !== 255) return `中心 alpha=${mid[3]}，应为 255 不透明`;
  }
  return null;
}

const SRC_ROUNDED = writeSvg('rounded.svg', SVG_ROUNDED);
const SRC_FULL = writeSvg('full.svg', SVG_FULL);
const SRC_CIRCLE = writeSvg('circle.svg', SVG_CIRCLE);
const SRC_FOREGROUND = writeSvg('foreground.svg', SVG_FOREGROUND);

/* icon.svg 本身也是产物：它是浏览器标签页 favicon 的源。
   由本脚本写出去，才能保证它与 icon-192/512.png 永远同源 —— 改设计只改上面那一处。 */
fs.writeFileSync(path.join(ROOT, 'icon.svg'), SVG_ROUNDED, 'utf8');

/* ---------- Web 端 4 张 ---------- */
const WEB_JOBS = [
  ['icon-192.png', 192, SRC_ROUNDED, 'purpose: any', 'corners-clear'],
  ['icon-512.png', 512, SRC_ROUNDED, 'purpose: any', 'corners-clear'],
  ['icon-maskable-512.png', 512, SRC_FULL, 'purpose: maskable', 'opaque'],
  // iOS 会给图标套自己的超椭圆遮罩，所以必须交满铺版：
  // 自带圆角会「圆角套圆角」，外圈还容易露出异色边
  ['apple-touch-icon.png', 180, SRC_FULL, 'iOS 主屏幕图标', 'opaque'],
];

/* ---------- 安卓端：5 个密度 × 3 张 ----------
   尺寸必须与 Capacitor 模板原图**完全一致**（prepare-android.js 会逐个断言），
   换算关系：launcher = 48×d，foreground = 108×d，round = 48×d */
const DENSITIES = [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]];
const ANDROID_JOBS = [];
for (const [d, k] of DENSITIES) {
  ANDROID_JOBS.push([`mipmap-${d}/ic_launcher.png`, 48 * k, SRC_FULL, '启动器图标（Android 7-）', 'opaque']);
  ANDROID_JOBS.push([`mipmap-${d}/ic_launcher_round.png`, 48 * k, SRC_CIRCLE, '圆形启动器图标', 'corners-clear']);
  ANDROID_JOBS.push([`mipmap-${d}/ic_launcher_foreground.png`, 108 * k, SRC_FOREGROUND, '自适应图标前景层', 'corners-clear']);
}

let fail = 0;
function run(jobs, baseDir, label) {
  console.log(`--- ${label} ---`);
  for (const [name, size, src, why, alpha] of jobs) {
    const out = path.join(baseDir, name);
    try {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      shoot(src, out, size);
      const png = decodePng(out);
      const bad = (png.w !== size || png.h !== size)
        ? `尺寸 ${png.w}×${png.h}，应为 ${size}×${size}`
        : verifyAlpha(out, alpha);
      if (bad) { fail++; console.log(`✗ ${name.padEnd(42)} ${bad}`); }
      else console.log(`✓ ${name.padEnd(42)} ${png.w}×${png.h}  alpha=${alpha === 'opaque' ? '全不透明' : '角落透明'}  (${why})`);
    } catch (e) {
      fail++;
      console.log(`✗ ${name.padEnd(42)} 失败：${e.message}`);
    }
  }
  console.log('');
}

run(WEB_JOBS, ROOT, '生成图标 · Web');
run(ANDROID_JOBS, ANDROID_RES, '生成图标 · 安卓');

/* ---------- 安卓的 XML 资源（与上面的 PNG 同源，一起生成，避免手改漂移） ---------- */
const XML = {
  'values/ic_launcher_background.xml': `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- 自适应图标背景层的**纯色兜底**。真正的渐变在 drawable/ic_launcher_background.xml，
         这里留一个同名 color 资源，以防模板别处按 @color/ic_launcher_background 引用。 -->
    <color name="ic_launcher_background">#6C5CF3</color>
</resources>
`,
  'drawable/ic_launcher_background.xml': `<?xml version="1.0" encoding="utf-8"?>
<!-- 自适应图标的背景层：与 icon.svg 同一套紫色渐变。
     早先这里是 #08090d 近黑 —— 系统把图标裁成圆形后，圆内是近黑底、中间一块紫色，
     看起来就是「一圈黑边」（用户实机反馈）。改成渐变铺满后，
     无论系统用圆、圆角方还是水滴形遮罩，边缘都不会再露出第二种颜色。 -->
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <gradient
        android:angle="315"
        android:startColor="#5B4DF0"
        android:endColor="#8F7BFF"
        android:type="linear" />
</shape>
`,
  'mipmap-anydpi-v26/ic_launcher.xml': `<?xml version="1.0" encoding="utf-8"?>
<!-- 自适应图标（Android 8+）：渐变背景层 + 只含闪电的透明前景层。
     这两层分层是关键 —— 合成后是一张「紫底闪电」，而不是把一张带底色的方图塞进圆形遮罩。 -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`,
};
XML['mipmap-anydpi-v26/ic_launcher_round.xml'] = XML['mipmap-anydpi-v26/ic_launcher.xml'];

console.log('--- 生成图标 · 安卓 XML ---');
for (const [rel, content] of Object.entries(XML)) {
  const out = path.join(ANDROID_RES, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, content, 'utf8');
  console.log(`✓ ${rel}`);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(fail ? `\n${fail} 张图标生成失败` : '\n全部图标生成成功（含 alpha 通道断言）');
process.exit(fail ? 1 : 0);
