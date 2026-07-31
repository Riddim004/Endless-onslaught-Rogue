// Entity data structures and factories.

import { PLAYER, ENEMIES, PASSIVES, DESTRUCTIBLES, CharacterId } from './config';


export interface PlayerStats {
  maxHp: number;
  moveSpeed: number; // px per second
  damageMult: number; // global damage multiplier
  attackSpeedMult: number; // >1 = faster (cooldowns divided by this)
  areaMult: number; // size of projectiles / auras
  projectileSpeedMult: number;
  pickupRadius: number;
  xpMult: number;
  regen: number; // hp per second
  armor: number; // damage reduction stat used in percentage-based formula
  amount: number; // extra projectiles for supporting weapons
  critChance: number; // 0..1
  critMult: number;
}

export function baseStats(): PlayerStats {
  return {
    maxHp: PLAYER.maxHp,
    moveSpeed: PLAYER.moveSpeed,
    damageMult: 1,
    attackSpeedMult: 1,
    areaMult: 1,
    projectileSpeedMult: 1,
    pickupRadius: PASSIVES.magnetRadii[0],
    xpMult: 1,
    regen: 0,
    armor: 0,
    amount: 0,
    critChance: PLAYER.critChanceBase,
    critMult: PLAYER.critMult,
  };
}

export interface Player {
  x: number;
  y: number;
  radius: number;
  hp: number;
  stats: PlayerStats;
  level: number;
  xp: number;
  xpToNext: number;
  facing: { x: number; y: number }; // last movement direction
  invuln: number; // seconds of i-frames remaining
  hurtFlash: number;
  passives: Map<string, number>; // passive id -> level
  charId: CharacterId; // 所选角色（决定初始武器/装扮/基础属性修正）
  attackAnim: number; // 攻击动作计时（剑客挥剑时刷新，供渲染控制剑光动画）
  attackDir: 1 | -1; // 本次挥砍扫动方向（与剑光同步）
  attackAngle: number; // 本次挥砍的中心朝向（与剑气同源，供持剑渲染）
}

export function createPlayer(x: number, y: number, charId: CharacterId = 'mage'): Player {
  const stats = baseStats();
  return {
    x,
    y,
    radius: PLAYER.radius,
    hp: stats.maxHp,
    stats,
    level: 1,
    xp: 0,
    xpToNext: PLAYER.firstLevelXp,
    facing: { x: 1, y: 0 },
    invuln: 0,
    hurtFlash: 0,
    passives: new Map(),
    charId,
    attackAnim: 0,
    attackDir: 1,
    attackAngle: 0,
  };
}

export type EnemyKind = 'walker' | 'fast' | 'tank' | 'brute' | 'boss';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number; // contact damage per hit
  xpValue: number;
  color: string;
  kx: number; // knockback velocity
  ky: number;
  hitFlash: number;
  contactCd: number; // per-enemy cooldown so it doesn't nuke player each frame
  wobble: number; // visual animation phase
  slowMul: number; // current speed multiplier from slows (1 = none)
  slowTimer: number; // seconds of slow remaining
  stunTimer: number; // seconds of stun (no movement) remaining
  sweepTimer: number; // seconds remaining moving in a fixed sweep direction (cluster events)
  sweepVx: number; // sweep velocity x
  sweepVy: number; // sweep velocity y
}

interface EnemyTemplate {
  radius: number;
  hp: number;
  speed: number;
  damage: number;
  xpValue: number;
  color: string;
}

const ENEMY_TEMPLATES: Record<EnemyKind, EnemyTemplate> = ENEMIES;

let enemyIdCounter = 1;

export function createEnemy(kind: EnemyKind, x: number, y: number, hpScale: number, speedScale = 1, dmgScale = 1): Enemy {
  const t = ENEMY_TEMPLATES[kind];
  const hp = Math.round(t.hp * hpScale);
  return {
    id: enemyIdCounter++,
    kind,
    x,
    y,
    radius: t.radius,
    hp,
    maxHp: hp,
    speed: t.speed * speedScale,
    damage: Math.round(t.damage * dmgScale),
    xpValue: t.xpValue,
    color: t.color,
    kx: 0,
    ky: 0,
    hitFlash: 0,
    contactCd: 0,
    wobble: Math.random() * Math.PI * 2,
    slowMul: 1,
    slowTimer: 0,
    stunTimer: 0,
    sweepTimer: 0,
    sweepVx: 0,
    sweepVy: 0,
  };
}

