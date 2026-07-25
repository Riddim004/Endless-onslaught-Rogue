// Main game controller: state machine, update loop, collisions, progression.

import {
  Enemy,
  FloatingText,
  Gem,
  Particle,
  Player,
  Projectile,
  ProjectileKind,
  createGem,
  createPlayer,
} from './entities';
import { Input } from './input';
import { Renderer, Beam } from './renderer';
import { Spawner } from './spawner';
import { UI } from './ui';
import { angleTo, clamp, rand } from './math';
import {
  Choice,
  WeaponContext,
  WeaponInstance,
  generateChoices,
  getWeaponDef,
  recomputeStats,
} from './skills';
import { PLAYER, XP_CURVE, DIFFICULTY } from './config';

type State = 'menu' | 'playing' | 'levelup' | 'paused' | 'gameover';

export class Game implements WeaponContext {
  private renderer: Renderer;
  private input: Input;
  private ui: UI;
  private spawner = new Spawner();

  // WeaponContext members
  player!: Player;
  enemies: Enemy[] = [];

  projectiles: Projectile[] = [];
  gems: Gem[] = [];
  particles: Particle[] = [];
  texts: FloatingText[] = [];
  beams: Beam[] = [];
  weapons: WeaponInstance[] = [];

  private state: State = 'menu';
  private kills = 0;
  private shake = 0;
  private pendingLevelUps = 0;
  private rerollAvailable = true;
  private lastTs = 0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new Renderer(canvas);
    this.input = new Input();
    this.ui = new UI(uiRoot);
    this.reset();
    this.ui.showStart(() => this.start());
    requestAnimationFrame((t) => this.loop(t));
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------
  private reset(): void {
    this.player = createPlayer(0, 0);
    this.enemies = [];
    this.projectiles = [];
    this.gems = [];
    this.particles = [];
    this.texts = [];
    this.beams = [];
    this.weapons = [];
    this.kills = 0;
    this.shake = 0;
    this.pendingLevelUps = 0;
    this.spawner.reset();
    recomputeStats(this.player);
    this.player.hp = this.player.stats.maxHp;
    // Starting weapon.
    this.addWeapon('bolt');
  }

  private start(): void {
    this.reset();
    this.state = 'playing';
    this.ui.setHudVisible(true);
  }

  private restart(): void {
    this.reset();
    this.state = 'playing';
    this.ui.setHudVisible(true);
  }

  // ------------------------------------------------------------------
  // Main loop
  // ------------------------------------------------------------------
  private loop(ts: number): void {
    const dtRaw = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    const dt = clamp(dtRaw || 0, 0, 1 / 20); // clamp to avoid huge steps

    this.handleGlobalKeys();

    if (this.state === 'playing') {
      this.update(dt);
    }

    this.renderer.render({
      player: this.player,
      enemies: this.enemies,
      projectiles: this.projectiles,
      gems: this.gems,
      particles: this.particles,
      texts: this.texts,
      beams: this.beams,
      time: this.spawner.time,
      shake: this.shake,
    });

    if (this.state === 'playing') {
      this.ui.updateHud({
        hp: this.player.hp,
        maxHp: this.player.stats.maxHp,
        xp: this.player.xp,
        xpToNext: this.player.xpToNext,
        level: this.player.level,
        time: this.spawner.time,
        kills: this.kills,
        tray: this.weapons.map((w) => ({ icon: getWeaponDef(w.defId).icon, level: w.level })),
      });
    }

    this.input.endFrame();
    requestAnimationFrame((t) => this.loop(t));
  }

  private handleGlobalKeys(): void {
    if ((this.input.justPressed('p') || this.input.justPressed('escape'))) {
      if (this.state === 'playing') {
        this.state = 'paused';
        this.ui.showPause(
          () => {
            this.state = 'playing';
          },
          () => this.restart(),
        );
      } else if (this.state === 'paused') {
        this.state = 'playing';
        this.ui.hidePause();
      }
    }
  }

