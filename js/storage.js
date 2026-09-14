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
     技能篇预设 —— 来自《【游戏人生(技能篇)】元技能与方法论》
     状态：精力管理4个值（文档未逐一命名，采用精力管理经典四维，
           可在属性面板自由改名）
     ============================================================ */
  function docSkills() {
    const mk = (name, emoji, actions) => ({
      id: GL.uid(), name, emoji, xp: 0, xpPerLevel: 100,
      actions: actions.map(([n, xp]) => ({ id: GL.uid(), name: n, xp })),
      logs: []
    });
    return [
      // == 语言 ==
      mk('写作能力', '✍️', [['写作30分钟', 15], ['输出一篇文章', 40], ['修改润色', 10]]),
      mk('口头表达能力', '🎤', [['刻意练习15分钟', 10], ['完整表达一次', 30], ['复述总结', 10]]),
      // == 社交 ==
      mk('small talk闲聊能力', '💬', [['主动破冰', 10], ['完成一段闲聊', 15], ['认识新朋友', 25]]),
      // == 生理 ==
      mk('力量', '💪', [['力量训练', 30], ['自重训练组', 15]]),
      mk('敏捷', '🤸', [['敏捷/协调训练', 20], ['拉伸放松', 8]]),
      // == 综合素养 ==
      mk('阅历', '🧭', [['记录一次新经历', 15], ['与不同背景的人深聊', 20]]),
      mk('眼界', '🔭', [['精读深度内容', 10], ['学一个新领域框架', 25]]),
      mk('审美力', '🎨', [['分析一个优秀作品', 15], ['收集灵感', 10]])
    ];
  }

  function docAttributes() {
    const mk = (name, emoji) => ({ id: GL.uid(), name: emoji + ' ' + name, min: 0, max: 100, value: 60, levels: GL.defLevels(), history: [] });
    // 状态：精力管理 4 个值
    const energy = [mk('体能精力', '⚡'), mk('情绪精力', '❤️'), mk('思维精力', '🧠'), mk('意志精力', '🧭')];
    // == 外貌 ==
    const look = [mk('皮肤', '🧴'), mk('穿搭', '👔'), mk('发型', '💇'), mk('牙齿', '🦷')];
    return energy.concat(look);
  }

  function docFields() {
    const mk = (name, unit, type) => ({ id: GL.uid(), name, unit, type, value: null, lastAt: null, history: [] });
    return [
      mk('睡眠时长', '小时', 'number'),
      mk('肌肉量', 'kg', 'number'),
      mk('喉咙(咽部)', '', 'toggle'),
      mk('鼻炎', '', 'toggle')
    ];
  }

  /* 一键应用技能篇预设：只覆盖技能 / 属性 / 生理字段，保留形象与饮水记录 */
  GL.applyDocPreset = function () {
    GL.state.skills = docSkills();
    GL.state.attributes = docAttributes();
    GL.state.physiology.fields = docFields();
    GL.save();
  };

  function defaults() {
    const t1 = GL.uid(), b1 = GL.uid(), s1 = GL.uid(), g1 = GL.uid();
    return {
      version: 1,
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

  GL.load = function () {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* ignore */ }
    GL.state = data ? merge(defaults(), data) : defaults();
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

  /* ---------- 属性等级 ---------- */
  GL.attrLevel = function (attr) {
    const levels = (attr.levels || []).slice().sort((a, b) => b.min - a.min);
    for (const lv of levels) if (attr.value >= lv.min) return lv.label;
    return '—';
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
