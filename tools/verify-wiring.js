/* ============================================================
   集成校验：index.html 与 JS 的「DOM id ↔ 代码引用」是否对得上
   跑法：node game-life/tools/verify-wiring.js
   —— 补上单元级校验管不到的那一环：
      脚本加载顺序、宿主节点存在性、被移除节点的残留引用
      （v1.8.1 起 tools/verify-portrait.js 随立绘一起删除，
        原先由它盯的「立绘是否画出来」不再需要，但「立绘不得复活」
        这条反向断言挪到了本文件第 3 节）
      （v1.8.2 起同理：设置页撤掉的「技能篇预设 / 版本与回滚 / 安装到桌面」
        也不得复活，见第 3b 节）
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
/* 这两个源码文件在多处被检查，统一在最前面读一次（避免在使用点之后才 const 声明） */
const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const storageSrc = fs.readFileSync(path.join(ROOT, 'js', 'storage.js'), 'utf8');

const problems = [];
const ok = [];

/* ---------- 1. 脚本顺序 ---------- */
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const localScripts = scripts.filter((s) => !/^https?:/.test(s));

/* wardrobe-data.js（构建产物）必须排在 storage.js **之后** ——
   ① 它是裸 `GL.WARDROBE_LIB = …`，GL 由 storage.js 建（`const GL = window.GL = {}`），
      排在前面会直接 ReferenceError: GL is not defined（v1.8.0 实测踩过）；
   ② 反过来 storage.js 更不能排在它后面，那会把 window.GL 整个重置掉。 */
const EXPECT = ['js/storage.js', 'js/wardrobe-data.js', 'js/avatar.js',
  'js/wardrobe.js', 'js/physiology.js',
  'js/attributes.js', 'js/skills.js', 'js/life.js', 'js/app.js'];
if (JSON.stringify(localScripts) !== JSON.stringify(EXPECT)) {
  problems.push(`脚本顺序不符\n    实际：${localScripts.join(' → ')}\n    期望：${EXPECT.join(' → ')}`);
} else {
  ok.push(`脚本顺序正确（${localScripts.length} 个本地脚本，storage 最先、app 最后）`);
}

/* ---------- 1b. 每个模块调用的 GL.* 是否都有提供者（v1.4.2 事故盲区） ----------
   事故复盘：index.html 曾漏加载 js/avatar.js，而 app.js 要调 GL.initAvatar()，
   于是 start() 抛异常中断，后面的 reveal() 没跑，所有 .rv 元素永久 opacity:0，
   整页白屏 —— 而当时的本脚本全绿，因为它只查「脚本清单对不对」，
   不查「app.js 要用的函数有没有人提供」。

   v1.5.0 扩展：不再只查 app.js，而是**逐模块**检查。因为数据层与视图层是分离的，
   attributes.js 依赖 GL.attrByGroup / GL.POL_NAME，skills.js 依赖 GL.skillByGroup ——
   任何一方漏定义都会在渲染时抛错。 */
const jsDir = path.join(ROOT, 'js');
const jsNames = fs.readdirSync(jsDir).filter((x) => x.endsWith('.js'));

// 收集所有 js 文件里对 GL.xxx 的定义
const provided = new Set();
for (const f of jsNames) {
  const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
  for (const m of src.matchAll(/\bGL\.([A-Za-z_$][\w$]*)\s*=/g)) provided.add(m[1]);
  if (/GL\.hooks\.push/.test(src)) provided.add('hooks');
}
// 允许跨模块通过 window.GL 动态挂载的名字（如 docLevels 等内部工具）
const BUILTIN = new Set(['document', 'window', 'state', 'hooks', 'VERSION', 'log',
  'fmtRel', 'todayKey', 'esc', 'toast', 'uid', 'save', 'load', 'changed']);

