/* ============================================================
   数据迁移校验：v1（扁平列表）→ v2（分组体系）
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
  check(A.version === 2, '全新：version = 2', '实际 ' + A.version);

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
  check(A.version === 2, '迁移：version 升到 2');

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
  check(GL.state.attributes.length === 14 && GL.state.version === 2,
    '迁移：重复 load 幂等（不会叠加）', '属性 ' + GL.state.attributes.length + ' 项');
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
