/* ============================================================
   集成校验：index.html 与 JS 的「DOM id ↔ 代码引用」是否对得上
   跑法：node game-life/tools/verify-wiring.js
   —— 补上 portrait.js 无头校验管不到的那一环：
      脚本加载顺序、宿主节点存在性、被移除节点的残留引用
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const problems = [];
const ok = [];

/* ---------- 1. 脚本顺序 ---------- */
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const localScripts = scripts.filter((s) => !/^https?:/.test(s));

const EXPECT = ['js/storage.js', 'js/avatar.js', 'js/portrait.js', 'js/physiology.js',
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
const NEEDED = ['portrait-svg', 'stage', 'stage-base', 'hud-lv', 'hud-readouts',
  'wing-attrs', 'wing-body', 'tabs', 'ctrl-toggle', 'avatar-ctrl',
  'panel-hud', 'panel-skills', 'panel-life', 'panel-settings', 'toast-box', 'main'];
for (const id of NEEDED) {
  if (!new RegExp(`id="${id}"`).test(html)) problems.push(`index.html 缺少宿主节点 #${id}`);
}
if (NEEDED.every((id) => new RegExp(`id="${id}"`).test(html))) {
  ok.push(`宿主节点齐全（${NEEDED.length} 个）`);
}

/* ---------- 3. 立绘 SVGSVG 属性 ---------- */
const svgTag = (html.match(/<svg id="portrait-svg"[^>]*>/) || [''])[0];
if (!/viewBox="0 0 680 1000"/.test(svgTag)) problems.push('#portrait-svg 的 viewBox 不是 "0 0 680 1000"（与 portrait.js 画布不符）');
else ok.push('#portrait-svg viewBox 与 portrait.js 画布一致（680×1000）');

/* ---------- 4. 被移除节点不得再被 JS 引用 ---------- */
const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js'));
const REMOVED = ['avatar-canvas'];
for (const f of jsFiles) {
  const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  for (const id of REMOVED) {
    if (src.includes(`getElementById('${id}')`)) {
      // avatar.js 的休眠 3D 段是允许的
      if (f === 'avatar.js') { ok.push(`avatar.js 仍引用 #${id}（休眠 3D 段，只在 THREE 存在时执行）`); continue; }
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
const MIN_SW_VER = 13;   // v1.7.5：图标前景层改透明 + SW 升级机制加固，资源有变必须 ≥ v13
if (swVer && Number(swVer) >= MIN_SW_VER) ok.push(`sw.js 缓存版本已升到 v${swVer}（≥ v${MIN_SW_VER}）`);
else problems.push(`sw.js 缓存版本过低（当前 v${swVer || '?'}，需 ≥ v${MIN_SW_VER}）—— 改了资源必须升版，否则用户浏览器里的旧缓存不会刷新，页面会停留在旧版本`);

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

const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
if (/updateViaCache:\s*'none'/.test(app)) ok.push('注册 SW 时 updateViaCache: none（脚本本身不吃 HTTP 缓存，否则更新检查永远拿到旧字节，新 SW 装不上）');
else problems.push('app.js 注册 SW 时没写 updateViaCache: none —— sw.js 自己会被 HTTP 缓存住，浏览器会认定「没有新版」');
if (/reg\.update\(\)/.test(app)) ok.push('每次打开主动查一次 SW 更新（reg.update）');
else problems.push('app.js 没在打开时 reg.update()，只能等浏览器自己想起来查更新');

/* ③ 页面侧自刷是主力：旧 SW 缓存优先，只有页面自己重载才拿得到新资源 */
if (/addEventListener\('controllerchange'[\s\S]{0,240}?location\.reload\(\)/.test(app)) {
  ok.push('页面侧监听 controllerchange 自刷（换版后打开一次就看到新界面 —— 主力机制）');
} else {
  problems.push('app.js 没有监听 controllerchange 自刷 —— 旧 SW 缓存优先会把旧界面一直供下去，用户「装了新版却什么都没变」');
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

/* ---------- 输出 ---------- */
ok.forEach((s) => console.log('  ✓ ' + s));
if (problems.length) {
  console.log('');
  problems.forEach((s) => console.log('  ✗ ' + s));
  console.log(`\n❌ 接线校验 ${problems.length} 处问题`);
  process.exit(1);
}
console.log(`\n✅ 接线校验全部通过`);
