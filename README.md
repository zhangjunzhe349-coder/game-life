# Game Life · 人生游戏面板

把人生当成游戏来打：人物立绘 + 生理追踪 + 属性面板 + 技能成长 + 生命刻度。
纯前端 PWA，数据存于本机 localStorage，无需登录、可离线、可安装到桌面。

## 运行

```bash
# 任意静态服务器
cd game-life
python -m http.server 8080
# 浏览器打开 http://localhost:8080
```

## 离线运行与手机端安装（v1.7.0）

### 前提：Service Worker 只在「安全上下文」注册

只有 `https://` 与 `localhost` 算安全上下文，**其它一律不注册 SW**：

| 打开方式 | 页面能看 | 离线可用 | 能装到桌面 |
|---|---|---|---|
| 双击 `index.html`（`file://`） | 可以 | **不行**（SW 不注册） | 不行 |
| 局域网 IP `http://192.168.x.x:8080` | 可以 | **不行**（SW 不注册） | 多数浏览器拒绝 |
| `http://localhost` | 可以 | 可以 | 可以（仅本机） |
| **https 托管** | 可以 | **可以** | **可以** |

**所以「手机 + 离线」的正解只有一个：把它放到 https 地址上，再从手机装到主屏幕。**
（v1.6.1 及更早的 README 写的是「局域网访问后添加到主屏幕」，那是错的 —— 那样装出来的图标没有离线能力。）

### 部署：先构建 `dist/`，再上传

```bash
cd game-life
node tools/patch-index-mobile.js    # 先清编辑器注入（跑过浏览器/预览就会被重新注入）
node tools/build-dist.js            # 产出 dist/：纯净运行时资源，约 460 KB
node tools/browser-check.js --dist  # 把 87 项断言跑在产物上（不是跑在源码上）
node tools/test-update-flow.js      # 升级链路：换成新版后「打开一次」就该看到新版
```

发布（内置托管，无需账号）：

```bash
node tools/build-dist.js --mirror="<发布目录绝对路径>"   # 构建 + 同步，一次完成
```

`--mirror` 存在的理由：内置托管会把名为 `dist` 的目录当作构建产物**排除** ——
实测直接发布 `dist/` 得到的是**空站点**。所以发布要用另一个名字的目录（本项目用
`../game-life-site`），用 `--mirror` 同步可避免手抄漏文件，也避免发布一份陈旧产物
（镜像只在自检全部通过后才执行）。

发布之后**一定要把同一组断言跑在线上地址上**（`--url` 会跳过内置服务直连）：

```bash
node tools/browser-check.js --url=https://<你的地址>/ --no-shot
```

线上与本地至少有三处不同，恰好都是会导致「页面能看但离线失效」的地方：
**真实域名的 MIME**（`sw.js` 不是 JS 类型就静默注册失败）、**缓存头**、**子路径与 HTTPS**
（PWA 作用域要求相对路径）。此外该模式会实测 Service Worker 是否真的注册并接管、
缓存是否真的建立 —— 这是「载体能不能离线用」的唯一硬证据。

`dist/` 与仓库是两份不同的东西：仓库里有 `tools/`（校验脚本 + 十几张调试截图）、`README.md`、`.git`，
这些都不该出现在公网 URL 下。构建脚本会自检并**拒绝产出不合格的产物**：

- 清单以 `sw.js` 的 `ASSETS` 为唯一真值，另补「只被 JS 字符串引用」的文件；
- 每个 `href` / `src` / `url()` 引用都必须在产物里真实存在；
- 零跨域引用（断网可用的前提）、不得混入开发产物；
- **源 `index.html` 若带编辑器注入（`data-page-node-id`）直接拒绝构建** —— 那些标记会随部署公开泄露。

> **为什么一定要跑 `--dist` 那一遍**：静态扫引用查不出两类问题。
> 本项目的构建脚本第一版就漏拷了 `sw.js` —— Service Worker **不会把自己写进 `ASSETS`**（自己缓存自己没意义），
> 于是「以 `ASSETS` 为唯一真值」的逻辑把它整份漏掉了。线上表现极具欺骗性：
> 页面照常打开、数据照常保存，**只是静默失去离线能力**，而且 `app.js` 里是
> `register('sw.js').catch(() => {})`，失败被吞掉，连控制台都不闹。
> 这个 bug 就是被 `browser-check.js --dist` 报的 `404 fetching the script` 抓出来的。

#### 平台怎么选（面向国内手机访问）

| 平台 | 免费额度 | 自动 HTTPS | 国内访问 | 结论 |
|---|---|---|---|---|
| **腾讯云 EdgeOne Pages** | 50 GB/月 | 是 | 免备案即可用；备案后 50–90 ms | **首选** |
| Cloudflare Pages | 无限带宽 | 是 | 联通晚高峰 800 ms+，时通时不通 | 备选 |
| GitHub Pages | 100 GB/月 | 是 | 极慢 | **本项目当前采用**（地址见下），门槛最低但国内体验差 |
| Vercel / Netlify | 100 GB/月 | 是 | 大陆基本不可访问 / 较差 | 不推荐 |

之所以不能「随便挑一个」：本项目全部价值都建立在**手机装到主屏幕、断网也能用**之上，
而那个过程的第一步是能在手机上打开 https 地址。平台在国内不可达的话，前面所有离线适配都白做。

#### 各平台操作

- **内置托管（本项目当前用它给手机访问）**：把 `--mirror` 出来的发布目录交给内置托管即可，
  **无需任何账号授权**，即刻得到 https 地址。注意不要直接发布 `dist/`（会被当构建产物排除，发出空站点）。
  - ✅ **本项目已上线（2026-09-23）**：<https://ef952b2677914127a1cb45d21a2ca93c.app.workbuddy.host>
    —— 87 项断言已直接跑在该地址上验证通过（含 Service Worker 注册与缓存建立）。
- **EdgeOne Pages（推荐用于长期/国内提速）**：控制台新建项目 → 上传 `dist/` 目录，或连 GitHub 仓库自动构建。
- **Cloudflare Pages**：也可以把 `dist/` 直接拖进控制台（无需 Git）。用命令行则先 `npx wrangler login`，之后：
  ```bash
  npx wrangler pages deploy dist --project-name=game-life
  ```
  每次更新只需重跑构建 + 这一条命令。
- **GitHub Pages**：**仓库根目录本身就是站点**（`index.html` 就在根上），不需要额外构建步骤：
  ```bash
  gh repo create game-life --public --source=. --remote=origin --push
  git push origin --tags     # gh 的 --push 不带 tag，版本 tags 要另推
  gh api -X POST "repos/{owner}/{repo}/pages" \
    -f 'source[branch]=main' -f 'source[path]=/'
  ```
  之后地址是 `https://<用户名>.github.io/game-life/`。
  - ✅ **本项目已上线（2026-09-23）：<https://zhangjunzhe349-coder.github.io/game-life/>**
    仓库：<https://github.com/zhangjunzhe349-coder/game-life>（`main` 分支即站点根目录，推上去约 1 分钟自动发布）
  - ⚠ 国内直连很慢，手机上最好先开代理再「添加到主屏幕」；装好后断网可用（Service Worker 已提供离线能力）。
  - ⚠ 免费账号的 Pages **只对公开仓库开放**（私有仓库需 Pro）。仓库一公开，源码与 README 都会公开 ——
    所以上线前要扫一遍有没有写死的本地绝对路径、真名、密钥。
  - ⚠ 免费版 Pages 是**纯静态**、无服务端逻辑；本项目正好是纯前端，契合。
  - ⚠ 部署在子路径下时，`manifest.webmanifest` 的 `start_url`/`scope` 与 Service Worker 作用域
    都必须是**相对路径**才不失效（本仓已是 `"./index.html"` / `"./"`，已确认可用）。
  - ⚠ Pages 默认会跑 Jekyll，它会忽略下划线开头的文件；根目录已放 `.nojekyll` 规避。
  - 想只发布产物而不是整个仓库：把 `dist/` 内容推到 `gh-pages` 分支。

