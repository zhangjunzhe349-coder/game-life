/* ============================================================
   图标生成：把 icon.svg 渲染成 PWA 所需的 PNG 尺寸
   ------------------------------------------------------------
   为什么需要这一步：
   ① iOS 的 apple-touch-icon **不认 SVG** —— Safari 会退化成白块或网页截图；
   ② 安卓各版本对 SVG 图标的支持不一致，可能直接让「添加到主屏幕」不可用；
   ③ maskable 图标要求内容落在中心安全区内，直接拿原图会被系统裁掉边缘。
   做法：借本机已有的 Chromium 内核浏览器（Edge / Chrome）无头渲染 SVG 再截图，
   **不引入任何新依赖**（不装 sharp / cairosvg 之类）。
   跑法：node tools/gen-icons.js
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-icon-'));

/* 原图：带圆角，用于 purpose: any（系统不会二次裁切，自己带圆角更精致） */
const SRC_PLAIN = path.join(ROOT, 'icon.svg');

/* 满铺版：底色铺满整块、内容缩到 80% 居中、不带圆角。
   Windows / Android 会把它裁成圆形或不规则形状，圆角与留白必须由系统来做，
   自己带圆角会变成「圆角套圆角」。 */
const MASK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5b4df0"/>
      <stop offset="1" stop-color="#8f7bff"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="#0d0f1a"/>
  <g transform="translate(256,256) scale(0.8) translate(-256,-256)">
    <rect x="24" y="24" width="464" height="464" rx="0" fill="url(#bg)"/>
    <polygon points="296,64 152,288 240,288 216,448 376,208 280,208" fill="#0d0f1a"/>
  </g>
</svg>`;
const SRC_MASK = path.join(TMP, 'mask.svg');
fs.writeFileSync(SRC_MASK, MASK_SVG, 'utf8');

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
   两个坑，都踩过：
   ① 相对路径的 --screenshot 不落在当前目录，而是浏览器自己的工作目录 —— 必须传绝对路径。
   ② --window-size 有**最小尺寸钳制**（远小于 500px 会被顶到最小值），
      于是「--window-size=192,192」实际渲染的是 ~500px 视口，截图只取左上角一小块，
      产出的是一张废图（而且文件很小、不报错）。
   解法：窗口开成目标的 4 倍（≥720px，稳稳超过钳制），再用 --force-device-scale-factor=0.25
   缩回来 —— 输出像素 = CSS 尺寸 × DSF，正好等于目标尺寸，且内容完整等比缩放。
   --virtual-time-budget 也必须给：否则可能在 SVG 绘制完成前就截图，得到空白图。 */
function shoot(srcSvg, out, size) {
  execFileSync(findBrowser(), [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=0.25',
    '--virtual-time-budget=2000',
    '--window-size=' + (size * 4) + ',' + (size * 4),
    '--screenshot=' + out,
    'file:///' + srcSvg.replace(/\\/g, '/'),
  ], { stdio: 'ignore' });
}

/* 读 PNG 的 IHDR 拿真实宽高，确认截图尺寸没错（不要凭信任） */
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.slice(1, 4).toString() !== 'PNG') throw new Error(file + ' 不是 PNG');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
}

const JOBS = [
  ['icon-192.png',            192, SRC_PLAIN, 'purpose: any'],
  ['icon-512.png',            512, SRC_PLAIN, 'purpose: any'],
  ['icon-maskable-512.png',   512, SRC_MASK,  'purpose: maskable'],
  ['apple-touch-icon.png',    180, SRC_MASK,  'iOS 主屏幕图标'],
];

let fail = 0;
console.log('--- 生成图标 ---');
for (const [name, size, src, why] of JOBS) {
  const out = path.join(ROOT, name);
  try {
    shoot(src, out, size);
    const got = pngSize(out);
    const ok = got.w === size && got.h === size;
    if (!ok) fail++;
    console.log(`${ok ? '✓' : '✗'} ${name.padEnd(24)} ${got.w}×${got.h}  ${(got.bytes / 1024).toFixed(1)}KB  (${why})`);
  } catch (e) {
    fail++;
    console.log(`✗ ${name.padEnd(24)} 失败：${e.message}`);
  }
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(fail ? `\n${fail} 个图标生成失败` : '\n全部图标生成成功');
process.exit(fail ? 1 : 0);
