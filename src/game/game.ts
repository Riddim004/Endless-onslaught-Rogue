// Main game controller: state machine, update loop, collisions, progression.

import {
  Enemy,
  FloatingText,
  Gem,
  Particle,
  Player,
  Projectile,
  ProjectileKind,
  Destructible,
  createGem,
  createHeal,
  createPlayer,
  createProjectile,
} from './entities';
import { Input } from './input';
import { Renderer, Beam, Slash, slashGeometry, ChannelFx } from './renderer';
import { Spawner } from './spawner';
import { DestructibleField } from './destructibles';
import { SpatialGrid } from './spatial';
import { UI, TrainLoadoutItem } from './ui';
import { angleTo, clamp, pick, rand, formatTime } from './math';
import {
  Choice,
  WeaponContext,
  WeaponInstance,
  generateChoices,
  getWeaponDef,
  recomputeStats,
} from './skills';
import {
  PLAYER,
  XP_CURVE,
  DIFFICULTY,
  DESTRUCTIBLES,
  GAME_MODES,
  GameMode,
  MapId,
  CharacterId,
  CHARACTERS,
  PASSIVES,
  WEAPONS,
  PROGRESSION,
} from './config';
import { audio } from './audio';
import { meta, RunResult } from './meta';

type State = 'menu' | 'playing' | 'levelup' | 'paused' | 'gameover';

/** 可破坏道具在投射物 hit/rehit 集合中的 id 偏移，避免与敌人 id 冲突 */
const DEST_HIT_OFFSET = 1_000_000_000;

export class Game implements WeaponContext {
  private renderer: Renderer;
  private input: Input;
  private ui: UI;
  private spawner = new Spawner();
  private destructibleField = new DestructibleField();

  // WeaponContext members
  player!: Player;
  enemies: Enemy[] = [];

  projectiles: Projectile[] = [];
  gems: Gem[] = [];
  particles: Particle[] = [];
  texts: FloatingText[] = [];
  beams: Beam[] = [];
  slashes: Slash[] = [];
  weapons: WeaponInstance[] = [];
  /** 本帧持续引导灼烧区（湮灭引导激活时），每帧重置；targets 为超武选定目标位置 */
  private channelFx: ChannelFx | null = null;

  private state: State = 'menu';
  private gameMode: GameMode = 'endless';
  private mapId: MapId = 'forest';
  private charId: CharacterId = 'mage';
  private slashDir: 1 | -1 = 1; // 近战挥砍方向（逐次交替）
  /** 训练模式自选装备（非训练模式为 null） */
  private trainLoadout: TrainLoadoutItem[] | null = null;
  /** 本局是否进行中且尚未结算（防止重复发币/漏发币） */
  private runActive = false;
  /** 敌人空间哈希网格（每帧重建，供分离/碰撞/范围查询/最近搜索共用，见 spatial.ts） */
  private grid = new SpatialGrid();
  private kills = 0;
  private shake = 0;
  private pendingLevelUps = 0;
  private rerollsLeft = 0; // 整局剩余重随次数（开局重置为 PROGRESSION.maxRerolls）
  private lastTs = 0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new Renderer(canvas);
    this.input = new Input();
    this.ui = new UI(uiRoot);
    this.reset();
    this.showMenu();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------
  private reset(): void {
    this.player = createPlayer(0, 0, this.charId);
    this.enemies = [];
    this.projectiles = [];
    this.gems = [];
    this.particles = [];
    this.texts = [];
    this.beams = [];
    this.slashes = [];
    this.weapons = [];
    this.kills = 0;
    this.shake = 0;
    this.pendingLevelUps = 0;
    this.rerollsLeft = PROGRESSION.maxRerolls;
    this.spawner.reset();
    this.destructibleField.reset();
    recomputeStats(this.player);
    this.player.hp = this.player.stats.maxHp;
    // Starting weapons: training loadout if provided, otherwise the character's weapon.
    if (this.gameMode === 'training' && this.trainLoadout && this.trainLoadout.length > 0) {
      for (const item of this.trainLoadout) {
        const def = getWeaponDef(item.id);
        this.weapons.push({
          defId: item.id,
          level: Math.min(item.level, def.maxLevel),
          timer: 0,
          state: {},
          evolved: item.evolved,
        });
      }
    } else {
      this.addWeapon(CHARACTERS[this.charId].startingWeapon);
    }
  }