const perModuleMissing = [];
for (const f of jsNames) {
  const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
  const needs = [...new Set([...src.matchAll(/\bGL\.([A-Za-z_$][\w$]*)\s*[(.]/g)].map((m) => m[1]))];
  const miss = needs.filter((n) => !provided.has(n) && !BUILTIN.has(n));
  if (miss.length) perModuleMissing.push(`${f} → ${miss.join(', ')}`);
}
if (perModuleMissing.length) {
  problems.push(`以下模块调用了无人提供的 GL 成员（渲染时会抛 TypeError）：\n    ${perModuleMissing.join('\n    ')}`);
} else {
  ok.push(`全部 ${jsNames.length} 个模块依赖的 GL.* 均有提供者（共 ${provided.size} 个定义）`);
}

if (scripts.some((s) => /three/i.test(s))) {
  problems.push('仍残留 Three.js CDN 引用（v1.4.0 应为零外部依赖）');
} else {
  ok.push('零外部脚本依赖（Three.js CDN 已移除）');
}

/* ---------- 2. 宿主节点存在性 ---------- */
const NEEDED = ['profile-card', 'hud-lv', 'hud-readouts', 'wing-attrs', 'wing-body',
  'tabs', 'ctrl-toggle', 'avatar-panel', 'wardrobe-ctrl',
  'panel-hud', 'panel-skills', 'panel-life', 'panel-settings', 'toast-box', 'main'];
for (const id of NEEDED) {
  if (!new RegExp(`id="${id}"`).test(html)) problems.push(`index.html 缺少宿主节点 #${id}`);
}
if (NEEDED.every((id) => new RegExp(`id="${id}"`).test(html))) {
  ok.push(`宿主节点齐全（${NEEDED.length} 个）`);
}

/* ---------- 3. 中央立绘已移除：这些宿主节点不得复活（v1.8.1） ----------
   用户拍板「角色立绘效果不好，去掉这个模块，只保留个人信息」，于是
   js/portrait.js 与 #portrait-svg / #stage / #stage-base / #avatar-ctrl 整条链路删除，
   个人信息改由 #profile-card 承载。
   留这条反向断言，是因为最容易犯的回归不是「删漏了」，而是**改别处时顺手把旧节点加回来**
   —— 那会让个人信息与立绘同时存在，而没有任何校验会因此报错。 */
const GONE = ['portrait-svg', 'stage', 'stage-base', 'avatar-ctrl', 'ctrl-tabs'];
const revived = GONE.filter((id) => new RegExp(`id="${id}"`).test(html));
if (revived.length) {
  problems.push(
    `index.html 里又出现了 v1.8.1 已移除的宿主节点：#${revived.join('、#')} —— ` +
    '中央立绘已废除，个人信息由 #profile-card 承载；立绘相关文件也已不在仓里，加了节点也没人渲染',
  );
} else {
  ok.push(`已移除的立绘宿主节点确认不复存在（${GONE.length} 个：${GONE.join(', ')}）`);
}
if (fs.existsSync(path.join(ROOT, 'js', 'portrait.js'))) {
  problems.push('js/portrait.js 又回来了 —— v1.8.1 已确认移除中央立绘，若确实要恢复请连带改 index.html / sw.js / 本文件');
} else {
  ok.push('js/portrait.js 已不在仓中（立绘整体移除）');
}

/* ---------- 3b. 设置页已撤掉的三张卡不得复活（v1.8.2） ----------
   用户原话：「技能篇预设这个模块去掉，版本与回滚也是，这都属于和用户体验无关的信息，
   还有安装到桌面也去掉，关于可以保留」。
   判据只认**按钮 id 与代码符号**，不认卡片标题 ——
   标题字符串在改动说明的注释里会自然出现（本文件与 app.js 都写了原因），
   拿它当判据会把注释一起判成违规。
   实际渲染出来的卡片张数由第 ③ 层 browser-check 在真 DOM 上数（那边没有注释污染）。 */
const PRESET_GONE = ['btn-preset'];
const presetRevived = PRESET_GONE.filter((id) => html.indexOf('id="' + id + '"') !== -1)
  .concat(PRESET_GONE.filter((id) => app.indexOf("'" + id + "'") !== -1));
if (presetRevived.length) {
  problems.push(`设置页又出现了已撤掉的入口：${[...new Set(presetRevived)].join('、')} —— ` +
    '技能篇预设已按用户要求移出设置页，若要恢复请连带更新 README 与 browser-check 的断言');
}
if (/GL\.applyDocPreset\s*=/.test(storageSrc)) {
  problems.push('storage.js 里又定义了 GL.applyDocPreset —— 设置页入口已撤销，留着就是死代码');
} else {
  ok.push('设置页已撤掉的三张卡（技能篇预设 / 版本与回滚 / 安装到桌面）确认未复活');
}

/* ---------- 3c. 技能详情不许退回浮层（v1.8.2） ----------
   浮层方案（#skill-modal / .smodal）做过一版，用户看过之后原话：
   「技能打开不要浮窗，用当时的另一种方案，直接展开，挤出空间」。
   于是完整卡改为在 panel-skills 内部就地渲染（.skill-grid > .skill-full 占满整行）。
   留这条反向断言的理由与 3b 相同：**最容易犯的回归不是删漏了，而是改别处时顺手加回来**。
   判据只认「宿主节点 + 浮层类名 + 挂在 body 上的模态类」，不认「浮窗」这两个字
   —— 中文词在说明注释里必然出现，拿它当判据会把注释一起判成违规。 */
const cssSrc = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
const skillsSrc = fs.readFileSync(path.join(ROOT, 'js', 'skills.js'), 'utf8');
const modalMarks = [];
if (html.indexOf('id="skill-modal"') !== -1) modalMarks.push('index.html 里的 #skill-modal');
if (/id\s*=\s*'skill-modal'/.test(skillsSrc)) modalMarks.push('skills.js 里动态创建的 #skill-modal');
if (/^\s*\.smodal[\s,{.:]/m.test(cssSrc)) modalMarks.push('style.css 里的 .smodal 规则');
if (/body\.modal-open/.test(cssSrc)) modalMarks.push('style.css 里的 body.modal-open');
if (modalMarks.length) {
  problems.push('技能详情又回到浮层方案了：' + modalMarks.join('、') + ' —— ' +
    '用户明确要求「不要浮窗，直接展开，挤出空间」，就地展开的完整卡在 #panel-skills 内部');
} else {
  ok.push('技能详情确认是就地展开（无 #skill-modal / .smodal / body.modal-open 残留）');
}
/* 就地展开必须真的占满整行，否则「挤出空间」不成立 */
if (/\.skill-grid\s*>\s*\.skill-full\s*\{[^}]*grid-column\s*:\s*1\s*\/\s*-1/.test(cssSrc)) {
  ok.push('就地展开的完整卡声明了 grid-column: 1 / -1（占满整行、把后面的小卡挤下去）');
} else {
  problems.push('style.css 缺少「.skill-grid > .skill-full { grid-column: 1 / -1 }」—— ' +
    '没了它，展开的完整卡只会占一个格子，挤不动后面的小卡');
}

/* ---------- 4. 被移除节点不得再被 JS 引用 ---------- */
const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js'));
/* avatar-canvas 是 3D 时代的宿主；portrait-svg / stage-base / avatar-ctrl 随中央立绘一并删除。
   v1.8.1 起不再有「休眠段豁免」—— 仓里已经没有会碰这些节点的代码，任何人再引用都是 bug。 */
const REMOVED = ['avatar-canvas', 'portrait-svg', 'stage-base', 'avatar-ctrl'];
for (const f of jsFiles) {
  const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  for (const id of REMOVED) {
    if (src.includes(`getElementById('${id}')`)) {
      problems.push(`${f} 引用了 index.html 中已不存在的 #${id}`);
    }
  }
}

/* ---------- 5. 每个 JS 文件语法自检 ---------- */
const { execFileSync } = require('child_process');
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, 'js', f)], { stdio: 'pipe' });
  } catch (e) {
    problems.push(`js/${f} 语法错误：${String(e.stderr).split('\n').slice(0, 2).join(' ')}`);
  }
}
ok.push(`js/*.js 语法全部通过（${jsFiles.length} 个文件）`);

