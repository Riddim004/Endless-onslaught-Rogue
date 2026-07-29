// =============================================================================
// 游戏数值配置中心 (Gameplay Tuning Config)
//
// 想调整数值只需要改这个文件。其它代码文件都从这里读取数值。
// - 说明见每一节的中文注释
// - 武器数组以「等级」为下标（index 0 不用，等级从 1 开始，最高 8 级）
// =============================================================================

// -----------------------------------------------------------------------------
// 玩家初始属性 (Player base stats)
// -----------------------------------------------------------------------------
export const PLAYER = {
  maxHp: 100, // 初始最大生命
  moveSpeed: 165, // 初始移动速度（像素/秒）
  radius: 14, // 角色半径（碰撞体积）
  critChanceBase: 0.05, // 初始暴击率
  critMult: 2, // 暴击伤害倍数
  invulnTime: 0.6, // 受到接触伤害后的无敌时间（秒）
  firstLevelXp: 4, // 1 级升 2 级所需经验
};

// -----------------------------------------------------------------------------
// 升级经验曲线 (XP curve)
// 升到下一级所需经验 = base + 等级*linear + 等级^2*quad
// -----------------------------------------------------------------------------
export const XP_CURVE = { base: 4, linear: 2.4, quad: 0.2 };

// -----------------------------------------------------------------------------
// 进度相关 (Progression)
// -----------------------------------------------------------------------------
export const PROGRESSION = {
  maxWeaponSlots: 9, // 最多同时持有的武器数
  choicesPerLevel: 3, // 每次升级给几个可选项
};

// -----------------------------------------------------------------------------
// 难度曲线 (Difficulty scaling)
// 所有缩放都在 rampSeconds 秒内从 1x 平滑增长到各自的上限。
// -----------------------------------------------------------------------------
export const DIFFICULTY = {
  rampSeconds: 500, // 多少秒爬到最高难度
  spawnBaseInterval: 0.6, // 初始出怪间隔（秒），越小出怪越快
  hpMaxScale: 40, // 怪物血量最高倍数
  speedMaxScale: 3, // 怪物移速最高倍数
  spawnRateMax: 10, // 出怪速度最高倍数
  batchStepSeconds: 60, // 每隔多少秒，每波多出 1 只
  batchMax: 4, // 每波最多出几只
  bossIntervalSeconds: 50, // 每隔多少秒出一个 Boss
  bossHpStepPerMinute: 0.55, // Boss 血量随分钟数递增的系数
  controlResistBoss: 0.4, // Boss 对减速/眩晕的抗性（越小越抗）
  // 掠过屏幕的怪群（踩踏事件）
  cluster: {
    countMin: 50, // 一群最少多少只
    countMax: 100, // 一群最多多少只
    intervalMin: 22, // 两次事件之间最短间隔（秒）
    intervalMax: 38, // 两次事件之间最长间隔（秒）
    speedMin: 210, // 横扫速度下限
    speedMax: 270, // 横扫速度上限
  },
};

// -----------------------------------------------------------------------------
// 怪物基础数值 (Enemy base stats)
// hp/speed 会再乘上面 DIFFICULTY 的随时间缩放；damage 为接触伤害；xpValue 为掉落经验。
// -----------------------------------------------------------------------------
export const ENEMIES = {
  walker: { radius: 13, hp: 10, speed: 52, damage: 8, xpValue: 2, color: '#8a5cff' },
  fast: { radius: 10, hp: 6, speed: 108, damage: 6, xpValue: 2, color: '#5ce1ff' },
  tank: { radius: 22, hp: 34, speed: 34, damage: 10, xpValue: 6, color: '#ff7b5c' },
  brute: { radius: 17, hp: 22, speed: 62, damage: 10, xpValue: 3, color: '#ff5c9e' },
  boss: { radius: 44, hp: 620, speed: 42, damage: 18, xpValue: 80, color: '#ffd166' },
};

// -----------------------------------------------------------------------------
// 被动技能 (Passives)
// perLevel = 每级效果；maxLevels = 各被动的满级（999 视为无上限）。
// magnetRadii 以磁力等级为下标，最后一档很大 = 全屏拾取。
// -----------------------------------------------------------------------------
export const PASSIVES = {
  maxHpPerLevel: 30, // 强健体魄：每级 +最大生命
  moveSpeedPerLevel: 0.12, // 疾风之靴：每级 +移速%
  powerPerLevel: 0.2, // 力量核心：每级 +伤害%
  hastePerLevel: 0.15, // 急速引擎：每级 +攻速%
  areaPerLevel: 0.16, // 扩张法阵：每级 +范围%
  xpPerLevel: 0.2, // 智慧宝石：每级 +经验%
  regenPerLevel: 1.5, // 生命源泉：每级 +每秒回血
  armorPerLevel: 3, // 坚固护甲：每级 +减伤
  critPerLevel: 0.12, // 致命一击：每级 +暴击率（会被 clamp 到 100%）
  magnetRadii: [70, 170, 320, 520, 820, 100000], // 磁力护符：下标=等级
  maxLevels: {
    max_hp: 8,
    move_speed: 999,
    power: 999,
    haste: 999,
    area: 999,
    magnet: 5,
    wisdom: 8,
    regen: 8,
    armor: 8,
    crit: 8,
  } as Record<string, number>,
};

