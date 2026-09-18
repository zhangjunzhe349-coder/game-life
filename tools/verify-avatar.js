/* 无头几何校验：用最小 THREE 桩件跑 avatar.js 的 build()，
   检查 NaN / 空几何 / 法线内翻（环序倒置），覆盖多组体型参数与全部发型 */
const fs = require('fs');
const path = require('path');

/* ================= 最小 THREE 桩件 ================= */
class Vec {
  constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
class Attr {
  constructor(arr, item) { this.array = arr; this.itemSize = item; this.count = arr.length / item; }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
  setX(i, v) { this.array[i * this.itemSize] = v; }
}
class Geometry {
  constructor() { this.attributes = {}; this.index = null; }
  setAttribute(n, a) { this.attributes[n] = a; return this; }
  setIndex(idx) { const arr = Array.isArray(idx) ? idx : idx.array; this.index = { array: arr, count: arr.length }; return this; }
  dispose() {}
  computeVertexNormals() {
    const p = this.attributes.position;
    if (!p) return;
    const n = new Float32Array(p.array.length);
    const idx = this.index ? this.index.array : [];
    for (let f = 0; f + 2 < idx.length; f += 3) {
      const a = idx[f], b = idx[f + 1], c = idx[f + 2];
      const ax = p.getX(a), ay = p.getY(a), az = p.getZ(a);
      const e1x = p.getX(b) - ax, e1y = p.getY(b) - ay, e1z = p.getZ(b) - az;
      const e2x = p.getX(c) - ax, e2y = p.getY(c) - ay, e2z = p.getZ(c) - az;
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      for (const v of [a, b, c]) { n[v * 3] += nx; n[v * 3 + 1] += ny; n[v * 3 + 2] += nz; }
    }
    for (let i = 0; i < n.length; i += 3) {
      const L = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
      n[i] /= L; n[i + 1] /= L; n[i + 2] /= L;
    }
    this.attributes.normal = new Attr(n, 3);
  }
}
class Material { constructor(o) { Object.assign(this, o || {}); } dispose() {} }
class Object3D {
  constructor() { this.children = []; this.position = new Vec(); this.rotation = new Vec(); this.scale = new Vec(1, 1, 1); }
  add(o) { this.children.push(o); return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); return this; }
  traverse(f) { f(this); this.children.forEach((c) => c.traverse && c.traverse(f)); }
}
class Mesh extends Object3D { constructor(g, m) { super(); this.geometry = g; this.material = m; this.isMesh = true; } }
const GROUPS = [];
class Group extends Object3D { constructor() { super(); GROUPS.push(this); } }
function simpleGeo() {
  return new Geometry()
    .setAttribute('position', new Attr(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), 3))
    .setIndex([0, 1, 2, 0, 2, 3]);
}

const THREE = {
  Color: class { constructor(c) { this.value = c; } },
  FrontSide: 0, DoubleSide: 2, BackSide: 1,
  SRGBColorSpace: 'srgb', sRGBEncoding: 3001, ACESFilmicToneMapping: 4,
  BufferGeometry: Geometry, Float32BufferAttribute: Attr,
  MeshStandardMaterial: Material, MeshBasicMaterial: Material,
  Mesh, Group,
  SphereGeometry: simpleGeo, BoxGeometry: simpleGeo, TorusGeometry: simpleGeo,
  CylinderGeometry: simpleGeo, CircleGeometry: simpleGeo, RingGeometry: simpleGeo,
  Scene: Object3D,
  PerspectiveCamera: class extends Object3D { constructor() { super(); this.aspect = 1; } lookAt() {} updateProjectionMatrix() {} },
  WebGLRenderer: class { constructor() { this.domElement = {}; } setPixelRatio() {} setSize() {} render() {} },
  HemisphereLight: class extends Object3D {}, DirectionalLight: class extends Object3D {},
  Clock: class { getElapsedTime() { return 0; } }
};

/* ================= DOM / GL 桩件 ================= */
const el = () => ({
  clientWidth: 600, clientHeight: 400, innerHTML: '', dataset: {}, hidden: false,
  appendChild() {}, addEventListener() {}, setPointerCapture() {},
  querySelector: () => el(), querySelectorAll: () => []
});
const doc = { getElementById: () => el(), createElement: () => el(), addEventListener() {} };
const win = { addEventListener() {}, devicePixelRatio: 1 };

