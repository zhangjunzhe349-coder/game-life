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

  check(A.attributes.length === 16, '全新：属性 16 项（14 + 体温 / 总体力值）', '实际 ' + A.attributes.length);
  check(A.skills.length === 13, '全新：技能 13 项', '实际 ' + A.skills.length);
  check(A.version === 5, '全新：version = 5', '实际 ' + A.version);

  const groups = [...new Set(A.attributes.map((a) => a.group))];
  check(groups.length === 4 && groups.includes('physio') && groups.includes('mental')
    && groups.includes('entropy') && groups.includes('emotion'),
    '全新：属性分 4 组（生理 / 精神 / 熵 / 情绪）', groups.join(','));

  const sgroups = [...new Set(A.skills.map((s) => s.group))];
  check(sgroups.length === 5, '全新：技能分 5 组', sgroups.join(','));

  const negAp = A.attributes.filter((a) => a.polarity === 'neg');
  check(negAp.length === 5, '全新：负向指标 5 项（熵值3 + 困倦度 + 情绪/挫折感）', '实际 ' + negAp.length);
  const midAp = A.attributes.filter((a) => a.polarity === 'mid');
  check(midAp.length === 3, '全新：双向指标 3 项（社交度、稳定度、体温）', '实际 ' + midAp.length);

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

  check(A.attributes.length === 16, '迁移：属性换为 16 项新体系', '实际 ' + A.attributes.length);
  check(A.skills.length === 13, '迁移：技能换为 13 项新体系', '实际 ' + A.skills.length);
  check(A.version === 5, '迁移：version 升到 5');

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
  check(byGroup.length === 4 && byGroup.every((g) => Array.isArray(g.items)),
    '迁移：GL.attrByGroup() 可用');
  check(GL.groupMean(byGroup[0].items) > 0, '迁移：GL.groupMean() 返回有效值');

  // 二次加载不应重复迁移（幂等）
  GL.load();
  check(GL.state.attributes.length === 16 && GL.state.version === 5,
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

  check(B.version === 5, '还原：version 升到 5', '实际 ' + B.version);

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
   用户 2026-09-26 要求整体换成他的 41 件白底图；v1.12.0 又追加 5 件花底抠图（w42–w46）。
   这里守两条线：
     ① 内置占位项必须被换掉，且换成的是 46 件、每件都带 color + box；
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

  check(A.version === 5, '衣橱：version 升到 5（v4→v5 也跑过）', '实际 ' + A.version);
  check(A.avatar.wardrobe.length === 46, '衣橱：换成 46 件照片素材（41 白底 + 5 花底抠图）', '实际 ' + A.avatar.wardrobe.length);
  check(A.avatar.wardrobe.every((w) => w.color && Array.isArray(w.box) && w.box.length === 4),
    '衣橱：每件都带 color 与 box（立绘贴图要用）');
  check(A.avatar.wardrobe.filter((w) => w.slot === 'top').length === 28
    && A.avatar.wardrobe.filter((w) => w.slot === 'bottom').length === 9
    && A.avatar.wardrobe.filter((w) => w.slot === 'shoes').length === 5
    && A.avatar.wardrobe.filter((w) => w.slot === 'bag').length === 3
    && A.avatar.wardrobe.filter((w) => w.slot === 'accessory').length === 1,
    '衣橱：分类数量 28/9/5/3/1（上/下/鞋/包/配饰，v1.12.0 加 4 上 1 下）');

  const new5 = A.avatar.wardrobe.filter((w) => ['w42', 'w43', 'w44', 'w45', 'w46'].indexOf(w.id) !== -1);
  const old41 = A.avatar.wardrobe.filter((w) => ['w42', 'w43', 'w44', 'w45', 'w46'].indexOf(w.id) === -1);
  check(old41.length === 41 && old41.every((w) => w.season === null && w.year === null),
    '衣橱：41 件白底图仍为 season / year 未标注（等用户自己标）');
  check(new5.length === 5 && new5.every((w) => w.year === null)
    && new5.filter((w) => w.season === 'winter').length === 4
    && new5.filter((w) => w.season === 'all').length === 1,
    '衣橱：5 件花底抠图已预标季节（冬装 ×4 · 四季 ×1），年份留空');

  const placeholderLeft = A.avatar.wardrobe.filter((w) => w.name === '白色T恤' || w.name === '黑框眼镜');
  check(placeholderLeft.length === 0, '衣橱：旧的 4 件占位单品已移除',
    '实际残留 ' + placeholderLeft.length);

  check(A.avatar.outfit.top === null && A.avatar.outfit.bottom === null
    && A.avatar.outfit.shoes === null && A.avatar.outfit.bag === null
    && A.avatar.outfit.accessory === null,
    '衣橱：outfit 五个槽位已清空（含新增的 bag，旧 id 已失效）');

  check(A.avatar.legacyWardrobe.length === 1
    && A.avatar.legacyWardrobe[0].name === '我自己加的外套',
    '衣橱：用户自建单品留档到 legacyWardrobe，没有静默删除',
    '实际 ' + A.avatar.legacyWardrobe.map((w) => w.name).join('、'));

  check(A.avatar.outfits.length === 1 && A.avatar.outfits[0].name === '上班那套'
    && A.avatar.outfits[0].slots.top === null,
    '衣橱：穿搭方案保住名字、清掉失效槽位');

  // 幂等：第二次 load 不能再搬一遍，也不能把留档清掉
  GL.load();
  check(GL.state.version === 5 && GL.state.avatar.wardrobe.length === 46
    && GL.state.avatar.legacyWardrobe.length === 1,
    '衣橱：重复 load 幂等（不会二次迁移、留档不丢、重同步不重复加件）');
}