/* ---------- 6. sw.js 资源清单 ---------- */
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const assetsBlock = (sw.split('const ASSETS = [')[1] || '').split('];')[0];
const assets = [...assetsBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);
for (const f of jsFiles) {
  if (!assets.includes(`js/${f}`)) problems.push(`sw.js ASSETS 漏了 js/${f}`);
}

/* ---------- 6b. ASSETS 引用的文件必须真实存在（v1.7.0 新增） ----------
   离线缓存的失败是**静默**的：文件名打错既不报错也不崩，只是断网时那个资源没有。
   字体与图标尤其隐蔽 —— 它们只在离线或已安装到主屏幕时才被用到，平时根本发现不了。
   注意：旧版这里用『只匹配 js|css|html|svg|webmanifest』的正则来收资源，
   于是 .png / .woff2 从来没被检查过，属于校验自身的盲区。 */
const missingAssets = assets.filter((u) => u !== './' && !fs.existsSync(path.join(ROOT, u)));
if (missingAssets.length) {
  problems.push(`sw.js ASSETS 引用了不存在的文件：\n    ${missingAssets.join('\n    ')}`);
} else {
  ok.push(`sw.js ASSETS 的 ${assets.length} 项资源全部存在（含字体与图标）`);
}

/* ---------- 6c. manifest 图标与 index.html 的本地引用必须存在 ---------- */
const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
const mfIcons = (mf.icons || []).map((i) => i.src).filter((u) => !/^https?:/.test(u));
const missingIcons = mfIcons.filter((u) => !fs.existsSync(path.join(ROOT, u)));
if (missingIcons.length) problems.push(`manifest 图标缺失：${missingIcons.join(', ')}`);
else ok.push(`manifest 图标齐全（${mfIcons.length} 个，含 maskable）`);