export type ProjectileKind =
  | 'bolt'
  | 'knife'
  | 'orbit'
  | 'aura'
  | 'nova'
  | 'lightning'
  | 'frost'
  | 'blackhole'
  | 'shock';

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  pierceLeft: number;
  life: number;
  maxLife: number;
  color: string;
  knockback: number;
  follow: boolean; // sticks to player (aura)
  orbit?: { angle: number; radius: number; speed: number };
  hit: Set<number>; // enemies already hit (for piercing single-hit projectiles)
  rehit: Map<number, number>; // enemy id -> remaining cooldown (for aura/orbit)
  rehitInterval: number; // seconds between re-hits; 0 = single hit
  angle: number; // visual rotation
  slowMul: number; // slow applied on hit (1 = none)
  slowDuration: number; // seconds of slow applied on hit
  stunDuration: number; // seconds of stun applied on hit
  pull: number; // inward pull strength (black hole)
  growth: number; // radius growth per second (shockwave)
}

let projIdCounter = 1;

export function createProjectile(p: Partial<Projectile> & { x: number; y: number; kind: ProjectileKind }): Projectile {
  return {
    id: projIdCounter++,
    kind: p.kind,
    x: p.x,
    y: p.y,
    vx: p.vx ?? 0,
    vy: p.vy ?? 0,
    radius: p.radius ?? 8,
    damage: p.damage ?? 5,
    pierceLeft: p.pierceLeft ?? 0,
    life: p.life ?? 1.5,
    maxLife: p.life ?? 1.5,
    color: p.color ?? '#ffd166',
    knockback: p.knockback ?? 60,
    follow: p.follow ?? false,
    orbit: p.orbit,
    hit: new Set(),
    rehit: new Map(),
    rehitInterval: p.rehitInterval ?? 0,
    angle: p.angle ?? 0,
    slowMul: p.slowMul ?? 1,
    slowDuration: p.slowDuration ?? 0,
    stunDuration: p.stunDuration ?? 0,
    pull: p.pull ?? 0,
    growth: p.growth ?? 0,
  };
}

export interface Gem {
  x: number;
  y: number;
  value: number;
  vx: number;
  vy: number;
  pulled: boolean;
  color: string;
  /** 若设置，拾取时恢复生命而非加经验（可破坏道具掉落的血包） */
  heal?: number;
}

export function createGem(x: number, y: number, value: number): Gem {
  let color = '#7ee787';
  if (value >= 20) color = '#ffd166';
  else if (value >= 5) color = '#6bd0ff';
  return { x, y, value, vx: 0, vy: 0, pulled: false, color };
}

/** 血包：同样可被磁力吸取，拾取时回血而非加经验 */
export function createHeal(x: number, y: number, amount: number): Gem {
  return { x, y, value: 0, vx: 0, vy: 0, pulled: false, color: '#ff6b8b', heal: amount };
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  life: number;
  text: string;
  color: string;
  size: number;
  crit?: boolean; // 暴击伤害：渲染时额外描边 + 轻微上弹弹跳
}

// -----------------------------------------------------------------------------
// 可破坏道具 (Destructible)
// 游戏拥有的可打碎物件：有 HP，仅阻挡玩家，被投射物打碎后按小概率掉落。
// x 为锚点水平中心，y 为底边（=baseY，供 Y-sort）；碰撞/受击圆心为 (cx,cy) 半径 r。
// -----------------------------------------------------------------------------
export interface Destructible {
  id: number;
  cellKey: string; // 所属生成格子（去重 / 摧毁记录用）
  type: number; // 地图内造型变体 0/1
  x: number; // 锚点中心 X（绘制原点）
  y: number; // 锚点底边 Y
  baseY: number; // = y，Y-sort 依据
  scale: number;
  seed: number; // 确定性绘制细节种子
  r: number; // 碰撞 / 受击半径
  cx: number; // 碰撞/受击圆心 X
  cy: number; // 碰撞/受击圆心 Y
  hp: number;
  maxHp: number;
  hitFlash: number;
}

let destructibleIdCounter = 1;

export function createDestructible(
  cellKey: string,
  type: number,
  x: number,
  y: number,
  scale: number,
  seed: number,
): Destructible {
  const r = DESTRUCTIBLES.radius * scale;
  return {
    id: destructibleIdCounter++,
    cellKey,
    type,
    x,
    y,
    baseY: y,
    scale,
    seed,
    r,
    cx: x,
    cy: y - r * 0.7,
    hp: DESTRUCTIBLES.hp,
    maxHp: DESTRUCTIBLES.hp,
    hitFlash: 0,
  };
}