/* ============ 用例 6.5：内置衣橱单品重同步（v1.12.0） ============
   老用户（已是 v5）的数据里只有 41 件快照 —— 新内置件 w42–w46 必须在
   load 时幂等追加，且**绝不碰**用户改过的名字 / 季节 / 年份 / 穿着状态。 */
{
  const { GL, store } = boot();
  GL.load();                                     // 先落一份 v5 全量底稿（46 件）
  const seeded = JSON.parse(JSON.stringify(GL.state));
  // 模拟老用户：衣橱裁回 41 件 + 用户改过 w01 的名字、季节，正穿着 w02
  seeded.avatar.wardrobe = seeded.avatar.wardrobe
    .filter((w) => ['w42', 'w43', 'w44', 'w45', 'w46'].indexOf(w.id) === -1);
  seeded.avatar.wardrobe[0].name = '我最爱的羽绒服';
  seeded.avatar.wardrobe[0].season = 'summer';
  seeded.avatar.wardrobe[1].name = '改过名的裤子';
  seeded.avatar.outfit = { top: seeded.avatar.wardrobe[0].id, bottom: null, shoes: null, bag: null, accessory: null };
  store['gamelife_state_v1'] = JSON.stringify(seeded);

  GL.load();
  const A = GL.state;
  const ids = A.avatar.wardrobe.map((w) => w.id);
  check(A.avatar.wardrobe.length === 46, '重同步：41 件快照补齐到 46 件', '实际 ' + A.avatar.wardrobe.length);
  check(['w42', 'w43', 'w44', 'w45', 'w46'].every((id) => ids.indexOf(id) !== -1),
    '重同步：w42–w46 五件全部追加到位');
  check(ids.slice(-5).join(',') === 'w42,w43,w44,w45,w46',
    '重同步：新件按清单顺序排在末尾');
  check(A.avatar.wardrobe[0].name === '我最爱的羽绒服' && A.avatar.wardrobe[0].season === 'summer',
    '重同步：用户改过的名字 / 季节原样保留');
  check(A.avatar.wardrobe[1].name === '改过名的裤子',
    '重同步：用户改过的第二件也保留');
  check(A.avatar.outfit.top === seeded.avatar.wardrobe[0].id,
    '重同步：穿着状态不受影响');
  GL.load();
  check(GL.state.avatar.wardrobe.length === 46,
    '重同步：重复 load 幂等（不会重复追加）');
}

