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
├── tools/verify-portrait.js # 无头图层校验：立绘 36 用例（见下）
├── tools/verify-wiring.js  # 接线校验：脚本顺序 / 宿主节点 / sw 清单
├── tools/render-preview.js # 把立绘落成 SVG+PNG，供目视检查比例
├── tools/verify-avatar.js  # 无头几何校验（v1.3.0 3D 版，保留）
├── sw.js                   # Service Worker（离线缓存）
└── manifest.webmanifest    # PWA 安装配置
```

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

### 三层校验

改动 `portrait.js` / `index.html` / `sw.js` 后依次运行：

```bash
node tools/verify-portrait.js   # 36 用例图层校验：6 体型 × 5 发型 + 衣橱/肤色/裙装组合
node tools/verify-wiring.js     # 接线校验：脚本加载顺序 / 宿主节点 / viewBox / sw 清单
node tools/render-preview.js    # 出 SVG+PNG，肉眼检查比例（唯一能「看见」画面的手段）
```

- `verify-portrait.js`：无头 DOM 桩件跑一遍 `drawAll()`，检查坏值 `NaN/undefined`、
  路径语法、**填充路径必须 `Z` 闭合**（`fill: none` 的线稿豁免）、关键部位是否齐备。
- `verify-wiring.js`：补前者的盲区 —— 脚本顺序必须为
  `storage → portrait → physiology → attributes → skills → life → app`，
  16 个宿主节点齐全、`#portrait-svg` 的 `viewBox` 与画布一致、无 Three.js CDN 残留、
  `sw.js` 的 `ASSETS` 完整且缓存版本号已递增。
- `render-preview.js`：`node tools/render-preview.js [发型] [体重] [肌肉]`，
  落盘后用系统浏览器 `--headless --screenshot` 栅格化成 PNG。

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
