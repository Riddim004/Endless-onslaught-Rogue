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
import { WEAPONS as W, PASSIVES as PT, PROGRESSION, PLAYER, CHARACTERS } from './config';

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
  /** 近战扇形挥砍：以 (x,y) 为支点、angle 为中心方向、arcHalf 为半张角，瞬时命中 reach 内敌人与道具并生成剑光 */
  meleeSwing(x: number, y: number, angle: number, reach: number, arcHalf: number, dmg: number, knockback: number): void;
  /** 鼠标在世界坐标系的位置（主动武器瞄准用） */
  aimWorld(): { x: number; y: number };
  /** 本帧鼠标左键是否刚在画布上按下 */
  fireJustPressed(): boolean;
  /** 鼠标左键是否正被按住（持续引导武器） */
  fireHeld(): boolean;
  /** 激光瞬发：从 (x,y) 沿 angle 方向的线段命中所有敌人/道具，并生成光束特效 */
  laserBlast(x: number, y: number, angle: number, range: number, halfWidth: number, dmg: number, knockback: number): void;
  /** 持续引导：标记本帧在 (ax,ay) 为心、radius 为半径的圆形区激活（供渲染赤色能量）；
   *  dealDamage 为 true 时同时结算一次区域伤害；maxTargets 限制同时选定的敌人数（取距圆心最近者，超武用） */
  channel(ax: number, ay: number, radius: number, dmg: number, knockback: number, dealDamage: boolean, maxTargets?: number): void;
}

export interface WeaponInstance {
  defId: string;
  level: number;
  timer: number;
  state: Record<string, number>;
  /** 已进化为超武（满级后选择超武进化卡获得） */
  evolved?: boolean;
}

export interface WeaponDef {
  id: string;
  name: string;
  icon: string;
  maxLevel: number;
  /** 触发方式：'auto' 自动施放（缺省）；'active' 需玩家鼠标点击触发 */
  mode?: 'auto' | 'active';
  /** 超武进化（可选）：满级后升级三选一必出进化卡，选中后质变 */
  evolve?: { name: string; desc: string };
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
      if (level === 1) return '召唤在你周围乱飞的飞刀，击中触碰到的敌人。';
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
      // Knives are summoned flying in random directions; they roam a fixed circle
      // around the player (bouncing off its rim, handled in the game loop).
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

  // 10. Blade of Dawn (melee) — sweep a cone toward the nearest enemy.
  {
    id: 'sword',
    name: '破晓之刃',
    icon: '⚔️',
    maxLevel: 8,
    describe(level) {
      if (level === 1) return '朝最近的敌人挥出一道剑气，瞬时斩击扇形区内所有敌人。';
      const bonuses = ['', '伤害 +57%', '冷却 -19%、范围 +17%', '伤害 +45%', '冷却 -17%、范围 +15%', '伤害 +44%', '冷却 -17%、范围 +15%', '伤害 +30%、范围 +11%、冷却 -15%'];
      return bonuses[level - 1] ?? '威力提升。';
    },
    update(dt, ctx, inst) {
      const L = inst.level;
      const cd = W.sword.cd[L];
      const p = ctx.player;
      const dmg = W.sword.dmg[L] * p.stats.damageMult;
      const reach = W.sword.reach[L] * p.stats.areaMult;
      inst.timer -= dt;
      if (inst.timer > 0) return;
      inst.timer = cd / p.stats.attackSpeedMult;
      // 朝最近敌人挥砍；无敌人时朝面向。
      const target = ctx.nearestEnemy(p.x, p.y);
      const ang = target
        ? angleTo(p.x, p.y, target.x, target.y)
        : Math.atan2(p.facing.y, p.facing.x);
      ctx.meleeSwing(p.x, p.y, ang, reach, W.sword.arcHalf, dmg, W.sword.knockback);
    },
  },