### 装到手机

1. 手机浏览器打开那个 https 地址，确认页面正常
2. **iOS**：Safari → 分享 → 「添加到主屏幕」；**安卓**：Chrome → 菜单 → 「添加到主屏幕」
3. 之后从主屏幕图标进入：全屏无地址栏、断网可用

> iOS 必须用 **Safari** 添加（Chrome for iOS 走的是同一内核但入口不完整）。
> 图标已经是 PNG（`apple-touch-icon.png` 180×180）—— iOS 不认 SVG，用 SVG 会显示成白块。

### 打包成安卓 App（v1.7.3）

**不是所有安卓浏览器都给 PWA 安装入口。** Chrome 从 108 版起取消了无条件的
「添加到主屏幕」，只在判定「可安装」时才显示「安装应用」；而国产浏览器（UC、夸克、
QQ，以及小米 / 华为 / OPPO / vivo 自带的那几个）基本不实现 PWA 安装 ——
菜单里连这一项都没有。这种情况站点侧再完美也没用（可用 `tools/diag-installable.js`
让浏览器自己说出原因）。

于是走原生打包：`android-pack/` 是 Capacitor 壳，只负责把 `dist/` 的纯净产物装进
原生容器，**业务代码一行不改**。本地不需要装 Android Studio / JDK / Android SDK，
由 `.github/workflows/android.yml` 在 GitHub 的机器上出包。

**取包**（固定链接，每次构建原地更新）：

```
https://github.com/zhangjunzhe349-coder/game-life/releases/download/android-latest/GameLife.apk
```

手机上装包要允许「安装未知来源应用」。仓库 Actions 页也能手动触发构建。

APK 与 PWA 的差别：

| | APK | PWA |
|---|---|---|
| 安装入口 | 系统装包，不受浏览器限制 | 取决于浏览器是否支持 |
| 全屏 | 没有地址栏也没有浏览器 UI，状态栏保留 | 安卓可连状态栏一起去掉，iOS 不行 |
| 离线 | 资源打包在应用内，天然离线，**不需要首次联网** | 靠 Service Worker 缓存，首次必须成功加载一次 |
| 数据 | 应用私有存储，与浏览器 / 线上站点互不可见 | 绑 origin |

#### 几个必须知道的点

- **签名必须固定。** 密钥由 Python `cryptography` 生成 PKCS12，存在仓库 Secret
  （`ANDROID_DEBUG_KEYSTORE_B64`），不入库、不公开。构建时会断言
  「keystore 证书指纹 == APK 实际签名指纹」，不等就失败。理由是签名一变，覆盖升级
  会被系统以「签名不符」拒绝，而唯一的绕过方式是卸载 —— 那会清掉 App 内的数据。
  > 踩过一次：早期把密钥放在 `~/.android/debug.keystore`，依赖 Gradle 对 `user.home`
  > 的推断，CI 上推断不到 → **静默退回了自动生成的临时签名**。产物一切正常、badging
  > 全对，只有对比证书指纹才发现。所以现在改成在 `build.gradle` 里显式指定
  > `signingConfigs.debug`，并加了指纹断言守住。
- **定制全部落在 `android-pack/scripts/prepare-android.js`。** 因为 `android/` 是
  `npx cap add android` 每次从模板重新生成的（不入库），手动改一次就会被覆盖。
  它负责：换启动器图标（含自适应图标前景层）、换 11 张启动画面、改背景色、把版本号
  从 `js/app.js` 的 `APP_VERSION` 派生（单一真值，不手写两份），并逐个断言覆盖的
  图片尺寸与模板原图一致 —— 缩放比例错了很难从截图上发现。
- **构建前会跑 `tools/build-dist.js`**，所以「源 `index.html` 带编辑器注入就拒绝构建」
  那道闸门对打包同样生效。产物自检还会确认 APK 内确实含 `assets/public/index.html`
  （否则装上去是白屏），并从**编译后**的 badging 读包名 / 应用名 / 版本号 / 启动入口
  （aapt2 会重写资源名，按 `res/mipmap-*/ic_launcher.png` 这种原路径是查不到的）。
- **包名 `com.jayzen.gamelife` 装上之后就不能改了** —— 改包名等于换一个 App，数据不通。
- **上架应用商店需要换成正式签名**（密钥移入 Secrets、补 `signingConfigs.release`）。
  现在的包是调试签名，只适合自己侧载。

### 全屏程度：安卓连状态栏一起去掉（v1.7.1；v1.7.4 起顶部固定预留）

manifest 的 `display` 为 `fullscreen`、`display_override` 为 `["fullscreen", "standalone"]`：

- **浏览器标签页里打开**：当然有地址栏 —— 这不是配置问题，是没装。
- **装到主屏幕后**：安卓连顶部状态栏（时间/电量）一起去掉，真全屏；
  **iOS 系统不支持 fullscreen，按规范回落到 standalone**（状态栏还在，这点绕不过去）。
- **顶部一律留一条空白**（v1.7.4，用户明确要求"要预留，不预留不好看"）：
  窄屏 `#main` 的 padding-top 取 `calc(var(--s4) + max(var(--sa-t), 30px))`
  —— 全屏时 `env(safe-area-inset-top)` 会归零，但有 `max()` 兜着，至少留 30px（≈安卓状态栏高度），
  页头不会贴到屏幕最上沿。末尾那条 `@media (display-mode: fullscreen)` 在此之上**再多 10px**：
  常态下上方总还有东西占位（浏览器地址栏 / 系统状态栏），全屏是**真的什么都没有**了。

> ⚠ **不能只认 `--sa-t`**：**安卓的 WebView 与独立应用一律返回 0**（安卓不做 safe-area 插值），
> 而系统状态栏照样占着最上面一条 —— APK 里就靠那 30px 兜住。只写 `var(--sa-t)` 等于在安卓上完全没预留。
> `max()` 需要 Chrome 79+ / Safari 11.1+（现代安卓与 iOS 均满足）。

> ⚠ **两个改动必须成对**：浏览器**优先读 `display_override`**，只把 `display` 改成 fullscreen
> 在安卓上不会生效；而 `display_override` 里必须留着 `standalone`，否则 iOS 没有可用项会退回浏览器模式。
> `tools/verify-wiring.js` 已加断言守住这一条。
>
> ⚠ **已经添加到主屏幕的话，需要等 Chrome 后台更新 WebAPK**（通常几小时到一天，打开一次应用会催一下）。
> 若一天后仍非全屏：**先在设置页导出备份** → 删除主屏幕图标 → 重新「添加到主屏幕」 → 导入备份。
> **卸载 WebAPK 会连同该应用的 `localStorage` 一起清掉**，绝不能省掉导出这一步。

### 数据归属：localStorage 按 origin 隔离

这是部署前必须知道的一件事 —— 数据绑在**协议 + 域名 + 端口**上：

- **换地址就换数据**：`file://`、`http://192.168.x.x:8080`、`https://xxx.pages.dev` 三者互不可见。
  换地址之前，先在「设置」页**导出备份**，到新地址再导入。
- **iOS 上是两份独立存储**：Safari 标签页里的数据，与主屏幕 App 里的数据**不互通**；
  安卓 Chrome 的 WebAPK 同理。建议**固定只用一种方式录入**（推荐就用在主屏幕 App 里）。
- **系统可能清理站点数据**：iOS 的 ITP 会在长期不用时清理；已添加到主屏幕的 PWA 有一定豁免，但不保证。

所以设置页那两个按钮（⬇ 导出备份 / ⬆ 导入备份）不是可选项，是**目前唯一的跨设备手段**，建议定期导出。
想要真正的自动同步只能接后端 —— 纯前端做不到。

### 自检离线是否真的生效

1. DevTools → Application → Service Workers：确认状态是 `activated`
2. Application → Cache Storage → `gamelife-v11`：应有 **23 项**（含 6 个字体、5 个图标）
3. Network 面板勾上 **Offline** 后刷新：页面应完整呈现，且 logo 等展示字的字形**不退化**
   （若字形变了，说明字体没进缓存）