// iOS 的 apple-touch-icon 不支持 SVG，manifest 里必须同时给出 PNG
if (!mfIcons.some((u) => /\.png$/.test(u))) {
  problems.push('manifest 只声明了 SVG 图标 —— iOS 不认 SVG 图标，安卓支持面也不全，必须提供 PNG');
}

const htmlRefs = [...new Set([...html.matchAll(/(?:href|src)="((?!https?:|data:|#)[^"]+)"/g)].map((m) => m[1]))];
const missingRefs = htmlRefs.filter((u) => !fs.existsSync(path.join(ROOT, u)));
if (missingRefs.length) problems.push(`index.html 引用了不存在的本地资源：${missingRefs.join(', ')}`);
else ok.push(`index.html 的 ${htmlRefs.length} 个本地资源引用全部存在`);

/* ---------- 6d. 全屏启动：display 与 display_override 必须一致 ---------- */
const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
const ov = mf.display_override || [];
if (mf.display === 'fullscreen' && ov[0] === 'fullscreen' && ov.includes('standalone')) {
  ok.push('全屏启动配置就位（display: fullscreen + display_override 回落 standalone）');
} else {
  problems.push(
    `全屏启动配置不完整（display=${mf.display}，display_override=[${ov.join(', ')}]）—— ` +
    '必须两者同时为首选 fullscreen：**浏览器优先读 display_override**，只改 display 在安卓上不生效；' +
    '列表中保留 standalone 是因为 iOS 不支持 fullscreen，需按规范回落',
  );
}
if (!/display-mode:\s*fullscreen/.test(css)) {
  problems.push(
    'css 缺少 @media (display-mode: fullscreen) 的顶部留白兜底 —— ' +
    '全屏时系统状态栏被隐藏，env(safe-area-inset-top) 归零，页头会直接贴到屏幕最上沿',
  );
} else if (/padding-top:[^;]*var\(--sa-t\)[^;]*[\d.]+px|padding-top:[^;]*[\d.]+px[^;]*var\(--sa-t\)/.test(css.match(/@media \(display-mode: fullscreen\)[\s\S]*?\n\}/)?.[0] || '')) {
  /* 判据 = 「padding-top 里同时出现 var(--sa-t) 和一个固定 px 值」，顺序不限、也不要求用 + 连接。
     早先写的是 `var(--sa-t)…+…px`，只认加法；后来改成
     `calc(var(--s4) + max(var(--sa-t), 30px))` —— 语义一样（保底 30px），
     但它没有 `+` 落在两者之间，旧正则就误判成"没有兜底"。
     放宽的是**写法**，不是**要求**：必须同时有安全区变量和固定 px，缺一仍然报错。 */
  ok.push('全屏模式下页头留白兜底就位（--sa-t 归零时仍有固定留白）');
} else {
  problems.push('全屏媒体查询里没看到「固定留白 + --sa-t」的组合，状态栏隐藏后页头可能贴边');
}

// --sa-t 定义了就必须有人用；只定义不用 = 状态栏浮层会压住页头（iOS black-translucent 就是这么丢的）
const saTUsed = /var\(--sa-t\)/.test(css);
if (saTUsed) ok.push('顶部安全区变量 --sa-t 已被消费（iOS 半透明状态栏不会压住页头）');
else problems.push('css 定义了 --sa-t 却没有任何规则使用它 —— iOS 的 black-translucent 状态栏会浮在页面上压住页头');

/* ---------- 6e. 不得再依赖外部字体 CDN（国内可达性 + 首屏阻塞回归守卫） ---------- */
if (/fonts\.(googleapis|gstatic)\.com/.test(html)) {
  problems.push('index.html 又出现了 Google Fonts 引用 —— 国内不可达，且 <link rel="stylesheet"> 是渲染阻塞资源，会拖白首屏');
} else {
  ok.push('字体完全自托管，无外部字体依赖（离线可用）');
}

const swVer = (sw.match(/gamelife-v(\d+)/) || [])[1];
const MIN_SW_VER = 19;   // v1.9.0：设置页新增「检查更新」按钮（app.js 加 GL.checkUpdate、css 加 .upd-state）；前几轮：v16 顶栏/设置/技能形态 → v17 emoji 豆腐块 → v18 技能改就地展开；每轮都动了 css 或 js，资源有变就必须抬到同值
if (swVer && Number(swVer) >= MIN_SW_VER) ok.push(`sw.js 缓存版本已升到 v${swVer}（≥ v${MIN_SW_VER}）`);
else problems.push(`sw.js 缓存版本过低（当前 v${swVer || '?'}，需 ≥ v${MIN_SW_VER}）—— 改了资源必须升版，否则用户浏览器里的旧缓存不会刷新，页面会停留在旧版本`);

/* ---------- 6f-2. emoji 字形安全（v1.8.2） ----------
   事故：技能「心肺」用了 U+1FAC1，是 Emoji 13.0（2020）才加入的字符。
   本机字体没有这个字形 → 界面上就是一个「豆腐块」空方框（headless 渲染出来
   与真实设备一致，已截图确认）。同批次其余 12 个 emoji 全部正常。
   U+1FA70–U+1FAFF 这一块整体是 2019 年后的新增（Emoji 12.0 起陆续填充），
   老一点的 Windows / 安卓设备普遍缺字形 —— 用这条断言把这个坑封死。
   ⚠ 连注释与报错文案里也**只写码点、不写那个字符** —— 一个「禁止新 emoji」的
   守卫自己带着新 emoji，看报错的人终端里照样是一块豆腐，等于把话说糊了。 */
const RISKY_EMOJI = /[\u{1FA70}-\u{1FAFF}]/gu;
function firstRiskyEmoji(src) {
  const m = src.match(RISKY_EMOJI);
  if (!m) return null;
  const i = src.indexOf(m[0]);
  const ctx = src.slice(Math.max(0, i - 26), i + 8).replace(/\n/g, ' ');
  return { ch: m[0], cps: [...m[0]].map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' '), ctx };
}
const risky = firstRiskyEmoji(storageSrc) || firstRiskyEmoji(html);
if (risky) {
  problems.push(
    `发现高风险 emoji「${risky.ch}」（${risky.cps}）—— 位于 U+1FA70–U+1FAFF（2019 年后新增字形），` +
    `老设备缺字形会显示成豆腐块空框。位置附近：…${risky.ctx}…。` +
    '请换成老字符（例如心肺那个换成 U+1F493 的爱心，外貌组的换成 U+1F484 的口红）'
  );
} else {
  ok.push('属性/技能/页面里没有 U+1FA70+ 的高风险 emoji（老设备缺字形会显示成豆腐块）');
}
/* 守卫自己也不许带（见上面的 ⚠）：它是「禁止新 emoji」这条规则本身，
   自己带着新 emoji，看报错的人在终端里会先看到一块豆腐，等于把话说糊了。
   ⚠ 别把它写成「全仓扫描」—— 本文件里那条正则的字面量 `\u{1FA70}` 是转义序列、
   不是真字符，所以扫到自己不会误报。 */
