// Entity data structures and factories.

import { PLAYER, ENEMIES, PASSIVES } from './config';


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
  armor: number; // flat damage reduction per hit
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
}

export function createPlayer(x: number, y: number): Player {
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

export function createEnemy(kind: EnemyKind, x: number, y: number, hpScale: number, speedScale = 1): Enemy {
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
    damage: t.damage,
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
}

export function createGem(x: number, y: number, value: number): Gem {
  let color = '#7ee787';
  if (value >= 20) color = '#ffd166';
  else if (value >= 5) color = '#6bd0ff';
  return { x, y, value, vx: 0, vy: 0, pulled: false, color };
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
}