### 字体为什么必须自托管

原先引的是 Google Fonts，两个问题：`fonts.googleapis.com` 在国内不可达，字体永远加载不到；
而且 `<link rel="stylesheet">` 是**渲染阻塞**资源，浏览器要等它失败才继续画首屏。
现在两款字体（Chakra Petch / JetBrains Mono，各 3 个字重，共约 95KB）都在 `fonts/` 里，
CSS 用 `@font-face` 引用，`sw.js` 的 `ASSETS` 一并缓存 —— **整个页面零跨域请求**。
浏览器校对方式：Network 面板应只看到本机 `fonts/*.woff2`，看不到任何 `fonts.gstatic.com` 请求。

## 目录结构

```
game-life/
├── index.html              # 结构：顶栏 HUD / 左翼属性 / 中央人物立绘 / 右翼生理 + 技能·生命·设置
├── css/style.css           # 设计令牌 + 组件 + 响应式 + 降级动效
├── js/storage.js           # 数据层：默认数据、技能篇预设、等级曲线、工具函数
├── js/portrait.js          # 分层 2D 立绘引擎（中央形象，纯 SVG 矢量绘制）
├── js/avatar.js            # 体型参数 + 衣橱单品的控制面板（3D 渲染段已休眠）
├── js/physiology.js        # 饮水 + 自定义生理指标（HUD 右翼）
├── js/attributes.js        # 自定义属性打分（HUD 左翼）
├── js/skills.js            # 技能经验值（＋ 手动加经验）
├── js/life.js              # 生命周刻度
├── js/app.js               # 入口：导航、顶栏读数、设置、启动流程
├── tools/verify-portrait.js # 无头图层校验：立绘 36 用例
├── tools/verify-wiring.js  # 接线校验：脚本清单 / GL.* 提供者 / 宿主节点 / 资源存在性 / sw 版本
├── tools/verify-migrate.js # 数据迁移校验：v1 → v2 → v3（41 项断言，防丢历史/防改写原文小字）
├── tools/browser-check.js  # 浏览器冒烟：桌面 + 手机视口 / 渲染断言 / 交互测试 / 离线能力 / 面板明细 / 出 PNG
│                            #   --dist          整组断言改跑在部署产物 dist/ 上
│                            #   --url=<地址>    改跑在线上地址上（不走内置服务，验真实 MIME/缓存头/HTTPS）
├── tools/test-update-flow.js # 第五层·升级链路：旧版吃满缓存 → 换新版 → **只打开一次**必须看到新内容
│                            #   --old=<rev>     指定「旧版」提交（默认 HEAD~1，发布后用上一个 tag）
│                            #   --simulate-no-fix  负向验证：摘掉三处修复，断言必须失败
├── tools/build-dist.js     # 生成可部署的纯净 dist/（上线用；含产物自检与注入闸门）
│                            #   --mirror=<目录> 自检通过后同步到发布目录（内置托管不接受名为 dist 的目录）
├── tools/gen-icons.js      # 图标唯一入口：内置 SVG 源 → icon.svg + Web 4 张 PNG
│                            #   + 安卓 5 密度 × 3 张 PNG + 自适应图标 XML（两边同源，不会改一边忘一边）
│                            #   前景层必须真透明（PNG colorType=6），有像素断言守着
├── tools/patch-index-mobile.js # 给 index.html 打 PWA 资源补丁（幂等，顺带清除编辑器注入属性）
├── tools/render-preview.js # 把立绘落成 SVG+PNG，供单独检查比例
├── tools/verify-avatar.js  # 无头几何校验（v1.3.0 3D 版，保留）
├── fonts/                  # 自托管字体 6 个 woff2（离线可用，不依赖 Google Fonts）
├── icon.svg                # 矢量图标（由 gen-icons.js 写出，与各 PNG 同源）
├── icon-192.png            # 安卓主屏幕图标 / 标签页 favicon
├── icon-512.png            # 高清图标 / 启动画面
├── icon-maskable-512.png   # 自适应图标（底色满铺、内容缩到 66%，四周留给系统裁切）
├── apple-touch-icon.png    # iOS 主屏幕图标（满铺版：iOS 会自己套一层超椭圆遮罩）
├── sw.js                   # Service Worker（离线缓存，v10 起只接管同源资源；当前 v13）
├── manifest.webmanifest    # PWA 安装配置
├── tools/diag-installable.js     # 问浏览器「为什么没有安装入口」（CDP：getAppManifest / getInstallabilityErrors）
├── .github/workflows/android.yml # 云端出 APK（本地不用装 Android Studio / JDK / Android SDK）
└── android-pack/           # Capacitor 壳：把 dist/ 装进原生容器，不含业务逻辑
    ├── capacitor.config.json     # 包名 com.jayzen.gamelife / 应用名 Game Life
    ├── scripts/prepare-android.js # 可重放的定制：图标 / 启动画面 / 版本号 / 固定签名
    │                              #   （android/ 由 cap add 每次重建，不入库）
    ├── res/                # 覆盖进原生工程的安卓资源镜像（图标 15 + 启动画面 11 + 自适应图标与背景层 XML 3）
    └── keystore/           # 签名密钥不入库，由 CI 从仓库 Secret 恢复
```

## 属性与技能体系（v1.5.0 起，v1.6.0 补齐小字与编辑）

数据定义在 `js/storage.js` 顶部的 `ATTR_GROUPS` / `SKILL_GROUPS` / `ATTR_DEFS` / `SKILL_DEFS`，
改体系只动这几处，视图层会自动跟着分组渲染。

```
属性（3 大类 14 项）            技能（5 大类 13 项）
├─ ❤️ 生理值 (6)               ├─ 💪 生理 (2)   肌肉量 · 心肺
│   喉咙 · 鼻腔 · 困倦度        ├─ 🗣 语言 (2)   写作能力 · 表达能力
│   运动度 · 睡眠 · 饮食        ├─ 💬 社交 (2)   small talk闲聊能力 · 自信值
├─ 🧠 精神力 (5)               ├─ 🪞 外貌 (4)   皮肤 · 穿搭 · 发型 · 牙齿
│   欲望值 · 情绪值 · 社交度    └─ 🧭 其他 (3)   阅历 · 眼界 · 审美力
│   稳定度 · 盼头值
└─ 🌀 熵值 (3)  多巴胺需求 · 混乱值 · 嘈杂值
```

### 小字：逐字照录用户的原文，且可在页面上编辑（v1.6.0）

每个属性项 / 技能项有一个 `sub`（**小字注解**，跟在本体名后面）和一个 `note`（**说明**，
点开才显示）。两者的取值**逐字照录**用户提供的两份原文
（「【游戏人生(属性篇)】」与「【游戏人生(技能篇)元技能与方法论】」；原文文件不在本仓库内）：

```
原文                                     → name      sub                    note
喉咙（咽部）                              → 喉咙      （咽部）                —
运动度（活动半径）（久坐值）                → 运动度    （活动半径）（久坐值）   ——待家里会头晕
饮食  ——（少油，少盐，少糖）（地中海饮食，高蛋白） → 饮食  —                ——（少油，少盐，少糖）（地中海饮食，高蛋白）
肌肉量（细狗——匀称——薄肌）                → 肌肉量    （细狗——匀称——薄肌）    —
small talk闲聊能力（破冰）                 → small talk闲聊能力（破冰）          —
```

> ⚠ **不要改写、精简或合并这些文字。** 全角括号、破折号、逗号一律保留；
> 说明里的换行也保留（如「嘈杂值」是两行）。改 `ATTR_DEFS` / `SKILL_DEFS` 时请从原文粘贴。

**前端可直接编辑**：点开任一属性小项（或在技能卡片点「✎ 注释」），展开区里有
**名称 / 小字 / 说明** 三个字段，改完即存。

