// Skill system: weapons (active) and passives (stat upgrades).
// This is the core of the level-up loop: each level the player either learns
// a new skill or upgrades an existing one.

import {
  Player,
  Enemy,
  Projectile,
  ProjectileKind,
  createProjectile,
} from './entities';
import { angleTo, dist } from './math';
import { WEAPONS as W, PASSIVES as PT, PROGRESSION, PLAYER } from './config';

/** What a weapon needs from the game world to do its job. Game implements this. */
export interface WeaponContext {
  player: Player;
  enemies: Enemy[];
  spawnProjectile(p: Projectile): void;
  clearProjectiles(kind: ProjectileKind): void;
  nearestEnemy(x: number, y: number, exclude?: Set<number>): Enemy | null;
  damageEnemy(e: Enemy, dmg: number, fromX: number, fromY: number, knockback: number): void;
  applyStatus(e: Enemy, slowMul: number, slowDuration: number, stunDuration: number): void;
  addBeam(x1: number, y1: number, x2: number, y2: number, color: string): void;
}

export interface WeaponInstance {
  defId: string;
  level: number;
  timer: number;
  state: Record<string, number>;
}

export interface WeaponDef {
  id: string;
  name: string;
  icon: string;
  maxLevel: number;
  /** Description shown for the *next* level (level = level you'd get). */
  describe(level: number): string;
  update(dt: number, ctx: WeaponContext, inst: WeaponInstance): void;
}