  // ------------------------------------------------------------------
  // Update
  // ------------------------------------------------------------------
  private update(dt: number): void {
    const p = this.player;

    // Movement
    const axis = this.input.moveAxis();
    if (axis.x !== 0 || axis.y !== 0) {
      p.facing.x = axis.x;
      p.facing.y = axis.y;
    }
    p.x += axis.x * p.stats.moveSpeed * dt;
    p.y += axis.y * p.stats.moveSpeed * dt;

    // Regen & timers
    if (p.stats.regen > 0 && p.hp < p.stats.maxHp) {
      p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.regen * dt);
    }
    p.invuln = Math.max(0, p.invuln - dt);
    p.hurtFlash = Math.max(0, p.hurtFlash - dt);
    this.shake = Math.max(0, this.shake - dt * 40);

    // Weapons
    for (const w of this.weapons) {
      getWeaponDef(w.defId).update(dt, this, w);
    }

    // Spawning (no alive-enemy cap)
    const spawn = this.spawner.update(dt, p.x, p.y, this.renderer.width, this.renderer.height);
    for (const e of spawn.enemies) this.enemies.push(e);

    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updateGems(dt);
    this.updateParticles(dt);
    this.updateTexts(dt);
    this.updateBeams(dt);

    this.collideProjectiles();
    this.collidePlayer(dt);

    // cull dead enemies
    if (this.enemies.some((e) => e.hp <= 0)) {
      this.enemies = this.enemies.filter((e) => e.hp > 0);
    }

    // Lose (no time limit — survive as long as you can)
    if (p.hp <= 0) {
      this.gameOver(false);
      return;
    }