- 编辑**不触发 `GL.changed()`** —— 整页重渲染会把正在编辑的输入框连同光标一起换掉。
  改为直接写 `GL.state` + `GL.save()`，再就地刷新行内的名称与小字
  （属性走 `repaintRow()`，技能走 `repaintCard()` / `repaintCardNote()`）。
- 单行输入框按 `Enter` 提交，`Esc` 收起微调区（会先 `blur()` 落盘，避免改动丢失）。
- 用户自建项的 `id` 不在定义表里，迁移不会碰它。

### 极性（polarity）—— 决定刻度语义与配色

这是本体系最容易读错的地方。每个属性项有 `polarity` 字段：

| 极性 | 含义 | 配色 | 适用 |
|---|---|---|---|
| `pos` | 越高越好 | 青色 | 多数指标（喉咙、运动度、欲望值…） |
| `neg` | **越低越好** | 红色 | 熵值三项、困倦度 |
| `mid` | **中间最好** | 琥珀 + 理想区间标记 | 社交度（过低生理级不适）、稳定度（过高陷入麻木） |

三个连带规则：

1. **等级文案跟着极性走**。`GL.attrLevelsFor(polarity)` 给 `neg` 项生成的是
   `😌 清爽 / 🙂 平稳 / 😐 一般 / 😣 偏高 / 🔥 过载` —— 对困倦度显示「🔥 充沛」是反的。
2. **初始值也跟着极性走**（`START_VALUE`）。负向项从 30 起步，否则新用户打开会看到
   一条红色长条，误以为状态很糟。
3. **总览分对负向项取反**（`GL.overallScore()`）。熵值低是好事，若直接计入平均会把总分拉低 ——
   这是负向指标最容易踩的统计陷阱。组内均值则显示原始水平（短条 = 熵值低 = 好）。

### 界面呈现：三级视觉权重

14 项要放进原来 8 项的地方，靠的不是缩小，而是分层：

| 层级 | 元素 | 规格 |
|---|---|---|
| 1 | 大类标题 `.ag-head` | 正常字号 + 组均值 + 汇总条，**承担识别** |
| 2 | 细刻度行 `.ag-row` | 11px 灰字 + 等宽数字 + 3px 细条，一行约 22px（名称后跟 `sub` 小字） |
| 3 | 点开展开区 `.ag-tune` | **点小项才出现**，含数值步进 + 名称/小字/说明编辑（`GL.textEditBox`） |

组标题可点击折叠，状态存 `GL.state.ui.attrCollapsed`（刷新后保持）。

技能卡片同理：名称下方是小字 `sub`，卡片底部是注释栏（点「✎ 注释」展开同一套编辑字段，
说明非空时以引用样式渲染在卡片里）。

## 生命刻度自适应（v1.6.1）

`js/life.js` 把「一周一格」的一生画到 `#life-grid` 画布上。

### 排布模型：列数由宽度算，行数是结果

不是「52 列 × 预期寿命行」（那是一年一行的竖长条），而是**格子固定大小、列数随宽度算**：

```
cols = floor(可用宽度 ÷ (格子边长 + 间距))       ← 一行能挤下几个格子
rows = ceil(总周数 ÷ cols)                       ← 行数是算出来的结果
总格子数 ≡ 总周数（4,160 = 80 年 × 52 周），只是排布方式变了
```

格子边长在 `[4, 14]px` 里**从大到小试**，取第一个「整块高度 ≤ `H_TARGET`（520px）」的方案。
所以窗口变宽 → 列变多、行变少 → 整块变矮；窗口变窄 → 格子自动降一档。
**同一屏内所有格子一样大、正方形，绝不拉伸变形** —— 这正是旧版最难看的地方。

| 容器宽度 | 每格 | 排布 | 整块高度 |
|---|---|---|---|
| 1240px | 10px | 42 行 × 100 列 | 512px |
| 1600px | 11px | 35 行 × 120 列 | 463px |
| 900px | 8px | 49 行 × 86 列 | 498px |
| 440px | 5px | 73 行 × 57 列 | 519px |

旧版是固定 52 列 × 80 行：1600px 窗口下格子被拉伸到 **22px、整块 1850px 高**（要滚两屏），
窄屏下又只画出左边一小块。现在一生始终一眼看全 —— **锚定的是「此刻处在整段生命的什么位置」，不是某一年的细节**。

### 标尺：按周序号定位，不按行号

行不再等于一年，「每 10 行标一个年龄」随之失效（一行可能装 0.5 年，也可能装 3 年）。
改为按**周序号**定位：第 `age × 52` 周那一格，就是 `age` 岁生日所在的那一格。

| 标记 | 定位方式 | 画法 |
|---|---|---|
| 十年节点 | 第 `n×520` 周 | 该格画**白色内圈**（琥珀底与暗底上都看得清） |
| 年龄数字 | 同上 | 左侧 `10岁 / 20岁 / …`，按该格**所在行**对齐 + 一小段刻度线 |
| 年度刻度 | 第 `n×52` 周 | 该格左缘画 1px 起始线；**颜色按区域反转**（琥珀底用暗线、暗底用亮线），两边都看得见 |
| 当前这一周 | 第 `lived` 周 | 最外层信号青描边，最后画（压在最上面） |

格子小、白圈也小，但 `browser-check.js` 会数画布上的白色像素确认它真的画出来了（> 60px）。

### 三个实现要点

1. **宽度基准是容器，不是画布自己** —— `canvas.clientWidth` 在 canvas 没有 CSS 宽度时默认就是
   **300px**，量自己等于拿「上一次的自己」当基准，永远填不满。量 `#life-grid-wrap`。
2. **余数分摊**：宽度除不尽的部分均匀加到各列间距上（`extraOf(i)`），整块恰好铺满容器、
   每列左边缘都落在整数像素上（不糊边，也不留缝）。校验脚本直接断言
   `cols × cell + (cols-1) × 2 + 余数 === 可用宽度`。
3. **`ctx.setTransform(dpr,0,0,dpr,0,0)` 而不是 `ctx.scale()`**，且用 `lastW` 去重防自激：
   绘制会改画布高度 → 容器高度变化 → `ResizeObserver` 再次触发；
   宽度没变就直接返回。`render()` 里把 `lastW` 重置为 `-1`（面板重建后 canvas 是新节点，必须重画）。

几个关联约束：

- 生命面板初始是 `hidden`，隐藏时容器宽度为 0 → 绘制函数直接返回（等有宽度再画）。
  所以 `app.js` 的 `initTabs()` 里切到生命页时会显式调一次 `GL.renderLife()`。
- 每次绘制后会留一份布局真值在 `GL.lifeGrid`（`{ cell, cols, rows, totalWeeks, avail, h }`），
  并在网格下方渲染一行**排布读数**（`4,160 格 · 每格 10px · 当前 42 行 × 100 列`）——
  让「自适应」这件事看得见，也给校验脚本一个抓手。
- `browser-check.js` 会**真的用 `Emulation.setDeviceMetricsOverride` 改一次视口宽度**，
  断言列数确实跟着变了（1240px → 1000px：100 列 → 96 列），并逐像素确认网格画到了右缘。

## 分层 2D 立绘说明（v1.4.0）

中央形象由 `js/portrait.js` **纯代码矢量绘制**，零图片、零字体文件、零 CDN —— 彻底离线。

### 图层结构（自下而上 9 层）

`ground` → `hairBack` → `legs` → `shoes` → `body` → `arms` → `head` → `hairFront` → `accessory`

每层是一个独立函数，只吃一个 `shape()` 得到的半宽表 `s`，因此体型一变全层同步重算，
不存在「改了身体忘了改衣服」的错位。上装/下装由 `body()` 依据躯干轮廓**外扩 `pad = 7`** 得到，
天然合身；裙装由单品名匹配 `/裙|skirt|dress/i` 切换分支。

### 坐标基准（改几何前务必先读这段）

