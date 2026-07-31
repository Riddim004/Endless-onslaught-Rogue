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
  maxRerolls: 3, // 整局最多重随次数（跨升级共用，每局开局重置）
  // 前期新武器保底：build 未成形时新武器的边际价值远高于升级/被动，
  // 且首抽全新武器让玩家做“构筑方向”的选择，避免开局连抽被动的挫败感。
  earlyBias: {
    allNewUntil: 2, // 玩家等级 ≤ 此值时，选项全部是新武器（首次升级即 level 2）
    until: 5, // 玩家等级 ≤ 此值时，至少保底 min 个新武器选项
    min: 2,
  },
};

// -----------------------------------------------------------------------------
// 难度曲线 (Difficulty scaling)
// 所有缩放都在 rampSeconds 秒内从 1x 平滑增长到各自的上限。
// -----------------------------------------------------------------------------
export const DIFFICULTY = {
  rampSeconds: 420, // 基础线性增长在 0~7 分钟内走完，之后进入类指数后期增长
  spawnBaseInterval: 0.6, // 初始出怪间隔（秒），越小出怪越快
  hpMaxScale: 40, // 怪物血量最高倍数（线性段终点）
  speedMaxScale: 3, // 怪物移速最高倍数（移速不参与后期指数，否则不可玩）
  spawnRateMax: 10, // 出怪速度最高倍数
  batchStepSeconds: 60, // 每隔多少秒，每波多出 1 只
  batchMax: 4, // 每波最多出几只
  bossIntervalSeconds: 50, // 每隔多少秒出一个 Boss
  dmgMaxScale: 2.5, // 怪物攻击力最高倍数（线性段终点）
  // 后期类指数增长：rampSeconds 之后按分钟复利叠乘（血量主压力轴，攻击温和防一刀秒）
  lateGrowth: {
    hpPerMinute: 1.35, // 满 ramp 后血量每分钟 ×1.35（Boss 同样适用）
    dmgPerMinute: 1.12, // 满 ramp 后攻击每分钟 ×1.12
  },
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
  armorPerLevel: 3, // 坚固护甲：每级 +护甲值（百分比减伤机制）
  armorDmgRatio: 0.2, // 护甲减伤系数 K：reduction = armor / (armor + K * enemyDamage)
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
  // 回旋飞刀：召唤在玩家周围圆形区域内乱飞的飞刀
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
    roamRadius: 1100, // 巡游圆半径（世界像素，以玩家为圆心），与窗口尺寸无关
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
  // 破晓之刃（近战）：朝最近敌人挥斜一个扇形区，瞬时命中扇内所有敌人（剑客初始武器）
  //   arcHalf 为扇形半张角（弧度）；reach 随等级与范围加成。
  sword: {
    cd: [0, 0.72, 0.72, 0.58, 0.58, 0.48, 0.48, 0.4, 0.34],
    dmg: [0, 28, 44, 44, 64, 64, 92, 92, 120],
    reach: [0, 92, 92, 108, 108, 124, 124, 142, 158],
    arcHalf: 0.95, // 半张角 ~54°（全张角 ~108°）
    knockback: 170,
  },
  // 激光炮（主动）：鼠标左键点击画布，朝光标方向瞬发一道贯穿光束，
  // 命中线路内所有敌人。长冷却高爆发，是唯一需要右手操作的武器。
  laser: {
    cd: [0, 1.6, 1.6, 1.35, 1.35, 1.15, 1.15, 0.95, 0.75],
    dmg: [0, 70, 105, 105, 150, 150, 205, 205, 270],
    width: [0, 10, 10, 13, 13, 16, 16, 20, 24], // 光束半宽（受范围加成）
    range: 950, // 射程（世界像素）
    knockback: 120,
    evoSpread: 0.38, // 超武「棱镜歼灭」三束齐射的相邻夹角（弧度，约 22°）
  },
  // 湮灭引导（主动·持续引导）：按住鼠标左键，赤色能量从主角飞向光标，
  // 持续灼烧以鼠标为中心的圆形区域（按 tick 间隔结算）。
  // 充能槽机制：引导持续消耗能量（用多少扣多少），松手恒速回充；
  // 耗尽后断线，需回充到 rearmFraction 才能再次引导（防 0 点抖动蹭伤害）。
  channel: {
    tick: [0, 0.16, 0.16, 0.14, 0.14, 0.12, 0.12, 0.1, 0.09], // 每次结算间隔（秒），受攻速影响
    dmg: [0, 10, 15, 15, 21, 21, 29, 29, 34], // 每次结算伤害
    radius: [0, 84, 84, 96, 96, 108, 108, 122, 138], // 灼烧圆半径（受范围加成）
    energyMax: [0, 100, 100, 116, 116, 134, 134, 158, 184], // 充能槽上限（决定可连续引导时长）
    drainPerSec: 34, // 引导每秒消耗（Lv.1 约可连续引导 3 秒）
    regenPerSec: 14, // 非引导时恒定每秒回充
    rearmFraction: 0.25, // 耗尽后需回充到此比例才能再引导
    evoMaxTargets: 20, // 超武「湮灭·无终」：区域内每次至多同时选定的目标数
    knockback: 40,
  },
};

