/* ============ Game Life · 体型与衣橱控制面板 ============
   v1.4.0：中央形象改为「分层 2D 立绘」（js/portrait.js）。
   本文件退化为纯「体型参数 + 衣橱单品」的数据与交互层，
   与立绘共用 GL.state.avatar 数据契约，改完走 GL.changed() 即可。

   ── 历史 ──
   v1.3.0 曾用 Three.js 做程序化 3D 模型（截面放样 + 分段关节）。
   该渲染段仍保留在文件下半部分但已休眠（见 init()），
   需要时用 `git checkout v1.3.0 -- game-life/` 可整体回滚。
   ============================================================ */
(function () {
  'use strict';
  /* ============ 体型与衣橱控制面板（v1.4.0） ============
     职责拆分：本文件只负责「体型参数 + 衣橱单品」的数据与交互 UI。
     中央人物形象由 js/portrait.js 的 SVG 分层立绘渲染 —— 二者共享
     GL.state.avatar 同一份数据契约，任何改动都会走 GL.changed() 触发
     立绘重绘，因此本文件无需知道立绘如何画。
     下方 3D 渲染段（build / init）保留但已休眠，见 init() 注释。 */

  let renderer, scene, camera, modelGroup, torsoMesh;
  let camDist = 3.4, raf = 0;
  let initialized = false;
  let dragging = false, lastX = 0, lastY = 0, camHeight = 1.0, lookY = 1.0;

  let matPool = [];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function A() { return GL.state.avatar; }
  function itemOf(id) { return A().wardrobe.find((w) => w.id === id) || null; }

  /* ---------- 材质 ---------- */
  function mat(color, opt) {
    opt = opt || {};
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: opt.roughness == null ? 0.74 : opt.roughness,
      metalness: opt.metalness == null ? 0.02 : opt.metalness,
      side: opt.side || THREE.FrontSide
    });
    matPool.push(m);
    return m;
  }

  function disposeGroup(g) {
    g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    matPool.forEach((m) => m.dispose());
    matPool = [];
  }

  /* ============================================================
     几何核心：由水平截面环放样出闭合曲面
     rings: [{ y, rx, rz, z? }] 自下而上；y 可为函数 y(a) 以生成变化的轮廓线
     a 约定：0 = 右(+X)，π/2 = 前(+Z)，π = 左(−X)，3π/2 = 后(−Z)
     ============================================================ */
  function surface(rings, seg, opt) {
    opt = opt || {};
    // 防御：截面环必须自下而上，否则法线会整体内翻（脚部曾踩过此坑）
    const yOf = (r) => (typeof r.y === 'function' ? r.y(Math.PI / 2) : r.y);
    const rr = (rings.length > 1 && yOf(rings[rings.length - 1]) < yOf(rings[0]))
      ? rings.slice().reverse() : rings;
    const n = rr.length, m = seg;
    const pos = [], idx = [];

    for (let i = 0; i < n; i++) {
      const r = rr[i];
      for (let j = 0; j < m; j++) {
        const a = (j / m) * Math.PI * 2;
        const y = (typeof r.y === 'function') ? r.y(a) : r.y;
        pos.push(Math.cos(a) * r.rx, y, Math.sin(a) * r.rz + (r.z || 0));
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < m; j++) {
        const a = i * m + j, b = i * m + ((j + 1) % m);
        const c = (i + 1) * m + j, d = (i + 1) * m + ((j + 1) % m);
        idx.push(a, c, b, b, c, d);
      }
    }
    const capAt = (ri, up) => {
      const r = rr[ri], ci = pos.length / 3;
      const y = (typeof r.y === 'function') ? r.y(Math.PI / 2) : r.y;
      pos.push(0, y, r.z || 0);
      for (let j = 0; j < m; j++) {
        const a = ri * m + j, b = ri * m + ((j + 1) % m);
        if (up) idx.push(ci, b, a); else idx.push(ci, a, b);
      }
    };
    if (opt.capBottom) capAt(0, false);
    if (opt.capTop) capAt(n - 1, true);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function mesh(geo, material, opt) {
    opt = opt || {};
    const m = new THREE.Mesh(geo, material);
    if (opt.p) m.position.set(opt.p[0], opt.p[1], opt.p[2]);
    if (opt.r) m.rotation.set(opt.r[0], opt.r[1], opt.r[2]);
    if (opt.s) m.scale.set(opt.s[0], opt.s[1], opt.s[2]);
    modelGroup.add(m);
    return m;
  }

  /* ---------- 头部侧面轮廓（单位 H，自颌下到头顶） ---------- */
  const HEAD = [
    { y: 0.862, rx: 0.014, rz: 0.017, z: 0.003 },   // 颌下
    { y: 0.873, rx: 0.026, rz: 0.031, z: 0.003 },   // 下颌
    { y: 0.885, rx: 0.035, rz: 0.042, z: 0.002 },   // 口
    { y: 0.898, rx: 0.042, rz: 0.051, z: 0.001 },   // 颧
    { y: 0.912, rx: 0.045, rz: 0.055, z: 0.000 },
    { y: 0.926, rx: 0.047, rz: 0.057, z: 0.000 },   // 眼线
    { y: 0.940, rx: 0.047, rz: 0.058, z: 0.000 },   // 眉
    { y: 0.954, rx: 0.046, rz: 0.056, z: 0.000 },   // 额
    { y: 0.968, rx: 0.042, rz: 0.051, z: 0.000 },
    { y: 0.982, rx: 0.033, rz: 0.040, z: 0.000 },
    { y: 0.994, rx: 0.017, rz: 0.021, z: 0.001 }    // 头顶
  ];

  /** 求高度 h（单位 H）处的头部横向半径 —— 线性插值，避免阶梯误差 */
  function headRadiusAt(h) {
    const hh = clamp(h, HEAD[0].y, HEAD[HEAD.length - 1].y);
    let lo = HEAD[0], hi = HEAD[HEAD.length - 1];
    for (let i = 0; i < HEAD.length - 1; i++) {
      if (hh >= HEAD[i].y && hh <= HEAD[i + 1].y) { lo = HEAD[i]; hi = HEAD[i + 1]; break; }
    }
    const t = hi.y === lo.y ? 0 : (hh - lo.y) / (hi.y - lo.y);
    return {
      rx: lo.rx + (hi.rx - lo.rx) * t,
      rz: lo.rz + (hi.rz - lo.rz) * t,
      z: (lo.z || 0) + ((hi.z || 0) - (lo.z || 0)) * t
    };
  }

  /** 头部前表面在给定高度 / 横向偏移处的 z 坐标（单位 H） */
  function faceZ(hH, xH) {
    const r = headRadiusAt(hH);
    const nx = clamp(Math.abs(xH) / r.rx, 0, 0.999);
    return r.rz * Math.sqrt(1 - nx * nx) + r.z;
  }

  /** 头发壳层：自随角度变化的发际线，沿参数 t 收敛到头顶，半径贴合头骨 */
  function hairGeo(H, frontH, backH, bulk, seg) {
    const ts = [0, 0.16, 0.33, 0.50, 0.67, 0.83, 1.0];
    const crown = 0.999;
    const n = ts.length, m = seg;
    const pos = [], idx = [];

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        const a = (j / m) * Math.PI * 2;
        const f = (Math.cos(a - Math.PI / 2) + 1) / 2;         // 1 = 前，0 = 后
        const yf = backH + (frontH - backH) * f;
        const yH = yf + ts[i] * (crown - yf);
        const r = headRadiusAt(yH);
        pos.push(Math.cos(a) * r.rx * bulk * H, yH * H, Math.sin(a) * r.rz * bulk * H + r.z * H);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < m; j++) {
        const a = i * m + j, b = i * m + ((j + 1) % m);
        const c = (i + 1) * m + j, d = (i + 1) * m + ((j + 1) % m);
        idx.push(a, c, b, b, c, d);
      }
    }
    const ci = pos.length / 3;
    pos.push(0, crown * H, 0);
    for (let j = 0; j < m; j++) {
      const a = (n - 1) * m + j, b = (n - 1) * m + ((j + 1) % m);
      idx.push(ci, b, a);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* ============================================================
     建模主流程
     ============================================================ */
  function build() {
    if (!modelGroup) return;
    disposeGroup(modelGroup);
    while (modelGroup.children.length) modelGroup.remove(modelGroup.children[0]);
    torsoMesh = null;

    const a = A();
    const H = a.height / 100;                                  // 米
    const dw = clamp((a.weight - 68) / 68, -0.35, 0.55);       // 相对标准体重偏差
    const mus = clamp(a.muscle / 100, 0, 1);

    const Y = {
      knee: 0.280 * H, crotch: 0.475 * H, hip: 0.505 * H,
      waist: 0.618 * H, chest: 0.725 * H, shldr: 0.820 * H, neck: 0.846 * H
    };

    /* 关键半径：基准值 × 体重修正 × 肌肉修正 */
    const R = {
      shldrW:  0.1260 * H * (1 + 0.18 * dw) * (1 + 0.14 * mus),
      chestRX: 0.0914 * H * (1 + 0.45 * dw) * (1 + 0.06 * mus),
      chestRZ: 0.0629 * H * (1 + 0.85 * dw) * (1 + 0.30 * mus),
      waistRX: 0.0800 * H * (1 + 0.85 * dw) * (1 - 0.04 * mus),
      waistRZ: 0.0571 * H * (1 + 0.90 * dw),
      hipRX:   0.0943 * H * (1 + 0.55 * dw),
      hipRZ:   0.0640 * H * (1 + 0.70 * dw),
      thigh:   0.0500 * H * (1 + 0.55 * dw) * (1 + 0.22 * mus),
      knee:    0.0314 * H * (1 + 0.45 * dw),
      calf:    0.0337 * H * (1 + 0.45 * dw) * (1 + 0.20 * mus),
      ankle:   0.0200 * H * (1 + 0.35 * dw),
      upArm:   0.0291 * H * (1 + 0.50 * dw) * (1 + 0.30 * mus),
      foreArm: 0.0246 * H * (1 + 0.45 * dw) * (1 + 0.28 * mus),
      wrist:   0.0154 * H * (1 + 0.32 * dw),
      neck:    0.0337 * H * (1 + 0.50 * dw) * (1 + 0.10 * mus)
    };

    const legX = R.hipRX * 0.50;
    const armX = (k) => R.shldrW * k;
    const bellyZ = Math.max(0, dw) * 0.016 * H;

    /* ---------- 材质 ---------- */
    const skinM = mat(a.skin, { roughness: 0.66 });
    const hairM = mat(a.hairColor, { roughness: 0.58, side: THREE.DoubleSide });
    const browM = mat('#2a2018', { roughness: 0.72 });
    const scleraM = mat('#f2efe9', { roughness: 0.34 });
    const irisM = mat('#20242e', { roughness: 0.22 });
    const mouthM = mat('#5d3a35', { roughness: 0.72 });

    const topItem = itemOf(a.outfit.top);
    const botItem = itemOf(a.outfit.bottom);
    const shoeItem = itemOf(a.outfit.shoes);
    const accItem = itemOf(a.outfit.accessory);

    const topM = topItem ? mat(topItem.color, { roughness: 0.82 }) : skinM;
    const botM = botItem ? mat(botItem.color, { roughness: 0.84 }) : mat('#7d828f', { roughness: 0.84 });
    const shoeM = mat(shoeItem ? shoeItem.color : '#2a2d38', { roughness: 0.55, metalness: 0.06 });

    /* ============ 1. 腿（踝 → 小腿 → 膝 → 大腿） ============ */
    const LEG = [
      { y: 0.052, r: null, k: 'ankle', f: 1.05 },
      { y: 0.110, r: null, k: 'ankle', f: 1.34 },
      { y: 0.175, r: null, k: 'calf', f: 1.00 },
      { y: 0.225, r: null, k: 'calf', f: 0.92 },
      { y: 0.268, r: null, k: 'knee', f: 0.97 },
      { y: 0.280, r: null, k: 'knee', f: 1.00 },
      { y: 0.305, r: null, k: 'knee', f: 0.99 },
      { y: 0.350, r: null, k: 'thigh', f: 0.88 },
      { y: 0.400, r: null, k: 'thigh', f: 1.00 },
      { y: 0.445, r: null, k: 'thigh', f: 1.08 },
      { y: 0.478, r: null, k: 'thigh', f: 1.04 }
    ];
    const legRings = LEG.map((q) => {
      const rr = R[q.k] * q.f;
      return { y: q.y * H, rx: rr, rz: rr * 0.94, z: 0 };
    });
    const legRingsLow = legRings.filter((q) => q.y <= 0.480 * H);

    for (const s of [-1, 1]) {
      mesh(surface(legRings, 20, { capBottom: true, capTop: true }), botM, { p: [s * legX, 0, 0] });
    }

    /* ============ 2. 鞋（脚背弧度 + 前掌后跟） ============ */
    const footRings = [
      { y: 0.000 * H, rx: 0.0245 * H, rz: 0.0715 * H, z: 0.020 * H },   // 鞋底
      { y: 0.004 * H, rx: 0.0268 * H, rz: 0.0750 * H, z: 0.020 * H },
      { y: 0.014 * H, rx: 0.0268 * H, rz: 0.0680 * H, z: 0.019 * H },
      { y: 0.028 * H, rx: 0.0262 * H, rz: 0.0530 * H, z: 0.015 * H },
      { y: 0.044 * H, rx: 0.0255 * H, rz: 0.0360 * H, z: 0.008 * H },
      { y: 0.058 * H, rx: 0.0255 * H, rz: 0.0290 * H, z: 0.002 * H }    // 脚踝口
    ];
    for (const s of [-1, 1]) {
      mesh(surface(footRings, 20, { capTop: true, capBottom: true }), shoeM, { p: [s * legX, 0, 0] });
    }

    /* ============ 3. 躯干 + 颈（一体放样，肩部无接缝） ============ */
    const torsoRings = [
      { y: 0.458 * H, rx: R.hipRX * 0.95, rz: R.hipRZ * 0.90, z: -0.010 * H * (1 + 0.4 * dw) },
      { y: 0.505 * H, rx: R.hipRX, rz: R.hipRZ, z: -0.013 * H * (1 + 0.4 * dw) },
      { y: 0.552 * H, rx: R.hipRX * 0.93, rz: R.hipRZ * 0.90, z: -0.006 * H },
      { y: 0.618 * H, rx: R.waistRX, rz: R.waistRZ, z: bellyZ },
      { y: 0.668 * H, rx: R.waistRX * 1.09, rz: R.waistRZ * 1.22, z: bellyZ * 0.5 },
      { y: 0.725 * H, rx: R.chestRX, rz: R.chestRZ, z: 0 },
      { y: 0.775 * H, rx: R.chestRX * 0.99, rz: R.chestRZ * 0.94, z: 0 },
      { y: 0.806 * H, rx: R.chestRX * 0.94, rz: R.chestRZ * 0.80, z: 0 },
      { y: 0.820 * H, rx: R.shldrW * 0.97, rz: R.chestRZ * 0.70, z: 0 },
      { y: 0.834 * H, rx: R.neck * 1.95, rz: R.chestRZ * 0.54, z: 0 },
      { y: 0.845 * H, rx: R.neck * 1.30, rz: R.neck * 1.16, z: 0 },
      { y: 0.858 * H, rx: R.neck * 1.03, rz: R.neck * 1.05, z: 0 },
      { y: 0.872 * H, rx: R.neck * 0.93, rz: R.neck * 0.98, z: 0 },
      { y: 0.882 * H, rx: R.neck * 0.80, rz: R.neck * 0.86, z: 0 },
      { y: 0.891 * H, rx: R.neck * 0.64, rz: R.neck * 0.70, z: 0 }
    ];
    torsoMesh = mesh(surface(torsoRings, 26, { capBottom: true, capTop: true }), topM, {});

    /* ============ 4. 手臂（上臂 / 肘 / 前臂 / 腕） ============ */
    const ARM = [
      { y: 0.462, k: 'wrist', f: 1.00 },
      { y: 0.500, k: 'foreArm', f: 0.92 },
      { y: 0.556, k: 'foreArm', f: 1.00 },
      { y: 0.606, k: 'foreArm', f: 0.98 },
      { y: 0.625, k: 'foreArm', f: 1.03 },       // 肘
      { y: 0.664, k: 'upArm', f: 0.93 },
      { y: 0.720, k: 'upArm', f: 1.00 },
      { y: 0.772, k: 'upArm', f: 1.06 },
      { y: 0.800, k: 'upArm', f: 1.10 },         // 三角肌
      { y: 0.822, k: 'upArm', f: 0.86 }
    ];
    const armRings = ARM.map((q) => {
      const rr = R[q.k] * q.f;
      return { y: q.y * H, rx: rr, rz: rr * 0.96, z: 0 };
    });
    for (const s of [-1, 1]) {
      const g = surface(armRings, 18, { capBottom: true, capTop: true });
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const yv = p.getY(i);
        const t = clamp((yv - 0.462 * H) / (0.822 * H - 0.462 * H), 0, 1);
        const k = 0.86 - t * 0.085;               // 肩 0.775 → 腕 0.86
        p.setX(i, p.getX(i) + s * armX(k));
      }
      g.computeVertexNormals();
      mesh(g, topM, {});
    }

    /* ============ 5. 手（掌 + 并指 + 拇指，非球体） ============ */
    const handRings = [
      { y: 0.378 * H, rx: 0.0115 * H, rz: 0.0062 * H, z: 0.002 * H },
      { y: 0.392 * H, rx: 0.0140 * H, rz: 0.0068 * H, z: 0.002 * H },
      { y: 0.412 * H, rx: 0.0150 * H, rz: 0.0074 * H, z: 0.001 * H },
      { y: 0.432 * H, rx: 0.0155 * H, rz: 0.0080 * H, z: 0 },
      { y: 0.452 * H, rx: 0.0145 * H, rz: 0.0082 * H, z: 0 },
      { y: 0.464 * H, rx: 0.0128 * H, rz: 0.0080 * H, z: 0 }
    ];
    for (const s of [-1, 1]) {
      mesh(surface(handRings, 14, { capTop: true, capBottom: true }), skinM, { p: [s * armX(0.855), 0, 0] });
      mesh(new THREE.SphereGeometry(1, 10, 8), skinM, {
        p: [s * (armX(0.855) - 0.0132 * H), 0.437 * H, 0.004 * H],
        r: [0.30, 0, s * 0.45],
        s: [0.0056 * H, 0.0155 * H, 0.0068 * H]
      });
    }

    /* ============ 6. 头 ============ */
    mesh(surface(HEAD.map((r) => ({ y: r.y * H, rx: r.rx * H, rz: r.rz * H, z: r.z * H })), 30,
      { capBottom: true, capTop: true }), skinM, {});

    /* ---------- 面部 ---------- */
    const noseRings = [
      { y: 0.898 * H, rx: 0.0058 * H, rz: 0.0050 * H, z: 0.0470 * H },
      { y: 0.908 * H, rx: 0.0082 * H, rz: 0.0098 * H, z: 0.0518 * H },
      { y: 0.918 * H, rx: 0.0078 * H, rz: 0.0104 * H, z: 0.0542 * H },
      { y: 0.926 * H, rx: 0.0056 * H, rz: 0.0074 * H, z: 0.0520 * H }
    ];
    mesh(surface(noseRings, 12, { capTop: true, capBottom: true }), skinM, {});
    for (const s of [-1, 1]) {                                       // 鼻翼
      mesh(new THREE.SphereGeometry(1, 10, 8), skinM, {
        p: [s * 0.0090 * H, 0.9000 * H, 0.0480 * H],
        s: [0.0042 * H, 0.0034 * H, 0.0046 * H]
      });
    }
    for (const s of [-1, 1]) {                                       // 眼：眼白 + 虹膜
      const ex = s * 0.0215 * H, ey = 0.9265 * H;
      const ez = (faceZ(0.9215, 0.0215) - 0.0022) * H;
      mesh(new THREE.SphereGeometry(1, 12, 10), scleraM, {
        p: [ex, ey, ez], s: [0.0086 * H, 0.0050 * H, 0.0050 * H]
      });
      mesh(new THREE.SphereGeometry(1, 10, 8), irisM, {
        p: [ex, ey - 0.0003 * H, ez + 0.0036 * H], s: [0.0036 * H, 0.0036 * H, 0.0022 * H]
      });
    }
    for (const s of [-1, 1]) {                                       // 眉
      mesh(new THREE.BoxGeometry(0.0215 * H, 0.0038 * H, 0.0052 * H), browM, {
        p: [s * 0.0222 * H, 0.9372 * H, (faceZ(0.9340, 0.0222) - 0.0016) * H],
        r: [0.10, 0, s * -0.07]
      });
    }
    mesh(new THREE.SphereGeometry(1, 14, 8), mouthM, {                // 口
      p: [0, 0.8842 * H, (faceZ(0.8842, 0) - 0.0032) * H],
      s: [0.0132 * H, 0.0026 * H, 0.0034 * H]
    });
    for (const s of [-1, 1]) {                                       // 耳
      mesh(new THREE.SphereGeometry(1, 12, 10), skinM, {
        p: [s * 0.0452 * H, 0.9200 * H, -0.0010 * H],
        r: [0, 0, s * 0.12],
        s: [0.0050 * H, 0.0112 * H, 0.0068 * H]
      });
    }

    /* ============ 7. 头发 ============ */
    const st = a.hairStyle;
    if (st === 'buzz') {
      mesh(hairGeo(H, 0.952, 0.928, 1.014, 26), hairM, {});
    } else if (st !== 'bald') {
      mesh(hairGeo(H, 0.944, 0.905, 1.045, 26), hairM, {});
      if (st === 'long') {
        const backRings = [
          { y: 0.700 * H, rx: 0.0460 * H, rz: 0.0300 * H, z: -0.0340 * H },
          { y: 0.760 * H, rx: 0.0500 * H, rz: 0.0330 * H, z: -0.0350 * H },
          { y: 0.820 * H, rx: 0.0520 * H, rz: 0.0355 * H, z: -0.0345 * H },
          { y: 0.870 * H, rx: 0.0520 * H, rz: 0.0380 * H, z: -0.0290 * H },
          { y: 0.910 * H, rx: 0.0490 * H, rz: 0.0400 * H, z: -0.0180 * H },
          { y: 0.940 * H, rx: 0.0450 * H, rz: 0.0430 * H, z: -0.0080 * H }
        ];
        mesh(surface(backRings, 20, { capBottom: true }), hairM, {});
      }
      if (st === 'ponytail') {
        mesh(new THREE.SphereGeometry(1, 16, 12), hairM, {
          p: [0, 0.952 * H, -0.0620 * H], s: [0.0225 * H, 0.0210 * H, 0.0155 * H]
        });
        const tail = [
          { y: 0.760 * H, rx: 0.0105 * H, rz: 0.0105 * H, z: -0.0620 * H },
          { y: 0.815 * H, rx: 0.0165 * H, rz: 0.0165 * H, z: -0.0640 * H },
          { y: 0.870 * H, rx: 0.0210 * H, rz: 0.0205 * H, z: -0.0650 * H },
          { y: 0.915 * H, rx: 0.0225 * H, rz: 0.0210 * H, z: -0.0640 * H },
          { y: 0.945 * H, rx: 0.0195 * H, rz: 0.0180 * H, z: -0.0620 * H }
        ];
        mesh(surface(tail, 16, { capTop: true, capBottom: true }), hairM, {});
      }
    }

    /* ============ 8. 衣橱外壳（上装 / 下装） ============ */
    const pad = 0.0075 * H;
    if (topItem) {
      const topRings = torsoRings.slice(2, 9)
        .map((r) => ({ y: r.y, rx: r.rx + pad, rz: r.rz + pad * 1.07, z: r.z }));
      topRings.unshift({
        y: 0.446 * H, rx: R.hipRX * 0.97 + pad, rz: R.hipRZ * 0.93 + pad * 1.07,
        z: -0.010 * H * (1 + 0.4 * dw)
      });
      topRings.push({ y: 0.828 * H, rx: R.chestRX * 0.94 + pad, rz: R.chestRZ * 0.80 + pad * 1.07, z: 0 });
      topRings.push({ y: 0.836 * H, rx: R.neck * 1.86 + pad, rz: R.chestRZ * 0.52 + pad * 1.07, z: 0 });
      mesh(surface(topRings, 26, { capBottom: true, capTop: true }), topM, {});
    }
    if (botItem) {
      const hipRings = [
        { y: 0.470 * H, rx: R.hipRX * 1.02 + pad, rz: R.hipRZ * 0.98 + pad, z: -0.011 * H * (1 + 0.4 * dw) },
        { y: 0.505 * H, rx: R.hipRX + pad, rz: R.hipRZ + pad, z: -0.013 * H * (1 + 0.4 * dw) },
        { y: 0.552 * H, rx: R.hipRX * 0.94 + pad, rz: R.hipRZ * 0.91 + pad, z: -0.006 * H },
        { y: 0.612 * H, rx: R.waistRX + pad, rz: R.waistRZ + pad, z: bellyZ }
      ];
      mesh(surface(hipRings, 24, { capBottom: true, capTop: true }), botM, {});
      for (const s of [-1, 1]) {
        const g = surface(legRingsLow.map((q) => ({
          y: q.y, rx: q.rx + pad * 0.95, rz: q.rz + pad * 0.95, z: q.z
        })), 20, { capBottom: true, capTop: true });
        mesh(g, botM, { p: [s * legX, 0, 0] });
      }
    }

    /* ============ 9. 配饰 ============ */
    if (accItem) {
      const isGlass = accItem.kind === 'glasses';
      const accM = mat(accItem.color || '#22222a', {
        roughness: isGlass ? 0.35 : 0.72,
        metalness: isGlass ? 0.25 : 0.05
      });
      const eyeY = 0.926 * H;
      if (isGlass) {
        for (const s of [-1, 1]) {
          mesh(new THREE.TorusGeometry(0.0125 * H, 0.0022 * H, 8, 22), accM, {
            p: [s * 0.0215 * H, eyeY, (faceZ(0.926, 0.0215) - 0.0018) * H]
          });
        }
        mesh(new THREE.BoxGeometry(0.0105 * H, 0.0020 * H, 0.0020 * H), accM, {
          p: [0, eyeY + 0.0006 * H, (faceZ(0.926, 0) - 0.0024) * H]
        });
        for (const s of [-1, 1]) {                                    // 镜腿
          mesh(new THREE.BoxGeometry(0.0018 * H, 0.0018 * H, 0.0420 * H), accM, {
            p: [s * 0.0455 * H, eyeY + 0.0012 * H, -0.0150 * H]
          });
        }
      } else {                                                        // 帽子
        mesh(new THREE.CylinderGeometry(0.0480 * H, 0.0500 * H, 0.0380 * H, 24), accM, {
          p: [0, 0.9680 * H, 0]
        });
        mesh(new THREE.CylinderGeometry(0.0700 * H, 0.0700 * H, 0.0075 * H, 28), accM, {
          p: [0, 0.9500 * H, 0.0180 * H]
        });
      }
    }

    /* ---------- 相机适配身高 ---------- */
    camDist = 1.45 + H * 0.86;
    camHeight = Y.shldr * 0.94;
    lookY = H * 0.52;
    camera.position.set(0, camHeight, camDist);
    camera.lookAt(0, lookY, 0);
  }

  /* ============================================================
     场景初始化
     ============================================================ */
  function init() {
    // v1.4.0 起中央舞台改为「分层 2D 立绘」（见 js/portrait.js）。
    // 3D 渲染路径整体休眠：不再建 WebGL 上下文、不再依赖 Three.js CDN。
    // 保留代码以便随时用 git checkout v1.3.0 回滚，或后续做「3D / 立绘」双模式开关。
    if (typeof THREE === 'undefined') return;   // 无 Three.js 时静默跳过
    const container = document.getElementById('avatar-canvas');
    if (!container || initialized) return;
    initialized = true;

    const w = container.clientWidth || 600, hgt = container.clientHeight || 400;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, hgt);
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    else if ('outputEncoding' in renderer && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    if ('toneMapping' in renderer && THREE.ACESFilmicToneMapping) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
    }
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(36, w / hgt, 0.1, 60);

    // 暗场三点打光：主光（前上左）+ 冷补光（右）+ 青色轮廓光（后）
    scene.add(new THREE.HemisphereLight(0x9ab2d8, 0x0a0c12, 0.72));
    const key = new THREE.DirectionalLight(0xfff4e8, 1.35); key.position.set(1.8, 3.6, 2.8); scene.add(key);
    const fill = new THREE.DirectionalLight(0x8fb4e8, 0.42); fill.position.set(-2.8, 1.2, 1.6); scene.add(fill);
    const rim = new THREE.DirectionalLight(0x3ce8b0, 0.85); rim.position.set(-1.4, 2.0, -3.0); scene.add(rim);
    const rim2 = new THREE.DirectionalLight(0x4cc9f0, 0.35); rim2.position.set(2.2, 1.0, -2.2); scene.add(rim2);

    // 舞台：圆盘 + 信号青光环
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(0.85, 48),
      new THREE.MeshStandardMaterial({ color: 0x0d1017, roughness: 0.96 })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 0.895, 64),
      new THREE.MeshBasicMaterial({ color: 0x3ce8b0, transparent: true, opacity: 0.42, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002;
    scene.add(ring);

    modelGroup = new THREE.Group();
    scene.add(modelGroup);
    build();

    /* 交互：拖动旋转 / 滚轮缩放 */
    container.addEventListener('pointerdown', (e) => {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      container.setPointerCapture(e.pointerId);
    });
    container.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      modelGroup.rotation.y += (e.clientX - lastX) * 0.011;
      camHeight = clamp(camHeight - (e.clientY - lastY) * 0.003, 0.2, 2.4);
      lastX = e.clientX; lastY = e.clientY;
    });
    container.addEventListener('pointerup', () => (dragging = false));
    container.addEventListener('pointercancel', () => (dragging = false));
    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      camDist = clamp(camDist + e.deltaY * 0.0022, 1.4, 6);
    }, { passive: false });

    window.addEventListener('resize', onResize);

    const clock = new THREE.Clock();
    (function animate() {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      // 呼吸：胸廓轻微扩张
      if (torsoMesh) {
        const b = 1 + Math.sin(t * 1.55) * 0.009;
        torsoMesh.scale.set(b, 1 + Math.sin(t * 1.55) * 0.004, b);
      }
      // 微幅重心摆动
      modelGroup.position.y = Math.sin(t * 1.55) * 0.0018;
      modelGroup.rotation.z = Math.sin(t * 0.62) * 0.0055;
      camera.position.set(0, camHeight, camDist);
      camera.lookAt(0, lookY, 0);
      renderer.render(scene, camera);
    })();
  }

  function onResize() {
    const container = document.getElementById('avatar-canvas');
    if (!container || !renderer) return;
    const w = container.clientWidth, hgt = container.clientHeight;
    renderer.setSize(w, hgt);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
  }

  /* ============================================================
     控制面板（体型 / 衣橱）—— 与数据契约保持不变
     ============================================================ */
  const SLOT_NAMES = { top: '上装', bottom: '下装', shoes: '鞋履', accessory: '配饰' };

  function render() {
    const el = document.getElementById('avatar-ctrl');
    if (!el) return;
    const a = A();
    const wardrobe = (slot) => a.wardrobe
      .map((it) => {
        const eq = a.outfit[slot] === it.id;
        return `<button class="chip ${eq ? 'equipped' : ''}" data-equip="${slot}|${it.id}">
          <span class="dot" style="background:${it.color}"></span>${GL.esc(it.name)}${eq ? ' ✓' : ''}
          <span class="x" data-del="${it.id}" title="删除单品">✕</span></button>`;
      }).join('') || '<span class="dim">暂无单品，先在下方添加</span>';

    const outfits = a.outfits.map((o) => `
      <button class="chip" data-apply-outfit="${o.id}">👔 ${GL.esc(o.name)}
        <span class="x" data-del-outfit="${o.id}" title="删除穿搭">✕</span></button>`).join('')
      || '<span class="dim">还没有保存的穿搭方案</span>';

    el.innerHTML = `
    <div class="card">
      <div class="card-head"><span class="card-title">📏 身体参数</span><span class="card-hint">数值实时映射到 3D 模型</span></div>
      <div class="ctl-row"><label>身高 cm</label><input type="range" min="140" max="210" step="1" value="${a.height}" data-p="height"><output>${a.height}</output></div>
      <div class="ctl-row"><label>体重 kg</label><input type="range" min="40" max="130" step="1" value="${a.weight}" data-p="weight"><output>${a.weight}</output></div>
      <div class="ctl-row"><label>肌肉量</label><input type="range" min="0" max="100" step="1" value="${a.muscle}" data-p="muscle"><output>${a.muscle}</output></div>
      <div class="ctl-row"><label>肤色</label><input type="color" value="${a.skin}" data-p="skin"><span class="dim">发色</span><input type="color" value="${a.hairColor}" data-p="hairColor"></div>
      <div class="ctl-row"><label>发型</label>
        <select data-p="hairStyle">
          ${[['short', '短发'], ['buzz', '寸头'], ['long', '长发'], ['ponytail', '马尾'], ['bald', '光头']]
            .map(([v, n]) => `<option value="${v}" ${a.hairStyle === v ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </div>
      <div class="dim" style="margin-top:10px">比例按标准人体测量映射：体重驱动腰/胸/四肢围度，肌肉量驱动肩宽与胸厚度。</div>
    </div>

    <div class="card">
      <div class="card-head"><span class="card-title">👗 AI 衣橱</span><span class="card-hint">点击单品穿 / 脱</span></div>
      ${Object.keys(SLOT_NAMES).map((slot) => `
        <div class="subhead">${SLOT_NAMES[slot]}</div>
        <div class="chips">${wardrobe(slot)}</div>`).join('')}
      <div class="edit-box">
        <div class="form-row">
          <input type="text" id="w-name" placeholder="单品名称，如 黑色卫衣">
          <select id="w-slot">
            <option value="top">上装</option><option value="bottom">下装</option>
            <option value="shoes">鞋履</option><option value="accessory">配饰</option>
          </select>
          <select id="w-kind" hidden><option value="hat">帽子</option><option value="glasses">眼镜</option></select>
          <input type="color" id="w-color" value="#5b6472">
          <button class="btn primary mini" id="w-add">＋录入</button>
        </div>
      </div>
      <div class="subhead">👔 穿搭方案</div>
      <div class="chips">${outfits}</div>
      <div class="edit-box"><button class="btn mini" id="outfit-save">💾 保存当前穿搭为方案</button></div>
    </div>`;
  }

  function bind() {
    const el = document.getElementById('avatar-ctrl');
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';

    el.addEventListener('input', (e) => {
      const p = e.target.dataset.p;
      if (!p) return;
      const a = A();
      a[p] = e.target.type === 'range' ? Number(e.target.value) : e.target.value;
      const out = e.target.parentElement.querySelector('output');
      if (out) out.textContent = a[p];
      build();
    });
    el.addEventListener('change', (e) => { if (e.target.dataset.p) GL.changed(); });

    el.addEventListener('click', (e) => {
      const a = A();
      const equip = e.target.closest('[data-equip]');
      if (equip) {
        const [slot, id] = equip.dataset.equip.split('|');
        a.outfit[slot] = a.outfit[slot] === id ? null : id;
        GL.changed(); build();
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        const id = del.dataset.del;
        if (!confirm('确定删除这件单品吗？')) return;
        a.wardrobe = a.wardrobe.filter((w) => w.id !== id);
        Object.keys(a.outfit).forEach((k) => { if (a.outfit[k] === id) a.outfit[k] = null; });
        GL.changed(); build();
        return;
      }
      const apply = e.target.closest('[data-apply-outfit]');
      if (apply) {
        const o = a.outfits.find((x) => x.id === apply.dataset.applyOutfit);
        if (o) {
          a.outfit = Object.assign({ top: null, bottom: null, shoes: null, accessory: null }, o.slots);
          GL.toast('已换上「' + o.name + '」');
          GL.changed(); build();
        }
        return;
      }
      const delO = e.target.closest('[data-del-outfit]');
      if (delO) {
        if (!confirm('确定删除该穿搭方案吗？')) return;
        a.outfits = a.outfits.filter((x) => x.id !== delO.dataset.delOutfit);
        GL.changed();
        return;
      }
      if (e.target.id === 'w-add') {
        const name = el.querySelector('#w-name').value.trim();
        const slot = el.querySelector('#w-slot').value;
        const color = el.querySelector('#w-color').value;
        if (!name) { GL.toast('先给单品起个名字', 'err'); return; }
        const item = { id: GL.uid(), name, slot, color };
        if (slot === 'accessory') item.kind = el.querySelector('#w-kind').value;
        a.wardrobe.push(item);
        a.outfit[slot] = item.id;
        GL.toast('已录入「' + name + '」并穿上');
        GL.changed(); build();
        return;
      }
      if (e.target.id === 'outfit-save') {
        const name = prompt('给这套穿搭起个名字：');
        if (!name) return;
        a.outfits.push({ id: GL.uid(), name, slots: Object.assign({}, a.outfit) });
        GL.toast('穿搭方案已保存');
        GL.changed();
      }
    });

    el.addEventListener('change', (e) => {
      if (e.target.id === 'w-slot') el.querySelector('#w-kind').hidden = e.target.value !== 'accessory';
    });
  }

  GL.hooks.push(() => { render(); });
  GL.initAvatar = function () { init(); };
  GL.renderAvatarCtrl = function () { render(); bind(); };
  GL.rebuildAvatar = function () { if (initialized && modelGroup) build(); };
})();