```js
const H = 940;                     // 身高对应的画布高度
const TOP = 28;                    // 头顶在画布中的 y
const yOf = (f) => TOP + f * H;    // 以身高比例取 y

const CX = 340;                    // 画布中枢线（viewBox 宽 680）
const KX = 940;                    // 横向换算：1 单位半径 = 1 画布像素
const px = (r) => r * KX;
```

所有 `Y` 表的 y 值一律由 `yOf(f)` 派生，**禁止硬编码绝对像素**。人体测量学比例（以身高 `H` 为单位）：
眼线 `0.926H`、颌下 `0.862H`、肩线 `0.820H`、胯 `0.475H`、膝 `0.280H`；
肩宽 `0.252H`、胸宽 `0.183H`、腰宽 `0.160H`、髋宽 `0.189H`、头宽 `0.088H`。

体型驱动与 3D 版同一套公式：`dw = clamp((weight-68)/68, -0.35, 0.55)`、`mus = clamp(muscle/100, 0, 1)`，
各围度 = 基准 × 体重修正 × 肌肉修正。

### 路径构造

`curve(pts)` 把 `[c1x, c1y, c2x, c2y, px, py, ...]` 转成 `M p0 C c1 c2 p1 C …`。

> **已知坑**：数组里**每个点必须 6 个元素**（两个控制点 + 一个锚点）。写成 8 个会产出
> `undefined undefined` 的路径而不报错，必须靠下面的校验工具兜住。

### 五层校验

改动 `portrait.js` / `attributes.js` / `skills.js` / `life.js` / `storage.js` / `index.html` / `sw.js` / `app.js` 后依次运行：

```bash
node tools/verify-portrait.js   # ① 静态：立绘 36 用例图层校验
node tools/verify-wiring.js     # ② 静态：脚本清单 / GL.* 提供者 / 宿主节点 / 资源存在性 / sw 版本
node tools/verify-migrate.js    # ③ 静态：数据迁移 v1→v2→v3（防历史记录丢失、防小字被改写）
node tools/browser-check.js     # ④ 动态：真跑页面 + 渲染断言 + 交互测试 + 手机视口 + 离线能力 + 出 PNG
node tools/test-update-flow.js  # ⑤ 动态：升级链路 —— 换版后**打开一次**就该是新版（先跑 build-dist.js）
```

改渲染后另跑 `browser-check.js --dist`（产物不是源码，两者不一样）；上线后再跑 `--url=<线上地址>`。

**为什么第 ⑤ 层必须存在**（v1.7.4 事故）：前三层查源码与接线、第四层查「页面能不能跑」，
**没有任何一层在查「用户手里那台旧机器换上新版之后会不会真的更新」**。
四层全绿、APK 拆包也确认是新代码，用户拿到的却仍是旧界面 —— 失败点全在
Service Worker 的换版链路（HTTP 缓存住 sw.js、新缓存装进旧文件、旧 SW 缓存优先一直供旧页面），
而且**只在新旧交替的那一次**发生，静态检查和单次冒烟都天然看不到。
`test-update-flow.js` 用真浏览器复现这个交替：旧提交起站吃满缓存 → 同端口同 profile 换新产物 →
只打开一次 → 断言已是新版。`--simulate-no-fix` 做负向验证（摘掉修复必须失败），
否则这条测试就是橡皮图章。

- `verify-portrait.js`：无头 DOM 桩件跑一遍 `drawAll()`，检查坏值 `NaN/undefined`、
  路径语法、**填充路径必须 `Z` 闭合**（`fill: none` 的线稿豁免）、关键部位是否齐备。
- `verify-wiring.js`：补前者的盲区 —— 脚本顺序必须为
  `storage → avatar → portrait → physiology → attributes → skills → life → app`，
  16 个宿主节点齐全、`#portrait-svg` 的 `viewBox` 与画布一致、无 Three.js CDN 残留、
  **每个模块调用的 `GL.*` 都有提供者**、缓存版本 ≥ v10。
  v1.7.0 补上了三类**此前根本没被检查过**的东西（旧版收资源的正则只认
  `js|css|html|svg|webmanifest`，`.png` 与 `.woff2` 全部漏检）：
  **`ASSETS` 里引用的每个文件必须真实存在**（离线缺资源是静默失败 —— 不报错、不崩，
  只是断网时那个文件没有）、**manifest 图标与 `index.html` 的本地引用必须存在**、
  **不得再出现 Google Fonts 引用**。
- `verify-migrate.js`：桩件跑 `storage.js`，断言迁移后**历史记录仍在**
  （`写作能力 xp 250` 要活着、旧名 `small talk闲聊能力` 要能配对、外貌四项要移入技能、
  旧项要淘汰、重复 load 要幂等）。v2→v3 那组还断言**小字被还原成原文**
  （运动度 `（活动半径）（久坐值）`、饮食说明含全角标点、嘈杂值说明保留换行），
  以及**用户自建项原样不动**。迁移出错是**静默丢数据**，不会报错，必须显式断言。
- `browser-check.js`（**最贴近真实的一层**）：内置静态服务器 + CDP 驱动真实浏览器，
  抓 `pageerror` / `console.error`，断言只有真渲染才有的状态
  （立绘 path 数、`.rv.in === .rv`、属性 3 组 14 行、负向行 4 个…），
  **并真点一遍新交互**（折叠、＋1 步进、−1 还原、折叠状态持久化、极性文案方向，
    以及 v1.6.0 的**文字就地编辑** —— 断言改动落进 `state`、行内小字即时同步、
    且输入框**没有被重渲染替换**（`isConnected`），因为编辑时丢焦点就是这么来的），
    输出各 tab 的 PNG + 编辑态局部图。
    **生命刻度那组会真的改一次视口宽度**（`Emulation.setDeviceMetricsOverride`）：断言列数随之变化、
    余数分摊后恰好占满可用宽度、整块高度不超上限，并**逐像素**确认网格画到了容器右缘
    （`getImageData` 数右缘 24px 竖条里的非透明像素，旧版这里是整片空白）、
    十年节点白圈确实落在画布上（数白色像素 > 60）。
    **v1.7.0 新增手机视口那一组**：把视口切成 iPhone 尺寸（390×844 / dpr 3 / mobile），
    断言侧栏确实变成 `position: fixed` 的底部标签栏、贴底悬浮、横向铺开、4 个页签触摸目标
    ≥ 44px、主区底部留白够高、**无横向溢出**、输入框字号 ≥ 16px
    （低于 16px 时 iOS 聚焦会自动放大整页）；并以**实际发出的资源请求**为证据，
    断言字体只从本机加载、Google Fonts 请求数为 0。
    **v1.7.1 补全屏与离线**：全屏那条不读源码，而是从部署产物的 CSSOM 取到 `@media (display-mode: fullscreen)`
    规则、再临时解除其媒体条件量**真实层叠结果**（`16px → 26px → 还原 16px`），
    验证它没被手机媒体查询里那条同为 `#main` 的 `padding` 简写盖掉；
    离线那 5 条实测 `sw.js` 的 MIME 是不是 JS 类型、**Service Worker 真的注册并接管了页面**、
    缓存真的建立且里面装了资源 —— 这是「装到主屏幕后能不能断网用」的唯一硬证据
    （`app.js` 里 `register('sw.js').catch(() => {})` 会把注册失败静默吞掉）。
    共 87 项，三种模式同一组断言：源码 / `--dist` 产物 / `--url=<线上地址>`。
    结尾还会打印**属性面板明细**（每组均值 + 每行「名称 数值」，负向标 `[-]`、双向标 `[~]`）——
    这不是断言，是给人眼的**地面真值**，缩略图上看错文案时以它为准。
  依赖 `ws`：装到仓库里（`npm i ws`），或 `NODE_PATH=<含 ws 的 node_modules 目录>` 指向已有的，
  然后 `NODE_PATH=<该 node_modules> node tools/browser-check.js`。

#### 图标与配套脚本（v1.7.0；v1.7.4 起统一到一处）

