# Game Life · 人生游戏面板

把人生当成游戏来打：3D 形象 + 生理追踪 + 属性面板 + 技能成长 + 生命刻度。
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
├── index.html              # 结构：顶栏 HUD / 左翼属性 / 中央 3D 舞台 / 右翼生理 + 技能·生命·设置
├── css/style.css           # 设计令牌 + 组件 + 响应式 + 降级动效
├── js/storage.js           # 数据层：默认数据、技能篇预设、等级曲线、工具函数
├── js/avatar.js            # Three.js 程序化人形 + AI 衣橱
├── js/physiology.js        # 饮水 + 自定义生理指标（HUD 右翼）
├── js/attributes.js        # 自定义属性打分（HUD 左翼）
├── js/skills.js            # 技能经验值（＋ 手动加经验）
├── js/life.js              # 生命周刻度
├── js/app.js               # 入口：导航、顶栏读数、设置、启动流程
├── sw.js                   # Service Worker（离线缓存）
└── manifest.webmanifest    # PWA 安装配置
```

## 设计定调（v1.2.0）

- **方向**：Retro-futuristic HUD / 复古未来仪表盘 —— 近黑底、发丝网格、扫描线、颗粒、四角括号
- **底色**：`#08090d`（暖调近黑，绝不用纯黑）；表面 `#101219` / `#151822`
- **强调色**：信号青 `#3ce8b0`（进度、主动作、属性条）· 琥珀 `#ffc24b`（XP / 生命刻度）· 冷蓝 `#4cc9f0`（饮水）
- **字体**：Chakra Petch（展示 / 数字标题）+ JetBrains Mono（标签、等宽数字 tabular-nums）+ 中文黑体（正文，字距 `0.02em`）
- **记忆点**：以 3D 形象为圆心，属性与生理状态环绕呈现的一体化 HUD，不是分页堆叠

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
