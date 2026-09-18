/* ============================================================
   分层 2D 立绘引擎 · 无头校验
   跑法：node game-life/tools/verify-portrait.js
   —— 用最小 DOM/SVG 桩件加载 js/portrait.js，逐图层检查：
      ① 是否产出元素、② 路径语法是否合法、③ 是否有 NaN/undefined 落进属性
      ④ 关键部位（头/躯干/腿/发）是否存在、⑤ 极端体型下不塌陷
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'portrait.js'), 'utf8');

/* ---------- 最小 DOM / SVG 桩件 ---------- */
const created = [];
function makeNode(tag) {
  const n = {
    tagName: tag,
    _attrs: {},
    childNodes: [],
    parentNode: null,
    get firstChild() { return this.childNodes[0] || null; },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    appendChild(c) { c.parentNode = this; this.childNodes.push(c); this.ownerDocument && (c.ownerDocument = this.ownerDocument); return c; },
    removeChild(c) {
      const i = this.childNodes.indexOf(c);
      if (i >= 0) this.childNodes.splice(i, 1);
      return c;
    }
  };
  created.push(n);
  return n;
}
const doc = {
  createElementNS: (ns, tag) => makeNode(tag),
  getElementById: () => null
};

/* ---------- 桩 THREE 无关，只需 GL ---------- */
const hooks = [];
global.window = { GL: null };
global.document = doc;

const GL = {
  state: null,
  hooks,
  uid: () => 'x' + Math.random().toString(36).slice(2, 7),
  esc: (s) => String(s == null ? '' : s),
  toast: () => {}
};
global.GL = GL;
global.window.GL = GL;

/* ---------- 加载被测模块 ---------- */
let drawPortrait;
try {
  // portrait.js 是 IIFE，直接 eval 到当前作用域
  const fn = new Function('window', 'document', 'GL', src + '\n;return { draw: GL.drawPortrait, render: GL.renderPortrait };');
  const api = fn(global.window, doc, GL);
  drawPortrait = api.draw;
} catch (e) {
  console.error('✗ 模块加载失败：' + e.message);
  process.exit(1);
}
if (typeof drawPortrait !== 'function') {
  console.error('✗ 未导出 GL.drawPortrait');
  process.exit(1);
}

/* ---------- 默认数据（与 storage.js 保持同构） ---------- */
function mkAvatar(o) {
  const t1 = 't1', b1 = 'b1', s1 = 's1', g1 = 'g1';
  return Object.assign({
    height: 175, weight: 68, muscle: 50,
    skin: '#e8b088', hairStyle: 'short', hairColor: '#2b2118',
    wardrobe: [
      { id: t1, name: '白色T恤', slot: 'top', color: '#f5f5f0' },
      { id: b1, name: '深蓝牛仔裤', slot: 'bottom', color: '#3a5a8c' },
      { id: s1, name: '白色运动鞋', slot: 'shoes', color: '#e8e8e8' },
      { id: g1, name: '黑框眼镜', slot: 'accessory', color: '#22222a', kind: 'glasses' }
    ],
    outfit: { top: t1, bottom: b1, shoes: s1, accessory: g1 },
    outfits: []
  }, o || {});
}

/* ---------- 检查器 ---------- */
const DANGER = /NaN|undefined|Infinity|null/;
function walk(node, out) {
  out.push(node);
  node.childNodes.forEach((c) => walk(c, out));
  return out;
}

const NUMERIC_ATTRS = ['x', 'y', 'cx', 'cy', 'rx', 'ry', 'r', 'width', 'height',
  'x1', 'y1', 'x2', 'y2', 'stroke-width', 'opacity', 'fill-opacity'];