  // 11. Laser Cannon (ACTIVE) — click to fire a piercing beam toward the cursor.
  {
    id: 'laser',
    name: '激光炮',
    icon: '🔫',
    maxLevel: 8,
    mode: 'active',
    evolve: {
      name: '棱镜歼灭',
      desc: '光束分裂为三道扇形齐射，一发贯穿整个战场。',
    },
    describe(level) {
      if (level === 1) return '鼠标左键点击，朝光标方向发射贯穿光束，重创线路上所有敌人。';
      const bonuses = ['', '伤害 +50%', '冷却 -16%、光束加粗', '伤害 +43%', '冷却 -15%、光束加粗', '伤害 +37%', '冷却 -17%、光束加粗', '伤害 +32%、冷却 -21%、光束加粗'];
      return bonuses[level - 1] ?? '威力提升。';
    },
    update(dt, ctx, inst) {
      const L = inst.level;
      inst.timer -= dt;
      if (inst.timer > 0) return;
      // 就绪后等待玩家点击发射（不自动开火）
      if (!ctx.fireJustPressed()) return;
      const p = ctx.player;
      inst.timer = W.laser.cd[L] / p.stats.attackSpeedMult;
      const aim = ctx.aimWorld();
      const ang = angleTo(p.x, p.y, aim.x, aim.y);
      const dmg = W.laser.dmg[L] * p.stats.damageMult;
      const halfW = W.laser.width[L] * p.stats.areaMult;
      // 超武「棱镜歼灭」：三束扇形齐射（单束伤害不变）
      if (inst.evolved) {
        const spread = W.laser.evoSpread;
        ctx.laserBlast(p.x, p.y, ang - spread, W.laser.range, halfW, dmg, W.laser.knockback);
        ctx.laserBlast(p.x, p.y, ang, W.laser.range, halfW, dmg, W.laser.knockback);
        ctx.laserBlast(p.x, p.y, ang + spread, W.laser.range, halfW, dmg, W.laser.knockback);
      } else {
        ctx.laserBlast(p.x, p.y, ang, W.laser.range, halfW, dmg, W.laser.knockback);
      }
    },
  },

  // 12. Annihilation Channel (ACTIVE · channeled) — hold to burn a circle at the cursor.
  {
    id: 'channel',
    name: '湮灭引导',
    icon: '☄️',
    maxLevel: 8,
    mode: 'active',
    evolve: {
      name: '湮灭·无终',
      desc: '引导不再消耗充能；赤色湮灭同时吞噬区域内至多 20 个敌人，将其罩入湮灭领域。',
    },
    describe(level) {
      if (level === 1) return '按住鼠标左键，赤色能量持续灼烧鼠标所在区域；引导消耗充能，松手恢复。';
      const bonuses = ['', '伤害 +50%', '频率 +14%、范围 +14%、充能 +16%', '伤害 +40%', '频率 +17%、范围 +13%、充能 +16%', '伤害 +38%', '频率 +20%、范围 +13%、充能 +18%', '伤害 +17%、频率 +11%、范围 +13%、充能 +16%'];
      return bonuses[level - 1] ?? '威力提升。';
    },
    update(dt, ctx, inst) {
      const L = inst.level;
      const p = ctx.player;
      const maxE = W.channel.energyMax[L];
      // 充能槽存在 inst.state：energy 当前能量，locked=1 表示耗尽断线待回充
      if (inst.state.energy === undefined) inst.state.energy = maxE;
      // 超武「湮灭·无终」：引导不消耗充能，按住即永续
      const wantChannel = ctx.fireHeld() && (inst.evolved || (inst.state.locked !== 1 && inst.state.energy > 0));
      if (!wantChannel) {
        // 回充；断线后回到阈值解锁
        inst.state.energy = Math.min(maxE, inst.state.energy + W.channel.regenPerSec * dt);
        if (inst.state.locked === 1 && inst.state.energy >= maxE * W.channel.rearmFraction) {
          inst.state.locked = 0;
        }
        inst.timer = 0; // 下次按下立即首击
        return;
      }
      // 引导中：消耗能量，耗尽即断线（超武不消耗）
      if (!inst.evolved) {
        inst.state.energy = Math.max(0, inst.state.energy - W.channel.drainPerSec * dt);
        if (inst.state.energy <= 0) inst.state.locked = 1;
      }
      const aim = ctx.aimWorld();
      const radius = W.channel.radius[L] * p.stats.areaMult;
      inst.timer -= dt;
      let dealDamage = false;
      if (inst.timer <= 0) {
        inst.timer = W.channel.tick[L] / p.stats.attackSpeedMult;
        dealDamage = true;
      }
      const dmg = W.channel.dmg[L] * p.stats.damageMult;
      // 超武：区域内至多同时选定 evoMaxTargets 个目标（无限引导的平衡刹车）
      ctx.channel(aim.x, aim.y, radius, dmg, W.channel.knockback, dealDamage, inst.evolved ? W.channel.evoMaxTargets : undefined);
    },
  },
];

