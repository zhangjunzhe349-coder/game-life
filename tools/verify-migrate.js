/* ============================================================
   数据迁移校验：v1（扁平列表）→ v2（分组体系）→ v3（小字照录原文）
   ------------------------------------------------------------
   为什么单独测：迁移逻辑一旦出错，用户的历史记录会静默丢失 ——
   不会报错、不会崩溃，只是数据没了。必须用真实样例断言。
   跑法：node tools/verify-migrate.js
   ============================================================ */
const fs = require('fs');
const path = require('path');

const problems = [];
const ok = [];
const check = (cond, label, detail) => {
  if (cond) ok.push(label);
  else problems.push(label + (detail ? '（' + detail + '）' : ''));
};

/* ---------- 最小桩件：让 storage.js 能在 node 里跑 ---------- */
function boot() {
  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const document = { getElementById: () => null };
  const window = {};
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'storage.js'), 'utf8');
  new Function('window', 'document', 'localStorage', src)(window, document, localStorage);
  /* 单品库是构建产物（tools/build-wardrobe.py → js/wardrobe-data.js）。
     storage.js 的 defaults() 在 load() 时才读它，所以在 load() 之前塞进 window.GL 即可。
     注意必须用参数把 GL 传进去：wardrobe-data.js 开头就是裸 `GL.WARDROBE_LIB = …`，
     在 new Function 的函数体里裸 GL 是解析不到的。 */
  const lib = fs.readFileSync(path.join(__dirname, '..', 'js', 'wardrobe-data.js'), 'utf8');
  new Function('window', 'GL', lib)(window, window.GL);
  return { GL: window.GL, store, localStorage };
}

/* ---------- v1 时期的真实数据形状（照 v1.4.2 的 defaults 造） ---------- */
const v1State = {
  version: 1,
  avatar: {
    height: 175, weight: 68, muscle: 50,
    skin: '#e8b088', hairStyle: 'short', hairColor: '#2b2118',
    wardrobe: [], outfit: { top: null, bottom: null, shoes: null, accessory: null }, outfits: [],
  },
  physiology: { hydration: { cupSize: 250, goal: 2000, remindOn: false, remindMin: 90, logs: [] }, fields: [] },
  attributes: [
    { id: 'a1', name: '⚡ 体能精力', min: 0, max: 100, value: 82, levels: [], history: [{ t: 1, v: 70 }, { t: 2, v: 82 }] },
    { id: 'a2', name: '❤️ 情绪精力', min: 0, max: 100, value: 55, levels: [], history: [] },
    { id: 'a3', name: '🧴 皮肤', min: 0, max: 100, value: 44, levels: [], history: [] },
    { id: 'a4', name: '🦷 牙齿', min: 0, max: 100, value: 71, levels: [], history: [] },
  ],
  skills: [
    { id: 's1', name: '写作能力', emoji: '✍️', xp: 250, xpPerLevel: 100, actions: [], logs: [{ t: 5, xp: 50, note: '旧记录' }] },
    { id: 's2', name: '力量', emoji: '💪', xp: 120, xpPerLevel: 100, actions: [], logs: [] },
    { id: 's3', name: 'small talk闲聊能力', emoji: '💬', xp: 60, xpPerLevel: 100, actions: [], logs: [] },
    { id: 's4', name: '眼界', emoji: '🔭', xp: 30, xpPerLevel: 100, actions: [], logs: [] },
  ],
  life: { birthDate: '1996-06-01', expectancy: 80 },
};

