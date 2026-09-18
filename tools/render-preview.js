/* 立绘预览渲染器：把 portrait.js 的输出落成独立 SVG / PNG
   跑法：node game-life/tools/render-preview.js [发型] [体重] [肌肉]
   例：  node game-life/tools/render-preview.js long 88 90
   说明：校验脚本只能查「有没有坏值」，看不出「画得像不像人」。
        这个工具把 SVG 真渲染出来，用于目视检查比例。 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'portrait.js'), 'utf8');

const hairStyle = process.argv[2] || 'short';
const weight = Number(process.argv[3] || 68);
const muscle = Number(process.argv[4] || 50);

/* ---------- 最小 DOM 桩件 ---------- */
function makeNode(tag) {
  return {
    tagName: tag, _attrs: {}, childNodes: [],
    get firstChild() { return this.childNodes[0] || null; },
    setAttribute(k, v) { this._attrs[k] = v; },
    appendChild(c) { c.parentNode = this; this.childNodes.push(c); return c; },
    removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); return c; }
  };
}
const doc = { createElementNS: (ns, t) => makeNode(t), getElementById: () => null };
const GL = { state: null, hooks: [], uid: () => 'x', esc: (s) => String(s), toast: () => {} };
const api = new Function('window', 'document', 'GL',
  src + '\n;return { draw: GL.drawPortrait };')({ GL }, doc, GL);

const W = [
  { id: 't1', name: '白色T恤', slot: 'top', color: '#f5f5f0' },
  { id: 'b1', name: '深蓝牛仔裤', slot: 'bottom', color: '#3a5a8c' },
  { id: 's1', name: '白色运动鞋', slot: 'shoes', color: '#e8e8e8' },
  { id: 'g1', name: '黑框眼镜', slot: 'accessory', color: '#22222a', kind: 'glasses' }
];
GL.state = {
  avatar: {
    height: 175, weight, muscle, skin: '#e8b088',
    hairStyle, hairColor: '#2b2118',
    wardrobe: W, outfit: { top: 't1', bottom: 'b1', shoes: 's1', accessory: 'g1' }, outfits: []
  }
};

const svg = makeNode('svg');
api.draw(svg);

function ser(n, d) {
  const pad = '  '.repeat(d);
  const at = Object.entries(n._attrs)
    .map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`).join('');
  if (!n.childNodes.length) return `${pad}<${n.tagName}${at}/>`;
  return `${pad}<${n.tagName}${at}>\n`
    + n.childNodes.map((c) => ser(c, d + 1)).join('\n')
    + `\n${pad}</${n.tagName}>`;
}
const body = svg.childNodes.map((c) => ser(c, 1)).join('\n');
const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 1000" width="680" height="1000">`
  + `<rect width="680" height="1000" fill="#0b0d13"/>\n${body}\n</svg>`;

const svgPath = path.join(__dirname, 'preview-portrait.svg');
fs.writeFileSync(svgPath, out);

/* ---------- 尽可能顺手出 PNG ---------- */
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].find((p) => fs.existsSync(p));

const pngPath = path.join(__dirname, 'preview-portrait.png');
let png = false;
if (EDGE) {
  try {
    execFileSync(EDGE, [
      '--headless', '--disable-gpu', '--no-sandbox',
      `--screenshot=${pngPath}`, '--window-size=680,1000', '--hide-scrollbars',
      'file:///' + svgPath.replace(/\\/g, '/').replace(/ /g, '%20')
    ], { stdio: 'pipe', timeout: 30000 });
    png = fs.existsSync(pngPath);
  } catch (e) { /* 出不了 PNG 也不影响 SVG */ }
}

console.log(`渲染设定：发型 ${hairStyle} · 体重 ${weight}kg · 肌肉 ${muscle}`);
console.log(`SVG：${svgPath}（${(out.length / 1024).toFixed(1)} KB）`);
console.log(png ? `PNG：${pngPath}` : 'PNG：跳过（未找到 Edge/Chrome）');
