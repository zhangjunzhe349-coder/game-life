/* ============ Game Life · 3D 人物形象 & AI 衣橱 ============ */
(function () {
  'use strict';

  let renderer, scene, camera, modelGroup;
  let camDist = 3.4, baseZ = 1;
  let torsoMesh = null, initialized = false;
  let dragging = false, lastX = 0, lastY = 0, camHeight = 1.0, lookY = 1.0;
  const mats = { top: [], bottom: [], shoes: [], skin: [], hair: [], acc: [] };

  function A() { return GL.state.avatar; }

  function itemOf(id) { return A().wardrobe.find((w) => w.id === id) || null; }

  function mkMat(list, color) {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.78, metalness: 0.05 });
    mats[list].push(m);
    return m;
  }

  function clearMats() { Object.keys(mats).forEach((k) => (mats[k].length = 0)); }

  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
  }

  function add(geo, mat, x, y, z, opt) {
    opt = opt || {};
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x || 0, y || 0, z || 0);
    if (opt.rx) mesh.rotation.x = opt.rx;
    if (opt.ry) mesh.rotation.y = opt.ry;
    if (opt.rz) mesh.rotation.z = opt.rz;
    if (opt.sz) mesh.scale.z = opt.sz;
    if (opt.cast !== false) mesh.castShadow = false;
    modelGroup.add(mesh);
    return mesh;
  }

  function build() {
    if (!modelGroup) return;
    disposeGroup(modelGroup);
    while (modelGroup.children.length) modelGroup.remove(modelGroup.children[0]);
    clearMats();
    torsoMesh = null;

    const a = A();
    const h = a.height / 100;
    const w = THREE.MathUtils.clamp(0.8 + ((a.weight - 45) / 45) * 0.5, 0.6, 1.5);
    const m = a.muscle / 100;

    const legH = 0.47 * h, torsoH = 0.30 * h, headR = 0.068 * h, neckH = 0.035 * h;
    const shoulderY = legH + torsoH;
    const torsoR = 0.078 * h * w * (0.9 + 0.25 * m);
    const armR = 0.020 * h * (0.75 + 0.55 * m) * (0.9 + 0.2 * (w - 1));
    const legR = 0.034 * h * (0.8 + 0.45 * m) * (0.85 + 0.3 * (w - 1));
    baseZ = 0.6 + 0.45 * w;

    const skinMat = mkMat('skin', a.skin);
    const topItem = itemOf(a.outfit.top);
    const topMat = topItem ? mkMat('top', topItem.color) : skinMat;
    const botItem = itemOf(a.outfit.bottom);
    const botMat = botItem ? mkMat('bottom', botItem.color) : mkMat('bottom', '#7d828f');
    const shoeItem = itemOf(a.outfit.shoes);
    const shoeMat = mkMat('shoes', shoeItem ? shoeItem.color : '#2a2d38');
    const hairMat = mkMat('hair', a.hairColor);

    /* --- 躯干 --- */
    torsoMesh = add(new THREE.CylinderGeometry(torsoR * 1.08, torsoR * 0.8, torsoH, 22), topMat, 0, legH + torsoH / 2, 0, { sz: baseZ });
    add(new THREE.SphereGeometry(torsoR * 1.08, 18, 14), topMat, 0, shoulderY, 0, { sz: baseZ }); // 肩部圆润
    /* --- 髋部 --- */
    add(new THREE.CylinderGeometry(legR * 1.7, legR * 1.5, 0.08 * h, 18), botMat, 0, legH - 0.02 * h, 0, { sz: 0.85 });

    /* --- 四肢 --- */
    const armLen = 0.30 * h;
    const armTopY = shoulderY - 0.01 * h;
    for (const s of [-1, 1]) {
      // 腿
      add(new THREE.CylinderGeometry(legR, legR * 0.8, legH - 0.05 * h, 16), botMat, s * legR * 1.5, 0.03 * h + (legH - 0.05 * h) / 2, 0);
      // 脚
      add(new THREE.BoxGeometry(0.075 * h, 0.05 * h, 0.16 * h), shoeMat, s * legR * 1.5, 0.026 * h, 0.035 * h);
      // 手臂
      add(new THREE.CylinderGeometry(armR, armR * 0.85, armLen, 14), topMat, s * (torsoR * 1.15 + armR * 0.9), armTopY - armLen / 2, 0, { rz: s * 0.07 });
      // 手
      add(new THREE.SphereGeometry(armR * 1.25, 12, 10), skinMat, s * (torsoR * 1.15 + armR * 1.15), armTopY - armLen, 0);
    }

    /* --- 颈 & 头 --- */
    add(new THREE.CylinderGeometry(0.028 * h, 0.032 * h, neckH, 12), skinMat, 0, shoulderY + neckH / 2, 0);
    const headY = shoulderY + neckH + headR * 0.85;
    add(new THREE.SphereGeometry(headR, 26, 20), skinMat, 0, headY, 0, { sz: 1.05 });
    // 眼睛
    const eyeMat = mkMat('skin', '#1c1c22');
    add(new THREE.SphereGeometry(0.010 * h, 8, 8), eyeMat, -0.028 * h, headY + 0.005 * h, headR * 0.82);
    add(new THREE.SphereGeometry(0.010 * h, 8, 8), eyeMat, 0.028 * h, headY + 0.005 * h, headR * 0.82);

    /* --- 发型 --- */
    const st = a.hairStyle;
    if (st === 'short') {
      add(new THREE.SphereGeometry(headR * 1.07, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat, 0, headY + 0.004 * h, 0, { rx: -0.12, sz: 1.05 });
    } else if (st === 'buzz') {
      add(new THREE.SphereGeometry(headR * 1.03, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), hairMat, 0, headY + 0.002 * h, 0, { sz: 1.05 });
    } else if (st === 'long') {
      add(new THREE.SphereGeometry(headR * 1.07, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat, 0, headY + 0.004 * h, 0, { rx: -0.12, sz: 1.05 });
      add(new THREE.CylinderGeometry(headR * 0.9, headR * 0.7, 0.26 * h, 16), hairMat, 0, headY - 0.10 * h, -headR * 0.55, { sz: 0.6 });
    } else if (st === 'ponytail') {
      add(new THREE.SphereGeometry(headR * 1.07, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat, 0, headY + 0.004 * h, 0, { rx: -0.12, sz: 1.05 });
      add(new THREE.SphereGeometry(headR * 0.42, 14, 12), hairMat, 0, headY + 0.03 * h, -headR * 1.05);
      add(new THREE.CylinderGeometry(0.018 * h, 0.026 * h, 0.15 * h, 10), hairMat, 0, headY - 0.05 * h, -headR * 1.25, { rx: 0.35 });
    }
    /* bald → 无头发 */

    /* --- 配饰 --- */
    const accItem = itemOf(a.outfit.accessory);
    if (accItem) {
      if (accItem.kind === 'glasses') {
        const gm = mkMat('acc', accItem.color || '#22222a');
        const tR = 0.024 * h;
        add(new THREE.TorusGeometry(tR, 0.004 * h, 8, 20), gm, -0.028 * h, headY + 0.005 * h, headR * 0.9);
        add(new THREE.TorusGeometry(tR, 0.004 * h, 8, 20), gm, 0.028 * h, headY + 0.005 * h, headR * 0.9);
        add(new THREE.BoxGeometry(0.018 * h, 0.004 * h, 0.004 * h), gm, 0, headY + 0.006 * h, headR * 0.92);
      } else { // hat
        const hm = mkMat('acc', accItem.color);
        add(new THREE.CylinderGeometry(0.072 * h, 0.076 * h, 0.07 * h, 20), hm, 0, headY + headR * 0.72, 0);
        add(new THREE.CylinderGeometry(0.115 * h, 0.115 * h, 0.014 * h, 24), hm, 0, headY + headR * 0.42, 0);
      }
    }

    /* --- 相机适配身高 --- */
    camDist = 2.0 + h * 0.78;
    camHeight = shoulderY * 0.92;
    lookY = h * 0.54;
    camera.position.set(0, camHeight, camDist);
    camera.lookAt(0, lookY, 0);
  }

  /* ---------- 场景初始化 ---------- */
  function init() {
    const container = document.getElementById('avatar-canvas');
    if (!container || initialized) return;
    if (typeof THREE === 'undefined') {
      container.innerHTML = '<div class="avatar-fallback">3D 引擎加载失败（需联网加载 Three.js）。<br>其余功能不受影响，联网后刷新即可恢复。</div>';
      return;
    }
    initialized = true;

    const w = container.clientWidth || 600, hgt = container.clientHeight || 400;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, hgt);
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, w / hgt, 0.1, 50);

    scene.add(new THREE.HemisphereLight(0xdfe4ff, 0xe9e6f5, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(2.2, 3.4, 2.6); scene.add(key);
    const rim = new THREE.DirectionalLight(0x8f7bff, 0.45); rim.position.set(-2.4, 1.6, -2); scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(0.85, 40),
      new THREE.MeshStandardMaterial({ color: 0xe9e6f7, roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 0.9, 48),
      new THREE.MeshBasicMaterial({ color: 0x5b4df0, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002;
    scene.add(ring);

    modelGroup = new THREE.Group();
    scene.add(modelGroup);
    build();

    /* 交互：拖动旋转 / 滚轮缩放 */
    container.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; container.setPointerCapture(e.pointerId); });
    container.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      modelGroup.rotation.y += (e.clientX - lastX) * 0.011;
      camHeight = THREE.MathUtils.clamp(camHeight - (e.clientY - lastY) * 0.003, 0.2, 2.2);
      lastX = e.clientX; lastY = e.clientY;
    });
    container.addEventListener('pointerup', () => (dragging = false));
    container.addEventListener('pointercancel', () => (dragging = false));
    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      camDist = THREE.MathUtils.clamp(camDist + e.deltaY * 0.0022, 1.4, 6);
    }, { passive: false });

    window.addEventListener('resize', onResize);

    const clock = new THREE.Clock();
    (function animate() {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      if (torsoMesh) {
        torsoMesh.scale.y = 1 + Math.sin(t * 1.7) * 0.014; // 呼吸
        torsoMesh.scale.z = baseZ;
      }
      modelGroup.position.y = Math.sin(t * 1.7) * 0.002;
      camera.position.set(0, camHeight, camDist);
      camera.lookAt(0, lookY, 0);
      renderer.render(scene, camera);
    })();
  }

  let raf = 0;
  function onResize() {
    const container = document.getElementById('avatar-canvas');
    if (!container || !renderer) return;
    const w = container.clientWidth, hgt = container.clientHeight;
    renderer.setSize(w, hgt);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
  }

  /* ---------- 面板控件渲染 ---------- */
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
          <input type="color" id="w-color" value="#7c5cff">
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

    // 参数滑杆 / 颜色 / 发型
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

    // 穿脱 / 删除 / 穿搭
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
        if (o) { a.outfit = Object.assign({ top: null, bottom: null, shoes: null, accessory: null }, o.slots); GL.toast('已换上「' + o.name + '」'); GL.changed(); build(); }
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
      if (e.target.id === 'w-slot') { /* noop */ }
      if (e.target.id === 'outfit-save') {
        const name = prompt('给这套穿搭起个名字：');
        if (!name) return;
        a.outfits.push({ id: GL.uid(), name, slots: Object.assign({}, a.outfit) });
        GL.toast('穿搭方案已保存');
        GL.changed();
      }
    });

    // 配饰类型联动
    el.addEventListener('change', (e) => {
      if (e.target.id === 'w-slot') el.querySelector('#w-kind').hidden = e.target.value !== 'accessory';
    });
  }

  GL.hooks.push(() => { render(); });
  GL.initAvatar = function () { init(); render(); bind(); };
  GL.rebuildAvatar = function () { if (initialized && modelGroup) build(); };
})();
