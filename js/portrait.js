/* ============ Game Life · 分层 2D 立绘引擎（v2.0.0 方案④） ============
   零外部资源：全部矢量路径用代码画，不用任何图片 / 字体文件。
   完全离线可用（不再依赖 Three.js CDN）。

   分层结构（自下而上 11 层，与衣橱 / 发型 / 肤色 / 体型参数一一对应）：
     1 ground    地面光晕 + 投影
     2 hairBack  后发（长发 / 马尾，先画，被身体压住）
     3 legs      腿（下装：裤子 / 裙）
     4 shoes     鞋
     5 body      躯干 + 颈（上装：上衣 / 外套）
     6 arms      手臂
     7 head      头 + 面部五官
     8 hairFront 前发 / 刘海 / 发际
     9 accBack   配饰后层（无）
    10 accFront  配饰前层（眼镜 / 帽子）
    11 hud       立绘内浮层读数（由 app.js 渲染到 DOM，不在此层）

   体型驱动（与 3D 版同一套人体测量学比例，单位 = 身高 H）：
     肩宽 0.252H · 胸宽 0.183H · 腰宽 0.160H · 髋宽 0.189H
     颌下 0.862H · 眼线 0.926H · 肩线 0.820H · 胯 0.475H · 膝 0.280H
   ============================================================ */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function A() { return GL.state.avatar; }
  function itemOf(id) { return (A().wardrobe || []).find((w) => w.id === id) || null; }

  /* ============================================================
     工具：颜色
     ============================================================ */
  function hex2rgb(hex) {
    let h = String(hex || '#000').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgb2hex(r, g, b) {
    return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  }
  /** amt > 0 提亮，< 0 压暗 */
  function shade(hex, amt) {
    const [r, g, b] = hex2rgb(hex);
    if (amt >= 0) return rgb2hex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
    const k = 1 + amt;
    return rgb2hex(r * k, g * k, b * k);
  }
  function rgba(hex, a) {
    const [r, g, b] = hex2rgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }

  /* ============================================================
     工具：SVG 构造
     ============================================================ */
  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) {
      if (attrs[k] === null || attrs[k] === undefined) continue;
      n.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(n);
    return n;
  }

  /** 三次贝塞尔闭合路径：M p0 → C c1 c2 p1 → C c3 c4 p2 … */
  function curve(pts) {
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i];
      d += ` C ${a[0]} ${a[1]} ${a[2]} ${a[3]} ${a[4]} ${a[5]}`;
    }
    return d;
  }
  const close = (d) => d + ' Z';

  /* ============================================================
     几何定义 —— 画布 680 × 1000（viewBox 同值）
     人物身高 H = 940 画布单位（顶部留 28 给发型，底部留 32 给鞋与投影）
     所有 y 为「自头顶向下」的绝对画布单位 = f × H
     所有横向半径传入 px() 换算成画布单位（KX=940，即 1 单位半径 = 1px）
     ============================================================ */
  const H = 940;                       // 身高对应的画布高度
  const TOP = 28;                      // 头顶在画布中的 y
  /** 自顶比例 → 画布 y */
  const yOf = (f) => TOP + f * H;

  const Y = {
    crown:    TOP,           // 头顶                        28
    hairTop:  TOP - 8,       // 发壳外层                    20
    chrome:   yOf(0.088),    // 眉线                       ≈ 111
    eye:      yOf(0.074),    // 眼线  0.926H 自底           ≈  98
    nose:     yOf(0.120),    // 鼻底                       ≈ 141
    mouth:    yOf(0.140),    // 口线                       ≈ 160
    jaw:      yOf(0.158),    // 颌下  0.862H 自底           ≈ 177
    neck:     yOf(0.168),    // 颈中（颌下 → 肩线之间）      ≈ 186
    shoulder: yOf(0.205),    // 肩线（含斜方肌，故略低于解剖肩）≈ 221
    chest:    yOf(0.310),    // 胸                         ≈ 319
    waist:    yOf(0.420),    // 腰                         ≈ 423
    hip:      yOf(0.525),    // 胯  0.475H 自底             ≈ 522
    crotch:   yOf(0.555),    // 裆                         ≈ 550
    knee:     yOf(0.720),    // 膝  0.280H 自底             ≈ 705
    ankle:    yOf(0.955),    // 踝                         ≈ 926
    foot:     yOf(1.000)     // 脚跟                       ≈ 968
  };

  /* ============================================================
     体型参数：与 3D 版同一套「体重 / 肌肉驱动围度」公式
     ============================================================ */
  function shape() {
    const a = A();
    const dw = clamp((a.weight - 68) / 68, -0.35, 0.55);   // 相对标准体重偏差
    const mus = clamp(a.muscle / 100, 0, 1);

    return {
      dw, mus,
      /* 各关键高度的半宽（以身高 H 为单位，px() 换算成画布单位）
         肩宽 0.252H · 胸宽 0.183H · 腰宽 0.160H · 髋宽 0.189H */
      shoulderW:  0.1260 * (1 + 0.18 * dw) * (1 + 0.14 * mus),
      chestW:     0.0914 * (1 + 0.45 * dw) * (1 + 0.06 * mus),
      waistW:     0.0800 * (1 + 0.85 * dw) * (1 - 0.04 * mus),
      hipW:       0.0943 * (1 + 0.55 * dw),
      thighR:     0.0500 * (1 + 0.55 * dw) * (1 + 0.22 * mus),
      calfR:      0.0337 * (1 + 0.45 * dw) * (1 + 0.20 * mus),
      ankleR:     0.0200 * (1 + 0.35 * dw),
      upArmR:     0.0291 * (1 + 0.50 * dw) * (1 + 0.30 * mus),
      foreArmR:   0.0246 * (1 + 0.45 * dw) * (1 + 0.28 * mus),
      neckR:      0.0337 * (1 + 0.50 * dw) * (1 + 0.10 * mus),
      headW:      0.0440,          // 头半宽 = 0.088H / 2
      belly:      Math.max(0, dw) * 16
    };
  }

  /* ============================================================
     各部位路径生成
     PX：把「以 H 为单位的横向半径」换算成画布横向像素
     画布：宽 680，高 1000；中枢线 x = 340
     横向比例：取 1H 宽 ≈ 200 画布单位（1 单位半径 = 200px）
     ============================================================ */
  const CX = 340;
  const KX = 940;    // 横向放大系数：与身高同尺度，1 单位半径 = 1 画布像素

  const px = (r) => r * KX;   // 半径 → 半宽像素

  /* ---------- 2. 后发（先画，被身体压住） ---------- */
  function hairBack(L, s) {
    const a = A();
    const st = a.hairStyle;
    if (st === 'bald' || st === 'buzz') return;
    const c = a.hairColor, dark = shade(c, -0.28), light = shade(c, 0.14);
    const hw = px(s.headW);
    const top = Y.crown + 6;
    const kh = (Y.jaw + 10 - top) / 2;
    /* 发长：长发垂到胸下，马尾垂到肩下 */
    const yEnd = st === 'long' ? Y.chest + 40 : Y.shoulder + 66;

    if (st === 'long') {
      /* 自颅顶沿头侧向外垂落，到胸下收成柔和的水滴形 */
      const w0 = hw * 2.0, w1 = hw * 2.6;      // 上窄下宽的包裹宽度
      const d = close(curve([
        [CX - hw * 0.6, Y.hairTop, CX - hw * 1.55, top + kh * 0.2, CX - w0, top + kh * 1.0],
        [CX - w1, top + kh * 2.2, CX - w1 * 0.98, Y.shoulder + 10, CX - w1 * 0.86, Y.shoulder + 70],
        [CX - w1 * 0.72, Y.chest - 30, CX - w1 * 0.54, yEnd - 40, CX - w1 * 0.3, yEnd],
        [CX, yEnd + 22, CX, yEnd + 22, CX + w1 * 0.3, yEnd],
        [CX + w1 * 0.54, yEnd - 40, CX + w1 * 0.72, Y.chest - 30, CX + w1 * 0.86, Y.shoulder + 70],
        [CX + w1 * 0.98, Y.shoulder + 10, CX + w1, top + kh * 2.2, CX + w0, top + kh * 1.0],
        [CX + hw * 1.55, top + kh * 0.2, CX + hw * 0.6, Y.hairTop, CX - hw * 0.6, Y.hairTop]
      ]));
      el('path', { d, fill: dark }, L);
      /* 内层亮面：偏左受光的一束 */
      const d2 = close(curve([
        [CX - hw * 0.4, top + kh * 0.4, CX - hw * 1.5, top + kh * 0.8, CX - hw * 1.9, top + kh * 1.6],
        [CX - hw * 2.1, Y.shoulder, CX - hw * 2.0, Y.chest - 60, CX - hw * 1.7, yEnd - 60],
        [CX - hw * 1.2, yEnd - 30, CX - hw * 0.8, yEnd - 70, CX - hw * 0.9, Y.chest - 60],
        [CX - hw * 1.0, Y.shoulder - 20, CX - hw * 0.9, top + kh * 1.2, CX - hw * 0.4, top + kh * 0.4]
      ]));
      el('path', { d: d2, fill: rgba(light, 0.42) }, L);
    } else if (st === 'ponytail') {
      /* 后脑发团（被头骨压住大半）+ 侧垂马尾 */
      const tail = close(curve([
        [CX + hw * 0.7, top + kh * 0.9, CX + hw * 1.9, top + kh * 1.3, CX + hw * 2.3, top + kh * 2.4],
        [CX + hw * 2.6, Y.shoulder - 10, CX + hw * 2.5, Y.shoulder + 40, CX + hw * 2.1, Y.shoulder + 62],
        [CX + hw * 1.7, Y.shoulder + 80, CX + hw * 1.2, Y.shoulder + 70, CX + hw * 1.1, Y.shoulder + 40],
        [CX + hw * 1.0, top + kh * 2.0, CX + hw * 0.7, top + kh * 1.5, CX + hw * 0.7, top + kh * 0.9]
      ]));
      el('path', { d: tail, fill: dark }, L);
      el('path', {
        d: close(curve([
          [CX + hw * 1.1, top + kh * 1.2, CX + hw * 1.7, top + kh * 1.5, CX + hw * 1.95, top + kh * 2.2],
          [CX + hw * 2.1, Y.shoulder - 6, CX + hw * 2.0, Y.shoulder + 30, CX + hw * 1.7, Y.shoulder + 48],
          [CX + hw * 1.45, Y.shoulder + 40, CX + hw * 1.4, top + kh * 2.0, CX + hw * 1.1, top + kh * 1.2]
        ])),
        fill: rgba(light, 0.4)
      }, L);
    }
  }

  /* ---------- 3. 腿（含下装） ---------- */
  function legs(L, s) {
    const botItem = itemOf(A().outfit.bottom);
    const botC = botItem ? botItem.color : shade(A().skin, -0.04);
    const bare = !botItem;
    const isSkirt = botItem && /裙|skirt|dress/i.test(botItem.name);
    const legX = px(s.hipW * 0.52);

    /* 裤装 / 裸腿：两条独立腿 */
    const drawLeg = (sx) => {
      const thigh = px(s.thighR), knee = px(s.thighR * 0.74), calf = px(s.calfR), ankle = px(s.ankleR);
      /* 解剖高度：胯 → 大腿 → 膝 → 小腿（腓肠肌最鼓）→ 踝 */
      const yTop = Y.crotch - 30;                 // 裤腰上缘（塞进上衣下摆里）
      const yThigh = (Y.crotch + Y.knee) / 2;
      const yKnee = Y.knee;
      const yCalf = Y.knee + (Y.ankle - Y.knee) * 0.34;   // 小腿最粗处
      const yHeel = Y.ankle - 2;

      const outline = [
        [CX + sx - thigh * 0.86, yTop, CX + sx - thigh * 1.0, Y.crotch, CX + sx - thigh * 1.02, yThigh],
        [CX + sx - knee * 1.0, yKnee - 30, CX + sx - knee * 0.96, yKnee, CX + sx - calf * 1.06, yCalf],
        [CX + sx - calf * 0.92, yCalf + 50, CX + sx - ankle * 1.04, yHeel - 40, CX + sx - ankle, yHeel],
        [CX + sx + ankle, yHeel, CX + sx + ankle * 1.04, yHeel - 40, CX + sx + calf * 0.92, yCalf + 50],
        [CX + sx + calf * 1.06, yCalf, CX + sx + knee * 0.96, yKnee, CX + sx + knee * 1.0, yKnee - 30],
        [CX + sx + thigh * 1.02, yThigh, CX + sx + thigh * 1.0, Y.crotch, CX + sx + thigh * 0.86, yTop],
        [CX + sx, yTop - 4, CX + sx - thigh * 0.86, yTop, CX + sx - thigh * 0.86, yTop]
      ];
      el('path', { d: close(curve(outline)), fill: bare ? shade(A().skin, -0.04) : botC }, L);

      /* 内侧压暗 */
      el('path', {
        d: close(curve([
          [CX + sx - thigh * 0.86, yTop, CX + sx - thigh * 1.0, Y.crotch, CX + sx - thigh * 1.02, yThigh],
          [CX + sx - knee * 1.0, yKnee - 30, CX + sx - knee * 0.96, yKnee, CX + sx - calf * 1.06, yCalf],
          [CX + sx - calf * 0.92, yCalf + 50, CX + sx - ankle * 1.04, yHeel - 40, CX + sx - ankle, yHeel],
          [CX + sx - ankle * 0.34, yHeel, CX + sx - calf * 0.36, yCalf + 40, CX + sx - knee * 0.36, yKnee],
          [CX + sx - knee * 0.38, yKnee - 26, CX + sx - thigh * 0.38, yThigh, CX + sx - thigh * 0.34, yTop + 20],
          [CX + sx - thigh * 0.6, yTop, CX + sx - thigh * 0.86, yTop, CX + sx - thigh * 0.86, yTop]
        ])),
        fill: rgba('#000000', 0.13)
      }, L);

      /* 外侧高光 */
      el('path', {
        d: `M ${CX + sx + thigh * 0.24} ${Y.crotch} L ${CX + sx + knee * 0.34} ${yKnee - 20} L ${CX + sx + calf * 0.32} ${yCalf + 30} L ${CX + sx + ankle * 0.22} ${yHeel - 20} Z`,
        fill: 'none', stroke: rgba('#ffffff', 0.13), 'stroke-width': 3, 'stroke-linecap': 'round'
      }, L);

      if (bare) {   // 裸腿：膝盖暗面
        el('ellipse', { cx: CX + sx, cy: yKnee + 2, rx: knee * 0.4, ry: 6, fill: rgba(shade(A().skin, -0.16), 0.45) }, L);
      }
    };

    if (isSkirt) {
      // 裙装：先画腿，再覆盖裙摆
      for (const sx of [-legX, legX]) drawLeg(sx);
      const sk0 = px(s.hipW * 1.0) + 4;                     // 裙腰
      const sk1 = px(s.hipW * 1.78);                        // 裙摆
      const yHem = Y.knee - 34;                             // 及膝
      const d = close(curve([
        [CX - sk0, Y.hip - 22, CX - sk0 - 8, Y.hip + 46, CX - sk1 * 0.86, yHem - 92],
        [CX - sk1 * 0.98, yHem - 30, CX - sk1, yHem, CX - sk1 * 0.62, yHem + 12],
        [CX - sk1 * 0.24, yHem + 20, CX + sk1 * 0.24, yHem + 20, CX + sk1 * 0.62, yHem + 12],
        [CX + sk1, yHem, CX + sk1 * 0.98, yHem - 30, CX + sk1 * 0.86, yHem - 92],
        [CX + sk0 + 8, Y.hip + 46, CX + sk0, Y.hip - 22, CX - sk0, Y.hip - 22]
      ]));
      el('path', { d, fill: botC }, L);
      el('path', {
        d: close(curve([
          [CX - sk0, Y.hip - 22, CX - sk0 - 8, Y.hip + 46, CX - sk1 * 0.86, yHem - 92],
          [CX - sk1 * 0.98, yHem - 30, CX - sk1, yHem, CX - sk1 * 0.62, yHem + 12],
          [CX - sk1 * 0.38, yHem + 6, CX - sk1 * 0.28, yHem - 40, CX - sk0 * 0.4, Y.hip + 30],
          [CX - sk0 * 0.6, Y.hip - 10, CX - sk0 * 0.84, Y.hip - 22, CX - sk0, Y.hip - 22]
        ])),
        fill: rgba('#000000', 0.12)
      }, L);
      // 裙摆褶皱
      for (let i = -2; i <= 2; i++) {
        el('path', {
          d: `M ${CX + i * sk0 * 0.28} ${Y.hip + 20} L ${CX + i * sk1 * 0.36} ${yHem + 6}`,
          stroke: rgba('#000000', 0.1), 'stroke-width': 2, fill: 'none'
        }, L);
      }
    } else {
      for (const sx of [-legX, legX]) drawLeg(sx);
    }
  }

  /* ---------- 4. 鞋 ---------- */
  function shoes(L, s) {
    const shoeItem = itemOf(A().outfit.shoes);
    if (!shoeItem) return;
    const c = shoeItem.color, dark = shade(c, -0.3), light = shade(c, 0.22);
    const legX = px(s.hipW * 0.52);
    const aR = px(s.ankleR);
    const w = aR * 1.7;                 // 鞋长（自踝向前后铺开）
    const ySole = Y.foot;               // 鞋底着地
    const yCollar = Y.ankle - 34;       // 鞋口（踝上一段，压住裤脚）

    for (const sx of [-legX, legX]) {
      const dir = sx > 0 ? 1 : -1;      // 鞋头朝外微张
      /* 鞋身：鞋口 → 后跟 → 鞋底 → 鞋头 → 鞋面 */
      const d = close(curve([
        [CX + sx - aR * 1.02, yCollar, CX + sx - w * 0.52, yCollar + 6, CX + sx - w * 0.56, Y.ankle + 6],
        [CX + sx - w * 0.58, ySole - 18, CX + sx - w * 0.5, ySole, CX + sx - w * 0.2, ySole],
        [CX + sx + dir * w * 0.66, ySole, CX + sx + dir * w * 1.0, ySole - 8, CX + sx + dir * w * 1.02, ySole - 22],
        [CX + sx + dir * w * 0.98, ySole - 40, CX + sx + dir * w * 0.62, ySole - 52, CX + sx + dir * w * 0.2, ySole - 50],
        [CX + sx + aR * 0.5, ySole - 48, CX + sx + aR * 0.92, Y.ankle - 40, CX + sx + aR * 1.02, yCollar]
      ]));
      el('path', { d, fill: c }, L);
      /* 鞋底（深色带） */
      el('path', {
        d: close(curve([
          [CX + sx - w * 0.58, ySole - 16, CX + sx - w * 0.5, ySole, CX + sx - w * 0.2, ySole],
          [CX + sx + dir * w * 0.66, ySole, CX + sx + dir * w * 1.0, ySole - 8, CX + sx + dir * w * 1.02, ySole - 20],
          [CX + sx + dir * w * 0.9, ySole - 14, CX + sx + dir * w * 0.4, ySole - 8, CX + sx - w * 0.1, ySole - 8],
          [CX + sx - w * 0.42, ySole - 8, CX + sx - w * 0.54, ySole - 12, CX + sx - w * 0.58, ySole - 16]
        ])),
        fill: dark
      }, L);
      /* 鞋面高光 */
      el('path', {
        d: `M ${CX + sx - w * 0.24} ${yCollar + 8} L ${CX + sx + dir * w * 0.5} ${Y.ankle + 4} L ${CX + sx + dir * w * 0.56} ${ySole - 40}`,
        stroke: rgba(light, 0.45), 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round'
      }, L);
    }
  }

  /* ---------- 5. 躯干 + 颈（含上装） ---------- */
  function body(L, s) {
    const a = A();
    const topItem = itemOf(a.outfit.top);
    const skin = a.skin;

    const sh = px(s.shoulderW), ch = px(s.chestW), wa = px(s.waistW), hi = px(s.hipW);
    const nk = px(s.neckR);
    const belly = s.belly;

    /* 颈 + 躯干一体轮廓（含肩部斜坡与斜方肌过渡） */
    const torso = close(curve([
      [CX - nk * 1.9, Y.neck - 4, CX - sh * 1.02, Y.shoulder - 4, CX - sh, Y.shoulder + 26],
      [CX - sh * 0.995, Y.shoulder + 62, CX - sh * 0.96, Y.chest - 22, CX - ch * 1.02, Y.chest],
      [CX - ch * 0.985, Y.chest + 44, CX - (ch * 0.9), Y.waist - 42, CX - wa * 1.02, Y.waist - 8],
      [CX - wa, Y.waist + 10, CX - wa * 1.04, Y.hip - 44, CX - hi * 0.99, Y.hip - 12],
      [CX - hi, Y.hip + 16, CX - hi - 4, Y.crotch + 26, CX - hi * 0.7, Y.crotch + 40],
      [CX - hi * 0.16, Y.crotch + 44, CX + hi * 0.16, Y.crotch + 44, CX + hi * 0.7, Y.crotch + 40],
      [CX + hi + 4, Y.crotch + 26, CX + hi, Y.hip + 16, CX + hi * 0.99, Y.hip - 12],
      [CX + wa * 1.04, Y.hip - 44, CX + wa, Y.waist + 10, CX + wa * 1.02, Y.waist - 8],
      [CX + (ch * 0.9), Y.waist - 42, CX + ch * 0.985, Y.chest + 44, CX + ch * 1.02, Y.chest],
      [CX + sh * 0.96, Y.chest - 22, CX + sh * 0.995, Y.shoulder + 62, CX + sh, Y.shoulder + 26],
      [CX + sh * 1.02, Y.shoulder - 4, CX + nk * 1.9, Y.neck - 4, CX + nk * 1.3, Y.neck - 26],
      [CX + nk * 0.95, Y.neck - 30, CX + nk * 0.8, Y.jaw + 20, CX + nk * 0.95, Y.jaw + 4],
      [CX + nk * 0.98, Y.jaw - 2, CX - nk * 0.98, Y.jaw - 2, CX - nk * 0.95, Y.jaw + 4],
      [CX - nk * 0.8, Y.jaw + 20, CX - nk * 0.95, Y.neck - 30, CX - nk * 1.3, Y.neck - 26],
      [CX - nk * 1.9, Y.neck - 4, CX - nk * 1.9, Y.neck - 4, CX - nk * 1.9, Y.neck - 4]
    ]));

    if (topItem) {
      /* 上装：躯干轮廓外扩后裁剪出衣摆 */
      const topC = topItem.color;
      const long = /卫衣|外套|夹克|大衣|hoodie|jacket|coat/i.test(topItem.name);
      /* 衣摆：常规款盖到胯下（与裤腰重叠，不留缝隙），长款到大腿中段 */
      const hemY = long ? Y.hip + 150 : Y.crotch + 10;
      const pad = 7;
      /* 上装轮廓：直接由躯干轮廓外扩 pad 得到，保证与身体同形不出现台阶。
         肩部额外走一点圆角，避免布料在斜方肌上折出尖角。 */
      const yNeckBase = Y.shoulder - 4;
      const shirt = close(curve([
        /* 左半：颈根 → 斜方肌 → 三角肌 → 胸 → 腰 → 摆 */
        [CX - nk * 1.9, yNeckBase, CX - sh * 0.68, Y.shoulder - 8, CX - sh * 0.92 - pad * 0.3, Y.shoulder + 6],
        [CX - sh - pad, Y.shoulder + 26, CX - sh - pad, Y.shoulder + 52, CX - sh * 0.98 - pad, Y.chest - 30],
        [CX - ch * 1.02 - pad, Y.chest, CX - ch * 0.985 - pad, Y.chest + 48, CX - ch * 0.9 - pad - 2, Y.waist - 30],
        [CX - wa * 1.02 - pad - 3, Y.waist, CX - wa - pad - 4, Y.waist + 22, CX - wa * 1.06 - pad - 4, hemY - 44],
        [CX - hi * 1.0 - pad, hemY - 16, CX - hi - pad + 2, hemY, CX - hi * 0.4, hemY + 8],
        /* 右半：摆 → 腰 → 胸 → 三角肌 → 斜方肌 → 颈根 */
        [CX + hi * 0.4, hemY + 8, CX + hi + pad - 2, hemY, CX + hi * 1.0 + pad, hemY - 16],
        [CX + wa * 1.06 + pad + 4, hemY - 44, CX + wa + pad + 4, Y.waist + 22, CX + wa * 1.02 + pad + 3, Y.waist],
        [CX + ch * 0.9 + pad + 2, Y.waist - 30, CX + ch * 0.985 + pad, Y.chest + 48, CX + ch * 1.02 + pad, Y.chest],
        [CX + sh * 0.98 + pad, Y.chest - 30, CX + sh + pad, Y.shoulder + 52, CX + sh + pad, Y.shoulder + 26],
        [CX + sh * 0.92 + pad * 0.3, Y.shoulder + 6, CX + sh * 0.68, Y.shoulder - 8, CX + nk * 1.9, yNeckBase],
        /* 领口内圈：贴颈一圈 */
        [CX + nk * 1.06, Y.neck + 2, CX + nk * 0.98, Y.jaw - 4, CX + nk * 0.96, Y.jaw - 4],
        [CX - nk * 0.96, Y.jaw - 4, CX - nk * 0.98, Y.jaw - 4, CX - nk * 1.06, Y.neck + 2],
        [CX - nk * 1.9, yNeckBase, CX - nk * 1.9, yNeckBase, CX - nk * 1.9, yNeckBase]
      ]));
      // 脖子（先画，被衣领压住）
      el('path', {
        d: close(curve([
          [CX - nk * 0.98, Y.jaw - 6, CX - nk * 1.08, Y.jaw + 30, CX - nk * 1.5, Y.neck - 12],
          [CX - nk * 1.9, Y.neck - 4, CX - nk * 1.0, Y.neck + 12, CX, Y.neck + 22],
          [CX + nk * 1.0, Y.neck + 12, CX + nk * 1.9, Y.neck - 4, CX + nk * 1.5, Y.neck - 12],
          [CX + nk * 1.08, Y.jaw + 30, CX + nk * 0.98, Y.jaw - 6, CX - nk * 0.98, Y.jaw - 6]
        ])),
        fill: shade(skin, -0.14)
      }, L);
      el('path', { d: torso, fill: skin }, L);   // 裸露部分（领口下）
      el('path', { d: shirt, fill: topC }, L);

      // 衣物立体：左侧受光、右侧阴影 + 中线折痕
      el('path', {
        d: close(curve([
          [CX + ch * 0.24, Y.shoulder + 40, CX + ch * 0.6, Y.chest, CX + ch * 0.62, Y.chest + 60],
          [CX + wa * 0.66, Y.waist - 20, CX + wa * 0.7, Y.waist + 40, CX + hi * 0.78, hemY - 30],
          [CX + hi * 0.94, hemY - 10, CX + hi * 1.0 + pad, hemY - 16, CX + hi + pad - 2, hemY],
          [CX + hi * 0.4, hemY + 10, CX + hi * 0.1, hemY + 6, CX + ch * 0.3, Y.waist - 30],
          [CX + ch * 0.22, Y.chest + 30, CX + ch * 0.2, Y.chest - 10, CX + ch * 0.24, Y.shoulder + 40]
        ])),
        fill: rgba(shade(topC, -0.32), 0.42)
      }, L);
      el('path', {
        d: `M ${CX - ch * 0.52} ${Y.shoulder + 46} C ${CX - ch * 0.66} ${Y.chest} ${CX - wa * 0.6} ${Y.waist - 30} ${CX - wa * 0.62} ${Y.waist + 30} C ${CX - hi * 0.6} ${Y.hip} ${CX - hi * 0.5} ${hemY - 40} ${CX - hi * 0.44} ${hemY - 6} Z`,
        fill: 'none', stroke: rgba('#ffffff', 0.13), 'stroke-width': 5, 'stroke-linecap': 'round'
      }, L);
      /* 领口：贴颈的圆弧开口，露出一点锁骨（与衣身同色系、仅压暗一档） */
      el('path', {
        d: close(curve([
          [CX - nk * 1.06, Y.neck + 2, CX - nk * 1.06, Y.neck + 16, CX - nk * 0.66, Y.chest - 74],
          [CX, Y.chest - 52, CX, Y.chest - 52, CX + nk * 0.66, Y.chest - 74],
          [CX + nk * 1.06, Y.neck + 16, CX + nk * 1.06, Y.neck + 2, CX + nk * 0.98, Y.jaw - 4],
          [CX, Y.jaw - 4, CX, Y.jaw - 4, CX - nk * 0.98, Y.jaw - 4]
        ])),
        fill: rgba(shade(topC, -0.12), 0.7)
      }, L);
    } else {
      // 裸上身：完整躯干 + 颈
      el('path', {
        d: close(curve([
          [CX - nk * 0.98, Y.jaw - 6, CX - nk * 1.08, Y.jaw + 30, CX - nk * 1.5, Y.neck - 12],
          [CX - nk * 1.9, Y.neck - 4, CX - nk * 1.0, Y.neck + 12, CX, Y.neck + 22],
          [CX + nk * 1.0, Y.neck + 12, CX + nk * 1.9, Y.neck - 4, CX + nk * 1.5, Y.neck - 12],
          [CX + nk * 1.08, Y.jaw + 30, CX + nk * 0.98, Y.jaw - 6, CX - nk * 0.98, Y.jaw - 6]
        ])),
        fill: shade(skin, -0.12)
      }, L);
      el('path', { d: torso, fill: skin }, L);
      // 胸肌 / 腹肌阴影
      el('ellipse', { cx: CX - ch * 0.44, cy: Y.chest + 34, rx: ch * 0.34, ry: 26, fill: rgba(shade(skin, -0.18), 0.42) }, L);
      el('ellipse', { cx: CX + ch * 0.44, cy: Y.chest + 34, rx: ch * 0.34, ry: 26, fill: rgba(shade(skin, -0.18), 0.42) }, L);
      el('path', { d: `M ${CX} ${Y.chest - 30} L ${CX} ${Y.waist + 20}`, stroke: rgba(shade(skin, -0.2), 0.5), 'stroke-width': 4, fill: 'none' }, L);
      if (belly > 0) el('ellipse', { cx: CX, cy: Y.waist + 26, rx: wa * 0.5, ry: 30, fill: rgba('#ffffff', 0.06) }, L);
    }
  }

  /* ---------- 6. 手臂（含上装袖子） ---------- */
  function arms(L, s) {
    const a = A();
    const topItem = itemOf(a.outfit.top);
    const skin = a.skin;
    const topC = topItem ? topItem.color : skin;
    const sh = px(s.shoulderW);
    const up = px(s.upArmR), fo = px(s.foreArmR);

    /* 解剖关键高度：肩关节（肩线 + 一小段）→ 肘（腰线下）→ 腕（胯下） */
    const yShoulderJ = Y.shoulder + 14;
    const yElbow = Y.waist + 46;
    const yWrist = Y.hip + 40;
    const yCuff = yWrist + 14;         // 袖口略过腕

    for (const side of [-1, 1]) {
      /* 上臂中心线：肩线内收一点，让肩头搭在躯干上 */
      const sx = side * sh * 0.9;
      /* 统一用「离身体中线的距离」定义，不再有 inner/outer 歧义：
         inK = 靠躯干一侧的系数，outK = 背离躯干一侧的系数（都取正） */
      const inP = (k) => CX + sx - side * up * k;      // 内侧（朝 CX）
      const outP = (k) => CX + sx + side * up * k;     // 外侧（背离 CX）

      /* 手臂外轮廓：肩头隆起 → 上臂外侧 → 肘 → 前臂外侧 → 腕 → 内侧收回到腋下 */
      const d = close(curve([
        [inP(0.3), yShoulderJ, inP(0.7), yShoulderJ - 12, outP(0.55), yShoulderJ - 16],   // 肩头隆起
        [outP(0.88), yShoulderJ + 26, outP(0.92), Y.chest + 20, outP(0.86), yElbow],      // 上臂外侧
        [outP(0.74), yElbow + 40, outP(0.66), yElbow + 90, outP(0.58), yWrist],           // 前臂外侧
        [outP(0.5), yCuff, inP(0.5), yCuff, inP(0.62), yWrist + 6],                       // 腕底
        [inP(0.7), yElbow + 80, inP(0.72), yElbow + 20, inP(0.7), yElbow],                // 前臂内侧
        [inP(0.64), Y.chest + 20, inP(0.58), yShoulderJ + 30, inP(0.3), yShoulderJ]       // 上臂内侧
      ]));
      el('path', { d, fill: topC }, L);

      /* 内侧阴影：腋下到腕侧 */
      el('path', {
        d: close(curve([
          [inP(0.3), yShoulderJ, inP(0.58), yShoulderJ + 30, inP(0.64), Y.chest + 20],
          [inP(0.7), yElbow, inP(0.72), yElbow + 20, inP(0.7), yElbow + 80],
          [inP(0.62), yWrist + 6, inP(0.5), yCuff, inP(0.5), yCuff - 20],
          [inP(0.44), yElbow + 60, inP(0.42), Y.chest + 30, inP(0.36), yShoulderJ + 20],
          [inP(0.3), yShoulderJ, inP(0.3), yShoulderJ, inP(0.3), yShoulderJ]
        ])),
        fill: rgba(shade(topC, -0.3), 0.38)
      }, L);

      /* 肩头高光 */
      el('ellipse', {
        cx: outP(0.16), cy: yShoulderJ + 14, rx: up * 0.4, ry: up * 0.46,
        fill: rgba('#ffffff', 0.1)
      }, L);

      /* 袖口（仅穿上装时） */
      if (topItem) {
        el('path', {
          d: close(curve([
            [outP(0.58), yWrist, outP(0.62), yCuff, outP(0.52), yCuff + 4],
            [inP(0.5), yCuff + 2, inP(0.66), yCuff, inP(0.66), yWrist],
            [inP(0.4), yWrist - 2, outP(0.2), yWrist - 2, outP(0.58), yWrist]
          ])),
          fill: shade(topC, -0.34)
        }, L);
      }

      /* 手：腕下一小段掌形 */
      el('path', {
        d: close(curve([
          [inP(0.66), yWrist + 2, inP(0.78), yCuff + 14, inP(0.66), yCuff + 40],
          [inP(0.1), yCuff + 54, outP(0.32), yCuff + 46, outP(0.42), yCuff + 20],
          [outP(0.5), yCuff, outP(0.56), yWrist, inP(0.66), yWrist + 2]
        ])),
        fill: topItem ? skin : shade(skin, -0.04)
      }, L);
    }
  }

  /* ---------- 7. 头 + 面部 ---------- */
  function head(L, s) {
    const a = A();
    const skin = a.skin, dark = shade(skin, -0.22), light = shade(skin, 0.16);
    const hw = px(s.headW);                 // 头半宽 = 0.044H ≈ 41px
    const top = Y.crown + 6;                // 颅顶
    const chinY = Y.jaw + 10;               // 颏尖
    const kh = (chinY - top) / 2;           // 头部半高 ≈ 58px

    /* 头骨轮廓：以 (CX, 头中心) 为心，横向 hw、纵向 kh，下颌收窄成卵形 */
    const d = close(curve([
      [CX, top, CX + hw * 0.62, top + kh * 0.06, CX + hw * 0.94, top + kh * 0.52],
      [CX + hw, top + kh * 1.02, CX + hw * 1.0, Y.eye + 2, CX + hw * 0.94, Y.nose - 6],
      [CX + hw * 0.8, Y.mouth + 6, CX + hw * 0.62, chinY - 12, CX + hw * 0.28, chinY],
      [CX, chinY + 2, CX - hw * 0.28, chinY, CX - hw * 0.62, chinY - 12],
      [CX - hw * 0.8, Y.mouth + 6, CX - hw * 0.94, Y.nose - 6, CX - hw * 1.0, Y.eye + 2],
      [CX - hw, top + kh * 1.02, CX - hw * 0.94, top + kh * 0.52, CX - hw * 0.62, top + kh * 0.06],
      [CX, top, CX, top, CX, top]
    ]));
    el('path', { d, fill: skin }, L);

    /* 耳：贴在头部纵向中段（眼线 ↔ 鼻底之间） */
    for (const side of [-1, 1]) {
      el('ellipse', {
        cx: CX + side * hw * 0.98, cy: Y.eye + 26, rx: hw * 0.1, ry: hw * 0.19,
        fill: shade(skin, -0.1)
      }, L);
      el('ellipse', {
        cx: CX + side * hw * 0.98, cy: Y.eye + 26, rx: hw * 0.042, ry: hw * 0.095,
        fill: dark, opacity: 0.5
      }, L);
    }

    /* 侧脸阴影（右侧背光） */
    el('path', {
      d: close(curve([
        [CX + hw * 0.58, top + kh * 0.32, CX + hw * 0.96, top + kh * 0.88, CX + hw * 1.0, Y.eye + 2],
        [CX + hw * 0.94, Y.nose - 6, CX + hw * 0.8, Y.mouth + 6, CX + hw * 0.62, chinY - 12],
        [CX + hw * 0.24, chinY - 4, CX + hw * 0.28, Y.mouth - 2, CX + hw * 0.34, Y.nose - 12],
        [CX + hw * 0.42, Y.eye - 8, CX + hw * 0.46, top + kh * 0.62, CX + hw * 0.58, top + kh * 0.32],
        [CX + hw * 0.58, top + kh * 0.32, CX + hw * 0.58, top + kh * 0.32, CX + hw * 0.58, top + kh * 0.32]
      ])),
      fill: rgba(dark, 0.28)
    }, L);

    /* 发际线阴影（贴在额头上，被前发盖住一部分） */
    el('path', {
      d: close(curve([
        [CX - hw * 0.94, Y.chrome - 20, CX - hw * 0.5, Y.chrome - 34, CX, Y.chrome - 24],
        [CX + hw * 0.5, Y.chrome - 34, CX + hw * 0.94, Y.chrome - 20, CX + hw * 0.99, Y.chrome + 6],
        [CX + hw * 0.6, Y.chrome - 6, CX + hw * 0.2, Y.chrome - 2, CX, Y.chrome - 2],
        [CX - hw * 0.2, Y.chrome - 2, CX - hw * 0.6, Y.chrome - 6, CX - hw * 0.99, Y.chrome + 6],
        [CX - hw * 0.94, Y.chrome - 20, CX - hw * 0.94, Y.chrome - 20, CX - hw * 0.94, Y.chrome - 20]
      ])),
      fill: rgba(dark, 0.14)
    }, L);

    /* 眉 */
    for (const side of [-1, 1]) {
      const bx = CX + side * hw * 0.46;
      el('path', {
        d: `M ${bx - side * hw * 0.26} ${Y.chrome + 5} C ${bx - side * hw * 0.1} ${Y.chrome - 2} ${bx + side * hw * 0.14} ${Y.chrome - 1} ${bx + side * hw * 0.24} ${Y.chrome + 7}`,
        fill: 'none', stroke: shade(a.hairColor || '#2b2118', -0.08),
        'stroke-width': 6, 'stroke-linecap': 'round'
      }, L);
    }

    /* 眼：眼白 + 虹膜 + 上眼睑 + 高光 */
    const eyeTop = Y.eye - 15, eyeBot = Y.eye + 15;
    for (const side of [-1, 1]) {
      const ex = CX + side * hw * 0.47;
      const ew = hw * 0.27;
      // 眼白（杏仁形）
      el('path', {
        d: close(curve([
          [ex - ew, Y.eye + 1, ex - ew * 0.5, eyeTop, ex, eyeTop + 1],
          [ex + ew * 0.6, eyeTop + 2, ex + ew * 1.02, Y.eye - 2, ex + ew * 0.8, eyeBot - 2],
          [ex + ew * 0.2, eyeBot - 1, ex - ew * 0.4, eyeBot + 1, ex - ew * 0.9, eyeBot - 4],
          [ex - ew, Y.eye + 1, ex - ew, Y.eye + 1, ex - ew, Y.eye + 1]
        ])),
        fill: '#f4f1ec'
      }, L);
      // 虹膜
      el('circle', { cx: ex + side * ew * 0.06, cy: Y.eye + 1, r: hw * 0.115, fill: '#3d2f26' }, L);
      el('circle', { cx: ex + side * ew * 0.06, cy: Y.eye + 1, r: hw * 0.058, fill: '#181310' }, L);
      el('circle', { cx: ex + side * ew * 0.06 - hw * 0.035, cy: Y.eye - hw * 0.045, r: hw * 0.03, fill: 'rgba(255,255,255,.9)' }, L);
      // 上眼睑
      el('path', {
        d: `M ${ex - ew} ${Y.eye + 1} C ${ex - ew * 0.5} ${eyeTop} ${ex + ew * 0.6} ${eyeTop + 2} ${ex + ew * 1.02} ${Y.eye - 2}`,
        fill: 'none', stroke: '#241c18', 'stroke-width': 3.4, 'stroke-linecap': 'round'
      }, L);
      // 双眼皮
      el('path', {
        d: `M ${ex - ew * 0.88} ${eyeTop - 7} C ${ex - ew * 0.3} ${eyeTop - 4} ${ex + ew * 0.5} ${eyeTop - 2} ${ex + ew * 0.96} ${Y.eye - 9}`,
        fill: 'none', stroke: rgba(dark, 0.5), 'stroke-width': 2, 'stroke-linecap': 'round'
      }, L);
      // 下眼睑
      el('path', {
        d: `M ${ex - ew * 0.86} ${eyeBot - 3} C ${ex - ew * 0.3} ${eyeBot + 2} ${ex + ew * 0.3} ${eyeBot} ${ex + ew * 0.78} ${eyeBot - 4}`,
        fill: 'none', stroke: rgba(dark, 0.34), 'stroke-width': 2, 'stroke-linecap': 'round'
      }, L);
    }

    /* 鼻：鼻梁阴影 + 鼻头 + 鼻翼 */
    el('path', {
      d: `M ${CX - hw * 0.12} ${Y.eye + 16} C ${CX - hw * 0.2} ${Y.nose - 30} ${CX - hw * 0.26} ${Y.nose - 10} ${CX - hw * 0.3} ${Y.nose - 2}`,
      fill: 'none', stroke: rgba(dark, 0.36), 'stroke-width': 5, 'stroke-linecap': 'round'
    }, L);
    el('path', {
      d: `M ${CX + hw * 0.1} ${Y.eye + 16} C ${CX + hw * 0.18} ${Y.nose - 34} ${CX + hw * 0.24} ${Y.nose - 12} ${CX + hw * 0.3} ${Y.nose - 4}`,
      fill: 'none', stroke: rgba(light, 0.42), 'stroke-width': 5, 'stroke-linecap': 'round'
    }, L);
    el('ellipse', { cx: CX, cy: Y.nose - 4, rx: hw * 0.2, ry: hw * 0.14, fill: shade(skin, 0.06) }, L);
    for (const side of [-1, 1]) {
      el('ellipse', { cx: CX + side * hw * 0.2, cy: Y.nose + 2, rx: hw * 0.09, ry: hw * 0.06, fill: rgba(dark, 0.5) }, L);
      el('circle', { cx: CX + side * hw * 0.17, cy: Y.nose + 4, r: hw * 0.035, fill: rgba('#2a1a12', 0.66) }, L);
    }

    /* 口：唇形 + 唇缝 */
    el('path', {
      d: close(curve([
        [CX - hw * 0.28, Y.mouth, CX - hw * 0.16, Y.mouth - 9, CX, Y.mouth - 7],
        [CX + hw * 0.16, Y.mouth - 9, CX + hw * 0.28, Y.mouth, CX + hw * 0.16, Y.mouth + 11],
        [CX, Y.mouth + 11, CX - hw * 0.16, Y.mouth + 11, CX - hw * 0.28, Y.mouth]
      ])),
      fill: shade(skin, 0.075)
    }, L);
    el('path', {
      d: `M ${CX - hw * 0.26} ${Y.mouth} C ${CX - hw * 0.12} ${Y.mouth + 4} ${CX + hw * 0.12} ${Y.mouth + 4} ${CX + hw * 0.26} ${Y.mouth}`,
      fill: 'none', stroke: rgba('#7a3a36', 0.72), 'stroke-width': 3, 'stroke-linecap': 'round'
    }, L);

    /* 下颌 / 颈部阴影 */
    el('path', {
      d: close(curve([
        [CX - hw * 0.62, Y.mouth + 18, CX - hw * 0.34, chinY, CX, chinY + 2],
        [CX + hw * 0.34, chinY, CX + hw * 0.62, Y.mouth + 18, CX + hw * 0.7, Y.mouth + 6],
        [CX, Y.mouth + 26, CX, Y.mouth + 26, CX - hw * 0.7, Y.mouth + 6]
      ])),
      fill: rgba(dark, 0.22)
    }, L);
  }

  /* ---------- 8. 前发 ---------- */
  function hairFront(L, s) {
    const a = A();
    const st = a.hairStyle;
    if (st === 'bald') return;
    const c = a.hairColor, dark = shade(c, -0.34), light = shade(c, 0.16);
    const hw = px(s.headW);
    const top = Y.crown + 6;                 // 颅顶
    const kh = (Y.jaw + 10 - top) / 2;       // 头部半高
    const bulk = 1.1;                        // 发壳外扩系数

    if (st === 'buzz') {
      el('path', {
        d: close(curve([
          [CX - hw * 1.04, Y.chrome - 10, CX - hw * 1.02, top + kh * 0.5, CX, top - 3],
          [CX + hw * 1.02, top + kh * 0.5, CX + hw * 1.04, Y.chrome - 10, CX + hw * 0.92, Y.chrome - 2],
          [CX + hw * 0.4, Y.chrome - 22, CX - hw * 0.4, Y.chrome - 22, CX - hw * 0.92, Y.chrome - 2]
        ])),
        fill: rgba(dark, 0.62)
      }, L);
      return;
    }

    /* 主发块：外轮廓比头骨大一圈，发际线随发型变化 */
    const frontY = st === 'long' ? Y.chrome + 4 : (st === 'ponytail' ? Y.chrome - 6 : Y.chrome - 4);
    const d = close(curve([
      [CX, top - 6, CX - hw * 0.62, top - 9, CX - hw * 1.10 * bulk, top + kh * 0.58],
      [CX - hw * 1.12 * bulk, top + kh * 1.26, CX - hw * 1.14 * bulk, Y.eye - 8, CX - hw * 1.04, Y.chrome + 10],
      [CX - hw * 0.86, frontY + 12, CX - hw * 0.72, frontY - 2, CX - hw * 0.42, frontY - 12],
      [CX - hw * 0.1, frontY - 8, CX + hw * 0.24, frontY - 4, CX + hw * 0.5, frontY + 4],
      [CX + hw * 0.66, frontY + 16, CX + hw * 0.82, frontY + 4, CX + hw * 1.0, Y.chrome + 8],
      [CX + hw * 1.12 * bulk, Y.eye - 8, CX + hw * 1.14 * bulk, top + kh * 1.26, CX + hw * 1.08 * bulk, top + kh * 0.58],
      [CX + hw * 0.62, top - 9, CX + hw * 0.3, top - 11, CX, top - 6],
      [CX, top - 6, CX, top - 6, CX, top - 6]
    ]));
    el('path', { d, fill: c }, L);

    /* 发丝：沿发流方向的分股高光 */
    for (let i = -3; i <= 3; i++) {
      const t = i / 3;
      el('path', {
        d: `M ${CX + t * hw * 0.84} ${top + kh * 0.28} C ${CX + t * hw * 1.04} ${top + kh * 0.72} ${CX + t * hw * 1.08} ${Y.chrome - 26} ${CX + t * hw * 0.94} ${frontY + 8}`,
        fill: 'none',
        stroke: rgba(i < 0 ? light : dark, i < 0 ? 0.4 : 0.28),
        'stroke-width': 5, 'stroke-linecap': 'round'
      }, L);
    }
    /* 顶部高光带 */
    el('path', {
      d: `M ${CX - hw * 0.68} ${top + kh * 0.46} C ${CX - hw * 0.3} ${top + kh * 0.1} ${CX + hw * 0.3} ${top + kh * 0.1} ${CX + hw * 0.68} ${top + kh * 0.46}`,
      fill: 'none', stroke: rgba(light, 0.5), 'stroke-width': 8, 'stroke-linecap': 'round'
    }, L);

    /* 刘海 */
    if (st === 'short' || st === 'long') {
      el('path', {
        d: close(curve([
          [CX - hw * 0.96, frontY + 8, CX - hw * 0.66, frontY - 6, CX - hw * 0.36, frontY - 16],
          [CX + hw * 0.02, frontY - 10, CX + hw * 0.4, frontY - 2, CX + hw * 0.72, frontY + 6],
          [CX + hw * 0.56, frontY + 24, CX + hw * 0.2, frontY + 18, CX - hw * 0.2, frontY + 22],
          [CX - hw * 0.6, frontY + 26, CX - hw * 0.86, frontY + 22, CX - hw * 0.96, frontY + 8]
        ])),
        fill: dark, opacity: 0.92
      }, L);
    }
    /* 鬓角 */
    for (const side of [-1, 1]) {
      el('path', {
        d: close(curve([
          [CX + side * hw * 1.02, frontY + 6, CX + side * hw * 1.1, Y.eye - 4, CX + side * hw * 1.06, Y.eye + 26],
          [CX + side * hw * 0.96, Y.eye + 30, CX + side * hw * 0.88, Y.eye + 16, CX + side * hw * 0.9, Y.eye - 2]
        ])),
        fill: c
      }, L);
    }
  }

  /* ---------- 10. 配饰 ---------- */
  function accessory(L, s) {
    const acc = itemOf(A().outfit.accessory);
    if (!acc) return;
    const c = acc.color || '#22222a';
    const hw = px(s.headW);
    const top = Y.crown + 6;
    const kh = (Y.jaw + 10 - top) / 2;
    const isGlass = acc.kind === 'glasses';

    if (isGlass) {
      /* 镜片中心对齐瞳孔：眼线略下移一点点，视觉上才「戴在眼睛上」 */
      const eyeY = Y.eye + 4;
      const ew = hw * 0.4, eh = ew * 0.72;
      for (const side of [-1, 1]) {
        el('rect', {
          x: CX + side * (hw * 0.5) - ew / 2, y: eyeY - eh / 2,
          width: ew, height: eh, rx: eh * 0.3,
          fill: rgba('#ffffff', 0.1), stroke: c, 'stroke-width': 3.4
        }, L);
        /* 镜腿：从镜框外缘折向耳根 */
        el('line', {
          x1: CX + side * (hw * 0.5 + ew * 0.5), y1: eyeY - eh * 0.1,
          x2: CX + side * hw * 0.97, y2: eyeY + 2,
          stroke: c, 'stroke-width': 3, 'stroke-linecap': 'round'
        }, L);
      }
      el('line', {
        x1: CX - hw * 0.1, y1: eyeY - eh * 0.1, x2: CX + hw * 0.1, y2: eyeY - eh * 0.1,
        stroke: c, 'stroke-width': 3
      }, L);
    } else {
      // 帽子：帽冠 + 帽檐（帽檐朝前）
      const cw = hw * 1.14;
      el('path', {
        d: close(curve([
          [CX - cw, Y.chrome - 30, CX - cw * 1.02, top + kh * 0.5, CX - cw * 0.4, top - 8],
          [CX + cw * 0.4, top - 8, CX + cw * 1.02, top + kh * 0.5, CX + cw, Y.chrome - 30],
          [CX + cw * 0.5, Y.chrome - 22, CX, Y.chrome - 20, CX - cw * 0.5, Y.chrome - 22],
          [CX - cw * 0.8, Y.chrome - 22, CX - cw, Y.chrome - 26, CX - cw, Y.chrome - 30]
        ])),
        fill: c
      }, L);
      el('path', {
        d: close(curve([
          [CX - cw * 1.06, Y.chrome - 26, CX - cw * 0.6, Y.chrome - 4, CX - cw * 0.1, Y.chrome - 2],
          [CX + cw * 0.6, Y.chrome - 4, CX + cw * 1.28, Y.chrome - 10, CX + cw * 1.32, Y.chrome - 22],
          [CX + cw * 1.06, Y.chrome - 26, CX - cw * 1.06, Y.chrome - 26, CX - cw * 1.06, Y.chrome - 26]
        ])),
        fill: shade(c, -0.24)
      }, L);
      el('path', {
        d: `M ${CX - cw * 0.8} ${Y.chrome - 26} C ${CX - cw * 0.6} ${top + kh * 0.7} ${CX + cw * 0.5} ${top + kh * 0.6} ${CX + cw * 0.82} ${Y.chrome - 28}`,
        fill: 'none', stroke: rgba('#ffffff', 0.16), 'stroke-width': 6, 'stroke-linecap': 'round'
      }, L);
    }
  }

  /* ---------- 1. 地面光晕 + 投影 ---------- */
  function ground(L) {
    /* 投影贴在脚跟下方（画布内，foot ≈ 968，下缘留 32） */
    el('ellipse', { cx: CX, cy: Y.foot + 6, rx: 168, ry: 22, fill: 'rgba(60,232,176,.08)' }, L);
    el('ellipse', { cx: CX, cy: Y.foot + 4, rx: 112, ry: 14, fill: 'rgba(0,0,0,.5)' }, L);
    el('ellipse', { cx: CX, cy: Y.foot + 10, rx: 176, ry: 3, fill: 'rgba(60,232,176,.32)' }, L);
    el('ellipse', { cx: CX, cy: Y.foot + 30, rx: 232, ry: 3.2, fill: 'rgba(60,232,176,.1)' }, L);
  }

  /* ============================================================
     总装：按图层顺序绘制
     ============================================================ */
  function drawAll(svg) {
    const s = shape();
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    /* defs：全局渐变 + 轻微扫描纹理 */
    const defs = el('defs', null, svg);
    const lg = el('linearGradient', { id: 'pl-body', x1: '0', y1: '0', x2: '0.4', y2: '1' }, defs);
    el('stop', { offset: '0', 'stop-color': '#3ce8b0', 'stop-opacity': '0.16' }, lg);
    el('stop', { offset: '1', 'stop-color': '#3ce8b0', 'stop-opacity': '0' }, lg);

    const g = el('g', { 'shape-rendering': 'geometricPrecision' }, svg);
    ground(g, s);
    hairBack(g, s);
    legs(g, s);
    shoes(g, s);
    body(g, s);
    arms(g, s);
    head(g, s);
    hairFront(g, s);
    accessory(g, s);

    /* 整幅轻微高光：自上而下的柔光罩 */
    el('rect', { x: 0, y: 0, width: 680, height: 1000, fill: 'url(#pl-body)', style: 'mix-blend-mode:screen' }, svg);
  }

  /* ============================================================
     对外 API
     ============================================================ */
  function render() {
    const svg = document.getElementById('portrait-svg');
    if (!svg) return;
    drawAll(svg);
  }

  GL.hooks.push(render);
  GL.renderPortrait = render;
  GL.drawPortrait = drawAll;
})();