- **`tools/gen-icons.js`**：**图标的唯一入口**。内置 SVG 源 → 写出 `icon.svg` 与 4 张 Web PNG
  （192 / 512 / maskable 512 / iOS 180），**以及安卓的 5 密度 × 3 张 PNG 与自适应图标 XML**
  （落到 `android-pack/res/`）。Web 与安卓放在同一个脚本里，是因为图标只有**一份设计** ——
  拆成两个脚本迟早漂移（改了一边忘了另一边，而且从界面上很难看出来）。
  不装 sharp / cairosvg 之类依赖，借本机已有的 Chromium 无头渲染。
  踩过两个坑：相对路径的 `--screenshot` **不落在当前目录**（按浏览器自己的工作目录算，必须传绝对路径）；
  `--window-size` 有**最小尺寸钳制**，传 180 会得到一张只截到左上角的废图（文件很小、也不报错）。
  现解法：窗口一律开到 800px 以上，再用 `--force-device-scale-factor=size/win` 缩回来
  —— DSF 取 `size/win` 而不是写死的 0.25，是因为安卓有 48px 这种小图，4 倍窗口也才 192px，仍会被钳制。

- **安卓图标为什么必须分层（v1.7.4 修「一圈黑边」）**：
  自适应图标 = `background`（`drawable/ic_launcher_background.xml`，紫色渐变、**满铺**）
  + `foreground`（`ic_launcher_foreground.png`，**透明底**、只画闪电、内容收进中心安全区）。
  早先背景是 `#08090d` 近黑、前景还是一张自带底色的不透明方图 —— 系统把图标裁成圆形后，
  圆内是近黑底、中间一块紫色，看起来就是**一圈黑边**（用户实机反馈）。
  现在两层都不含第二种颜色：任何遮罩形状下，边缘露出的都是同一种紫。
  legacy 图标（`ic_launcher.png` / `ic_launcher_round.png`，Android 7 及以下用）同样改成满铺 / 整圆，不带外圈。
- **`tools/patch-index-mobile.js`**：改 `index.html` 请用它，别手工编辑。
  这个文件会被外部编辑器**持续**注入 `data-page-node-id`（清干净后几秒内就回来），
  手工 `Edit` 时常因这些多出来的属性而匹配失败。该脚本把「清除注入」与「应用改动」
  放进同一次原子写入，且**幂等** —— 提交前重跑一遍当兜底。

#### 为什么静态校验不够（两次事故复盘）

**v1.4.2 白屏**：`index.html` 漏了 `<script src="js/avatar.js">`，而 `app.js` 的 `start()` 在调
`GL.initAvatar()` → 抛 `TypeError` 中断启动 → 排在后面的 `reveal()` 没跑 →
所有 `.rv` 元素永久停在 `.rv { opacity: 0 }` → **整页白屏**。
当时 `verify-portrait` 与 `verify-wiring` **全绿**。

**v1.5.0 交互失效（正是上一条修复引入的回归）**：把首屏渲染改成走 `GL.changed()` 后，
各模块只注册了 `render` 而没注册 `bind()` —— 事件委托从未绑定。
页面能看、点不动，**两种静态校验依然全绿**。

两条教训指向同一结论：**静态分析查不出「页面跑起来会不会崩、点了有没有反应」。**
所以现在：

- `start()` 内每步都走 `step()` 包裹，任何模块出事不再连累整页；
- `reveal()` 有 1.2s 超时兜底，绝不留下白屏；
- **各模块的 `GL.hooks.push` 一律推 `renderAll = () => { render(); bind(); }`**，
  因为 `GL.changed()` 是唯一重渲染入口，只推 `render` 就等于永不绑定事件；
- `browser-check.js` 里有一组**交互测试**，专门守这个洞。

**极性文案反向（v1.5.0 引入极性语义后新增的隐患）**：`neg` 项若沿用 `pos` 的等级文案，
会对着「困倦度 30」（其实是清爽）显示「🔥 充沛」，纯属反向误导。`tuneNote()` 已改为负向给
「越低越好」、双向给「中间最好」，并在 `browser-check.js` 里加了三项断言锁死这个方向。

### 3D 版仍在，但已休眠

`js/avatar.js` 保留完整的 3D 建模代码（`build()` / `surface()` / `hairGeo()` 等），
但 `init()` 开头有 `if (typeof THREE === 'undefined') return;`，在无 Three.js 的环境下静默跳过。
它现在只承担**体型参数 + 衣橱单品的控制面板**职责。
想回到 3D 版：`git checkout v1.3.0 -- .` 后重新提交（会一并恢复 Three.js CDN 与 index.html 的 canvas 节点）。
`tools/verify-avatar.js`（32 用例）随之保留。


## 设计定调（v1.2.0）

- **方向**：Retro-futuristic HUD / 复古未来仪表盘 —— 近黑底、发丝网格、扫描线、颗粒、四角括号
- **底色**：`#08090d`（暖调近黑，绝不用纯黑）；表面 `#101219` / `#151822`
- **强调色**：信号青 `#3ce8b0`（进度、主动作、属性条）· 琥珀 `#ffc24b`（XP / 生命刻度）· 冷蓝 `#4cc9f0`（饮水）
- **字体**：Chakra Petch（展示 / 数字标题）+ JetBrains Mono（标签、等宽数字 tabular-nums）+ 中文黑体（正文，字距 `0.02em`）
- **记忆点**：以人物立绘为圆心，属性与生理状态环绕呈现的一体化 HUD，不是分页堆叠

## 版本管理与回滚

本项目由 **Git** 管理（仓库就在 `game-life/` 目录）。规则：

- **提交规范**：Conventional Commits —— `feat` / `fix` / `style` / `refactor` / `perf` / `chore`
- **版本规范**：SemVer —— 新功能 `+0.1.0`，修复与纯视觉 `+0.0.1`，破坏性变更 `+1.0.0`
- **每个可运行版本必须打 tag**：`git tag -a v1.2.0 -m "说明"`

### 常用回滚命令（在 `game-life` 目录执行）

```bash
git tag                       # 查看所有已发布版本
git log --oneline             # 查看提交历史

# ① 整体回到某个版本（文件直接恢复，之后重新提交）
git checkout v1.1.0 -- .
git commit -m "chore: 回滚到 v1.1.0"

# ② 从某个版本开一条分支（保留当前工作不丢）
git checkout -b rollback/v1.1.0 v1.1.0

# ③ 只撤销某一次改动，保留之后的改动
git revert <commit-id>

# ④ 临时看看某个版本长什么样（不改动当前分支）
git stash && git checkout v1.1.0
```

当前工作区如有未提交改动，先 `git stash` 或提交，再执行回滚。

## 版本历史