/* ============ 用例 1：全新用户 ============ */
{
  const { GL } = boot();
  GL.load();
  const A = GL.state;

  check(A.attributes.length === 14, '全新：属性 14 项', '实际 ' + A.attributes.length);
  check(A.skills.length === 13, '全新：技能 13 项', '实际 ' + A.skills.length);
  check(A.version === 4, '全新：version = 4', '实际 ' + A.version);

  const groups = [...new Set(A.attributes.map((a) => a.group))];
  check(groups.length === 3 && groups.includes('physio') && groups.includes('mental') && groups.includes('entropy'),
    '全新：属性分 3 组（physio / mental / entropy）', groups.join(','));

  const sgroups = [...new Set(A.skills.map((s) => s.group))];
  check(sgroups.length === 5, '全新：技能分 5 组', sgroups.join(','));

  const negAp = A.attributes.filter((a) => a.polarity === 'neg');
  check(negAp.length === 4, '全新：负向指标 4 项（熵值3 + 困倦度）', '实际 ' + negAp.length);
  const midAp = A.attributes.filter((a) => a.polarity === 'mid');
  check(midAp.length === 2, '全新：双向指标 2 项（社交度、稳定度）', '实际 ' + midAp.length);

  // 负向指标初始值应低于正向，否则新用户看到红长条会误判状态很差
  const negVals = negAp.map((a) => a.value);
  const posVals = A.attributes.filter((a) => a.polarity === 'pos').map((a) => a.value);
  check(Math.max.apply(null, negVals) < Math.min.apply(null, posVals),
    '全新：负向初始值 < 正向初始值（' + negVals.join(',') + ' < ' + posVals.join(',') + '）');

  // 负向反转：熵值低（好事）不该把综合分拉低
  const naive = Math.round(A.attributes.reduce((s, a) => s + a.value, 0) / A.attributes.length);
  const score = GL.overallScore();
  check(score > naive,
    '全新：综合分对负向项取反（' + score + ' > 朴素平均 ' + naive + '）',
    '若相等说明负向项没反转，熵值低会被误算成状态差');

  // 等级文案必须跟极性匹配
  const drowse = A.attributes.find((a) => a.id === 'drowse');
  const topLevel = drowse.levels.slice().sort((x, y) => y.min - x.min)[0].label;
  check(topLevel.indexOf('充沛') === -1, '全新：负向项等级文案不用「充沛」', '实际 ' + topLevel);
}

/* ============ 用例 2：v1 老用户升级 ============ */
{
  const { GL, store } = boot();
  store['gamelife_state_v1'] = JSON.stringify(v1State);
  GL.load();
  const A = GL.state;

  check(A.attributes.length === 14, '迁移：属性换为 14 项新体系', '实际 ' + A.attributes.length);
  check(A.skills.length === 13, '迁移：技能换为 13 项新体系', '实际 ' + A.skills.length);
  check(A.version === 4, '迁移：version 升到 4');

  // 同语义的技能经验必须保住
  const writing = A.skills.find((s) => s.id === 'writing');
  check(writing && writing.xp === 250, '迁移：写作能力 xp 250 保留', writing ? '实际 ' + writing.xp : '未找到');
  check(writing && writing.logs.length === 1, '迁移：写作能力成长记录保留', writing ? '实际 ' + writing.logs.length : '未找到');

  const st = A.skills.find((s) => s.id === 'smalltalk');
  check(st && st.xp === 60, '迁移：small talk xp 60 保留（旧名带后缀也能配对）', st ? '实际 ' + st.xp : '未找到');

  const vision = A.skills.find((s) => s.id === 'vision');
  check(vision && vision.xp === 30, '迁移：眼界 xp 30 保留', vision ? '实际 ' + vision.xp : '未找到');

  // 外貌从属性搬到技能
  const skin = A.skills.find((s) => s.id === 'skin');
  check(!!skin, '迁移：外貌「皮肤」已从属性移入技能');
  const teeth = A.skills.find((s) => s.id === 'teeth');
  check(!!teeth, '迁移：外貌「牙齿」已从属性移入技能');

  // 淘汰项不得残留
  const names = A.attributes.map((a) => a.name).concat(A.skills.map((s) => s.name));
  check(names.indexOf('体能精力') === -1 && names.join('').indexOf('体能精力') === -1,
    '迁移：旧项「体能精力」已淘汰');
  check(names.join('').indexOf('力量') === -1 || !!A.skills.find((s) => s.id === 'muscle'),
    '迁移：旧项「力量」已淘汰（新体系为「肌肉量」）');

  // 迁移后应能正常分组渲染
  const byGroup = GL.attrByGroup();
  check(byGroup.length === 3 && byGroup.every((g) => Array.isArray(g.items)),
    '迁移：GL.attrByGroup() 可用');
  check(GL.groupMean(byGroup[0].items) > 0, '迁移：GL.groupMean() 返回有效值');

  // 二次加载不应重复迁移（幂等）
  GL.load();
  check(GL.state.attributes.length === 14 && GL.state.version === 4,
    '迁移：重复 load 幂等（不会叠加）', '属性 ' + GL.state.attributes.length + ' 项');
}

