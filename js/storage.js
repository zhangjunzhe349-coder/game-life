/* ============ Game Life · 数据层 & 公共工具 ============ */
(function () {
  'use strict';
  const KEY = 'gamelife_state_v1';

  const GL = window.GL = {};

  GL.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  GL.defLevels = () => [
    { min: 80, label: '🔥 充沛' },
    { min: 60, label: '😊 良好' },
    { min: 40, label: '😐 一般' },
    { min: 20, label: '😕 低迷' },
    { min: -999, label: '😫 糟糕' }
  ];

  /* ============================================================
     技能篇 / 属性篇预设
     来源：《【游戏人生(技能篇)】元技能与方法论》《【游戏人生(属性篇)】》

     属性三大类：生理值 / 精神力 / 熵值
     技能五大类：生理 / 语言 / 社交 / 外貌 / 其他

     polarity（极性）决定刻度条的语义与配色，这是关键设计：
       pos  越高越好   → 青色，条越长越好（多数指标）
       neg  越低越好   → 红色，条越长越需要注意（熵值三项、困倦度）
       mid  中间最好   → 琥珀，偏离理想区间的程度才是有意义的信号
                        （用户原文：社交度「过低生理级不适」、
                          稳定度「过高日复一日又会陷入麻木」）
     用固定 key 作 id，而不是随机 uid —— 这样换版本时能对上旧数据、迁移历史。
     ============================================================ */

  const ATTR_GROUPS = [
    { id: 'physio', name: '生理值', emoji: '❤️', note: '身体基线' },
    { id: 'mental', name: '精神力', emoji: '🧠', note: '心理状态' },
    /* 组注按原文照录（原文：==熵值==（此项过高暂没法做高集中的事）） */
    { id: 'entropy', name: '熵值', emoji: '🌀', note: '（此项过高暂没法做高集中的事）' },
  ];

  const SKILL_GROUPS = [
    { id: 'physio', name: '生理', emoji: '💪' },
    { id: 'lang', name: '语言', emoji: '🗣️' },
    { id: 'social', name: '社交', emoji: '💬' },
    { id: 'look', name: '外貌', emoji: '🪞' },
    { id: 'misc', name: '其他', emoji: '🧭' },
  ];

  GL.ATTR_GROUPS = ATTR_GROUPS;
  GL.SKILL_GROUPS = SKILL_GROUPS;

  /* ============================================================
     属性项定义：[key, 显示名, 小字注解, 组, 极性, 说明]
     ------------------------------------------------------------
     ⚠ 小字注解（sub）与说明（note）**逐字照录**用户提供的【游戏人生(属性篇)】原文
       —— 全角括号、破折号、标点一律保留，不得改写、精简或合并。
       （原文文件不在本仓库内；改定义表时必须回到用户手上那份原文去粘。）
     原文结构 → 字段的对应关系：
       「运动度（活动半径）（久坐值）」        → name「运动度」 sub「（活动半径）（久坐值）」
       「运动度」下面 `` ——待家里会头晕 ``    → note「——待家里会头晕」
     ============================================================ */
  const ATTR_DEFS = [
    ['throat', '喉咙', '（咽部）', 'physio', 'pos', ''],
    ['nose', '鼻腔', '（鼻炎积水）', 'physio', 'pos', ''],
    ['drowse', '困倦度', '', 'physio', 'neg', ''],
    ['move', '运动度', '（活动半径）（久坐值）', 'physio', 'pos', '——待家里会头晕'],
    ['sleep', '睡眠', '（早睡早起值）', 'physio', 'pos', '——起的越晚，越累'],
    ['diet', '饮食', '', 'physio', 'pos', '——（少油，少盐，少糖）（地中海饮食，高蛋白）'],

    ['desire', '欲望值', '（动力感）', 'mental', 'pos', ''],
    ['mood', '情绪值', '', 'mental', 'pos', ''],
    ['social', '社交度', '', 'mental', 'mid', '——(环境能量)(内外倾高低能都需要)——(过低生理级不适)——还决定了你的眼界，高质量圈子带来的信息交换会逼着人成长'],
    ['stable', '稳定度', '', 'mental', 'mid', '——(过低→生活变动大)(会打断很多系统习惯)（过高日复一日又会陷入麻木）'],
    ['hope', '盼头值', '', 'mental', 'pos', '——生活有没有一个盼头'],

    ['dopamine', '多巴胺需求', '', 'entropy', 'neg', '—→(阈值)←(过高破坏系统性动作)'],
    ['chaos', '混乱值', '', 'entropy', 'neg', '——★熵★(信息接收数量和频次)，做选择次数，刷视频'],
    ['noise', '嘈杂值', '', 'entropy', 'neg', '——周围的声音，反独处心境，待家里就高\n——嘈杂值过高，失去自我。'],
  ];

  /* 技能项定义：[key, 显示名, 小字注解, emoji, 组, 行动库, 说明]
     小字同样逐字照录用户提供的【游戏人生(技能篇)元技能与方法论】原文（不在本仓库内） */
  const SKILL_DEFS = [
    ['muscle', '肌肉量', '（细狗——匀称——薄肌）', '💪', 'physio', [['力量训练', 30], ['自重训练组', 15]], ''],
    ['cardio', '心肺', '', '🫁', 'physio', [['有氧训练', 25], ['间歇冲刺', 30]], ''],

    ['writing', '写作能力', '', '✍️', 'lang', [['写作30分钟', 15], ['输出一篇文章', 40]], ''],
    ['speaking', '表达能力', '（口头）', '🎤', 'lang', [['刻意练习15分钟', 10], ['完整表达一次', 30]], ''],

    ['smalltalk', 'small talk闲聊能力', '（破冰）', '💬', 'social', [['主动破冰', 10], ['完成一段闲聊', 15]], ''],
    ['confidence', '自信值', '', '🦁', 'social', [['当众表达', 25], ['做一件不敢做的事', 35]], ''],

    ['skin', '皮肤', '', '🧴', 'look', [['护肤流程', 10], ['规律作息一天', 15]], ''],
    ['outfit', '穿搭', '', '👔', 'look', [['搭一套造型', 15], ['分析他人穿搭', 8]], ''],
    ['hair', '发型', '', '💇', 'look', [['打理发型', 8], ['尝试新造型', 20]], ''],
    ['teeth', '牙齿', '', '🦷', 'look', [['认真刷牙+牙线', 8], ['定期洗牙', 25]], ''],

    ['experience', '阅历', '', '🧭', 'misc', [['记录一次新经历', 15], ['与不同背景的人深聊', 20]], ''],
    ['vision', '眼界', '', '🔭', 'misc', [['精读深度内容', 10], ['学一个新领域框架', 25]], ''],
    ['aesthetic', '审美力', '', '🎨', 'misc', [['分析一个优秀作品', 15], ['收集灵感', 10]], ''],
  ];

  /* 等级文案必须跟着极性走 —— 对「困倦度」显示「🔥 充沛」是反的。
     pos：越高越好的常规描述
     neg：越低越好的描述（熵值、困倦度）
     mid：偏离理想区间的双向描述（社交度、稳定度） */
  const LEVELS = {
    pos: () => [
      { min: 80, label: '🔥 充沛' }, { min: 60, label: '😊 良好' },
      { min: 40, label: '😐 一般' }, { min: 20, label: '😕 低迷' },
      { min: -999, label: '😫 糟糕' },
    ],
    neg: () => [
      { min: 80, label: '🔥 过载' }, { min: 60, label: '😣 偏高' },
      { min: 40, label: '😐 一般' }, { min: 20, label: '🙂 平稳' },
      { min: -999, label: '😌 清爽' },
    ],
    mid: () => [
      { min: 85, label: '🌊 过载' }, { min: 65, label: '🙂 尚可' },
      { min: 45, label: '🎯 刚好' }, { min: 25, label: '🙂 尚可' },
      { min: -999, label: '🌊 波动' },
    ],
  };

  /* 初始值跟着极性走：负向指标（熵值、困倦度）的「好状态」是低值，
     若一律给 60，新用户打开会看到一条红色长条，误以为状态很糟。
     pos 60（中等偏上）/ neg 30（偏清爽）/ mid 55（贴近理想区间） */
  const START_VALUE = { pos: 60, neg: 30, mid: 55 };

  function docAttributes() {
    return ATTR_DEFS.map(([key, name, sub, group, polarity, note]) => ({
      id: key, name, sub: sub || '', note: note || '', group, polarity,
      min: 0, max: 100,
      value: START_VALUE[polarity] !== undefined ? START_VALUE[polarity] : 60,
      levels: (LEVELS[polarity] || LEVELS.pos)(), history: []
    }));
  }

  /* 供属性面板在切换刻度语义时同步等级文案 */
  GL.attrLevelsFor = (polarity) => (LEVELS[polarity] || LEVELS.pos)();

  /* 极性 → 中文说明，UI 与管理区共用 */
  GL.POL_NAME = { pos: '越高越好', neg: '越低越好', mid: '中间最好' };

  function docSkills() {
    return SKILL_DEFS.map(([key, name, sub, emoji, group, actions, note]) => ({
      id: key, name, sub: sub || '', note: note || '',
      emoji, group, xp: 0, xpPerLevel: 100,
      actions: actions.map(([n, xp]) => ({ id: GL.uid(), name: n, xp })),
      logs: []
    }));
  }

  /* 旧数据迁移表：把 v1.4.x 时代的中文名映射到新体系的固定 key。
     匹配不上的旧项（如「体能精力」「力量」「敏捷」）按新体系淘汰。 */
  const ATTR_MIGRATE = {
    '喉咙(咽部)': 'throat', '喉咙（咽部）': 'throat', '喉咙': 'throat',
    '鼻炎': 'nose', '鼻腔': 'nose',
    '睡眠时长': 'sleep', '睡眠': 'sleep',
  };
  const SKILL_MIGRATE = {
    '写作能力': 'writing',
    '口头表达能力': 'speaking', '表达能力（口头）': 'speaking', '表达能力': 'speaking',
    'small talk闲聊能力': 'smalltalk', 'small talk': 'smalltalk',
    '阅历': 'experience', '眼界': 'vision', '审美力': 'aesthetic',
    '肌肉量': 'muscle',
  };

  /* 去掉名称里的 emoji / 空格，才能跟迁移表比对 */
  const bare = (s) => String(s || '').replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]/gu, '').trim();

  /* 把旧数组里的 value / history 搬进新结构（按迁移表配对，其次按同名配对） */
  GL.migrateLists = function (fresh, old, kind) {
    if (!Array.isArray(old) || !old.length) return fresh;
    const map = kind === 'attr' ? ATTR_MIGRATE : SKILL_MIGRATE;
    for (const item of fresh) {
      const oldItem = old.find((o) => map[bare(o.name)] === item.id
        || bare(o.name) === item.name
        || (o.id === item.id));
      if (!oldItem) continue;
      item.value = oldItem.value !== undefined ? oldItem.value : item.value;
      item.xp = oldItem.xp !== undefined ? oldItem.xp : item.xp;
      item.xpPerLevel = oldItem.xpPerLevel || item.xpPerLevel;
      item.history = oldItem.history || item.history;
      item.logs = oldItem.logs || item.logs;
      if (kind === 'attr') {
        item.min = oldItem.min !== undefined ? oldItem.min : item.min;
        item.max = oldItem.max !== undefined ? oldItem.max : item.max;
        item.levels = oldItem.levels || item.levels;
      }
    }
    return fresh;
  };

  /* 右翼「生理状态」只留**客观记录**（具体数值），主观打分归属性面板。
     二者互补不冲突：睡眠时长是「睡了 6.5 小时」，属性里的睡眠是「作息规律性」。 */
  function docFields() {
    const mk = (name, unit, type) => ({ id: GL.uid(), name, unit, type, value: null, lastAt: null, history: [] });
    return [
      mk('睡眠时长', '小时', 'number'),
      mk('肌肉量', 'kg', 'number'),
    ];
  }

  /* 一键应用技能篇 / 属性篇预设 */
  GL.applyDocPreset = function () {
    GL.state.skills = docSkills();
    GL.state.attributes = docAttributes();
    GL.state.physiology.fields = docFields();
    GL.save();
  };

  function defaults() {
    const t1 = GL.uid(), b1 = GL.uid(), s1 = GL.uid(), g1 = GL.uid();
    return {
      version: 3,
      ui: { attrCollapsed: [] },
      avatar: {
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
      },
      physiology: {
        hydration: { cupSize: 250, goal: 2000, remindOn: false, remindMin: 90, logs: [] },
        fields: docFields()
      },
      attributes: docAttributes(),
      skills: docSkills(),
      life: { birthDate: '1996-06-01', expectancy: 80 }
    };
  }

  /* 深度合并缺失字段（版本升级兼容） */
  function merge(base, patch) {
    if (patch === null || patch === undefined) return base;
    if (typeof base !== 'object' || Array.isArray(base) || typeof patch !== 'object' || Array.isArray(patch)) return patch;
    const out = Object.assign({}, base);
    for (const k of Object.keys(patch)) out[k] = merge(base ? base[k] : undefined, patch[k]);
    return out;
  }

  /* ============================================================
     v1 → v2 迁移：属性 / 技能从「扁平列表」改为「分组体系」
     ------------------------------------------------------------
     v1（≤ v1.4.2）：
       属性 = 精力管理四维 + 外貌四项（8 项，无分组）
       技能 = 写作 / 口头表达 / small talk / 力量 / 敏捷 / 阅历 / 眼界 / 审美（8 项）
     v2（本次）：
       属性 = 生理值(6) + 精神力(5) + 熵值(3)
       技能 = 生理(2) + 语言(2) + 社交(2) + 外貌(4) + 其他(3)

     迁移规则：
       ① 同名且同语义的项（写作能力、阅历、眼界…）→ 搬 value / xp / history / logs
       ② 外貌四项原属属性，新体系归技能 → 在技能侧重建（属性分数不折算成 XP，
          因为「打分」与「经验值」不是同一把尺子）
       ③ 淘汰项（体能精力等四维、力量、敏捷）→ 不迁入
     ============================================================ */
  function migrateV1toV2(old) {
    const lookKeys = ['skin', 'outfit', 'hair', 'teeth'];
    /* 把旧属性里属于外貌的项并入技能匹配源（只带去名字，不带分数） */
    const lookSrc = (old.attributes || [])
      .filter((a) => lookKeys.indexOf(SKILL_MIGRATE[bare(a.name)]) !== -1)
      .map((a) => ({ name: a.name }));

    GL.state.attributes = GL.migrateLists(docAttributes(), old.attributes, 'attr');
    GL.state.skills = GL.migrateLists(docSkills(), (old.skills || []).concat(lookSrc), 'skill');
    GL.state.version = 2;
  }

  /* ============================================================
     v2 → v3 迁移：把「小字」还原成用户原文
     ------------------------------------------------------------
     v2（v1.5.0）里，我把用户的原文压缩成了短标签（如把「（活动半径）（久坐值）」
     写成「活动半径」），并且把 `` —— `` 引导的那一整行说明**整个丢掉了**。
     用户明确要求「原文里是什么就是什么，不要删减」。

     迁移策略：按固定 key 命中内置项后，用定义表里的原文覆盖 name/sub/note。
     安全性：v1.5.0 没有任何改名/改注解的入口，所以现存数据里这两个字段
     必然还是我写的旧值，覆盖不会伤到用户的编辑；用户自己新建的项
     （id 不在定义表里）一律不动。
     ============================================================ */
  function migrateV2toV3() {
    const aMap = {};
    ATTR_DEFS.forEach(([id, name, sub, , , note]) => { aMap[id] = { name, sub, note }; });
    const sMap = {};
    SKILL_DEFS.forEach(([id, name, sub, , , , note]) => { sMap[id] = { name, sub, note }; });

    GL.state.attributes.forEach((a) => {
      const d = aMap[a.id];
      if (!d) return;
      a.name = d.name;
      a.sub = d.sub || '';
      a.note = d.note || '';
    });
    GL.state.skills.forEach((s) => {
      const d = sMap[s.id];
      if (!d) return;
      s.name = d.name;
      s.sub = d.sub || '';
      s.note = d.note || '';
    });
    GL.state.version = 3;
  }

  GL.load = function () {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* ignore */ }
    if (!data) {
      GL.state = defaults();
    } else {
      const prevVer = Number(data.version) || 1;
      GL.state = merge(defaults(), data);
      if (prevVer < 2) migrateV1toV2(data);
      if (prevVer < 3) migrateV2toV3();
      if (!GL.state.ui || !Array.isArray(GL.state.ui.attrCollapsed)) GL.state.ui = { attrCollapsed: [] };
    }
    GL.save();
  };

  GL.save = function () {
    try { localStorage.setItem(KEY, JSON.stringify(GL.state)); }
    catch (e) { GL.toast('保存失败：本地存储空间不足', 'err'); }
  };

  GL.reset = function () {
    localStorage.removeItem(KEY);
    GL.state = defaults();
    GL.save();
  };

  GL.importData = function (json) {
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== 'object' || !obj.avatar || !obj.attributes) {
      throw new Error('文件格式不正确');
    }
    GL.state = merge(defaults(), obj);
    GL.save();
  };

  /* ---------- 工具 ---------- */
  GL.esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* ---------- 文字编辑区（属性 / 技能共用） ----------
     产出的三个字段用 data-<kind>-name / -sub / -note 标记，
     各模块在 bind() 里按自己的前缀处理。
     注意：文字改动不要走 GL.changed() —— 整页重渲染会
     把正在编辑的输入框连同光标一起换掉，编辑体验会碎掉。 */
  GL.textEditBox = function (x, kind) {
    return `<div class="tx-edit">
      <label class="tx-field">
        <span class="tx-key">名称</span>
        <input type="text" data-${kind}-name value="${GL.esc(x.name)}" aria-label="名称">
      </label>
      <label class="tx-field">
        <span class="tx-key">小字</span>
        <input type="text" data-${kind}-sub value="${GL.esc(x.sub || '')}" placeholder="括号里的注解" aria-label="小字注解">
      </label>
      <label class="tx-field wide">
        <span class="tx-key">说明</span>
        <textarea data-${kind}-note rows="2" placeholder="破折号后面的说明" aria-label="说明">${GL.esc(x.note || '')}</textarea>
      </label>
    </div>`;
  };

  const pad = (n) => String(n).padStart(2, '0');

  GL.todayKey = (ts) => {
    const d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };

  GL.fmtClock = (ts) => {
    const d = new Date(ts);
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };

  GL.fmtRel = (t) => {
    if (!t) return '暂无记录';
    const d = Date.now() - t;
    if (d < 60e3) return '刚刚';
    if (d < 3600e3) return Math.floor(d / 60e3) + ' 分钟前';
    if (d < 86400e3) return Math.floor(d / 3600e3) + ' 小时前';
    if (d < 7 * 86400e3) return Math.floor(d / 86400e3) + ' 天前';
    return GL.fmtClock(t);
  };

  /* ---------- 技能等级 ---------- */
  GL.skillLevel = function (skill) {
    const per = Math.max(1, skill.xpPerLevel || 100);
    let L = 1;
    while (per * L * (L + 1) / 2 <= skill.xp) L++;
    const cum = per * (L - 1) * L / 2;
    const need = per * L;
    const into = skill.xp - cum;
    return { level: L, into, need, pct: Math.min(100, Math.round(into / need * 100)) };
  };

  /* ---------- 角色总等级（全技能累计 XP 走同一条曲线） ---------- */
  GL.heroLevel = function () {
    const total = GL.state.skills.reduce((s, k) => s + (k.xp || 0), 0);
    const per = 100;
    let L = 1;
    while (per * L * (L + 1) / 2 <= total) L++;
    const cum = per * (L - 1) * L / 2;
    const need = per * L;
    return { level: L, total, into: total - cum, need, pct: Math.min(100, Math.round((total - cum) / need * 100)) };
  };

  /* ---------- 生命刻度：统一计算，顶栏与生命页共用 ---------- */
  GL.lifeInfo = function () {
    const L = GL.state.life;
    const [y, m, d] = String(L.birthDate).split('-').map(Number);
    const birth = new Date(y || 1996, (m || 1) - 1, d || 1);
    const now = new Date();
    let ageY = now.getFullYear() - birth.getFullYear();
    const anniv = new Date(now.getFullYear(), birth.getMonth(), birth.getDate());
    if (anniv > now) ageY--;
    const lastBd = new Date(now.getFullYear() - (anniv > now ? 1 : 0), birth.getMonth(), birth.getDate());
    const ageD = Math.floor((now - lastBd) / 86400e3);
    const livedW = Math.max(0, Math.floor((Date.now() - birth.getTime()) / (7 * 86400e3)));
    const totalW = L.expectancy * 52;
    const remainW = Math.max(0, totalW - livedW);
    return { birth, ageY: Math.max(0, ageY), ageD, livedW, totalW, remainW, pct: Math.min(100, (livedW / totalW) * 100) };
  };

  /* ---------- 属性等级 ---------- */
  GL.attrLevel = function (attr) {
    const levels = (attr.levels || []).slice().sort((a, b) => b.min - a.min);
    for (const lv of levels) if (attr.value >= lv.min) return lv.label;
    return '—';
  };

  /* ---------- 分组视图：属性 / 技能共用 ---------- */
  GL.attrByGroup = function () {
    return ATTR_GROUPS.map((g) => ({
      ...g,
      items: GL.state.attributes.filter((a) => (a.group || 'physio') === g.id),
    }));
  };

  GL.skillByGroup = function () {
    return SKILL_GROUPS.map((g) => ({
      ...g,
      items: GL.state.skills.filter((s) => (s.group || 'misc') === g.id),
    }));
  };

  /* 组均值：显示**原始水平**（条长 = 实际值）。
     不在这里反转负向项 —— 熵值 30 就该显示成 30% 的短条，
     配合红色与「越低越好」标签，语义已经清楚。 */
  const pctOf = (a) => {
    const lo = a.min, hi = Math.max(a.max, a.min + 1);
    return Math.max(0, Math.min(100, ((a.value - lo) / (hi - lo)) * 100));
  };

  GL.groupMean = function (items) {
    if (!items.length) return 0;
    return Math.round(items.reduce((s, a) => s + pctOf(a), 0) / items.length);
  };

  /* 总览分：**负向指标取反**后再平均。
     否则「熵值低（这是好事）」会把总分拉低，读起来像状态变差了 ——
     这是负向指标最容易踩的统计陷阱。 */
  GL.overallScore = function () {
    const arr = GL.state.attributes;
    if (!arr.length) return 0;
    const sum = arr.reduce((s, a) => s + (a.polarity === 'neg' ? 100 - pctOf(a) : pctOf(a)), 0);
    return Math.round(sum / arr.length);
  };

  /* 某种极性在组内是否占多数 —— 决定组标题的着色 */
  GL.groupPolarity = function (items) {
    const neg = items.filter((a) => a.polarity === 'neg').length;
    return neg * 2 > items.length ? 'neg' : 'pos';
  };

  /* ---------- Toast ---------- */
  GL.toast = function (msg, type) {
    const box = document.getElementById('toast-box');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    box.appendChild(el);
    const life = type === 'lvlup' ? 3800 : 2600;
    setTimeout(() => el.remove(), life);
  };

  /* ---------- 状态变更统一入口：保存 + 全量重渲染 ---------- */
  GL.hooks = [];
  GL.changed = function () {
    GL.save();
    GL.hooks.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  };
})();