    // Queued level ups
    if (this.pendingLevelUps > 0) {
      this.openLevelUp();
    }
  }

  private updateEnemies(dt: number): void {
    const p = this.player;
    for (const e of this.enemies) {
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.contactCd = Math.max(0, e.contactCd - dt);
      e.wobble += dt * 6;
      // status effects
      if (e.stunTimer > 0) e.stunTimer = Math.max(0, e.stunTimer - dt);
      if (e.slowTimer > 0) {
        e.slowTimer -= dt;
        if (e.slowTimer <= 0) e.slowMul = 1;
      }
      // knockback decay (still applies while stunned)
      e.x += e.kx * dt;
      e.y += e.ky * dt;
      e.kx *= 0.86;
      e.ky *= 0.86;
      // chase player (blocked while stunned, reduced while slowed)
      if (e.stunTimer <= 0) {
        const mul = e.slowTimer > 0 ? e.slowMul : 1;
        if (e.sweepTimer > 0) {
          // Cluster stampede: move in a fixed direction across the screen.
          e.sweepTimer -= dt;
          e.x += e.sweepVx * mul * dt;
          e.y += e.sweepVy * mul * dt;
        } else {
          const spd = e.speed * mul;
          const ang = angleTo(e.x, e.y, p.x, p.y);
          e.x += Math.cos(ang) * spd * dt;
          e.y += Math.sin(ang) * spd * dt;
        }
      }
    }
    this.separateEnemies();
  }

  /** Light grid-based separation so enemies don't fully overlap. */
  private separateEnemies(): void {
    const cell = 48;
    const grid = new Map<string, Enemy[]>();
    const key = (cx: number, cy: number) => `${cx},${cy}`;
    for (const e of this.enemies) {
      const cx = Math.floor(e.x / cell);
      const cy = Math.floor(e.y / cell);
      const k = key(cx, cy);
      let arr = grid.get(k);
      if (!arr) grid.set(k, (arr = []));
      arr.push(e);
    }
    for (const e of this.enemies) {
      const cx = Math.floor(e.x / cell);
      const cy = Math.floor(e.y / cell);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const arr = grid.get(key(cx + ox, cy + oy));
          if (!arr) continue;
          for (const o of arr) {
            if (o === e) continue;
            const dx = e.x - o.x;
            const dy = e.y - o.y;
            const minD = e.radius + o.radius;
            const d2 = dx * dx + dy * dy;
            if (d2 > 0 && d2 < minD * minD) {
              const d = Math.sqrt(d2);
              const push = (minD - d) * 0.5;
              const nx = dx / d;
              const ny = dy / d;
              e.x += nx * push;
              e.y += ny * push;
              o.x -= nx * push;
              o.y -= ny * push;
            }
          }
        }
      }
    }
  }

  private updateProjectiles(dt: number): void {
    const p = this.player;
    const alive: Projectile[] = [];
    for (const pr of this.projectiles) {
      if (pr.orbit) {
        pr.orbit.angle += pr.orbit.speed * dt;
        pr.x = p.x + Math.cos(pr.orbit.angle) * pr.orbit.radius;
        pr.y = p.y + Math.sin(pr.orbit.angle) * pr.orbit.radius;
      } else if (pr.follow) {
        pr.x = p.x;
        pr.y = p.y;
      } else {
        pr.x += pr.vx * dt;
        pr.y += pr.vy * dt;
        // Summoned knives roam the screen, bouncing off its edges.
        if (pr.kind === 'knife') {
          const halfW = this.renderer.width / 2 - pr.radius;
          const halfH = this.renderer.height / 2 - pr.radius;
          if (pr.x < p.x - halfW) { pr.x = p.x - halfW; pr.vx = Math.abs(pr.vx); }
          else if (pr.x > p.x + halfW) { pr.x = p.x + halfW; pr.vx = -Math.abs(pr.vx); }
          if (pr.y < p.y - halfH) { pr.y = p.y - halfH; pr.vy = Math.abs(pr.vy); }
          else if (pr.y > p.y + halfH) { pr.y = p.y + halfH; pr.vy = -Math.abs(pr.vy); }
          pr.angle = Math.atan2(pr.vy, pr.vx);
        }
      }
      // Shockwave expands outward.
      if (pr.growth > 0) pr.radius += pr.growth * dt;
      // Black hole drags nearby enemies toward its center.
      if (pr.pull > 0) {
        const reach = pr.radius * 1.8;
        const reach2 = reach * reach;
        for (const e of this.enemies) {
          if (e.hp <= 0) continue;
          const dx = pr.x - e.x;
          const dy = pr.y - e.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > reach2 || d2 < 1) continue;
          const d = Math.sqrt(d2);
          const strength = pr.pull * (1 - d / reach);
          e.x += (dx / d) * strength * dt;
          e.y += (dy / d) * strength * dt;
        }
      }
      // decrement re-hit cooldowns
      if (pr.rehitInterval > 0 && pr.rehit.size) {
        for (const [id, cd] of pr.rehit) {
          const n = cd - dt;
          if (n <= 0) pr.rehit.delete(id);
          else pr.rehit.set(id, n);
        }
      }
      pr.life -= dt;
      if (pr.life > 0) alive.push(pr);
    }
    this.projectiles = alive;
  }

  private updateGems(dt: number): void {
    const p = this.player;
    const pr2 = p.stats.pickupRadius * p.stats.pickupRadius;
    const remaining: Gem[] = [];
    for (const g of this.gems) {
      const d2 = (g.x - p.x) ** 2 + (g.y - p.y) ** 2;
      if (g.pulled || d2 < pr2) {
        g.pulled = true;
        const ang = angleTo(g.x, g.y, p.x, p.y);
        const speed = 380;
        g.x += Math.cos(ang) * speed * dt;
        g.y += Math.sin(ang) * speed * dt;
      }
      if (d2 < (p.radius + 6) ** 2) {
        this.addXp(g.value);
      } else {
        remaining.push(g);
      }
    }
    this.gems = remaining;
  }

  private updateParticles(dt: number): void {
    const alive: Particle[] = [];
    for (const pt of this.particles) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.9;
      pt.vy *= 0.9;
      pt.life -= dt;
      if (pt.life > 0) alive.push(pt);
    }
    this.particles = alive;
  }

  private updateTexts(dt: number): void {
    const alive: FloatingText[] = [];
    for (const t of this.texts) {
      t.y += t.vy * dt;
      t.vy *= 0.92;
      t.life -= dt;
      if (t.life > 0) alive.push(t);
    }
    this.texts = alive;
  }

  private updateBeams(dt: number): void {
    const alive: Beam[] = [];
    for (const b of this.beams) {
      b.life -= dt;
      if (b.life > 0) alive.push(b);
    }
    this.beams = alive;
  }

  // ------------------------------------------------------------------
  // Collisions
  // ------------------------------------------------------------------
  private collideProjectiles(): void {
    for (const pr of this.projectiles) {
      if (pr.kind === 'lightning') continue; // instant, handled at fire time
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        const rr = (pr.radius + e.radius) ** 2;
        const d2 = (pr.x - e.x) ** 2 + (pr.y - e.y) ** 2;
        if (d2 > rr) continue;

        if (pr.rehitInterval > 0) {
          // persistent (orbit / aura / frost / blackhole): re-hit on interval
          if (pr.rehit.has(e.id)) continue;
          this.damageEnemy(e, pr.damage, pr.x, pr.y, pr.knockback);
          this.applyStatus(e, pr.slowMul, pr.slowDuration, pr.stunDuration);
          pr.rehit.set(e.id, pr.rehitInterval);
        } else {
          // single-hit / piercing
          if (pr.hit.has(e.id)) continue;
          this.damageEnemy(e, pr.damage, pr.x, pr.y, pr.knockback);
          this.applyStatus(e, pr.slowMul, pr.slowDuration, pr.stunDuration);
          pr.hit.add(e.id);
          pr.pierceLeft -= 1;
          if (pr.pierceLeft <= 0) {
            pr.life = 0;
            break;
          }
        }
      }
    }
  }

  private collidePlayer(_dt: number): void {
    const p = this.player;
    if (p.invuln > 0) return;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const rr = (p.radius + e.radius) ** 2;
      const d2 = (p.x - e.x) ** 2 + (p.y - e.y) ** 2;
      if (d2 < rr) {
        const dmg = Math.max(1, e.damage - p.stats.armor);
        p.hp -= dmg;
        p.invuln = PLAYER.invulnTime;
        p.hurtFlash = 0.15;
        this.shake = 10;
        this.addText(`-${dmg}`, p.x, p.y - p.radius, '#ff6b6b', 16);
        this.spawnParticles(p.x, p.y, '#ff6b6b', 8, 120);
        break;
      }
    }
  }

  // ------------------------------------------------------------------
  // WeaponContext implementation
  // ------------------------------------------------------------------
  spawnProjectile(pr: Projectile): void {
    this.projectiles.push(pr);
  }

  clearProjectiles(kind: ProjectileKind): void {
    this.projectiles = this.projectiles.filter((p) => p.kind !== kind);
  }

  nearestEnemy(x: number, y: number, exclude?: Set<number>): Enemy | null {
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      if (exclude && exclude.has(e.id)) continue;
      const d2 = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d2 < bestD) {
        bestD = d2;
        best = e;
      }
    }
    return best;
  }

  damageEnemy(e: Enemy, dmg: number, fromX: number, fromY: number, knockback: number): void {
    if (e.hp <= 0) return;
    const crit = Math.random() < this.player.stats.critChance;
    const final = Math.max(1, Math.round(dmg * (crit ? this.player.stats.critMult : 1)));
    e.hp -= final;
    e.hitFlash = 0.09;
    const ang = angleTo(fromX, fromY, e.x, e.y);
    e.kx += Math.cos(ang) * knockback;
    e.ky += Math.sin(ang) * knockback;
    this.addText(String(final), e.x, e.y - e.radius, crit ? '#ffd166' : '#ffffff', crit ? 18 : 13);
    if (e.hp <= 0) this.killEnemy(e);
  }

  addBeam(x1: number, y1: number, x2: number, y2: number, color: string): void {
    this.beams.push({ x1, y1, x2, y2, color, life: 0.14, maxLife: 0.14 });
  }

  applyStatus(e: Enemy, slowMul: number, slowDuration: number, stunDuration: number): void {
    if (e.hp <= 0) return;
    // Bosses are only lightly affected by control.
    const resist = e.kind === 'boss' ? DIFFICULTY.controlResistBoss : 1;
    if (slowDuration > 0 && slowMul < 1) {
      const strength = 1 - (1 - slowMul) * resist; // weaker slow on bosses
      e.slowMul = Math.min(e.slowMul, strength); // strongest slow wins
      e.slowTimer = Math.max(e.slowTimer, slowDuration);
    }
    if (stunDuration > 0) {
      e.stunTimer = Math.max(e.stunTimer, stunDuration * resist);
    }
  }

  // ------------------------------------------------------------------
  // Death, XP, level up
  // ------------------------------------------------------------------
  private killEnemy(e: Enemy): void {
    this.kills++;
    this.spawnParticles(e.x, e.y, e.color, e.kind === 'boss' ? 40 : 10, 160);
    if (e.kind === 'boss') this.shake = 16;
    // Drop XP. Bosses drop a big cluster.
    if (e.kind === 'boss') {
      for (let i = 0; i < 8; i++) {
        this.gems.push(createGem(e.x + rand(-30, 30), e.y + rand(-30, 30), Math.ceil(e.xpValue / 8)));
      }
    } else {
      this.gems.push(createGem(e.x, e.y, e.xpValue));
    }
  }

  private addXp(amount: number): void {
    const p = this.player;
    p.xp += amount * p.stats.xpMult;
    while (p.xp >= p.xpToNext) {
      p.xp -= p.xpToNext;
      p.level++;
      p.xpToNext = this.xpForLevel(p.level);
      this.pendingLevelUps++;
    }
  }

  private xpForLevel(level: number): number {
    // Flatter curve so players level up frequently and keep picking skills.
    return Math.floor(XP_CURVE.base + level * XP_CURVE.linear + level * level * XP_CURVE.quad);
  }

  private openLevelUp(): void {
    this.state = 'levelup';
    this.rerollAvailable = true; // one free re-roll per level-up
    this.presentChoices();
  }

  private presentChoices(): void {
    const choices = generateChoices(this.player, this.weapons);
    if (choices.length === 0) {
      // Nothing left to pick: refund as a small heal and continue.
      this.pendingLevelUps = 0;
      this.player.hp = Math.min(this.player.stats.maxHp, this.player.hp + 20);
      this.state = 'playing';
      return;
    }
    const onReroll = this.rerollAvailable
      ? () => {
          this.rerollAvailable = false;
          this.presentChoices();
        }
      : null;
    this.ui.showLevelUp(choices, (c) => this.applyChoice(c), onReroll);
  }

  private applyChoice(c: Choice): void {
    switch (c.type) {
      case 'new-weapon':
        this.addWeapon(c.id);
        break;
      case 'upgrade-weapon': {
        const inst = this.weapons.find((w) => w.defId === c.id);
        if (inst) inst.level++;
        break;
      }
      case 'new-passive':
      case 'upgrade-passive': {
        const cur = this.player.passives.get(c.id) ?? 0;
        this.player.passives.set(c.id, cur + 1);
        recomputeStats(this.player);
        break;
      }
    }
    this.spawnParticles(this.player.x, this.player.y, '#ffd166', 24, 200);
    this.pendingLevelUps--;
    if (this.pendingLevelUps > 0) {
      this.openLevelUp();
    } else {
      this.state = 'playing';
    }
  }

  private addWeapon(id: string): void {
    this.weapons.push({ defId: id, level: 1, timer: 0, state: {} });
  }

  private gameOver(victory: boolean): void {
    this.state = 'gameover';
    this.ui.setHudVisible(false);
    this.ui.showGameOver(
      { time: this.spawner.time, level: this.player.level, kills: this.kills, victory },
      () => this.restart(),
    );
  }

  // ------------------------------------------------------------------
  // FX helpers
  // ------------------------------------------------------------------
  private addText(text: string, x: number, y: number, color: string, size: number): void {
    // cap floating texts to avoid clutter
    if (this.texts.length > 120) this.texts.shift();
    this.texts.push({ x: x + rand(-4, 4), y, vy: -40, life: 0.7, text, color, size });
  }

  private spawnParticles(x: number, y: number, color: string, count: number, speed: number): void {
    if (this.particles.length > 400) return;
    for (let i = 0; i < count; i++) {
      const ang = rand(0, Math.PI * 2);
      const s = rand(speed * 0.3, speed);
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * s,
        vy: Math.sin(ang) * s,
        life: rand(0.3, 0.6),
        maxLife: 0.6,
        size: rand(2, 4),
        color,
      });
    }
  }
}