// -----------------------------------------------------------------------------
// 武器数值 (Weapons)
// 数组下标 = 武器等级（index 0 不用；数组已补到 8 级，无需额外回退值）。
//   cd       冷却（秒，越小越快）
//   dmg      单次伤害
//   count/bullets/chains  数量类
//   xxxFrom  达到该等级时启用的阈值（如 pierceHighFrom=4 表示 4 级起用 pierceHigh）
//   speed/radius/life/knockback  投射物的手感参数
// -----------------------------------------------------------------------------
export const WEAPONS = {
  // 魔法飞弹：自动追踪最近的敌人
  bolt: {
    cd: [0, 0.9, 0.9, 0.9, 0.68, 0.68, 0.68, 0.5, 0.5],
    dmg: [0, 24, 38, 38, 56, 56, 82, 82, 120],
    pierceLow: 2,
    pierceHigh: 3,
    pierceHighFrom: 4,
    speed: 460,
    radius: 7,
    life: 1.6,
    knockback: 90,
  },
  // 回旋飞刀：召唤在屏幕内乱飞的飞刀
  dagger: {
    cd: [0, 0.66, 0.66, 0.46, 0.46, 0.46, 0.46, 0.36, 0.32],
    dmg: [0, 18, 28, 28, 40, 40, 60, 60, 74],
    count: [0, 1, 1, 1, 2, 2, 3, 4, 4],
    pierceLow: 2,
    pierceHigh: 4,
    pierceHighFrom: 5,
    speed: 440,
    radius: 6,
    life: 3.6,
    knockback: 70,
  },
  // 守护法球：环绕自身旋转
  orbit: {
    count: [0, 2, 2, 3, 3, 4, 4, 5, 5],
    dmg: [0, 18, 30, 30, 44, 44, 66, 66, 80],
    spinLow: 2.8,
    spinHigh: 3.6,
    spinHighFrom: 3,
    radiusBase: 82,
    radiusBonus: 24,
    radiusBonusFrom: 5,
    orbRadius: 13,
    rehit: 0.5,
    knockback: 40,
  },
  // 烈焰领域：环绕自身的持续灼烧领域
  aura: {
    dmg: [0, 12, 12, 20, 20, 20, 34, 34, 44],
    radiusMul: [0, 1, 1.2, 1.2, 1.2, 1.42, 1.42, 1.64, 1.8],
    intervalLow: 0.44,
    intervalHigh: 0.34,
    intervalHighFrom: 4, // 4 级启用高频灼烧（3 级已涨伤害，错开避免 4 级空升级）
    radiusBase: 62,
  },
  // 冰霜新星：周期性向四周爆发弹幕
  nova: {
    cd: [0, 2.4, 2.4, 1.8, 1.8, 1.8, 1.8, 1.5, 1.3],
    dmg: [0, 20, 30, 30, 44, 44, 66, 66, 80],
    bullets: [0, 8, 8, 10, 14, 14, 16, 20, 24],
    pierceLow: 2,
    pierceHigh: 3,
    pierceHighFrom: 5, // 5 级启用高穿透（原 6 级与弹幕/伤害叠在同级，导致 5 级空升级）
    speed: 300,
    radius: 7,
    life: 1.0,
    knockback: 80,
  },
  // 连锁闪电：在敌群间弹跳
  lightning: {
    cd: [0, 1.5, 1.5, 1.15, 1.15, 1.15, 1.15, 0.85, 0.7],
    dmg: [0, 34, 52, 52, 72, 96, 96, 96, 120],
    chains: [0, 3, 4, 4, 6, 6, 8, 9, 10],
    range: 260,
  },
  // 霜寒领域（控制）：减速并冰冻靠近的敌人；slow 越小减速越强
  frostfield: {
    dmg: [0, 5, 5, 9, 9, 9, 16, 16, 22],
    slow: [0, 0.58, 0.48, 0.48, 0.42, 0.38, 0.38, 0.28, 0.24],
    radiusMul: [0, 1, 1.18, 1.18, 1.38, 1.38, 1.38, 1.6, 1.8],
    radiusBase: 74,
    rehit: 0.5,
    slowDuration: 1.4,
  },
  // 重力奇点（控制+AoE）：黑洞牵引并减速
  singularity: {
    cd: [0, 6, 6, 4.6, 4.6, 4.6, 4.6, 3.4, 2.8],
    dmg: [0, 10, 16, 16, 24, 24, 38, 38, 50],
    radiusMul: [0, 1, 1.24, 1.24, 1.24, 1.24, 1.24, 1.5, 1.6],
    durationBase: 2.4,
    durationBonus: 0.8,
    durationBonusFrom: 4,
    pullBase: 170,
    pullBonus: 90,
    pullBonusFrom: 5,
    radiusBase: 96,
    rehit: 0.4,
    slowMul: 0.5,
    slowDuration: 0.6,
  },
  // 震荡波（控制+AoE）：扩张环击退并眩晕
  shockwave: {
    cd: [0, 3, 3, 2.4, 2.4, 2.1, 2.1, 1.7, 1.4],
    dmg: [0, 14, 22, 22, 32, 32, 48, 48, 62],
    rMul: [0, 1, 1.1, 1.24, 1.24, 1.24, 1.44, 1.44, 1.6],
    stunBase: 0.35,
    stunBonus: 0.2,
    stunBonusFrom: 6,
    maxRBase: 150,
    radiusStart: 24,
    expand: 0.4,
    knockback: 300,
  },
};