| 版本 | 日期 | 主要变更 |
|---|---|---|
| v1.1.0 | 2026-09-14 | 亮色 ZENITH 风格、技能篇文档内化为预设数据、角色档案卡 |
| v1.2.0 | 2026-09-15 | 黑色 HUD 主题重构；属性/生理环绕 3D 形象；技能简化为「＋ 手动加经验」；引入 Git 版本管理 |
| v1.3.0 | 2026-09-15 | 3D 模型重建：基本体拼装 → 截面放样；分段关节 / 面部特征 / 三维手掌脚型；体重肌肉双轴驱动围度；新增 `tools/verify-avatar.js` 几何校验 |
| v1.4.0 | 2026-09-18 | 中央形象由 Three.js 3D 模型切换为**纯代码矢量 SVG 分层立绘**（方案④）：9 图层合成、零外部依赖、完全离线；建立 `H = 940` / `yOf(f)` / `px(r)` 统一坐标基准；3D 渲染段休眠保留（`git checkout v1.3.0 -- .` 可回滚）；新增 `verify-portrait` / `verify-wiring` / `render-preview` 三件校验工具 |
| v1.4.1 | 2026-09-18 | 文档收尾：README 补齐分层立绘说明与校验流程 |
| v1.4.2 | 2026-09-18 | **修复整页白屏事故**：index.html 漏加载 `js/avatar.js` → `app.js` 调 `GL.initAvatar()` 抛异常中断启动 → `reveal()` 未执行 → 所有 `.rv` 永久 `opacity:0`。修法：补回脚本 + `start()` 改 `step()` 逐步兜错 + `reveal()` 超时兜底；新增 `tools/browser-check.js` 浏览器冒烟测试，`verify-wiring.js` 增补「`GL.*` 提供者」检查；顺带打磨立绘三处观感（领口改圆领、衣摆不再露肤色、鞋头明显朝外）；sw 缓存升 v6 |
| v1.5.0 | 2026-09-18 | **属性与技能改为分组体系**：属性 3 大类 14 项（生理值 / 精神力 / 熵值），技能 5 大类 13 项（生理 / 语言 / 社交 / 外貌 / 其他），数据定义收敛到 `storage.js` 的 `ATTR_DEFS` / `SKILL_DEFS`。属性面板改三级视觉权重（大类标题 → 细刻度行 → 点击展开微调），14 项一屏装下且组可折叠。引入**极性语义**：负向指标（熵值 3 项 + 困倦度）红色反转、双向指标（社交度、稳定度）标理想区间，等级文案与初始值均随极性走，`GL.overallScore()` 对负向项取反。新增 `tools/verify-migrate.js`（24 项迁移断言，防历史丢失）。**修复交互失效回归**：各模块 `GL.hooks` 只注册了 `render` 未带 `bind()`，导致「页面能看、点不动」；`browser-check.js` 增加交互测试 + 极性文案方向断言（36 项）+ 属性面板明细输出。sw 缓存升 v7 |
| v1.6.0 | 2026-09-21 | **小字按原文照录 + 前端可编辑**：属性/技能每项新增 `sub`（小字注解）与 `note`（说明）两字段，取值**逐字照录**用户两份原文（含全角括号、破折号、换行），不再由我改写精简；点开任一属性小项（或技能卡片的「✎ 注释」）即可在页面上直接编辑**名称 / 小字 / 说明**，编辑走 `GL.save()` + 就地刷新（`repaintRow` / `repaintCard`），**不触发 `GL.changed()`** 以免重渲染换掉输入框丢焦点；技能卡片新增注释栏。**修复生命刻度列宽**：旧实现量的是 `canvas.clientWidth`（默认 300px）导致网格只画出左边一小块，改为量容器宽度 + 整数列宽并把余数分摊到前 N 列，整行精确铺满；`window.resize{once}` 换成 `ResizeObserver`（带宽度去重防自激），`ctx.scale` 换 `setTransform`（防重画累乘）。数据迁移 v2→v3 还原被压缩的小字与丢失的说明（用户自建项不动）。sw 缓存升 v8 |
| v1.6.1 | 2026-09-21 | **生命刻度改为「列数由宽度算」**：不再固定「52 列 × 预期寿命行」（那是一年一行的竖长条，宽屏下格子被拉到 22px、整块 1850px 高）。改为**格子固定大小（4–14px 一档，绝不拉伸）、列数由容器宽度算出、行数是结果**，总格子数恒等于总周数。挑格子的规则是「整块高度 ≤ 520px 时取最大边长」，所以窗口变宽 → 列变多行变少 → 整块变矮，一生始终一眼看全。宽度余数均匀分摊到各列间距，恰好占满容器。**标尺改为按周序号定位**（行不再等于一年，「每 10 行标一次」失效）：第 age×52 周那格 = age 岁生日所在格 → 画白色内圈，左侧数字按该格所在行对齐；每 52 周画 1px 年度刻度，颜色按区域反转（琥珀底暗线、暗底亮线）。新增网格下方「排布读数」与 `GL.lifeGrid` 布局真值。browser-check 增至 66 项，新增「真改视口宽度看列数是否重排」+ 逐像素确认画到右缘。sw 缓存升 v9 |
| v1.7.0 | 2026-09-22 | **离线与手机端完整化**。① **字体自托管**：原先引 Google Fonts，国内不可达且 `<link rel=stylesheet>` 是渲染阻塞资源会拖白首屏；现将 Chakra Petch / JetBrains Mono 各 3 个字重（共 95KB woff2）放进 `fonts/`，CSS 用 @font-face 引用，页面做到**零跨域请求**，断网也不退化字形。② **补 PNG 图标**：iOS 不认 SVG 的 apple-touch-icon（会显示白块），新增 192 / 512 / maskable-512 / 180 四个尺寸，并写了 `tools/gen-icons.js` —— 借本机 Chromium 无头渲染，不引入 sharp 之类依赖。③ **手机端补齐**：底部标签栏加 `env(safe-area-inset-bottom)` 避开 iPhone 手势条；`100dvh` 替代 `100vh`（手机上 100vh 含地址栏会裁掉底部内容）；窄屏卡片标题栏改竖排（横排时展示字体标题与等宽说明挤成一团）；生命统计块锁两列（否则「约 49 年」的「年」字被挤到下一行）；输入框字号提到 16px（低于 16px 时 iOS 聚焦会自动放大整页 —— 且选择器必须带 `#main` 提权，否则被 `.tx-field input` 盖掉，实测就漏过一次）。④ **`sw.js`**：删掉 Three.js 时代遗留的 CDN 分支，改为只接管同源资源，ASSETS 补齐 6 个字体与 5 个图标（v10）。⑤ **校验增强**：verify-wiring 补上「ASSETS / manifest 图标 / index.html 引用必须真实存在」与「不得再有 Google Fonts」（旧正则只认 js|css|html|svg|webmanifest，png 与 woff2 全部漏检）；browser-check 66 → **78 项**，新增**手机视口**整组断言（真机 390×844 / dpr3 下测布局、触摸目标、横向溢出、输入框字号，并以实际资源请求证明字体来源） |
| v1.7.1 | 2026-09-23 | **安卓全屏启动**：`display` 由 `standalone` 改为 `fullscreen`，`display_override` 由 `["standalone","minimal-ui"]` 改为 `["fullscreen","standalone"]`（⚠ 浏览器**优先读 `display_override`**，只改 `display` 在安卓上不生效；列表里保留 `standalone` 是 iOS 的规范回落项）。全屏后系统状态栏消失、`env(safe-area-inset-top)` 归零，故新增 `@media (display-mode: fullscreen)` 的页头固定留白兜底。**顺带修掉一个潜伏 bug**：`--sa-t` 变量定义了却全仓无人引用 —— iOS 的 `black-translucent` 状态栏是浮在页面之上的，页头一直被时间/电量压着；现补进 `#main` 顶部内边距。校验：verify-wiring 增 3 条断言（`display` 与 `display_override` 必须成对为 fullscreen / 必须有 fullscreen 留白兜底 / `--sa-t` 必须被消费），browser-check 78 → **82 项**（不读源码：从部署产物的 CSSOM 取该规则，再用 CSSOM 临时解除媒体条件量**真实层叠结果** `16px → 26px`，证明它没被上面的 `padding` 简写盖掉）。sw 缓存升 v11 |
| v1.7.3（打包） | 2026-09-24 | **安卓打包链路**（**运行时文件无任何改动**，故未升 `APP_VERSION`、未升 sw 缓存、未打 tag —— APK 里跑的就是 v1.7.1 那份代码，所以 APK 的 versionName 也是 1.7.1）。起因：用户手机的自带浏览器菜单里没有安装入口。先用 `tools/diag-installable.js`（CDP 的 `Page.getAppManifest` + `Page.getInstallabilityErrors`，让浏览器自己说原因）确认站点侧完全合格 —— manifest 无解析错误、未报任何不可安装原因、SW 已激活并接管、缓存 23 项，判定问题在浏览器侧，改走原生打包。① 新增 `android-pack/`（Capacitor 8.5.2 壳）与 `.github/workflows/android.yml`，**本地不需要装 Android Studio / JDK / Android SDK**。② **定制必须可重放**：`android/` 是 `npx cap add android` 每次从模板重新生成的（不入库），手动改一次就会被覆盖，所以图标 / 启动画面 / 背景色 / 版本号全部落在 `android-pack/scripts/prepare-android.js` 里，并逐个断言覆盖的图片尺寸与模板原图一致 —— 缩放比例错了很难从截图上发现。③ **签名必须固定**：密钥由 Python `cryptography` 生成 PKCS12 存入仓库 Secret（不入库），`build.gradle` 里显式指定 `signingConfigs.debug`。早期版本把密钥放在 `~/.android/debug.keystore` 依赖 Gradle 对 `user.home` 的推断，CI 上推断不到会**静默退回自动生成的临时签名** —— APK 一切正常、badging 全对，只有对比证书指纹才发现，而后果是覆盖升级必被系统以「签名不符」拒绝（唯一绕过方式是卸载，会清掉 App 内数据）。现加断言「keystore 证书指纹 == APK 实际签名指纹」守住。④ **产物自检**：确认 APK 内含 `assets/public/index.html`（否则装上去是白屏），并从**编译后**的 badging 读包名 / 应用名 / 版本号 / 启动入口 —— aapt2 会重写资源名，按 `res/mipmap-*/ic_launcher.png` 这种原路径是查不到的（第一版自检就因此误报失败）。⑤ 发布到固定 tag `android-latest` + 固定文件名 `GameLife.apk`，下载链接永久不变 |
| v1.7.2（工具链） | 2026-09-23 | **发布链路打通 + 校验工具三点增强**（**运行时文件无任何改动**，故未升 `APP_VERSION`、未升 sw 缓存、未打 tag —— 线上跑的就是 v1.7.1 那份代码）。① **内置托管发布**：不依赖任何账号授权即可得到 https 地址，手机可直接打开（⚠ 内置托管会把名为 `dist` 的目录当构建产物**排除**，实测直接发布 `dist/` 得到**空站点**；故发布用另一个名字的目录，并给构建脚本加 `--mirror=<目录>`，自检通过后才镜像，一次完成、不留时间窗）。② **`browser-check.js` 加 `--url=<地址>`**：同一组断言跳过内置服务直接跑在**线上地址**上 —— 线上与本地至少有三处不同（真实域名的 MIME、缓存头、子路径与 HTTPS），恰好都是会导致「页面能看但离线失效」的地方。③ **新增 5 条离线能力断言**：实测 `sw.js` 的 MIME 是 JS 类型、Service Worker 真的注册并接管页面、缓存真的建立且装了资源（断言数 82 → **87**；此前只在源码里查过配置，没验过注册结果，而 `register('sw.js').catch(() => {})` 会把失败静默吞掉）。④ **修掉一处会掩盖真问题的偶发失败**：启动等待原为「readyState 完成 + 固定 2200ms」，跑远程（冷启动二十多个资源）会偶发踩空，`overallScore()` 内部读到 `undefined` 抛 TypeError → 脚本直接 `exit 1`，输出只剩一句没头没尾的「页面求值失败」，把真正的断言结果全盖掉；改为**轮询到 `GL.state.attributes` 就位**，并把那次调用单独 try 住，超时也继续往下测（打印启动诊断：缺哪些 `GL.*`、哪些脚本标签、几条页面异常） |
| v1.7.4 | 2026-09-24 | **实机反馈三项修正**。① **去掉图标一圈黑边**：根因是 `icon.svg` 在紫色渐变块外面还套了一圈 `#0d0f1a` 近黑（本机看着像精致的深色描边，到启动器遮罩下就是一圈黑边），安卓自适应图标的 `background` 层更是直接用了 `#08090d`、`foreground` 层还是一张自带底色的**不透明**方图 —— 系统裁圆后圆内是近黑底 + 中间一块紫，必然露边。现改为**满铺紫色渐变 + 透明前景层**（只画闪电、收进中心安全区），legacy 图标（Android 7 及以下）同样改满铺 / 整圆；`apple-touch-icon` 改用满铺版（iOS 会自己套超椭圆遮罩，自带圆角会变成「圆角套圆角」且外圈易露异色边）。同时把图标生成**收敛到唯一入口** `tools/gen-icons.js`：一次写出 `icon.svg` + 4 张 Web PNG + 安卓 5 密度 × 3 张 PNG + 自适应图标 XML —— 两边同源，不会再"改了一边忘了另一边"；顺带修掉小尺寸被 `--window-size` 钳制的问题（DSF 由写死的 0.25 改为 `size/win`，窗口一律 ≥ 800px）。② **立绘下方读数精简**：原为三行（身高/体重/肌肉 · 发型/衣橱件数 · 今日饮水/距上次），窄屏上把立绘压得很碎，现只留**一行**「身高 / 体重 / 发型」—— 饮水在生理面板、衣橱在「体型与衣橱」面板都有完整视图，舞台注脚不必重复；随之删掉仅供它使用的 `todayMl()` / `lastDrink()`。③ **顶部固定预留系统状态栏**：**安卓的 WebView 与独立应用 `env(safe-area-inset-top)` 一律返回 0**，而系统状态栏照样占着最上面一条 → 页头被压住（APK 里尤其明显）；改为 `calc(var(--s4) + max(var(--sa-t), 30px))`，任何环境下都至少留 30px（≈安卓状态栏高度），末尾全屏那条规则再 +10px。verify-wiring 的「全屏留白兜底」断言同步放宽**写法**（原先只认 `var(--sa-t) … + … px` 的加法形式，`max()` 写法会被误判成没兜底；要求没变：必须同时出现安全区变量与固定 px）。browser-check 仍 **87 项全绿**（全屏层叠实测 `46px → 56px`）。sw 缓存升 v12 |
| v1.7.5 | 2026-09-24 | **修「装了新版却什么都没变」**（v1.7.4 上线后的实机反馈：装上新 APK，只有图标变了、界面一律是老样子）。四层校验全绿、APK 拆包也确认是新代码 —— 问题整条都在**换版链路上**，四层校验一层都覆盖不到，为此新增第五层 `tools/test-update-flow.js`。四个成因，逐个修：① **sw.js 自己也被 HTTP 缓存住**（GitHub Pages / 内网都会给 max-age），更新检查拿到旧字节就认定「没有新版」→ `register('sw.js', { updateViaCache: 'none' })` + 每次打开 `reg.update()`。② **装缓存时 `cache.add(u)` 默认走 HTTP 缓存**，手里留着旧副本时新缓存里装的仍是旧文件（版本号变了、内容没变）→ 改 `cache.add(new Request(url, { cache: 'reload' }))` 强制取真身。③ **换版后没人刷页面**：旧 SW 是缓存优先，会把旧 `index.html` / 旧 `app.js` 一直供下去 → **页面侧**监听 `controllerchange` 自刷一次（只在本来就有 controller 时挂，`reloadedForUpdate` 兜底，无刷新循环）。④ **顺带抓到一个自造的死锁**：把 `Client.navigate()` 放进 `activate` 的 `waitUntil` 里必然挂死 —— 本 SW 在 activate 落地前**不处理 fetch**，而 navigate 触发的正是同源导航请求，实测挂 37 秒后报 `Cannot navigate to URL`；同一形状的坑还有把 `await self.skipWaiting()` 写进 `install`（`skipWaiting()` 的 promise 要等激活才 resolve，而激活又要等 install 结束 —— 一 await 就是新版永远升不上去，且**新缓存已经建出来了**，从 `caches.keys()` 看像是装成功了）。现在 SW 侧只留延迟一拍的兜底 navigate（救「页面上跑的还是没有 `controllerchange` 监听的旧代码」那一次）。**第五层怎么测**：用 `git show HEAD~1` 取旧版 `sw.js` / `app.js` / `style.css` 起站、让浏览器把旧缓存吃满（= 用户手里那台机器），再同端口同 profile 换成新产物、**只打开一次**，断言看到新版且应用启动完好、读数 1 行、顶部留白变大、缓存已换代、只刷新一次；`--simulate-no-fix` 把三处修复全摘掉做负向验证（缺了它这就是一张橡皮图章）。sw 缓存升 v13 |