  /** 回到开始菜单（首次进入 / 结算后返回菜单共用） */
  private showMenu(): void {
    this.state = 'menu';
    audio.stopMusic();
    this.ui.setHudVisible(false);
    this.ui.showStart(
      (mode, map, char, loadout) => {
        this.trainLoadout = loadout;
        this.start(mode, this.resolveMap(map), char);
      },
      () => this.ui.showShop(() => this.showMenu()),
    );
  }

  /** 'random' 时从三张地图中随机取一（每局重随） */
  private resolveMap(map: MapId | 'random'): MapId {
    if (map === 'random') return pick<MapId>(['forest', 'village', 'ruins']);
    return map;
  }

  private start(mode: GameMode, map: MapId, char: CharacterId): void {
    this.gameMode = mode;
    this.mapId = map;
    this.charId = char;
    this.renderer.setMap(map);
    this.destructibleField.setMap(map);
    this.reset();
    this.state = 'playing';
    this.runActive = true;
    this.ui.setHudVisible(true);
    audio.startMusic();
  }

  private restart(): void {
    // 再来一局：沿用当前 gameMode / mapId
    this.renderer.setMap(this.mapId);
    this.destructibleField.setMap(this.mapId);
    this.reset();
    this.state = 'playing';
    this.runActive = true;
    this.ui.setHudVisible(true);
    audio.startMusic();
  }

  /**
   * 结算本局：发放货币与刷新最佳成绩，每局只生效一次（runActive 守卫）。
   * 死亡、限时胜利、中途退出三条路径共用，避免“退出就丢钱”。
   * （训练模式同样结算：它是隐藏开发者选项，普通玩家接触不到，无刷分风险。）
   */
  private settleRun(): RunResult {
    const zero = { earned: 0, rank: 0 };
    if (!this.runActive) return zero;
    this.runActive = false;
    return meta.recordRun(this.kills, this.spawner.time, this.player.level, this.charId, this.gameMode);
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

    if (this.state === 'menu') {
      // 菜单：渲染动态氛围背景（透过毛玻璃覆盖层显示），而非初始静态画面
      this.renderer.renderMenu(ts / 1000);
    } else {
      this.renderer.render({
        player: this.player,
        enemies: this.enemies,
        destructibles: this.destructibleField.active,
        projectiles: this.projectiles,
        gems: this.gems,
        particles: this.particles,
        texts: this.texts,
        beams: this.beams,
        slashes: this.slashes,
        aim: this.aimState(),
        channel: this.channelFx,
        time: this.spawner.time,
        shake: this.shake,
      });
    }

    if (this.state === 'playing') {
      this.ui.updateHud({
        hp: this.player.hp,
        maxHp: this.player.stats.maxHp,
        xp: this.player.xp,
        xpToNext: this.player.xpToNext,
        level: this.player.level,
        time: this.spawner.time,
        kills: this.kills,
        tray: this.weapons.map((w) => {
          const def = getWeaponDef(w.defId);
          return { icon: def.icon, level: w.level, mode: def.mode ?? 'auto', evolved: !!w.evolved };
        }),
        ...(this.gameMode === 'timed'
          ? { countdown: GAME_MODES.timed.duration - this.spawner.time }
          : {}),
      });
    }

    this.input.endFrame();
    requestAnimationFrame((t) => this.loop(t));
  }

  /** 训练模式：跳转游戏时钟并反馈新时间 */
  private scrubTime(delta: number): void {
    this.spawner.setTime(this.spawner.time + delta);
    this.addText(`时间 → ${formatTime(this.spawner.time)}`, this.player.x, this.player.y - 46, '#7df9ff', 18);
  }