/* ============ 用例 3：v2 → v3 把「小字」还原成用户原文 ============
   v2（v1.5.0）里我把用户的原文压缩成了短标签，并把 `` —— `` 引导的
   说明整行丢掉了。用户要求「原文里是什么就是什么」。这里断言还原到位，
   且**用户自建的项不被误改**。 */
{
  const { GL, store } = boot();
  GL.load();                                     // 先拿一份 v3 全量数据
  const v2 = JSON.parse(JSON.stringify(GL.state));
  v2.version = 2;
  // 模拟 v2 时代的样子：说明字段整个不存在，小字是我压缩过的
  v2.attributes.forEach((a) => { delete a.note; });
  v2.skills.forEach((s) => { delete s.sub; delete s.note; });
  v2.attributes.find((a) => a.id === 'move').sub = '活动半径';
  v2.attributes.find((a) => a.id === 'diet').sub = '少油少盐';
  v2.attributes.find((a) => a.id === 'social').sub = '环境能量';
  v2.skills.find((s) => s.id === 'smalltalk').name = 'small talk';
  // 用户自己加的一项：迁移必须**原样不动**
  v2.attributes.push({
    id: 'my_own', name: '我的自定义', sub: '（我自己写的）', note: '别动我',
    group: 'physio', polarity: 'pos', min: 0, max: 100, value: 50, levels: [], history: [],
  });

  store['gamelife_state_v1'] = JSON.stringify(v2);
  GL.load();
  const B = GL.state;
  const attr = (id) => B.attributes.find((a) => a.id === id);
  const skill = (id) => B.skills.find((s) => s.id === id);

  check(B.version === 4, '还原：version 升到 4', '实际 ' + B.version);

  check(attr('move').sub === '（活动半径）（久坐值）',
    '还原：运动度小字 = 原文「（活动半径）（久坐值）」', '实际 ' + attr('move').sub);
  check(attr('move').note === '——待家里会头晕',
    '还原：运动度说明 = 原文「——待家里会头晕」', '实际 ' + attr('move').note);
  check(attr('diet').note === '——（少油，少盐，少糖）（地中海饮食，高蛋白）',
    '还原：饮食说明 = 原文（含标点全角括号）', '实际 ' + attr('diet').note);
  check(attr('diet').sub === '', '还原：饮食无小字（原文括号内容属于说明）', '实际 ' + attr('diet').sub);
  check(attr('noise').note.indexOf('\n') !== -1,
    '还原：嘈杂值说明保留原文换行（两行）', JSON.stringify(attr('noise').note));
  check(attr('social').note.indexOf('高质量圈子带来的信息交换') !== -1,
    '还原：社交度说明 = 原文整段未被截断');
  check(attr('stable').note === '——(过低→生活变动大)(会打断很多系统习惯)（过高日复一日又会陷入麻木）',
    '还原：稳定度说明 = 原文', '实际 ' + attr('stable').note);
  check(attr('drowse').sub === '', '还原：困倦度无小字');

  check(skill('muscle').sub === '（细狗——匀称——薄肌）',
    '还原：肌肉量小字 = 原文', '实际 ' + skill('muscle').sub);
  check(skill('speaking').sub === '（口头）', '还原：表达能力小字 = 原文', '实际 ' + skill('speaking').sub);
  check(skill('smalltalk').sub === '（破冰）', '还原：small talk 小字 = 原文', '实际 ' + skill('smalltalk').sub);
  check(skill('smalltalk').name === 'small talk闲聊能力',
    '还原：small talk 名称 = 原文「small talk闲聊能力」', '实际 ' + skill('smalltalk').name);
  check(skill('cardio').sub === '', '还原：心肺无小字（原文就没有）');

  // 用户自建项不能被迁移碰到
  check(attr('my_own') && attr('my_own').name === '我的自定义' && attr('my_own').sub === '（我自己写的）'
    && attr('my_own').note === '别动我',
    '还原：用户自建的项原样保留（迁移只认内置 key）');

  // 历史记录还要在
  const writing = skill('writing');
  check(!!writing, '还原：技能项仍完好');

  // 幂等
  const before = JSON.stringify(B.attributes.map((a) => [a.id, a.sub, a.note]));
  GL.load();
  const after = JSON.stringify(GL.state.attributes.map((a) => [a.id, a.sub, a.note]));
  check(before === after, '还原：重复 load 幂等（小字不会被二次改写）');
}