// -----------------------------------------------------------------------------
// 游戏模式 (Game modes)
// -----------------------------------------------------------------------------
export type GameMode = 'endless' | 'timed';

export const GAME_MODES = {
  endless: { name: '无尽模式', desc: '在无尽敌潮中生存尽可能久' },
  timed: { name: '限时模式', desc: '存活 10 分钟即获胜', duration: 600 },
};

// -----------------------------------------------------------------------------
// 背景地图 (Maps)
// 调色板与装饰物密度供 background.ts 使用；改这里即可热调背景观感。
//   base        底色
//   texture     瓦片噪点/纹理色
//   grid        瓦片上淡色调网格痕迹的颜色
//   deco        装饰物颜色数组（各地图装饰绘制时按序取用）
//   decoChance  每个 256px 格子出现装饰物的概率
//   decoDouble  已有装饰物的格子再出第 2 个的概率
//   obstacle    不可通行障碍物参数（obstacles.ts 使用）
// -----------------------------------------------------------------------------
export type MapId = 'forest' | 'village' | 'ruins';

// 障碍物公共参数：cell 为生成大格尺寸（每格至多 1 个障碍物，越大越稀疏），
// safeRadius 为世界原点（玩家出生点）周围不生成障碍物的半径。
export const OBSTACLES = {
  cell: 640,
  safeRadius: 320,
};

/** 每张地图的障碍物调参 */
export interface MapObstacleDef {
  chance: number; // 每个大格生成障碍物的概率
  scaleMin: number; // 障碍物随机缩放下限
  scaleMax: number; // 障碍物随机缩放上限
}

export interface MapDef {
  name: string;
  desc: string;
  base: string;
  texture: string;
  grid: string;
  deco: string[];
  decoChance: number;
  decoDouble: number;
  obstacle: MapObstacleDef;
}

export const MAPS: Record<MapId, MapDef> = {
  forest: {
    name: '幽暗森林',
    desc: '树影幢幢的深绿密林',
    base: '#0a140d',
    texture: '#122417',
    grid: 'rgba(90, 140, 100, 0.05)',
    deco: ['#0e1f13', '#13291a', '#183321', '#31402f', '#4a5548'],
    decoChance: 0.55,
    decoDouble: 0.25,
    obstacle: { chance: 0.6, scaleMin: 0.85, scaleMax: 1.25 },
  },
  village: {
    name: '废弃村庄',
    desc: '荒草掩埋的残破屋舍',
    base: '#14100c',
    texture: '#201a12',
    grid: 'rgba(160, 130, 90, 0.05)',
    deco: ['#241c12', '#3a2e1c', '#57452a', '#d9a066', '#2b2418'],
    decoChance: 0.5,
    decoDouble: 0.22,
    obstacle: { chance: 0.55, scaleMin: 0.9, scaleMax: 1.2 },
  },
  ruins: {
    name: '赛博废墟',
    desc: '霓虹残光下的破碎都市',
    base: '#0d0a1e',
    texture: '#161130',
    grid: 'rgba(120, 100, 220, 0.06)',
    deco: ['#1b1440', '#251a55', '#5ce1ff', '#b56cff', '#241e4a'],
    decoChance: 0.55,
    decoDouble: 0.25,
    obstacle: { chance: 0.58, scaleMin: 0.85, scaleMax: 1.25 },
  },
};
