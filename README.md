# Game Life · 人生游戏面板

把人生当成游戏来打：人物立绘 + 生理追踪 + 属性面板 + 技能成长 + 生命刻度。
纯前端 PWA，数据存于本机 localStorage，无需登录、可离线、可安装到桌面。

## 运行

```bash
# 任意静态服务器（Service Worker 需要 http 协议，直接双击 file:// 打开则无离线能力）
cd game-life
python -m http.server 8080
# 浏览器打开 http://localhost:8080
```

手机端：用局域网访问同一地址，浏览器菜单 →「添加到主屏幕」。

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
├── tools/verify-wiring.js  # 接线校验：脚本清单 / GL.* 提供者 / 宿主节点 / sw 版本
├── tools/verify-migrate.js # 数据迁移校验：v1 → v2 分组体系（24 项断言，防丢历史）
├── tools/browser-check.js  # 浏览器冒烟：真跑页面 + 抓异常 + 渲染断言 + 交互测试 + 面板明细 + 出 PNG
├── tools/render-preview.js # 把立绘落成 SVG+PNG，供单独检查比例
├── tools/verify-avatar.js  # 无头几何校验（v1.3.0 3D 版，保留）
├── sw.js                   # Service Worker（离线缓存）
└── manifest.webmanifest    # PWA 安装配置
```

## 属性与技能体系（v1.5.0）

数据定义在 `js/storage.js` 顶部的 `ATTR_GROUPS` / `SKILL_GROUPS` / `ATTR_DEFS` / `SKILL_DEFS`，
改体系只动这几处，视图层会自动跟着分组渲染。

```
属性（3 大类 14 项）            技能（5 大类 13 项）
├─ ❤️ 生理值 (6)               ├─ 💪 生理 (2)   肌肉量 · 心肺
│   喉咙 · 鼻腔 · 困倦度        ├─ 🗣 语言 (2)   写作能力 · 表达能力
│   运动度 · 睡眠 · 饮食        ├─ 💬 社交 (2)   small talk · 自信值
├─ 🧠 精神力 (5)               ├─ 🪞 外貌 (4)   皮肤 · 穿搭 · 发型 · 牙齿
│   欲望值 · 情绪值 · 社交度    └─ 🧭 其他 (3)   阅历 · 眼界 · 审美力
│   稳定度 · 盼头值
└─ 🌀 熵值 (3)  多巴胺需求 · 混乱值 · 嘈杂值
```

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
| 2 | 细刻度行 `.ag-row` | 11px 灰字 + 等宽数字 + 3px 细条，一行约 22px |
| 3 | 微调 `.ag-tune` | **点小项才展开**，不操作时不占地方 |

组标题可点击折叠，状态存 `GL.state.ui.attrCollapsed`（刷新后保持）。

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

### 四层校验

改动 `portrait.js` / `attributes.js` / `skills.js` / `storage.js` / `index.html` / `sw.js` / `app.js` 后依次运行：

```bash
node tools/verify-portrait.js   # 静态：立绘 36 用例图层校验
node tools/verify-wiring.js     # 静态：脚本清单 / GL.* 提供者 / 宿主节点 / sw 版本
node tools/verify-migrate.js    # 静态：数据迁移 v1→v2（防历史记录丢失）
node tools/browser-check.js     # 动态：真跑页面 + 渲染断言 + 交互测试 + 出 PNG
```

- `verify-portrait.js`：无头 DOM 桩件跑一遍 `drawAll()`，检查坏值 `NaN/undefined`、
  路径语法、**填充路径必须 `Z` 闭合**（`fill: none` 的线稿豁免）、关键部位是否齐备。
- `verify-wiring.js`：补前者的盲区 —— 脚本顺序必须为
  `storage → avatar → portrait → physiology → attributes → skills → life → app`，
  16 个宿主节点齐全、`#portrait-svg` 的 `viewBox` 与画布一致、无 Three.js CDN 残留、
  **每个模块调用的 `GL.*` 都有提供者**、`sw.js` 的 `ASSETS` 完整且缓存版本 ≥ v7。
- `verify-migrate.js`：桩件跑 `storage.js`，断言迁移后**历史记录仍在**
  （`写作能力 xp 250` 要活着、旧名 `small talk闲聊能力` 要能配对、外貌四项要移入技能、
  旧项要淘汰、重复 load 要幂等）。迁移出错是**静默丢数据**，不会报错，必须显式断言。
- `browser-check.js`（**最贴近真实的一层**）：内置静态服务器 + CDP 驱动真实浏览器，
  抓 `pageerror` / `console.error`，断言只有真渲染才有的状态
  （立绘 path 数、`.rv.in === .rv`、属性 3 组 14 行、负向行 4 个…），
  **并真点一遍新交互**（折叠、＋1 步进、−1 还原、折叠状态持久化、极性文案方向），
  输出各 tab 的 PNG，并在结尾打印**属性面板明细**（每组均值 + 每行「名称 数值」，负向标 `[-]`、
  双向标 `[~]`）。这不是断言，是给人眼的**地面真值** —— 缩略图看错文案时以它为准。
  依赖 `ws`：`cd C:/Users/ZHANG/.workbuddy/binaries/node/workspace && npm i ws`，
  然后 `NODE_PATH=<该 node_modules> node tools/browser-check.js`。

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