function checkCase(title, avatar) {
  GL.state = { avatar: mkAvatar(avatar) };
  const svg = makeNode('svg');
  let err = null;
  try { drawPortrait(svg); } catch (e) { err = e; }

  if (err) return { title, ok: false, msg: '抛异常：' + err.message };
  const nodes = walk(svg, []).slice(1);   // 去掉 root
  if (!nodes.length) return { title, ok: false, msg: '没有产出任何元素' };

  const problems = [];
  const tags = {};
  let pathCount = 0;

  for (const n of nodes) {
    tags[n.tagName] = (tags[n.tagName] || 0) + 1;

    // 属性值不得含 NaN/undefined
    for (const k in n._attrs) {
      const v = n._attrs[k];
      if (typeof v === 'string' && DANGER.test(v) && k !== 'id') {
        problems.push(`${n.tagName}[${k}] = "${v}"`);
      }
    }
    // 数值属性必须是有限数
    for (const k of NUMERIC_ATTRS) {
      if (k in n._attrs) {
        const num = Number(n._attrs[k]);
        if (!Number.isFinite(num)) problems.push(`${n.tagName}[${k}] 非有限数：${n._attrs[k]}`);
      }
    }
    // 路径语法
    if (n.tagName === 'path') {
      pathCount++;
      const d = n._attrs.d;
      if (!d) problems.push('path 缺少 d 属性');
      else {
        // 仅填充路径需要闭合；fill:none 的线稿（眉/眼睑/高光/发丝）不必闭合
        const strokeOnly = n._attrs.fill === 'none';
        if (!/^M\s*-?[\d.]/.test(d)) problems.push('path 未以 M 开头：' + d.slice(0, 40));
        if (!strokeOnly && !/Z\s*$/.test(d)) problems.push('填充路径未闭合（缺 Z）：' + d.slice(0, 50));
        const cmds = (d.match(/[A-Za-z]/g) || []).join('');
        if (/[^MCLZ]/.test(cmds)) problems.push('path 含未支持的命令：' + cmds);
        // 坐标数：M 后 2 个起，每个 C 后 6 个
        const nums = d.match(/-?\d+(\.\d+)?/g) || [];
        if (nums.length < 4) problems.push('path 坐标点过少：' + nums.length);
        if ((nums.length - 2) % 6 !== 0 && cmds.includes('C')) {
          problems.push(`path 坐标数不成组：（${nums.length} - 2）不能被 6 整除`);
        }
      }
    }
  }

  // 关键部位存在性
  const need = { path: 8, ellipse: 2, circle: 3 };
  for (const k in need) {
    if ((tags[k] || 0) < need[k]) problems.push(`缺少 ${k} 图层（实际 ${tags[k] || 0}，期望 ≥ ${need[k]}）`);
  }

  return {
    title, ok: problems.length === 0,
    msg: `元素 ${nodes.length}（path ${pathCount} / ellipse ${tags.ellipse || 0} / circle ${tags.circle || 0}）`
      + (problems.length ? ' · ' + problems.length + ' 处问题：\n    ' + [...new Set(problems)].slice(0, 6).join('\n    ') : ''),
    nodes
  };
}

/* ---------- 用例矩阵 ---------- */
const cases = [];
const bodyTypes = [
  ['标准', { height: 175, weight: 68, muscle: 50 }],
  ['壮硕', { height: 170, weight: 88, muscle: 90 }],
  ['肥胖', { height: 168, weight: 118, muscle: 20 }],
  ['瘦弱', { height: 180, weight: 52, muscle: 10 }],
  ['极限高', { height: 210, weight: 80, muscle: 60 }],
  ['极限矮', { height: 140, weight: 40, muscle: 0 }]
];
const styles = ['short', 'buzz', 'long', 'ponytail', 'bald'];

for (const [bn, bp] of bodyTypes) {
  for (const st of styles) {
    cases.push([`${bn} ${bp.height}/${bp.weight}/${bp.muscle} / ${st}`, Object.assign({}, bp, { hairStyle: st })]);
  }
}
// 衣橱边界
cases.push(['空衣橱（裸身上阵）', { wardrobe: [], outfit: { top: null, bottom: null, shoes: null, accessory: null } }]);
cases.push(['配饰为帽子', { outfit: { top: 't1', bottom: 'b1', shoes: 's1', accessory: 'h1' }, wardrobe: [
  { id: 't1', name: '白色T恤', slot: 'top', color: '#f5f5f0' },
  { id: 'b1', name: '深蓝牛仔裤', slot: 'bottom', color: '#3a5a8c' },
  { id: 's1', name: '白色运动鞋', slot: 'shoes', color: '#e8e8e8' },
  { id: 'h1', name: '棒球帽', slot: 'accessory', color: '#2f3a52', kind: 'hat' }
] }]);
cases.push(['穿裙装', { outfit: { top: 't1', bottom: 'd1', shoes: 's1', accessory: null }, wardrobe: [
  { id: 't1', name: '米色针织衫', slot: 'top', color: '#e6dcc8' },
  { id: 'd1', name: '深色半身裙', slot: 'bottom', color: '#3c3346' },
  { id: 's1', name: '白色运动鞋', slot: 'shoes', color: '#e8e8e8' }
] }]);
cases.push(['长外套', { outfit: { top: 'c1', bottom: 'b1', shoes: 's1', accessory: null }, wardrobe: [
  { id: 'c1', name: '灰色长款外套', slot: 'top', color: '#5a6270' },
  { id: 'b1', name: '深蓝牛仔裤', slot: 'bottom', color: '#3a5a8c' },
  { id: 's1', name: '白色运动鞋', slot: 'shoes', color: '#e8e8e8' }
] }]);
cases.push(['极深肤色 + 银发', { skin: '#7a4a30', hairColor: '#d8d8dc' }]);
cases.push(['极浅肤色 + 纯白装', { skin: '#fbe0cc', hairColor: '#efe6d6' }]);

/* ---------- 执行 ---------- */
let pass = 0, fail = 0;
const failed = [];
for (const [t, av] of cases) {
  const r = checkCase(t, av);
  if (r.ok) { pass++; console.log(`PASS  [${t}] ${r.msg}`); }
  else { fail++; failed.push(r); console.log(`FAIL  [${t}] ${r.msg}`); }
}

console.log('');
if (fail) {
  console.log(`❌ ${fail} / ${pass + fail} 个用例失败`);
  process.exit(1);
} else {
  console.log(`✅ 全部通过（${pass} 个用例）`);
}