/* ---------- 内置技能 emoji 重同步（v1.8.2） ----------
   场景：用户数据里躺的是旧 emoji（🫁 / 🪞 —— 本机与老设备缺字形，界面显示成豆腐块）。
   定义表换掉 emoji 后必须能落到老数据上；同时**绝不能碰**用户可编辑的 name / sub / note，
   也不能动用户自建技能自己的 emoji。 */
{
  const { GL, store } = boot();
  GL.load();                                     // 先让 defaults() 落进 store，才有可改的底稿
  const seeded = JSON.parse(JSON.stringify(GL.state));
  seeded.skills.forEach((s) => {
    if (s.id === 'cardio') { s.emoji = '🫁'; s.name = '心肺（我改过名）'; s.sub = '我改过小字'; }
    if (s.id === 'writing') s.emoji = '✍️';      // 本来就对，不应被误改
    if (s.id === 'muscle') s.emoji = '💪';       // 本来就对
  });
  // 用户自建技能：id 不在定义表里，emoji 必须原样保留
  seeded.skills.push({ id: 'u_custom_1', name: '自建技能', sub: '', note: '',
    emoji: '🪞', group: 'misc', xp: 0, xpPerLevel: 100, actions: [], logs: [] });
  store['gamelife_state_v1'] = JSON.stringify(seeded);

  GL.load();
  const A = GL.state;
  const cardio = A.skills.find((s) => s.id === 'cardio');
  const custom = A.skills.find((s) => s.id === 'u_custom_1');

  check(cardio.emoji === '💓', 'emoji：内置技能的旧 emoji 被定义表修正（🫁 → 💓）',
    '实际 ' + cardio.emoji);
  check(cardio.name === '心肺（我改过名）' && cardio.sub === '我改过小字',
    'emoji：重同步不碰用户可编辑的名称 / 小字',
    'name=' + cardio.name + ' sub=' + cardio.sub);
  check(custom && custom.emoji === '🪞',
    'emoji：用户自建技能的 emoji 原样保留（只认内置 id）',
    '实际 ' + (custom ? custom.emoji : '（自建项丢失）'));
  const builtinRisky = A.skills.filter((s) => !String(s.id).startsWith('u_'))
    .filter((s) => /[\u{1FA70}-\u{1FAFF}]/u.test(s.emoji || ''));
  check(builtinRisky.length === 0,
    'emoji：内置技能里不再有 U+1FA70+ 的豆腐块字符',
    '残留 ' + builtinRisky.map((s) => s.name).join('、'));

  // 幂等：再 load 一次结果不变
  GL.load();
  check(GL.state.skills.find((s) => s.id === 'cardio').emoji === '💓',
    'emoji：重复 load 幂等（不会反复改写）');
}

/* ============ 每日必做（v1.10.0） ============
   三条路径都必须守，否则会以「看起来正常」的样子出错：
     ① 全新装 → 默认 5 项（用户截图里那几件事）
     ② 老数据里没有 dailies 字段 → load 时补上（merge 的默认值路径）
     ③ 用户主动删光（[]）→ **必须保持空**，不能被「补默认」又长回来
   ③ 是最容易写错的：把 seed 写成「length === 0 就补」，
   用户删完一刷新全部复活的体验极差。 */
function checkDailies() {
  {
    const b = boot();
    b.GL.load();
    const d = b.GL.state.dailies;
    check(Array.isArray(d) && d.length === 5, '每日必做：全新装默认 5 项',
      '实际 ' + (Array.isArray(d) ? d.length : typeof d));
    check(d[0] && d[0].title === '整理外脑1h' && d[0].note === '这是进化的必备条件',
      '每日必做：默认项逐字照录用户原文（第 1 项）',
      d[0] ? d[0].title + ' / ' + d[0].note : '（无）');
    check(d.every((x) => x.id && x.emoji && !x.doneOn),
      '每日必做：每项都有 id / emoji，且初始为未完成');
    check(d[2].note === '', '每日必做：截图里被省略号截断的小字不瞎猜（第 3 项留空）',
      '实际「' + d[2].note + '」');
  }

  {
    const b = boot();
    b.store['gamelife_state_v1'] = JSON.stringify(v1State);   // v1 数据里根本没有 dailies
    b.GL.load();
    const d = b.GL.state.dailies;
    check(Array.isArray(d) && d.length === 5, '每日必做：老数据升级后补上默认 5 项',
      '实际 ' + (Array.isArray(d) ? d.length : typeof d));
  }

  {
    const b = boot();
    b.GL.load();
    b.GL.state.dailies = [];
    b.GL.save();
    b.GL.load();
    check(Array.isArray(b.GL.state.dailies) && b.GL.state.dailies.length === 0,
      '每日必做：用户主动删光后不会被默认值长回来',
      '实际 ' + (b.GL.state.dailies || []).length);
  }

  {
    const b = boot();
    b.GL.load();
    b.GL.state.dailies[0].doneOn = b.GL.todayKey(Date.now());
    b.GL.save();
    b.GL.load();
    check(b.GL.state.dailies[0].doneOn === b.GL.todayKey(Date.now()),
      '每日必做：完成状态按日期存（不存布尔值，跨日自然失效）');
  }
}
checkDailies();