if (firstRiskyEmoji(fs.readFileSync(__filename, 'utf8'))) {
  problems.push('verify-wiring.js 自己带了 U+1FA70+ 的 emoji —— 注释与报错文案里只许写码点');
} else {
  ok.push('verify-wiring.js 自身也只写码点、不带高风险 emoji');
}


/* ---------- 6g. SW 必须能把新版本送到用户眼前（v1.7.4 实机事故守门） ----------
   事故：改了代码、也发了新包，用户实机反馈「没有任何变化」。
   四个成因都不是「代码写错了」，静态校验全绿也照样发生：
     ① sw.js 自己也被 HTTP 缓存住 → 更新检查拿到旧字节 → 浏览器认定「没有新版」；
     ② 装缓存时 `cache.add(u)` 走 HTTP 缓存 → 新缓存里装的还是旧文件；
     ③ 旧 SW 是缓存优先，接管时用户那张页面已经用旧脚本跑起来了，不刷就看不到新版；
     ④ 「让旧页面刷新」这一步本身有个死锁（见下），写错的话表面全绿、实际送不出去。
   这些一旦被改回去，界面依旧正常、构建依旧成功，只是用户永远看到旧版。
   所以在此钉死：缺任一条就报错。
   ⚠ 这里只覆盖「静态可判」的部分；「真的能在一次打开内完成换代」由第五层
   tools/test-update-flow.js 用真浏览器跑 —— 静态判不出 §4 里的死锁顺序。 */