/* ============ 用例 5：v3 → v4 衣橱换成真实照片素材 ============
   v3 的衣橱是 defaults 里那 4 件**假单品**（只有 color、没有图）。
   用户 2026-09-26 要求整体换成他的 41 件白底图。
   这里守两条线：
     ① 内置占位项必须被换掉，且换成的是 41 件、每件都带 color + box；
     ② **用户自建的单品绝不能静默消失** —— 要留档到 avatar.legacyWardrobe。 */
const v3State = {
  version: 3,
  avatar: {
    height: 175, weight: 68, muscle: 50,
    skin: '#e8b088', hairStyle: 'short', hairColor: '#2b2118',
    wardrobe: [
      { id: 't1', name: '白色T恤', slot: 'top', color: '#f5f5f0' },
      { id: 'b1', name: '深蓝牛仔裤', slot: 'bottom', color: '#3a5a8c' },
      { id: 's1', name: '白色运动鞋', slot: 'shoes', color: '#e8e8e8' },
      { id: 'g1', name: '黑框眼镜', slot: 'accessory', color: '#22222a', kind: 'glasses' },
      { id: 'u1', name: '我自己加的外套', slot: 'top', color: '#123456' },
    ],
    outfit: { top: 't1', bottom: 'b1', shoes: 's1', accessory: 'g1' },
    outfits: [{ id: 'o1', name: '上班那套', slots: { top: 't1', bottom: 'b1', shoes: null, accessory: null } }],
  },
  physiology: { hydration: { cupSize: 250, goal: 2000, remindOn: false, remindMin: 90, logs: [] }, fields: [] },
  attributes: [], skills: [],
  life: { birthDate: '1996-06-01', expectancy: 80 },
};

{
  const { GL, store } = boot();
  store['gamelife_state_v1'] = JSON.stringify(v3State);
  GL.load();
  const A = GL.state;

  check(A.version === 4, '衣橱：version 升到 4', '实际 ' + A.version);
  check(A.avatar.wardrobe.length === 41, '衣橱：换成 41 件照片素材', '实际 ' + A.avatar.wardrobe.length);
  check(A.avatar.wardrobe.every((w) => w.color && Array.isArray(w.box) && w.box.length === 4),
    '衣橱：每件都带 color 与 box（立绘贴图要用）');
  check(A.avatar.wardrobe.filter((w) => w.slot === 'top').length === 24
    && A.avatar.wardrobe.filter((w) => w.slot === 'bottom').length === 8
    && A.avatar.wardrobe.filter((w) => w.slot === 'shoes').length === 5
    && A.avatar.wardrobe.filter((w) => w.slot === 'accessory').length === 4,
    '衣橱：分类数量 24/8/5/4（上/下/鞋/配饰）');

  const placeholderLeft = A.avatar.wardrobe.filter((w) => w.name === '白色T恤' || w.name === '黑框眼镜');
  check(placeholderLeft.length === 0, '衣橱：旧的 4 件占位单品已移除',
    '实际残留 ' + placeholderLeft.length);

  check(A.avatar.outfit.top === null && A.avatar.outfit.bottom === null
    && A.avatar.outfit.shoes === null && A.avatar.outfit.accessory === null,
    '衣橱：outfit 四个槽位已清空（旧 id 已失效）');

  check(A.avatar.legacyWardrobe.length === 1
    && A.avatar.legacyWardrobe[0].name === '我自己加的外套',
    '衣橱：用户自建单品留档到 legacyWardrobe，没有静默删除',
    '实际 ' + A.avatar.legacyWardrobe.map((w) => w.name).join('、'));

  check(A.avatar.outfits.length === 1 && A.avatar.outfits[0].name === '上班那套'
    && A.avatar.outfits[0].slots.top === null,
    '衣橱：穿搭方案保住名字、清掉失效槽位');

  // 幂等：第二次 load 不能再搬一遍，也不能把留档清掉
  GL.load();
  check(GL.state.version === 4 && GL.state.avatar.wardrobe.length === 41
    && GL.state.avatar.legacyWardrobe.length === 1,
    '衣橱：重复 load 幂等（不会二次迁移、留档不丢）');
}

/* ============ 输出 ============ */
console.log('=== 数据迁移校验 ===\n');
ok.forEach((s) => console.log('  ✓ ' + s));
if (problems.length) {
  console.log('');
  problems.forEach((s) => console.log('  ✗ ' + s));
  console.log(`\n❌ 迁移校验 ${problems.length} 处问题`);
  process.exit(1);
}
console.log(`\n✅ 全部通过（${ok.length} 项）`);