  private handleGlobalKeys(): void {
    if (this.input.justPressed('m')) this.ui.toggleMute();
    // 训练模式：[ / ] 调整游戏时钟（±1 分钟），用于测试特定时间点的怪物强度
    if (this.gameMode === 'training' && this.state === 'playing') {
      if (this.input.justPressed('[')) this.scrubTime(-60);
      if (this.input.justPressed(']')) this.scrubTime(60);
    }
    if ((this.input.justPressed('p') || this.input.justPressed('escape'))) {
      if (this.state === 'playing') {
        this.state = 'paused';
        audio.duckMusic(true);
        this.ui.showPause(
          () => {
            this.state = 'playing';
            audio.duckMusic(false);
          },
          () => this.restart(),
          () => {
            this.settleRun(); // 中途退出也结算，保留本局已得货币与成绩
            this.showMenu();
          },
        );
      } else if (this.state === 'paused') {
        this.state = 'playing';
        audio.duckMusic(false);
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
    p.attackAnim = Math.max(0, p.attackAnim - dt);
    this.shake = Math.max(0, this.shake - dt * 40);

    // Weapons
    this.channelFx = null;
    for (const w of this.weapons) {
      getWeaponDef(w.defId).update(dt, this, w);
    }

    // Spawning (no alive cap by design — 无尽敌潮是核心爽感)
    const spawn = this.spawner.update(dt, p.x, p.y, this.renderer.width, this.renderer.height);
    for (const e of spawn.enemies) this.enemies.push(e);
    if (spawn.bossSpawned) {
      audio.bossWarn();
      this.shake = Math.max(this.shake, 14);
    }

    this.updateEnemies(dt);
    this.collideObstacles();
    this.updateDestructibles(dt);
    this.collideDestructibles();
    this.updateProjectiles(dt);
    this.updateGems(dt);
    this.updateParticles(dt);
    this.updateTexts(dt);
    this.updateBeams(dt);
    this.updateSlashes(dt);

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

    // 限时模式：存活满时长即获胜
    if (this.gameMode === 'timed' && this.spawner.time >= GAME_MODES.timed.duration) {
      this.gameOver(true);
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
    this.grid.rebuild(this.enemies);
    this.grid.separate(this.enemies);
  }

  // ------------------------------------------------------------------
  // 敌人空间哈希网格（实现见 spatial.ts）：每帧在 updateEnemies 内重建一次，
  // 分离 / 投射物碰撞 / 玩家碰撞 / 黑洞 / 最近搜索共用，避免全表扫描。
  // 保留下面这层薄封装，让各碰撞调用点无需感知 grid。
  // ------------------------------------------------------------------
  /** 遍历可能与圆 (x,y,r) 相交的敌人（已含敌人半径与位移宽容）；回调返回 true 时提前终止 */
  private forEachEnemyNear(x: number, y: number, r: number, fn: (e: Enemy) => boolean | void): void {
    this.grid.forEachNear(x, y, r, fn);
  }

  /**
   * 玩家与所有敌人（含踩踏事件 sweep 敌人与 Boss）对地图障碍物做圆形推离；
   * 投射物 / 经验宝石 / 粒子不受阻挡（保持武器手感）。
   * 在玩家移动与 grid.separate 之后调用；每个实体只查询自身附近格子的碰撞体。
   * 刷新在障碍物内的敌人也靠每帧推离自然挤出（1~2 帧内完成，不可感知）。
   */
  private collideObstacles(): void {
    const field = this.renderer.obstacles;
    field.collide(this.player, this.player.radius);
    for (const e of this.enemies) {
      field.collide(e, e.radius);
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
        // 飞刀在以玩家为圆心的固定巡游圆内乱飞（世界坐标，与窗口尺寸无关），
        // 碰到圆周按法线镜面反射弹回。
        if (pr.kind === 'knife') {
          const R = WEAPONS.dagger.roamRadius - pr.radius;
          const dx = pr.x - p.x;
          const dy = pr.y - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > R * R) {
            const d = Math.sqrt(d2) || 1;
            const nx = dx / d;
            const ny = dy / d;
            pr.x = p.x + nx * R;
            pr.y = p.y + ny * R;
            const dot = pr.vx * nx + pr.vy * ny;
            if (dot > 0) {
              pr.vx -= 2 * dot * nx;
              pr.vy -= 2 * dot * ny;
            }
            pr.angle = Math.atan2(pr.vy, pr.vx);
          }
        }
      }
      // Shockwave expands outward.
      if (pr.growth > 0) pr.radius += pr.growth * dt;
      // Black hole drags nearby enemies toward its center.
      if (pr.pull > 0) {
        const reach = pr.radius * 1.8;
        const reach2 = reach * reach;
        this.forEachEnemyNear(pr.x, pr.y, reach, (e) => {
          if (e.hp <= 0) return;
          const dx = pr.x - e.x;
          const dy = pr.y - e.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > reach2 || d2 < 1) return;
          const d = Math.sqrt(d2);
          const strength = pr.pull * (1 - d / reach);
          e.x += (dx / d) * strength * dt;
          e.y += (dy / d) * strength * dt;
        });
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
        if (g.heal) {
          p.hp = Math.min(p.stats.maxHp, p.hp + g.heal);
          this.addText(`+${g.heal}`, p.x, p.y - p.radius, '#7ee787', 15);
        } else {
          this.addXp(g.value);
        }
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

  private updateSlashes(dt: number): void {
    const alive: Slash[] = [];
    for (const sl of this.slashes) {
      sl.life -= dt;
      if (sl.life <= 0) continue;
      // 剑光存活期间持续判定：谁在已扫亮的刃光区里谁挨刀（每目标只结一次）
      if (sl.dmg) this.applySlashDamage(sl);
      alive.push(sl);
    }
    this.slashes = alive;
  }

  /** 剑光命中判定：与渲染共用 slashGeometry，视觉盖到哪、伤害就到哪 */
  private applySlashDamage(sl: Slash): void {
    const g = slashGeometry(sl);
    const swept = Math.abs(g.span);
    if (swept < 0.01) return;
    const tol = 0.06; // 刃缘宽容，避免擦边目标被判在外
    this.forEachEnemyNear(sl.x, sl.y, g.reach, (e) => {
      if (e.hp <= 0 || sl.hit!.has(e.id)) return;
      const dx = e.x - sl.x;
      const dy = e.y - sl.y;
      const rr = g.reach + e.radius;
      if (dx * dx + dy * dy > rr * rr) return;
      const rel = this.angleDelta(Math.atan2(dy, dx), g.a0) * sl.dir;
      if (rel >= -tol && rel <= swept + tol) {
        sl.hit!.add(e.id);
        this.damageEnemy(e, sl.dmg!, sl.x, sl.y, sl.knockback!);
      }
    });
    this.forEachDestructibleHit(sl.x, sl.y, g.reach, (d) => {
      const key = DEST_HIT_OFFSET + d.id;
      if (sl.hit!.has(key)) return;
      const rel = this.angleDelta(Math.atan2(d.cy - sl.y, d.cx - sl.x), g.a0) * sl.dir;
      if (rel >= -tol && rel <= swept + tol) {
        sl.hit!.add(key);
        this.damageDestructible(d, sl.dmg!);
      }
    });
  }

  // ------------------------------------------------------------------
  // Collisions
  // ------------------------------------------------------------------
  private collideProjectiles(): void {
    for (const pr of this.projectiles) {
      if (pr.kind === 'lightning') continue; // instant, handled at fire time
      // 网格范围查询代替全表扫描（原 O(投射物×敌人) 是主热点）
      this.forEachEnemyNear(pr.x, pr.y, pr.radius, (e) => {
        if (e.hp <= 0) return;
        const rr = (pr.radius + e.radius) ** 2;
        const d2 = (pr.x - e.x) ** 2 + (pr.y - e.y) ** 2;
        if (d2 > rr) return;

        if (pr.rehitInterval > 0) {
          // persistent (orbit / aura / frost / blackhole): re-hit on interval
          if (pr.rehit.has(e.id)) return;
          this.damageEnemy(e, pr.damage, pr.x, pr.y, pr.knockback);
          this.applyStatus(e, pr.slowMul, pr.slowDuration, pr.stunDuration);
          pr.rehit.set(e.id, pr.rehitInterval);
        } else {
          // single-hit / piercing
          if (pr.hit.has(e.id)) return;
          this.damageEnemy(e, pr.damage, pr.x, pr.y, pr.knockback);
          this.applyStatus(e, pr.slowMul, pr.slowDuration, pr.stunDuration);
          pr.hit.add(e.id);
          pr.pierceLeft -= 1;
          if (pr.pierceLeft <= 0) {
            pr.life = 0;
            return true; // 穿透耗尽，提前终止
          }
        }
      });
      if (pr.life <= 0) continue;
      // 投射物也打可破坏道具（穿过道具、不消耗穿透，避免道具替敌人挡弹）
      this.forEachDestructibleHit(pr.x, pr.y, pr.radius, (d) => {
        const key = DEST_HIT_OFFSET + d.id;
        if (pr.rehitInterval > 0) {
          if (pr.rehit.has(key)) return;
          this.damageDestructible(d, pr.damage);
          pr.rehit.set(key, pr.rehitInterval);
        } else {
          if (pr.hit.has(key)) return;
          this.damageDestructible(d, pr.damage);
          pr.hit.add(key);
        }
      });
    }
  }

  // ------------------------------------------------------------------
  // 可破坏道具
  // ------------------------------------------------------------------
  /** 遍历与圆 (x,y,r) 相交的存活道具（各战斗方法共用；回调返回 true 提前终止） */
  private forEachDestructibleHit(x: number, y: number, r: number, fn: (d: Destructible) => boolean | void): void {
    for (const d of this.destructibleField.active) {
      if (d.hp <= 0) continue;
      const dx = d.cx - x;
      const dy = d.cy - y;
      const rr = r + d.r;
      if (dx * dx + dy * dy > rr * rr) continue;
      if (fn(d)) return;
    }
  }

  /** 生成/剔除跟随玩家的道具，并衰减受击白闪 */
  private updateDestructibles(dt: number): void {
    this.destructibleField.update(this.player.x, this.player.y);
    for (const d of this.destructibleField.active) {
      if (d.hitFlash > 0) d.hitFlash = Math.max(0, d.hitFlash - dt);
    }
  }

  /** 道具仅阻挡玩家（敌人不受阻，避免堆积） */
  private collideDestructibles(): void {
    const p = this.player;
    for (const d of this.destructibleField.active) {
      if (d.hp <= 0) continue;
      const dx = p.x - d.cx;
      const dy = p.y - d.cy;
      const minD = p.radius + d.r;
      const d2 = dx * dx + dy * dy;
      if (d2 < minD * minD && d2 > 0.0001) {
        const dist = Math.sqrt(d2);
        p.x = d.cx + (dx / dist) * minD;
        p.y = d.cy + (dy / dist) * minD;
      }
    }
  }

  private damageDestructible(d: Destructible, dmg: number): void {
    if (d.hp <= 0) return;
    const crit = Math.random() < this.player.stats.critChance;
    const final = Math.max(1, Math.round(dmg * (crit ? this.player.stats.critMult : 1)));
    d.hp -= final;
    d.hitFlash = 0.09;
    if (crit) this.addText(String(final), d.cx, d.cy - d.r, '#ffd166', 20, true);
    else this.addText(String(final), d.cx, d.cy - d.r, '#ffffff', 12);
    if (d.hp <= 0) this.destroyDestructible(d);
  }

  /** 道具被打碎：碎裂粒子 + 小概率掉经验/血包/爆炸（各项独立判定） */
  private destroyDestructible(d: Destructible): void {
    const debris = this.mapId === 'ruins' ? '#8a7bff' : '#b58a4e';
    this.spawnParticles(d.cx, d.cy, debris, 14, 150);
    this.destructibleField.markDestroyed(d);
    const drop = DESTRUCTIBLES.drop;
    if (Math.random() < drop.xpChance) {
      this.gems.push(createGem(d.cx, d.cy, drop.xpValue));
    }
    if (Math.random() < drop.healChance) {
      this.gems.push(createHeal(d.cx + rand(-6, 6), d.cy + rand(-6, 6), drop.healAmount));
    }
    if (Math.random() < drop.explodeChance) {
      const start = 24;
      const life = 0.42;
      this.projectiles.push(
        createProjectile({
          kind: 'shock',
          x: d.cx,
          y: d.cy,
          radius: start,
          damage: drop.explodeDamage,
          pierceLeft: 9999,
          life,
          color: '#ffb454',
          knockback: drop.explodeKnockback,
          growth: (drop.explodeRadius - start) / life,
        }),
      );
      this.spawnParticles(d.cx, d.cy, '#ffcf87', 20, 220);
      this.shake = Math.max(this.shake, 8);
    }
  }

  private collidePlayer(_dt: number): void {
    const p = this.player;
    if (p.invuln > 0) return;
    this.forEachEnemyNear(p.x, p.y, p.radius, (e) => {
      if (e.hp <= 0) return;
      const rr = (p.radius + e.radius) ** 2;
      const d2 = (p.x - e.x) ** 2 + (p.y - e.y) ** 2;
      if (d2 < rr) {
        const reduction = p.stats.armor / (p.stats.armor + PASSIVES.armorDmgRatio * e.damage);
        const dmg = Math.max(1, Math.round(e.damage * (1 - reduction)));
        p.hp -= dmg;
        p.invuln = PLAYER.invulnTime;
        p.hurtFlash = 0.15;
        this.shake = 10;
        this.addText(`-${dmg}`, p.x, p.y - p.radius, '#ff6b6b', 16);
        this.spawnParticles(p.x, p.y, '#ff6b6b', 8, 120);
        return true; // 本帧只吃一次接触伤害
      }
    });
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

  nearestEnemy(x: number, y: number, exclude?: Set<number>, maxDist?: number): Enemy | null {
    return this.grid.nearest(x, y, exclude, maxDist);
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
    if (crit) {
      this.addText(String(final), e.x, e.y - e.radius, '#ffd166', 22, true);
    } else {
      this.addText(String(final), e.x, e.y - e.radius, '#ffffff', 13);
    }
    if (e.hp <= 0) this.killEnemy(e);
  }

  addBeam(x1: number, y1: number, x2: number, y2: number, color: string): void {
    this.beams.push({ x1, y1, x2, y2, color, life: 0.14, maxLife: 0.14 });
  }

  /** 鼠标位置换算到世界坐标（相机始终以玩家为中心，不计震屏偏移） */
  aimWorld(): { x: number; y: number } {
    return {
      x: this.player.x + (this.input.mouse.x - this.renderer.width / 2),
      y: this.player.y + (this.input.mouse.y - this.renderer.height / 2),
    };
  }

  fireJustPressed(): boolean {
    return this.input.clickJustPressed();
  }

  fireHeld(): boolean {
    return this.input.mouseIsDown();
  }

  /** 主动武器瞄准态：持有主动武器时返回准星位置与充能进度/颜色，供渲染准星；否则 null */
  private aimState(): { x: number; y: number; ready: boolean; charge: number; color: string } | null {
    const inst = this.weapons.find((w) => getWeaponDef(w.defId).mode === 'active');
    if (!inst) return null;
    const aim = this.aimWorld();
    if (inst.defId === 'laser') {
      const cd = WEAPONS.laser.cd[inst.level] / this.player.stats.attackSpeedMult;
      const charge = cd > 0 ? clamp(1 - inst.timer / cd, 0, 1) : 1;
      return { x: aim.x, y: aim.y, ready: inst.timer <= 0, charge, color: '#7df9ff' };
    }
    // 持续引导（湮灭引导）：准星反映充能槽；耗尽断线时显示回充进度；超武恒满
    if (inst.evolved) {
      return { x: aim.x, y: aim.y, ready: true, charge: 1, color: '#ff5a5a' };
    }
    const maxE = WEAPONS.channel.energyMax[inst.level];
    const energy = inst.state.energy ?? maxE;
    const locked = inst.state.locked === 1;
    return {
      x: aim.x,
      y: aim.y,
      ready: !locked && energy > 0,
      charge: clamp(energy / maxE, 0, 1),
      color: '#ff5a5a',
    };
  }

  /** 持续引导：标记本帧圆形灼烧区（供渲染），dealDamage 时结算一次区域伤害。
   *  maxTargets（超武）：取距圆心最近的至多 N 只敌人作为选定目标，
   *  选定目标位置每帧传给渲染层画凸包能量罩。 */
  channel(
    ax: number,
    ay: number,
    radius: number,
    dmg: number,
    knockback: number,
    dealDamage: boolean,
    maxTargets?: number,
  ): void {
    let targets: Enemy[] | null = null;
    if (maxTargets !== undefined) {
      // 收集圈内敌人，按距圆心排序取最近的 maxTargets 只
      const inRange: { e: Enemy; d2: number }[] = [];
      this.forEachEnemyNear(ax, ay, radius, (e) => {
        if (e.hp <= 0) return;
        const dx = e.x - ax;
        const dy = e.y - ay;
        const rr = radius + e.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 <= rr * rr) inRange.push({ e, d2 });
      });
      inRange.sort((a, b) => a.d2 - b.d2);
      targets = inRange.slice(0, maxTargets).map((t) => t.e);
    }
    this.channelFx = {
      x: ax,
      y: ay,
      radius,
      targets: targets ? targets.map((e) => ({ x: e.x, y: e.y })) : null,
    };
    if (dealDamage) {
      if (targets) {
        for (const e of targets) this.damageEnemy(e, dmg, ax, ay, knockback);
      } else {
        this.forEachEnemyNear(ax, ay, radius, (e) => {
          if (e.hp <= 0) return;
          const dx = e.x - ax;
          const dy = e.y - ay;
          const rr = radius + e.radius;
          if (dx * dx + dy * dy <= rr * rr) this.damageEnemy(e, dmg, ax, ay, knockback);
        });
      }
      // 道具不占目标名额，圈内照常灼烧
      this.forEachDestructibleHit(ax, ay, radius, (d) => this.damageDestructible(d, dmg));
      // 灼烧冲击粒子
      this.spawnParticles(ax + rand(-radius * 0.4, radius * 0.4), ay + rand(-radius * 0.4, radius * 0.4), '#ff6b5a', 4, 120);
    }
  }

  laserBlast(
    x: number,
    y: number,
    angle: number,
    range: number,
    halfWidth: number,
    dmg: number,
    knockback: number,
  ): void {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const x2 = x + dx * range;
    const y2 = y + dy * range;
    // 命中判定：点到线段距离 ≤ 光束半宽 + 目标半径（沿光束方向投影后钳制）
    const hitAlong = (ex: number, ey: number, er: number): boolean => {
      const px = ex - x;
      const py = ey - y;
      const t = clamp(px * dx + py * dy, 0, range);
      const cx = x + dx * t;
      const cy = y + dy * t;
      const rr = halfWidth + er;
      return (ex - cx) ** 2 + (ey - cy) ** 2 <= rr * rr;
    };
    this.forEachEnemyNear(x + dx * range * 0.5, y + dy * range * 0.5, range * 0.5 + halfWidth, (e) => {
      if (e.hp <= 0) return;
      if (hitAlong(e.x, e.y, e.radius)) {
        this.damageEnemy(e, dmg, e.x - dx * 10, e.y - dy * 10, knockback);
      }
    });
    for (const d of this.destructibleField.active) {
      if (d.hp > 0 && hitAlong(d.cx, d.cy, d.r)) this.damageDestructible(d, dmg);
    }
    // 光束特效（直线模式）+ 枪口/末端粒子 + 震屏
    this.beams.push({ x1: x, y1: y, x2, y2, color: '#7df9ff', life: 0.2, maxLife: 0.2, width: halfWidth * 2 });
    this.spawnParticles(x + dx * 30, y + dy * 30, '#bffcff', 6, 180);
    this.spawnParticles(x2, y2, '#7df9ff', 8, 160);
    this.shake = Math.max(this.shake, 6);
  }

  meleeSwing(
    x: number,
    y: number,
    angle: number,
    reach: number,
    arcHalf: number,
    dmg: number,
    knockback: number,
  ): void {
    // 逐次交替扫动方向，左右互斩更有挥砍感
    this.slashDir = this.slashDir === 1 ? -1 : 1;
    this.player.attackAnim = 0.2; // 触发挥剑动画
    this.player.attackDir = this.slashDir;
    this.player.attackAngle = angle; // 持剑朝向与剑气同源，避免“剑往前、剑气在后”
    // 剑光实体：伤害不在此处瞬时结算，而由 updateSlashes 随刃光扫过持续判定，
    // 避免“剑气看着能盖到但没伤害”的错位感。
    const sl: Slash = {
      x,
      y,
      angle,
      reach,
      arcHalf,
      dir: this.slashDir,
      life: 0.22,
      maxLife: 0.22,
      color: '#cfe6ff',
      dmg,
      knockback,
      hit: new Set<number>(),
    };
    this.slashes.push(sl);
    this.applySlashDamage(sl); // 首帧立即判一次，保证贴脸目标手感不延迟
    this.spawnParticles(
      x + Math.cos(angle) * reach * 0.8,
      y + Math.sin(angle) * reach * 0.8,
      '#dfe9ff',
      3,
      130,
    );
  }

  /** 两角度差归一化到 [-PI, PI] */
  private angleDelta(a: number, b: number): number {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
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
    if (e.kind === 'boss') {
      this.shake = 16;
      audio.bossDie();
    }
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
    if (this.state !== 'levelup') {
      audio.duckMusic(true);
    }
    this.state = 'levelup';
    this.presentChoices();
  }

  private presentChoices(): void {
    const choices = generateChoices(this.player, this.weapons);
    if (choices.length === 0) {
      // Nothing left to pick: refund as a small heal and continue.
      this.pendingLevelUps = 0;
      this.player.hp = Math.min(this.player.stats.maxHp, this.player.hp + 20);
      this.state = 'playing';
      audio.duckMusic(false);
      return;
    }
    const onReroll =
      this.rerollsLeft > 0
        ? () => {
            this.rerollsLeft -= 1;
            this.presentChoices();
          }
        : null;
    this.ui.showLevelUp(choices, (c) => this.applyChoice(c), onReroll, this.rerollsLeft);
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
      case 'evolve-weapon': {
        // 超武进化：质变而非加级，金色爆发庆祝
        const inst = this.weapons.find((w) => w.defId === c.id);
        if (inst) inst.evolved = true;
        this.spawnParticles(this.player.x, this.player.y, '#ffe9a8', 40, 320);
        this.shake = Math.max(this.shake, 10);
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
      audio.duckMusic(false);
    }
  }

  private addWeapon(id: string): void {
    this.weapons.push({ defId: id, level: 1, timer: 0, state: {} });
  }

  private gameOver(victory: boolean): void {
    this.state = 'gameover';
    audio.stopMusic();
    this.ui.setHudVisible(false);
    // 本局结算（发币+记录最佳，只生效一次）
    const run = this.settleRun();
    this.ui.showGameOver(
      { time: this.spawner.time, level: this.player.level, kills: this.kills, victory, run },
      () => this.restart(),
      () => this.showMenu(),
    );
  }

  // ------------------------------------------------------------------
  // FX helpers
  // ------------------------------------------------------------------
  private addText(text: string, x: number, y: number, color: string, size: number, crit = false): void {
    // cap floating texts to avoid clutter
    if (this.texts.length > 120) this.texts.shift();
    this.texts.push({ x: x + rand(-4, 4), y, vy: -40, life: 0.7, text, color, size, crit });
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