const state = {
  avatar: {
    height: 175, weight: 68, muscle: 50,
    skin: '#e8b088', hairStyle: 'short', hairColor: '#2b2118',
    wardrobe: [
      { id: 't', name: 'T恤', slot: 'top', color: '#f5f5f0' },
      { id: 'b', name: '牛仔', slot: 'bottom', color: '#3a5a8c' },
      { id: 's', name: '鞋', slot: 'shoes', color: '#e8e8e8' },
      { id: 'g', name: '眼镜', slot: 'accessory', color: '#22222a', kind: 'glasses' }
    ],
    outfit: { top: 't', bottom: 'b', shoes: 's', accessory: 'g' },
    outfits: []
  }
};
const GL = {
  state, uid: () => 'u1', esc: (s) => String(s), toast: () => {}, changed: () => {}, hooks: []
};

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'avatar.js'), 'utf8');
const factory = new Function('THREE', 'document', 'window', 'requestAnimationFrame', 'GL', 'console',
  src + '\n;return GL;');

/* ================= 校验 ================= */
function run(label) {
  GROUPS.length = 0;
  const g = factory(THREE, doc, win, () => 0, GL, console);
  g.initAvatar();                       // init() 内部会调用 build()

  const group = GROUPS[GROUPS.length - 1];
  if (!group) { console.log(`[${label}] 未捕获到 modelGroup`); return false; }

  let meshes = 0, nan = 0, empty = 0, inward = 0, noNormal = 0;
  const bad = [];

  group.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    meshes++;
    const p = o.geometry.attributes.position;
    if (!p || p.count === 0) { empty++; bad.push('空几何'); return; }
    let cx = 0, cy = 0, cz = 0, ok = true;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { ok = false; break; }
      cx += x; cy += y; cz += z;
    }
    if (!ok) { nan++; return; }
    cx /= p.count; cy /= p.count; cz /= p.count;

    const nm = o.geometry.attributes.normal;
    if (!nm) { noNormal++; return; }
    let out = 0, inn = 0;
    for (let i = 0; i < p.count; i++) {
      const dx = p.getX(i) - cx, dy = p.getY(i) - cy, dz = p.getZ(i) - cz;
      const L = Math.hypot(dx, dy, dz);
      if (L < 1e-9) continue;
      const d = (dx / L) * nm.getX(i) + (dy / L) * nm.getY(i) + (dz / L) * nm.getZ(i);
      if (d > 0.12) out++; else if (d < -0.12) inn++;
    }
    if (inn > out * 1.8 && inn > 12) {
      inward++;
      bad.push(`法线疑似内翻 out=${out} inn=${inn} verts=${p.count}`);
    }
  });

  const pass = nan === 0 && empty === 0 && inward === 0;
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${label}] 网格 ${meshes} · 空 ${empty} · NaN ${nan} · 无UV法线 ${noNormal} · 内翻 ${inward}`);
  bad.forEach((b) => console.log('        ⚠ ' + b));
  return pass;
}

let allPass = true;
const bodies = [
  ['标准 175/68/50', 175, 68, 50],
  ['偏瘦 180/52/30', 180, 52, 30],
  ['壮硕 170/88/90', 170, 88, 90],
  ['肥胖 168/110/20', 168, 110, 20],
  ['极限高 210/80/60', 210, 80, 60],
  ['极限矮 140/40/0', 140, 40, 0]
];
for (const [label, h, w, m] of bodies) {
  state.avatar.height = h; state.avatar.weight = w; state.avatar.muscle = m;
  for (const hs of ['short', 'buzz', 'long', 'ponytail', 'bald']) {
    state.avatar.hairStyle = hs;
    if (!run(`${label} / ${hs}`)) allPass = false;
  }
}

/* 无衣橱（裸参数）与仅配饰为帽子 */
state.avatar.height = 175; state.avatar.weight = 68; state.avatar.muscle = 50;
state.avatar.hairStyle = 'short';
state.avatar.outfit = { top: null, bottom: null, shoes: null, accessory: null };
if (!run('全部槽位为空')) allPass = false;
state.avatar.wardrobe.push({ id: 'h', name: '帽子', slot: 'accessory', color: '#334455', kind: 'hat' });
state.avatar.outfit = { top: 't', bottom: 'b', shoes: 's', accessory: 'h' };
if (!run('配饰为帽子')) allPass = false;

console.log('\n' + (allPass ? '✅ 全部通过' : '❌ 存在失败项'));
process.exit(allPass ? 0 : 1);