// -----------------------------------------------------------------------------
// 游戏模式 (Game modes)
// -----------------------------------------------------------------------------
export type GameMode = 'endless' | 'timed' | 'training';

export const GAME_MODES = {
  endless: { name: '无尽模式', desc: '在无尽敌潮中生存尽可能久' },
  timed: { name: '限时模式', desc: '存活 10 分钟即获胜', duration: 600 },
  training: { name: '训练模式', desc: '自选武器与等级，测试专用' },
};

// -----------------------------------------------------------------------------
// 可选角色 (Characters)
// 每个角色有不同的初始武器、标志性装扮（由 renderer 绘制）与基础属性微调。
//   startingWeapon：开局自带的武器 id（对应 skills.ts 中的武器）
//   mods：基础属性修正（hpAdd 加最大生命，moveMul 乘移速），在 recomputeStats 中应用
// -----------------------------------------------------------------------------
export type CharacterId = 'mage' | 'swordsman';

export interface CharacterMods {
  hpAdd: number; // 基础最大生命加成
  moveMul: number; // 移动速度乘数
  hasteMul: number; // 施法速度乘数（所有武器冷却除以此值）
  areaMul: number; // 技能范围乘数
}

export interface CharacterDef {
  name: string;
  desc: string;
  icon: string; // 菜单显示的 emoji
  startingWeapon: string;
  trait: string; // 特性说明
  mods: CharacterMods;
}

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  mage: {
    name: '法师',
    desc: '施法快、范围广，远程压制',
    icon: '🧙',
    startingWeapon: 'bolt',
    trait: '初始：魔法飞弹 · 施法速度 +12% · 技能范围 +10%',
    mods: { hpAdd: 0, moveMul: 1, hasteMul: 1.12, areaMul: 1.1 },
  },
  swordsman: {
    name: '剑客',
    desc: '近战挥斩，血厚移速快',
    icon: '⚔️',
    startingWeapon: 'sword',
    trait: '初始：破晓之刃 · +20 生命 · +12% 移速',
    mods: { hpAdd: 20, moveMul: 1.12, hasteMul: 1, areaMul: 1 },
  },
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

// -----------------------------------------------------------------------------
// 可破坏道具 (Destructibles)
// 独立于确定性障碍物系统的可打碎物件（各地图不同造型）：
//   按格子哈希稀疏生成，有 HP，只阻挡玩家；被武器投射物打碎后按小概率掉落收益。
//   drop 各项概率独立判定：多数道具碎后无收益（纯视觉），少数掉经验/血包/爆炸。
// -----------------------------------------------------------------------------
export const DESTRUCTIBLES = {
  cell: 460, // 生成大格尺寸（px，比障碍物更稀），每格至多 1 个
  chance: 0.42, // 每格生成概率
  safeRadius: 240, // 世界原点（出生点）周围不生成的半径
  hp: 26, // 道具生命（一两下即碎）
  radius: 19, // 碰撞 / 受击半径
  cullRadius: 1500, // 超出玩家此距离的道具从活动列表移除（未破坏者重新靠近时确定性重建）
  // 碎后掉落（各项独立判定，概率均偏小）
  drop: {
    xpChance: 0.3, // 掉经验宝石的概率
    xpValue: 4, // 经验宝石数值
    healChance: 0.05, // 掉血包的概率
    healAmount: 25, // 血包回复生命
    explodeChance: 0.05, // 碎时爆炸的概率
    explodeRadius: 130, // 爆炸最大半径
    explodeDamage: 48, // 爆炸伤害
    explodeKnockback: 240, // 爆炸击退
  },
};
