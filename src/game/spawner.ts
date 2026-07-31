// Enemy spawning: waves that scale with elapsed time.

import { Enemy, EnemyKind, createEnemy } from './entities';
import { rand } from './math';
import { DIFFICULTY } from './config';

export interface SpawnResult {
  enemies: Enemy[];
  bossSpawned: boolean;
}

export class Spawner {
  private timer = 0;
  private clusterTimer = rand(DIFFICULTY.cluster.intervalMin, DIFFICULTY.cluster.intervalMax);
  private bossTimers = new Set<number>(); // minute marks already used
  time = 0;

  reset(): void {
    this.timer = 0;
    this.clusterTimer = rand(DIFFICULTY.cluster.intervalMin, DIFFICULTY.cluster.intervalMax);
    this.time = 0;
    this.bossTimers.clear();
  }

  /**
   * 直接跳转游戏时钟（训练模式测试特定时间点的怪物强度）。
   * 难度缩放由 this.time 驱动，改时间即改难度；
   * 将已过分钟标记为已用，避免前跳时一次性补刷多个 Boss。
   */
  setTime(t: number): void {
    this.time = Math.max(0, t);
    this.timer = 0; // 新难度下尽快出下一波
    this.bossTimers.clear();
    const passed = Math.floor(this.time / DIFFICULTY.bossIntervalSeconds);
    for (let m = 1; m <= passed; m++) this.bossTimers.add(m);
  }

  /** 0..1 progress toward the difficulty caps (reached at rampSeconds). */
  private ramp(): number {
    return Math.min(1, this.time / DIFFICULTY.rampSeconds);
  }

  /** 满 ramp 之后的类指数后期增长：每分钟复利 ×rate（之前恒为 1） */
  private lateMul(rate: number): number {
    const over = this.time - DIFFICULTY.rampSeconds;
    if (over <= 0) return 1;
    return Math.pow(rate, over / 60);
  }

  /** Enemy HP: linear ramp up to hpMaxScale, then compounding late growth. */
  private hpScale(): number {
    return (1 + (DIFFICULTY.hpMaxScale - 1) * this.ramp()) * this.lateMul(DIFFICULTY.lateGrowth.hpPerMinute);
  }

  /** Enemy move speed scales gradually up to speedMaxScale. */
  private speedScale(): number {
    return 1 + (DIFFICULTY.speedMaxScale - 1) * this.ramp();
  }

  /** Enemy damage: linear ramp up to dmgMaxScale, then mild compounding late growth. */
  private dmgScale(): number {
    return (1 + (DIFFICULTY.dmgMaxScale - 1) * this.ramp()) * this.lateMul(DIFFICULTY.lateGrowth.dmgPerMinute);
  }

  /** Seconds between spawn ticks; spawn rate ramps up to spawnRateMax over time. */
  private spawnInterval(): number {
    return DIFFICULTY.spawnBaseInterval / (1 + (DIFFICULTY.spawnRateMax - 1) * this.ramp());
  }

  /** How many enemies per tick (grows a little over time, then holds). */
  private batchSize(): number {
    return 1 + Math.min(DIFFICULTY.batchMax - 1, Math.floor(this.time / DIFFICULTY.batchStepSeconds));
  }

  private weightedKind(): EnemyKind {
    const t = this.time;
    const weights: [EnemyKind, number][] = [
      ['walker', 10],
      ['fast', t > 25 ? 7 : 0],
      ['brute', t > 60 ? 6 : 0],
      ['tank', t > 100 ? 4 : 0],
    ];
    const total = weights.reduce((s, w) => s + w[1], 0);
    let r = rand(0, total);
    for (const [kind, w] of weights) {
      r -= w;
      if (r <= 0) return kind;
    }
    return 'walker';
  }