// ---------------------------------------------------------------------------
// Passives
// ---------------------------------------------------------------------------

const PASSIVE_DEFS: PassiveDef[] = [
  { id: 'max_hp', name: '强健体魄', icon: '❤️', maxLevel: PT.maxLevels.max_hp, describe: () => `最大生命值 +${PT.maxHpPerLevel}，并回复相应生命。` },
  { id: 'move_speed', name: '疾风之靴', icon: '👟', maxLevel: PT.maxLevels.move_speed, describe: () => `移动速度 +${Math.round(PT.moveSpeedPerLevel * 100)}%。` },
  { id: 'power', name: '力量核心', icon: '💪', maxLevel: PT.maxLevels.power, describe: () => `所有伤害 +${Math.round(PT.powerPerLevel * 100)}%。` },
  { id: 'haste', name: '急速引擎', icon: '⏩', maxLevel: PT.maxLevels.haste, describe: () => `攻击速度 +${Math.round(PT.hastePerLevel * 100)}%。` },
  { id: 'area', name: '扩张法阵', icon: '🌀', maxLevel: PT.maxLevels.area, describe: () => `技能范围 +${Math.round(PT.areaPerLevel * 100)}%。` },
  { id: 'magnet', name: '磁力护符', icon: '🧲', maxLevel: PT.maxLevels.magnet, describe: (level) => (level >= PT.maxLevels.magnet ? '拾取范围覆盖全屏！' : '大幅提升拾取范围。') },
  { id: 'wisdom', name: '智慧宝石', icon: '📘', maxLevel: PT.maxLevels.wisdom, describe: () => `经验获取 +${Math.round(PT.xpPerLevel * 100)}%。` },
  { id: 'regen', name: '生命源泉', icon: '✨', maxLevel: PT.maxLevels.regen, describe: () => `每秒回复生命 +${PT.regenPerLevel}。` },
  { id: 'armor', name: '坚固护甲', icon: '🛡️', maxLevel: PT.maxLevels.armor, describe: () => `护甲 +${PT.armorPerLevel}，减免受到的伤害。` },
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
  const cm = CHARACTERS[player.charId].mods;
  s.maxHp = PLAYER.maxHp + PT.maxHpPerLevel * lv('max_hp') + cm.hpAdd;
  s.moveSpeed = PLAYER.moveSpeed * (1 + PT.moveSpeedPerLevel * lv('move_speed')) * cm.moveMul;
  s.damageMult = 1 * (1 + PT.powerPerLevel * lv('power'));
  s.attackSpeedMult = (1 + PT.hastePerLevel * lv('haste')) * cm.hasteMul;
  s.areaMult = (1 + PT.areaPerLevel * lv('area')) * cm.areaMul;
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

export type ChoiceType = 'new-weapon' | 'upgrade-weapon' | 'new-passive' | 'upgrade-passive' | 'evolve-weapon';

export interface Choice {
  type: ChoiceType;
  id: string;
  name: string;
  icon: string;
  tag: string; // '新技能' | '强化' 
  tagClass: string;
  desc: string;
  levelText: string;
  /** 武器触发方式徽章：'active' 主动 / 'auto' 自动；被动增益无此字段 */
  mode?: 'auto' | 'active';
}

const MAX_WEAPON_SLOTS = PROGRESSION.maxWeaponSlots;

export function generateChoices(
  player: Player,
  weapons: WeaponInstance[],
): Choice[] {
  const weaponLevels = new Map(weapons.map((w) => [w.defId, w.level]));

  // 新武器单独分组，便于前期对其做保底
  const newWeapons: Choice[] = [];
  const others: Choice[] = [];
  // 超武进化卡：满级且未进化的可进化武器，必定出现在本次三选一中
  const evolutions: Choice[] = [];
  for (const inst of weapons) {
    const def = getWeaponDef(inst.defId);
    if (def.evolve && inst.level >= def.maxLevel && !inst.evolved) {
      evolutions.push({
        type: 'evolve-weapon',
        id: def.id,
        name: def.evolve.name,
        icon: def.icon,
        tag: '超武进化',
        tagClass: 'tag-evo',
        desc: def.evolve.desc,
        levelText: `Lv.${def.maxLevel} → EX`,
        mode: def.mode ?? 'auto',
      });
    }
  }

  // Upgrade existing weapons
  for (const inst of weapons) {
    const def = getWeaponDef(inst.defId);
    if (inst.level < def.maxLevel) {
      others.push({
        type: 'upgrade-weapon',
        id: def.id,
        name: def.name,
        icon: def.icon,
        tag: '武器强化',
        tagClass: 'tag-up',
        desc: def.describe(inst.level + 1),
        levelText: `Lv.${inst.level} → ${inst.level + 1}`,
        mode: def.mode ?? 'auto',
      });
    }
  }

  // New weapons (if there is a free slot)
  if (weapons.length < MAX_WEAPON_SLOTS) {
    // 职业专属初始武器：其他职业的初始武器不进入抽卡池（职业身份独一无二）
    const own = CHARACTERS[player.charId].startingWeapon;
    const exclusive = new Set<string>();
    for (const c of Object.values(CHARACTERS)) {
      if (c.startingWeapon !== own) exclusive.add(c.startingWeapon);
    }
    // 每局只能拥有一个主动武器（避免右手操作过载）：已持有主动武器时不再提供新的主动武器
    const hasActive = weapons.some((w) => getWeaponDef(w.defId).mode === 'active');
    for (const def of WEAPON_DEFS) {
      if (weaponLevels.has(def.id) || exclusive.has(def.id)) continue;
      if (hasActive && def.mode === 'active') continue;
      newWeapons.push({
        type: 'new-weapon',
        id: def.id,
        name: def.name,
        icon: def.icon,
        tag: '新武器',
        tagClass: 'tag-weapon',
        desc: def.describe(1),
        levelText: '解锁 Lv.1',
        mode: def.mode ?? 'auto',
      });
    }
  }

  // Upgrade / learn passives
  for (const def of PASSIVE_DEFS) {
    const cur = player.passives.get(def.id) ?? 0;
    if (cur < def.maxLevel) {
      others.push({
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

  // 前期新武器保底（见 PROGRESSION.earlyBias）：首抽全新武器，前几级至少 min 个
  const n = PROGRESSION.choicesPerLevel;
  const eb = PROGRESSION.earlyBias;
  let minNew = 0;
  if (player.level <= eb.allNewUntil) minNew = n;
  else if (player.level <= eb.until) minNew = eb.min;
  minNew = Math.min(minNew, newWeapons.length);

  shuffle(newWeapons);
  // 组装：超武进化卡优先入选，其次前期新武器保底，余位随机补齐
  const result = evolutions.slice(0, n);
  for (const c of newWeapons.slice(0, minNew)) {
    if (result.length >= n) break;
    result.push(c);
  }
  const taken = new Set(result);
  const rest = [...others, ...newWeapons.filter((c) => !taken.has(c))];
  shuffle(rest);
  for (const c of rest) {
    if (result.length >= n) break;
    result.push(c);
  }
  shuffle(result); // 保底项不固定排在前面
  return result;
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export { dist };
