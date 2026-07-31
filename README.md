# Endless Onslaught 无尽猛攻

<p align="center">
  <img src="build/icon.png" alt="Endless Onslaught" width="160" />
</p>

<p align="center">
  <b>English</b> | <a href="#中文">中文</a>
</p>

A fast-paced 2D roguelite survivor game (vampire-survivors-like), built from scratch with **TypeScript + HTML5 Canvas + Vite** — no game engine, no frameworks.

Pick a class, survive an endless, ever-growing monster onslaught. Level up, build from 12 weapons and 10 passives, evolve your ultimate super-weapon, climb the leaderboard, and spend your kills in the shop.

## 🎮 Download & Play

Grab the Windows portable exe from [**Releases**](https://github.com/Riddim004/Endless-onslaught-Rogue/releases) — no installation needed, just double-click and play.

## ✨ Features

- **2 classes**: Mage (homing bolts, faster casting & bigger area) and Swordsman (melee sword sweep, tankier & faster) — each with a unique starting weapon and signature look
- **12 weapons**: homing bolts, roaming daggers, orbiting orbs, flame aura, frost nova, chain lightning, frost field, gravity singularity, shockwave, blade-of-dawn sweep, plus two **active weapons**
- **Active weapons** (aim with the mouse, one per run): **Laser Cannon** (click to fire a piercing beam) and **Annihilation Channel** (hold to burn an area, energy-gauge driven)
- **Super weapon evolutions**: max a weapon to roll a golden evolution card — e.g. the laser splits into a 3-beam prism volley
- **10 passives**: damage, attack speed, area, move speed and more — several with **no level cap**; armor uses percentage-based mitigation
- **Destructible props** scattered around the map — smash them for a chance at gems, health, or a chain explosion
- **Meta progression**: a local **leaderboard** of your best runs, plus an out-of-run **shop** — earn coins from kills and spend them on cosmetic auras
- **Procedural audio**: real-time synthesized BGM and boss cues (no audio files)
- **Two-stage difficulty**: enemy stats ramp up over the first 7 minutes, then grow exponentially — endless runs stay dangerous
- **Stampede events**, **timed bosses**, full-screen pickup, crit builds up to 100%, up to 3 re-rolls per run

## 🕹️ Controls

| Key | Action |
|---|---|
| `WASD` / Arrow keys | Move |
| Mouse | Aim & fire **active weapons** (left click / hold) |
| `P` / `Esc` | Pause |
| `M` | Mute / unmute |

Auto weapons fire on their own — your job is to dodge, position, aim your active weapon, and build.

## 🛠️ Development

```bash
npm install       # install dependencies
npm run dev       # dev server (http://localhost:5173, hot reload)
npm run build     # type-check + production build to dist/
npm run dist:exe  # package the Windows portable exe (output: release/)
```

> Building the exe downloads the Electron runtime. In mainland China, set the mirror first:
> `$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'`

## ⚖️ Tuning the Game

All gameplay numbers live in a single file: [`src/game/config.ts`](src/game/config.ts) — player stats, XP curve, difficulty ramp, enemy stats, passives, and every weapon's per-level arrays. Edit, save, and the dev server hot-reloads instantly.

## 📁 Project Structure

```
src/
├── main.ts             # entry point
└── game/
    ├── config.ts       # ★ all gameplay tuning in one place
    ├── game.ts         # main loop, collisions, XP & level-up flow
    ├── skills.ts       # weapon & passive definitions, super evolutions
    ├── spawner.ts      # enemy waves, difficulty ramp, bosses, stampedes
    ├── spatial.ts      # enemy spatial-hash grid (collision & nearest queries)
    ├── entities.ts     # player / enemy / projectile factories
    ├── destructibles.ts # destructible props field
    ├── renderer.ts     # canvas rendering & visual effects
    ├── audio.ts        # procedural BGM & SFX (Web Audio)
    ├── input.ts        # keyboard & mouse input
    ├── ui.ts           # HUD, menu, shop & level-up screens
    ├── meta.ts         # meta progression: leaderboard, shop, cosmetics
    └── math.ts         # small math helpers
```

---

<a name="中文"></a>

# 中文

一款快节奏的 2D 肉鸽幸存者游戏（类吸血鬼幸存者），使用 **TypeScript + HTML5 Canvas + Vite** 从零编写——没有游戏引擎，没有框架。

选一个职业，在无穷无尽、不断变强的怪物狂潮中求生。升级、从 12 种武器和 10 种被动中构筑你的 Build、将武器进化为终极超武、冲击排行榜，并用击杀数在商店里兑换装扮。

## 🎮 下载游玩

从 [**Releases**](https://github.com/Riddim004/Endless-onslaught-Rogue/releases) 下载 Windows 便携版 exe——无需安装，双击即玩。

## ✨ 特性

- **2 个职业**：法师（追踪飞弹，施法更快、范围更大）与剑客（近战扇形挥砍，血厚移速快）——各自拥有专属初始武器与标志性装扮
- **12 种武器**：追踪飞弹、乱飞回旋刀、守护法球、烈焰领域、冰霜新星、连锁闪电、霜寒领域、重力奇点、震荡波、破晓之刃，以及两种**主动武器**
- **主动武器**（鼠标瞄准，每局限一把）：**激光炮**（点击发射贯穿光束）与**湮灭引导**（按住持续灼烧区域，充能槽驱动）
- **超武进化**：武器满级后升级会刷出金色进化卡——例如激光炮分裂为三束棱镜齐射
- **10 种被动**：伤害、攻速、范围、移速等——其中多项**没有等级上限**；护甲为百分比减伤
- **可破坏道具**：场景中散布可打碎的道具，有概率掉落经验宝石、补血或触发连锁爆炸
- **局外进度**：记录你历次最佳战绩的**排行榜**，以及局外**商店**——用击杀数换取金币，购买角色光环装扮
- **程序化音频**：实时合成的 BGM 与 Boss 提示音（零音频素材文件）
- **两段式难度**：怪物属性在前 7 分钟线性攀升，之后转为指数增长——无尽局始终充满威胁
- **踩踏事件**、**限时 Boss**、全屏拾取、暴击可堆到 100%、每局最多 3 次刷新选项

## 🕹️ 操作

| 按键 | 功能 |
|---|---|
| `WASD` / 方向键 | 移动 |
| 鼠标 | 瞄准并施放**主动武器**（左键点击 / 按住）|
| `P` / `Esc` | 暂停 |
| `M` | 静音 / 取消静音 |

自动武器会自行攻击——你要做的是走位、拉扯、瞄准主动武器和构筑。

## 🛠️ 开发

```bash
npm install       # 安装依赖
npm run dev       # 开发服务器（http://localhost:5173，热重载）
npm run build     # 类型检查 + 生产构建到 dist/
npm run dist:exe  # 打包 Windows 便携版 exe（输出到 release/）
```

> 打包 exe 需要下载 Electron 运行时，国内网络请先设置镜像：
> `$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'`

## ⚖️ 调整数值

所有游戏数值集中在一个文件里：[`src/game/config.ts`](src/game/config.ts)——玩家属性、经验曲线、难度爬升、怪物数值、被动效果、以及每种武器逐级的数值数组。改完保存，开发服务器立即热重载生效。

## 📁 项目结构

```
src/
├── main.ts             # 入口
└── game/
    ├── config.ts       # ★ 所有可调数值集中于此
    ├── game.ts         # 主循环、碰撞、经验与升级流程
    ├── skills.ts       # 武器与被动定义、超武进化
    ├── spawner.ts      # 出怪波次、难度爬升、Boss、踩踏事件
    ├── spatial.ts      # 敌人空间哈希网格（碰撞与最近搜索）
    ├── entities.ts     # 玩家/怪物/投射物工厂
    ├── destructibles.ts # 可破坏道具管理
    ├── renderer.ts     # Canvas 渲染与特效
    ├── audio.ts        # 程序化 BGM 与音效（Web Audio）
    ├── input.ts        # 键盘与鼠标输入
    ├── ui.ts           # HUD、菜单、商店与升级界面
    ├── meta.ts         # 局外进度：排行榜、商店、装扮（localStorage）
    └── math.ts         # 数学工具函数
```