  update(
    dt: number,
    playerX: number,
    playerY: number,
    viewW: number,
    viewH: number,
  ): SpawnResult {
    this.time += dt;
    this.timer -= dt;
    const result: SpawnResult = { enemies: [], bossSpawned: false };

    // Boss every bossIntervalSeconds.
    const minute = Math.floor(this.time / DIFFICULTY.bossIntervalSeconds);
    if (minute >= 1 && !this.bossTimers.has(minute)) {
      this.bossTimers.add(minute);
      const { x, y } = this.spawnPoint(playerX, playerY, viewW, viewH);
      // Boss 血量：逐只线性递增，后期另吃类指数增长（与小怪同步膨胀，避免相对变脆）
      const bossHp = (1 + (minute - 1) * DIFFICULTY.bossHpStepPerMinute) * this.lateMul(DIFFICULTY.lateGrowth.hpPerMinute);
      const boss = createEnemy('boss', x, y, bossHp, 1, this.dmgScale());
      result.enemies.push(boss);
      result.bossSpawned = true;
    }

    if (this.timer <= 0) {
      this.timer = this.spawnInterval();
      const n = this.batchSize();
      const hp = this.hpScale();
      const spd = this.speedScale();
      const dmg = this.dmgScale();
      for (let i = 0; i < n; i++) {
        const { x, y } = this.spawnPoint(playerX, playerY, viewW, viewH);
        result.enemies.push(createEnemy(this.weightedKind(), x, y, hp, spd, dmg));
      }
    }

    // Occasional stampede: a dense cluster of enemies sweeps across the screen.
    this.clusterTimer -= dt;
    if (this.clusterTimer <= 0) {
      this.clusterTimer = rand(DIFFICULTY.cluster.intervalMin, DIFFICULTY.cluster.intervalMax);
      this.spawnCluster(playerX, playerY, viewW, viewH, result);
    }

    return result;
  }

  /** Spawn a blob of 50–100 enemies that stampede straight across the screen. */
  private spawnCluster(
    px: number,
    py: number,
    viewW: number,
    viewH: number,
    result: SpawnResult,
  ): void {
    const count = Math.floor(rand(DIFFICULTY.cluster.countMin, DIFFICULTY.cluster.countMax));
    const margin = 140;
    const halfW = viewW / 2;
    const halfH = viewH / 2;
    const speed = rand(DIFFICULTY.cluster.speedMin, DIFFICULTY.cluster.speedMax);
    const horizontal = Math.random() < 0.5;
    let dirX = 0;
    let dirY = 0;
    let baseX = 0;
    let baseY = 0;
    if (horizontal) {
      dirX = Math.random() < 0.5 ? 1 : -1;
      baseX = px - dirX * (halfW + margin); // enter from the far edge
      baseY = py + rand(-halfH * 0.5, halfH * 0.5);
    } else {
      dirY = Math.random() < 0.5 ? 1 : -1;
      baseY = py - dirY * (halfH + margin);
      baseX = px + rand(-halfW * 0.5, halfW * 0.5);
    }
    // Enough time to fully cross the view, then they revert to chasing.
    const crossDist = (horizontal ? viewW : viewH) + margin * 2 + 320;
    const sweepTime = crossDist / speed;
    const hp = this.hpScale();
    const spd = this.speedScale();
    const dmg = this.dmgScale();
    for (let i = 0; i < count; i++) {
      const sx = baseX + rand(-170, 170);
      const sy = baseY + rand(-170, 170);
      const kind: EnemyKind = Math.random() < 0.7 ? 'walker' : 'fast';
      const e = createEnemy(kind, sx, sy, hp, spd, dmg);
      e.sweepVx = dirX * speed;
      e.sweepVy = dirY * speed;
      e.sweepTimer = sweepTime;
      result.enemies.push(e);
    }
  }

  /** Pick a point just outside the visible view around the player. */
  private spawnPoint(px: number, py: number, viewW: number, viewH: number): { x: number; y: number } {
    const margin = 60;
    const halfW = viewW / 2 + margin;
    const halfH = viewH / 2 + margin;
    const side = Math.floor(rand(0, 4));
    switch (side) {
      case 0: // top
        return { x: px + rand(-halfW, halfW), y: py - halfH };
      case 1: // bottom
        return { x: px + rand(-halfW, halfW), y: py + halfH };
      case 2: // left
        return { x: px - halfW, y: py + rand(-halfH, halfH) };
      default: // right
        return { x: px + halfW, y: py + rand(-halfH, halfH) };
    }
  }
}