export interface PassiveDef {
  id: string;
  name: string;
  icon: string;
  maxLevel: number;
  describe(level: number): string;
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

const WEAPON_DEFS: WeaponDef[] = [
  // 1. Magic Bolt — auto-targets the nearest enemy.
  {
    id: 'bolt',
    name: '魔法飞弹',
    icon: '🔮',
    maxLevel: 8,
    describe(level) {
      if (level === 1) return '自动向最近的敌人发射追踪飞弹。';
      const bonuses = ['', '伤害 +58%', '飞弹数 +1', '伤害 +47%、冷却 -24%、穿透 +1', '飞弹数 +1', '伤害 +46%', '飞弹数 +1、冷却 -26%', '伤害 +46%'];
      return bonuses[level - 1] ?? '威力提升。';
    },
    update(dt, ctx, inst) {
      const L = inst.level;
      const cd = W.bolt.cd[L];
      const dmg = W.bolt.dmg[L];
      const count = 1 + Math.floor((L - 1) / 2) + ctx.player.stats.amount;
      const pierce = L >= W.bolt.pierceHighFrom ? W.bolt.pierceHigh : W.bolt.pierceLow;
      inst.timer -= dt;
      if (inst.timer > 0) return;
      inst.timer = cd / ctx.player.stats.attackSpeedMult;
      const p = ctx.player;
      const exclude = new Set<number>();
      for (let i = 0; i < count; i++) {
        const target = ctx.nearestEnemy(p.x, p.y, exclude);
        let ang: number;
        if (target) {
          ang = angleTo(p.x, p.y, target.x, target.y);
          exclude.add(target.id);
        } else {
          ang = Math.atan2(p.facing.y, p.facing.x) + (i - count / 2) * 0.2;
        }
        const speed = W.bolt.speed * p.stats.projectileSpeedMult;
        ctx.spawnProjectile(
          createProjectile({
            kind: 'bolt',
            x: p.x,
            y: p.y,
            vx: Math.cos(ang) * speed,
            vy: Math.sin(ang) * speed,
            radius: W.bolt.radius * p.stats.areaMult,
            damage: dmg * p.stats.damageMult,
            pierceLeft: pierce,
            life: W.bolt.life,
            color: '#b98bff',
            knockback: W.bolt.knockback,
          }),
        );
      }
    },
  },

  // 2. Whirling Daggers — fire in the facing direction, piercing.
  {
    id: 'dagger',
    name: '回旋飞刀',
    icon: '🗡️',
    maxLevel: 8,
    describe(level) {
      if (level === 1) return '召唤在屏幕内乱飞的飞刀，击中触碰到的敌人。';
      const bonuses = ['', '伤害 +56%', '冷却 -30%', '飞刀数 +1、伤害 +43%', '穿透 +2', '飞刀数 +1、伤害 +50%', '飞刀数 +1、冷却 -22%', '伤害 +23%、冷却 -11%'];
      return bonuses[level - 1] ?? '威力提升。';
    },
    update(dt, ctx, inst) {
      const L = inst.level;
      const cd = W.dagger.cd[L];
      const dmg = W.dagger.dmg[L];
      const count = W.dagger.count[L];
      const total = count + ctx.player.stats.amount;
      const pierce = L >= W.dagger.pierceHighFrom ? W.dagger.pierceHigh : W.dagger.pierceLow;
      inst.timer -= dt;
      if (inst.timer > 0) return;
      inst.timer = cd / ctx.player.stats.attackSpeedMult;
      const p = ctx.player;
      // Knives are summoned flying in random directions; they roam the screen
      // (bouncing off its edges, handled in the game loop) and hit enemies on contact.
      for (let i = 0; i < total; i++) {
        const ang = Math.random() * Math.PI * 2;
        const speed = W.dagger.speed * p.stats.projectileSpeedMult;
        ctx.spawnProjectile(
          createProjectile({
            kind: 'knife',
            x: p.x,
            y: p.y,
            vx: Math.cos(ang) * speed,
            vy: Math.sin(ang) * speed,
            radius: W.dagger.radius * p.stats.areaMult,
            damage: dmg * p.stats.damageMult,
            pierceLeft: pierce,
            life: W.dagger.life,
            color: '#e8eef7',
            knockback: W.dagger.knockback,
            angle: ang,
          }),
        );
      }
    },
  },

  // 3. Guardian Orbs — orbit the player continuously.
  {
    id: 'orbit',
    name: '守护法球',
    icon: '🟠',
    maxLevel: 8,
    describe(level) {
      if (level === 1) return '召唤环绕自身旋转的能量法球，持续造成伤害。';
      const bonuses = ['', '伤害 +67%', '法球 +1、转速 +29%', '伤害 +47%', '法球 +1、轨道范围 +29%', '伤害 +50%', '法球 +1', '伤害 +21%'];
      return bonuses[level - 1] ?? '威力提升。';
    },
    update(dt, ctx, inst) {
      const L = inst.level;
      const count = W.orbit.count[L];
      const dmg = W.orbit.dmg[L];
      const spin = L >= W.orbit.spinHighFrom ? W.orbit.spinHigh : W.orbit.spinLow;
      const radius = (W.orbit.radiusBase + (L >= W.orbit.radiusBonusFrom ? W.orbit.radiusBonus : 0)) * ctx.player.stats.areaMult;
      // (Re)build orbs whenever configuration changed.
      const want = count;
      inst.state.count = inst.state.count ?? 0;
      if (inst.state.count !== want || inst.state.dmg !== dmg || inst.state.radius !== radius) {
        inst.state.count = want;
        inst.state.dmg = dmg;
        inst.state.radius = radius;
        inst.state.rebuild = 1;
      }
      // Signal the game to (re)spawn orbit projectiles via a sentinel timer.
      inst.timer -= dt;
      if (inst.state.rebuild === 1 || inst.timer <= 0) {
        inst.state.rebuild = 0;
        inst.timer = 999; // orbs persist; refreshed if config changes
        // Replace old orbs with a fresh, correctly-configured set.
        ctx.clearProjectiles('orbit');
        const p = ctx.player;
        for (let i = 0; i < want; i++) {
          ctx.spawnProjectile(
            createProjectile({
              kind: 'orbit',
              x: p.x,
              y: p.y,
              radius: W.orbit.orbRadius * p.stats.areaMult,
              damage: dmg * p.stats.damageMult,
              life: Infinity,
              color: '#ffb454',
              knockback: W.orbit.knockback,
              rehitInterval: W.orbit.rehit,
              orbit: { angle: (i / want) * Math.PI * 2, radius, speed: spin },
            }),
          );
        }
      }
    },
  },

  // 4. Flame Aura — persistent damaging field around the player.
  {
    id: 'aura',
    name: '烈焰领域',
    icon: '🔥',
    maxLevel: 8,
    describe(level) {
      if (level === 1) return '环绕自身的灼热领域，持续灼烧靠近的敌人。';
      const bonuses = ['', '范围 +20%', '伤害 +67%', '灼烧频率 +29%', '范围 +18%', '伤害 +70%', '范围 +15%', '伤害 +29%、范围 +10%'];
      return bonuses[level - 1] ?? '威力提升。';
    },
    update(dt, ctx, inst) {
      const L = inst.level;
      const dmg = W.aura.dmg[L];
      const radiusMul = W.aura.radiusMul[L];
      const interval = L >= W.aura.intervalHighFrom ? W.aura.intervalHigh : W.aura.intervalLow;
      const radius = W.aura.radiusBase * radiusMul * ctx.player.stats.areaMult;
      inst.timer -= dt;
      if (inst.state.made !== 1 || inst.state.radius !== radius || inst.state.dmg !== dmg) {
        inst.state.made = 1;
        inst.state.radius = radius;
        inst.state.dmg = dmg;
        ctx.clearProjectiles('aura');
        const p = ctx.player;
        ctx.spawnProjectile(
          createProjectile({
            kind: 'aura',
            x: p.x,
            y: p.y,
            radius,
            damage: dmg * p.stats.damageMult,
            life: Infinity,
            color: 'rgba(255,120,60,0.18)',
            knockback: 10,
            follow: true,
            rehitInterval: interval,
          }),
        );
      }
    },
  },

  // 5. Frost Nova — periodically bursts projectiles in all directions.
  {
    id: 'nova',
    name: '冰霜新星',
    icon: '❄️',
    maxLevel: 8,
    describe(level) {
      if (level === 1) return '周期性向四周爆发一圈冰霜弹幕。';
      const bonuses = ['', '伤害 +50%', '弹幕 +2、冷却 -25%', '弹幕 +4、伤害 +47%', '穿透 +1', '弹幕 +2、伤害 +50%', '弹幕 +4、冷却 -17%', '弹幕 +4、伤害 +21%、冷却 -13%'];
      return bonuses[level - 1] ?? '威力提升。';
    },
    update(dt, ctx, inst) {
      const L = inst.level;
      const cd = W.nova.cd[L];
      const dmg = W.nova.dmg[L];
      const bullets = W.nova.bullets[L];
      const total = bullets + ctx.player.stats.amount;
      const pierce = L >= W.nova.pierceHighFrom ? W.nova.pierceHigh : W.nova.pierceLow;
      inst.timer -= dt;
      if (inst.timer > 0) return;
      inst.timer = cd / ctx.player.stats.attackSpeedMult;
      const p = ctx.player;
      for (let i = 0; i < total; i++) {
        const ang = (i / total) * Math.PI * 2;
        const speed = W.nova.speed * p.stats.projectileSpeedMult;
        ctx.spawnProjectile(
          createProjectile({
            kind: 'nova',
            x: p.x,
            y: p.y,
            vx: Math.cos(ang) * speed,
            vy: Math.sin(ang) * speed,
            radius: W.nova.radius * p.stats.areaMult,
            damage: dmg * p.stats.damageMult,
            pierceLeft: pierce,
            life: W.nova.life,
            color: '#7fe6ff',
            knockback: W.nova.knockback,
          }),
        );
      }
    },
  },

  // 6. Chain Lightning — instant strike that arcs between enemies.
  {
    id: 'lightning',
    name: '连锁闪电',
    icon: '⚡',
    maxLevel: 8,
    describe(level) {
      if (level === 1) return '击中最近的敌人并在敌群间弹跳的闪电。';
      const bonuses = ['', '跳数 +1、伤害 +53%', '冷却 -23%', '跳数 +2、伤害 +38%', '伤害 +33%', '跳数 +2', '跳数 +1、冷却 -26%', '跳数 +1、伤害 +25%、冷却 -18%'];
      return bonuses[level - 1] ?? '威力提升。';
    },
    update(dt, ctx, inst) {
      const L = inst.level;
      const cd = W.lightning.cd[L];
      const dmg = W.lightning.dmg[L];
      const chains = W.lightning.chains[L];
      const range = W.lightning.range;
      inst.timer -= dt;
      if (inst.timer > 0) return;
      const p = ctx.player;
      const first = ctx.nearestEnemy(p.x, p.y);
      if (!first) return;
      inst.timer = cd / p.stats.attackSpeedMult;
      const hitSet = new Set<number>();
      let fromX = p.x;
      let fromY = p.y;
      let current: Enemy | null = first;
      const dmgVal = dmg * p.stats.damageMult;
      for (let i = 0; i < chains && current; i++) {
        ctx.addBeam(fromX, fromY, current.x, current.y, '#bfe9ff');
        ctx.damageEnemy(current, dmgVal, fromX, fromY, 40);
        hitSet.add(current.id);
        fromX = current.x;
        fromY = current.y;
        // find next nearest unhit enemy within range
        let next: Enemy | null = null;
        let best = range * range;
        for (const e of ctx.enemies) {
          if (hitSet.has(e.id) || e.hp <= 0) continue;
          const d = (e.x - fromX) ** 2 + (e.y - fromY) ** 2;
          if (d < best) {
            best = d;
            next = e;
          }
        }
        current = next;
      }
    },
  },

  // 7. Frost Field (control) — a chilling aura that slows enemies.
  {
    id: 'frostfield',
    name: '霜寒领域',
    icon: '🧊',
    maxLevel: 8,
    describe(level) {
      if (level === 1) return '环绕自身的寒冰领域，减速并持续冰冻靠近的敌人。';
      const bonuses = ['', '减速 +10%、范围 +18%', '伤害 +80%', '减速 +6%、范围 +17%', '减速 +4%', '伤害 +78%', '减速 +10%、范围 +16%', '伤害 +38%、减速 +4%、范围 +13%'];
      return bonuses[level - 1] ?? '威力提升。';
    },
    update(dt, ctx, inst) {
      const L = inst.level;
      const dmg = W.frostfield.dmg[L];
      // lower slowMul = stronger slow (enemy speed multiplier)
      const slow = W.frostfield.slow[L];
      const radiusMul = W.frostfield.radiusMul[L];
      const radius = W.frostfield.radiusBase * radiusMul * ctx.player.stats.areaMult;
      inst.timer -= dt;
      if (inst.state.made !== 1 || inst.state.radius !== radius || inst.state.dmg !== dmg || inst.state.slow !== slow) {
        inst.state.made = 1;
        inst.state.radius = radius;
        inst.state.dmg = dmg;
        inst.state.slow = slow;
        ctx.clearProjectiles('frost');
        const p = ctx.player;
        ctx.spawnProjectile(
          createProjectile({
            kind: 'frost',
            x: p.x,
            y: p.y,
            radius,
            damage: dmg * p.stats.damageMult,
            life: Infinity,
            color: 'rgba(120,200,255,0.18)',
            knockback: 0,
            follow: true,
            rehitInterval: W.frostfield.rehit,
            slowMul: slow,
            slowDuration: W.frostfield.slowDuration,
          }),
        );
      }
    },
  },

  // 8. Singularity (control + AoE) — a black hole that pulls and crushes.
  {
    id: 'singularity',
    name: '重力奇点',
    icon: '🕳️',
    maxLevel: 8,
    describe(level) {
      if (level === 1) return '在敌群中制造黑洞，牵引并减速敌人，同时造成范围伤害。';
      const bonuses = ['', '伤害 +60%、范围 +24%', '冷却 -23%', '伤害 +50%、持续 +0.8s', '牵引 +53%', '伤害 +58%', '冷却 -26%、范围 +21%', '伤害 +32%、冷却 -18%、范围 +7%'];
      return bonuses[level - 1] ?? '威力提升。';
    },
    update(dt, ctx, inst) {
      const L = inst.level;
      const cd = W.singularity.cd[L];
      const dmg = W.singularity.dmg[L];
      const radiusMul = W.singularity.radiusMul[L];
      const duration = W.singularity.durationBase + (L >= W.singularity.durationBonusFrom ? W.singularity.durationBonus : 0);
      const pull = W.singularity.pullBase + (L >= W.singularity.pullBonusFrom ? W.singularity.pullBonus : 0);
      const radius = W.singularity.radiusBase * radiusMul * ctx.player.stats.areaMult;
      inst.timer -= dt;
      if (inst.timer > 0) return;
      const p = ctx.player;
      const target = ctx.nearestEnemy(p.x, p.y);
      inst.timer = cd / p.stats.attackSpeedMult;
      const cx = target ? target.x : p.x;
      const cy = target ? target.y : p.y;
      ctx.spawnProjectile(
        createProjectile({
          kind: 'blackhole',
          x: cx,
          y: cy,
          radius,
          damage: dmg * p.stats.damageMult,
          life: duration,
          color: '#a888ff',
          knockback: 0,
          rehitInterval: W.singularity.rehit,
          slowMul: W.singularity.slowMul,
          slowDuration: W.singularity.slowDuration,
          pull,
        }),
      );
    },
  },

  // 9. Shockwave (control + AoE) — an expanding ring that knocks back and stuns.
  {
    id: 'shockwave',
    name: '震荡波',
    icon: '💥',
    maxLevel: 8,
    describe(level) {
      if (level === 1) return '周期性释放冲击波，击退并短暂眩晕范围内的敌人。';
      const bonuses = ['', '伤害 +57%、范围 +10%', '冷却 -20%、范围 +13%', '伤害 +45%', '冷却 -13%', '伤害 +50%、范围 +16%、眩晕 +0.2s', '冷却 -19%', '伤害 +29%、范围 +11%、冷却 -18%'];
      return bonuses[level - 1] ?? '威力提升。';
    },
    update(dt, ctx, inst) {
      const L = inst.level;
      const cd = W.shockwave.cd[L];
      const dmg = W.shockwave.dmg[L];
      const rMul = W.shockwave.rMul[L];
      const stun = W.shockwave.stunBase + (L >= W.shockwave.stunBonusFrom ? W.shockwave.stunBonus : 0);
      const maxR = W.shockwave.maxRBase * rMul * ctx.player.stats.areaMult;
      inst.timer -= dt;
      if (inst.timer > 0) return;
      inst.timer = cd / ctx.player.stats.attackSpeedMult;
      const p = ctx.player;
      const expand = W.shockwave.expand;
      ctx.spawnProjectile(
        createProjectile({
          kind: 'shock',
          x: p.x,
          y: p.y,
          radius: W.shockwave.radiusStart,
          damage: dmg * p.stats.damageMult,
          pierceLeft: 9999,
          life: expand,
          color: '#bfe0ff',
          knockback: W.shockwave.knockback,
          growth: (maxR - W.shockwave.radiusStart) / expand,
          stunDuration: stun,
        }),
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Passives
// ---------------------------------------------------------------------------

const PASSIVE_DEFS: PassiveDef[] = [
  { id: 'max_hp', name: '强健体魄', icon: '❤️', maxLevel: PT.maxLevels.max_hp, describe: () => `最大生命值 +${PT.maxHpPerLevel}，并回复相应生命。` },
  { id: 'move_speed', name: '疾风之靴', icon: '👟', maxLevel: PT.maxLevels.move_speed, describe: () => `移动速度 +${Math.round(PT.moveSpeedPerLevel * 100)}%。` },
  { id: 'power', name: '力量核心', icon: '💥', maxLevel: PT.maxLevels.power, describe: () => `所有伤害 +${Math.round(PT.powerPerLevel * 100)}%。` },
  { id: 'haste', name: '急速引擎', icon: '⏩', maxLevel: PT.maxLevels.haste, describe: () => `攻击速度 +${Math.round(PT.hastePerLevel * 100)}%。` },
  { id: 'area', name: '扩张法阵', icon: '🌀', maxLevel: PT.maxLevels.area, describe: () => `技能范围 +${Math.round(PT.areaPerLevel * 100)}%。` },
  { id: 'magnet', name: '磁力护符', icon: '🧲', maxLevel: PT.maxLevels.magnet, describe: (level) => (level >= PT.maxLevels.magnet ? '拾取范围覆盖全屏！' : '大幅提升拾取范围。') },
  { id: 'wisdom', name: '智慧宝石', icon: '📘', maxLevel: PT.maxLevels.wisdom, describe: () => `经验获取 +${Math.round(PT.xpPerLevel * 100)}%。` },
  { id: 'regen', name: '生命源泉', icon: '✨', maxLevel: PT.maxLevels.regen, describe: () => `每秒回复生命 +${PT.regenPerLevel}。` },
  { id: 'armor', name: '坚固护甲', icon: '🛡️', maxLevel: PT.maxLevels.armor, describe: () => `受到伤害减少 ${PT.armorPerLevel} 点。` },
  { id: 'crit', name: '致命一击', icon: '🎯', maxLevel: PT.maxLevels.crit, describe: () => `暴击率 +${Math.round(PT.critPerLevel * 100)}%（满级 100%）。` },
];

// ---------------------------------------------------------------------------
// Registries & stat recomputation
// ---------------------------------------------------------------------------

export const WEAPONS = new Map(WEAPON_DEFS.map((w) => [w.id, w]));
export const PASSIVES = new Map(PASSIVE_DEFS.map((p) => [p.id, p]));

export function getWeaponDef(id: string): WeaponDef {
  const w = WEAPONS.get(id);
  if (!w) throw new Error(`Unknown weapon ${id}`);
  return w;
}

export function getPassiveDef(id: string): PassiveDef {
  const p = PASSIVES.get(id);
  if (!p) throw new Error(`Unknown passive ${id}`);
  return p;
}

/** Recompute derived player stats from base + passive levels. */
export function recomputeStats(player: Player): void {
  const s = player.stats;
  const lv = (id: string) => player.passives.get(id) ?? 0;

  const oldMax = s.maxHp;
  s.maxHp = PLAYER.maxHp + PT.maxHpPerLevel * lv('max_hp');
  s.moveSpeed = PLAYER.moveSpeed * (1 + PT.moveSpeedPerLevel * lv('move_speed'));
  s.damageMult = 1 * (1 + PT.powerPerLevel * lv('power'));
  s.attackSpeedMult = 1 * (1 + PT.hastePerLevel * lv('haste'));
  s.areaMult = 1 * (1 + PT.areaPerLevel * lv('area'));
  // Pickup radius grows fast and covers the whole screen at max level.
  const magnetRadii = PT.magnetRadii;
  s.pickupRadius = magnetRadii[Math.min(lv('magnet'), magnetRadii.length - 1)];
  s.xpMult = 1 * (1 + PT.xpPerLevel * lv('wisdom'));
  s.regen = PT.regenPerLevel * lv('regen');
  s.armor = PT.armorPerLevel * lv('armor');
  s.critChance = Math.min(1, PLAYER.critChanceBase + PT.critPerLevel * lv('crit'));
  s.projectileSpeedMult = 1;
  s.critMult = PLAYER.critMult;

  // Heal by the max-hp increase so leveling max_hp feels good.
  const gained = s.maxHp - oldMax;
  if (gained > 0) player.hp = Math.min(s.maxHp, player.hp + gained);
  if (player.hp > s.maxHp) player.hp = s.maxHp;
}

// ---------------------------------------------------------------------------
// Level-up choice generation
// ---------------------------------------------------------------------------

export type ChoiceType = 'new-weapon' | 'upgrade-weapon' | 'new-passive' | 'upgrade-passive';

export interface Choice {
  type: ChoiceType;
  id: string;
  name: string;
  icon: string;
  tag: string; // '新技能' | '强化' 
  tagClass: string;
  desc: string;
  levelText: string;
}

const MAX_WEAPON_SLOTS = PROGRESSION.maxWeaponSlots;

export function generateChoices(
  player: Player,
  weapons: WeaponInstance[],
): Choice[] {
  const pool: Choice[] = [];
  const weaponLevels = new Map(weapons.map((w) => [w.defId, w.level]));

  // Upgrade existing weapons
  for (const inst of weapons) {
    const def = getWeaponDef(inst.defId);
    if (inst.level < def.maxLevel) {
      pool.push({
        type: 'upgrade-weapon',
        id: def.id,
        name: def.name,
        icon: def.icon,
        tag: '武器强化',
        tagClass: 'tag-up',
        desc: def.describe(inst.level + 1),
        levelText: `Lv.${inst.level} → ${inst.level + 1}`,
      });
    }
  }

  // New weapons (if there is a free slot)
  if (weapons.length < MAX_WEAPON_SLOTS) {
    for (const def of WEAPON_DEFS) {
      if (!weaponLevels.has(def.id)) {
        pool.push({
          type: 'new-weapon',
          id: def.id,
          name: def.name,
          icon: def.icon,
          tag: '新武器',
          tagClass: 'tag-weapon',
          desc: def.describe(1),
          levelText: '解锁 Lv.1',
        });
      }
    }
  }

  // Upgrade / learn passives
  for (const def of PASSIVE_DEFS) {
    const cur = player.passives.get(def.id) ?? 0;
    if (cur < def.maxLevel) {
      pool.push({
        type: cur === 0 ? 'new-passive' : 'upgrade-passive',
        id: def.id,
        name: def.name,
        icon: def.icon,
        tag: cur === 0 ? '新增益' : '增益强化',
        tagClass: cur === 0 ? 'tag-new' : 'tag-up',
        desc: def.describe(cur + 1),
        levelText: cur === 0 ? '获得 Lv.1' : `Lv.${cur} → ${cur + 1}`,
      });
    }
  }

  // Shuffle and take up to 3, preferring a mix.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, PROGRESSION.choicesPerLevel);
}

export { dist };