/* ============ 用例 7：v4 → v5（v1.11.0 三个新属性 + 衣橱分类重整） ============
   为什么单独立一条：前面几条都是从 v1/v3 一路迁上来，混着看会掩盖
   「v4 用户单独升级」这一条最常见路径。这里造一份**标准的 v4 数据**：
     · 没有 temp / stamina 两项
     · mood 还在 mental 组、正向、值 70、有两条历史
     · 三只包还在 accessory
     · 单品没有 season / year，outfit 只有四个槽
   迁移后必须：补齐、情绪值取反并单列、包改类、补字段 —— 且**不覆盖用户改过的名字**。 */
{
  const { GL, store } = boot();
  GL.load();                                     // 拿一份完整 v5 数据当底稿
  const v4 = JSON.parse(JSON.stringify(GL.state));

  v4.version = 4;
  v4.attributes = v4.attributes.filter((a) => a.id !== 'temp' && a.id !== 'stamina');

  const mood = v4.attributes.find((a) => a.id === 'mood');
  mood.group = 'mental';
  mood.polarity = 'pos';
  mood.sub = '';
  mood.value = 70;
  mood.history = [{ t: 1000, v: 70 }, { t: 2000, v: 80 }];
  mood.levels = [{ min: 80, label: '🔥 充沛' }, { min: -999, label: '😫 糟糕' }];

  // 用户改过名字的一项：迁移不许覆盖
  const renamed = v4.attributes.find((a) => a.id === 'sleep');
  renamed.name = '我改的睡眠名';

  // 用户自建的属性：迁移不许删
  v4.attributes.push({
    id: 'myown', name: '我的自定义项', sub: '', note: '', group: 'physio',
    polarity: 'pos', min: 0, max: 100, value: 88, levels: [{ min: -999, label: 'x' }], history: [],
  });

  v4.avatar.outfit = { top: null, bottom: null, shoes: null, accessory: null };
  v4.avatar.wardrobe.forEach((w) => {
    if (w.id === 'w33' || w.id === 'w34' || w.id === 'w35') w.slot = 'accessory';
    delete w.season;
    delete w.year;
  });

  store['gamelife_state_v1'] = JSON.stringify(v4);
  GL.load();
  const A = GL.state;
  const has = (id) => A.attributes.find((a) => a.id === id);

  check(A.version === 5, 'v5：version 升到 5', '实际 ' + A.version);
  check(!!has('temp') && has('temp').group === 'physio',
    'v5：体温已补进生理值组', has('temp') ? has('temp').group : '缺失');
  check(has('temp') && has('temp').value === 36.5 && has('temp').unit === '℃',
    'v5：体温初值 36.5℃（不是 0~100 的中点 55）',
    has('temp') ? has('temp').value + ' / ' + has('temp').unit : '缺失');
  check(has('temp') && Array.isArray(has('temp').ideal) && has('temp').ideal[0] === 36.1,
    'v5：体温带理想区间（按偏离正常值计分）');
  check(!!has('stamina') && has('stamina').group === 'physio',
    'v5：总体力值已补进生理值组', has('stamina') ? has('stamina').group : '缺失');

  const m2 = has('mood');
  check(m2 && m2.group === 'emotion', 'v5：情绪值已搬到独立的 emotion 组', m2 ? m2.group : '缺失');
  check(m2 && m2.polarity === 'neg', 'v5：情绪值极性改为负向（挫折感越低越好）', m2 ? m2.polarity : '缺失');
  check(m2 && m2.sub === '（挫折感）', 'v5：情绪值小字＝挫折感', m2 ? m2.sub : '缺失');
  check(m2 && m2.value === 30, 'v5：当前值取反（正向心情 70 → 挫折感 30）', m2 ? '实际 ' + m2.value : '缺失');
  check(m2 && m2.history.length === 2 && m2.history[0].v === 30 && m2.history[1].v === 20,
    'v5：历史值一并取反（趋势图方向才对）',
    m2 ? m2.history.map((h) => h.v).join(',') : '缺失');

  check(has('sleep') && has('sleep').name === '我改的睡眠名',
    'v5：用户改过的属性名不被覆盖', has('sleep') ? has('sleep').name : '缺失');
  check(!!has('myown') && has('myown').value === 88,
    'v5：用户自建的属性不删、分值不动', has('myown') ? String(has('myown').value) : '被删了');

  const bags = ['w33', 'w34', 'w35'].filter((id) => {
    const w = A.avatar.wardrobe.find((x) => x.id === id);
    return w && w.slot === 'bag';
  });
  check(bags.length === 3, 'v5：三只包从配饰改到 bag 分类', '改到 ' + bags.length + ' 只');
  check(A.avatar.wardrobe.every((w) => w.season !== undefined && w.year !== undefined),
    'v5：每件单品都补了 season / year 字段');
  check(A.avatar.outfit.bag === null, 'v5：outfit 补上 bag 槽位');
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