if (/cache:\s*'reload'/.test(sw)) ok.push('SW 装缓存时绕开 HTTP 缓存（cache: reload），新缓存不会装进旧文件');
else problems.push('sw.js 装缓存没有用 cache: \'reload\' —— 会走 HTTP 缓存，升级后新缓存里可能仍是旧文件，用户界面看不到变化');

if (/updateViaCache:\s*'none'/.test(app)) ok.push('注册 SW 时 updateViaCache: none（脚本本身不吃 HTTP 缓存，否则更新检查永远拿到旧字节，新 SW 装不上）');
else problems.push('app.js 注册 SW 时没写 updateViaCache: none —— sw.js 自己会被 HTTP 缓存住，浏览器会认定「没有新版」');
if (/reg\.update\(\)/.test(app)) ok.push('每次打开主动查一次 SW 更新（reg.update）');
else problems.push('app.js 没在打开时 reg.update()，只能等浏览器自己想起来查更新');

/* ③ 页面侧自刷是主力：旧 SW 缓存优先，只有页面自己重载才拿得到新资源。
   v1.9.0 起刷新动作收进 reloadForUpdate()（自动与「检查更新」按钮共用同一条路 +
   同一个单次守卫），所以这里不只认「controllerchange 后面紧跟 location.reload()」，
   而是要求「绑到那个函数」且「那个函数真的会 reload」—— 两步都查，才算钉住。 */
if (/addEventListener\('controllerchange',\s*reloadForUpdate\)/.test(app)
  && /function\s+reloadForUpdate\s*\([\s\S]*?location\.reload\(\)/.test(app)) {
  ok.push('页面侧监听 controllerchange 自刷（换版后打开一次就看到新界面 —— 主力机制）');
} else {
  problems.push('app.js 没有把 controllerchange 绑到 reloadForUpdate()（或该函数不再 reload）—— 旧 SW 缓存优先会把旧界面一直供下去，用户「装了新版却什么都没变」');
}

/* ④ 两个死锁：写成「看起来更规范」的 await 化就会送不出新版 */
const installBody = (sw.match(/addEventListener\('install'[\s\S]*?\n\}\);/) || [''])[0];
if (!/await\s+self\.skipWaiting\(\)/.test(installBody)) {
  ok.push('install 里没有 await skipWaiting()（它的 promise 要等激活才 resolve，一 await 就是死锁）');
} else {
  problems.push("install 里写了 await self.skipWaiting() —— 死锁：install 永不结束、新版永远升不上去；而新缓存已经建好，从 caches.keys() 看『像是装成功了』");
}
const activateBody = (sw.match(/addEventListener\('activate'[\s\S]*?\n\}\);/) || [''])[0];
if (/waitUntil\([\s\S]*?\.navigate\(/.test(activateBody) && !/setTimeout\([\s\S]*?\.navigate\(/.test(activateBody)) {
  problems.push('activate 的 waitUntil 里直接调了 Client.navigate() —— 死锁：本 SW 在 activate 落地前不处理 fetch，导航请求没人应答，实测挂 37 秒后报「Cannot navigate to URL」');
} else {
  ok.push('activate 里没有在 waitUntil 中直接 navigate（避开了「导航请求无人应答」的死锁）');
}
if (/clients\.matchAll/.test(sw) && /\.navigate\(/.test(sw)) {
  ok.push('SW 侧保留延迟一拍的兜底刷新（救「页面上跑的还是旧代码」那一次，例如 v1.7.4 → v1.7.5）');
} else {
  problems.push('sw.js 连兜底刷新都没了 —— 页面上跑的还是没有 controllerchange 监听的旧代码时（v1.7.4 → v1.7.5 正是这种），新版永远送不出去');
}

/* ---------- 6h. 「检查更新」按钮必须真的接在换版链路上（v1.9.0） ----------
   这类按钮最容易退化成安慰剂：画个按钮、点完弹一句「已是最新」，
   底下什么都没发生 —— 界面看着更"完整"了，实际是把「看不到新版」这件事藏得更深。
   所以这里把「按钮 → GL.checkUpdate → reg.update() → 自刷」这条链的每一环都钉住，
   外加 sw.js 那侧必须留好的 SKIP_WAITING 兜底通道。 */
const hasUpdBtn = /id="btn-check-update"|id\s*=\s*'btn-check-update'/.test(app);
const hasUpdHandler = /e\.target\.id\s*===\s*'btn-check-update'[\s\S]{0,80}?GL\.checkUpdate\(\)/.test(app);
const hasUpdEntry = /GL\.checkUpdate\s*=\s*(async\s+)?function/.test(app);
if (hasUpdBtn && hasUpdHandler && hasUpdEntry) {
  ok.push('设置页「检查更新」接线完整（关于卡片里有按钮 + 点击有处理 + GL.checkUpdate 有实现）');
} else {
  problems.push('「检查更新」接线不完整（按钮 ' + (hasUpdBtn ? '有' : '缺')
    + ' / 点击处理 ' + (hasUpdHandler ? '有' : '缺')
    + ' / GL.checkUpdate ' + (hasUpdEntry ? '有' : '缺') + '）—— 少一环就只是个按钮图案');
}

/* 必须走 reg.update() 强制重拉；配合 register 的 updateViaCache:'none' 才不被 HTTP 缓存骗 */
if (/reg\.update\(\)/.test(app)) ok.push('检查更新走 reg.update() 强制重拉 sw.js（配合 updateViaCache:none）');
else problems.push('GL.checkUpdate 里没有 reg.update() —— 点一万次也查不到新版');

/* 查不动时必须说查不动。谎报「已是最新」比不检查更糟：用户以为没问题就不再管了 */
if (/navigator\.onLine|onLine/.test(app)) ok.push('检查更新区分「离线 / 检查失败」与「已是最新」（查不动时不谎报最新）');
else problems.push('app.js 没区分离线 —— 断网时会把「查不到」说成「已是最新」，比不检查更糟');

/* 原生 APK 的网页资源是打包进包体的，应用内换不了 —— 文案必须分开写，不假装能自更新 */
if (/isNativeApp\(\)[\s\S]{0,400}?打包进包体|打包进包体/.test(app)) {
  ok.push('检查更新对原生包如实说明（APK 包体内的资源应用内换不了，只做版本核对）');
} else {
  problems.push('app.js 未对原生包说明差异 —— 会对 APK 用户谎称能自动更新，而包体是打包进去的');
}

/* sw.js 侧的兜底通道：新 SW 卡在 waiting 时，页面发消息催它上位 */
const msgBody = (sw.match(/addEventListener\('message'[\s\S]*?\n\}\);/) || [''])[0];
if (/SKIP_WAITING/.test(msgBody) && /self\.skipWaiting\(\)/.test(msgBody)) {
  ok.push('sw.js 留有 SKIP_WAITING 兜底通道（新 SW 卡在 waiting 时页面能催它上位）');
} else {
  problems.push('sw.js 没有 SKIP_WAITING 的 message 处理 —— 「新 SW 停在 waiting」这种边角情况下，检查更新会一直等下去');
}
if (/await\s+self\.skipWaiting\(\)/.test(msgBody)) {
  problems.push('sw.js 的 message 处理里写了 await self.skipWaiting() —— 与 install 里那个是同一个死锁');
} else {
  ok.push('message 处理里没有 await skipWaiting()（避开同一个死锁）');
}

/* 状态行得有落脚处，否则点完按钮毫无反馈 */
if (/^\s*\.upd-state[\s,{.:]/m.test(cssSrc)) ok.push('style.css 有 .upd-state（检查进度 / 结果的反馈位）');
else problems.push('style.css 缺 .upd-state —— 点完按钮没有任何反馈，用户不知道发生了什么');

/* ---------- 输出 ---------- */
ok.forEach((s) => console.log('  ✓ ' + s));
if (problems.length) {
  console.log('');
  problems.forEach((s) => console.log('  ✗ ' + s));
  console.log(`\n❌ 接线校验 ${problems.length} 处问题`);
  process.exit(1);
}
console.log(`\n✅ 接线校验全部通过`);
