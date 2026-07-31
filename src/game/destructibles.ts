// 可破坏道具管理器：确定性稀疏生成 + 靠近生成 / 远离剔除 + 摧毁持久记录。
//
// - 与障碍物系统一样按格子哈希确定性生成（不同盐值避免落点重合），每格 0~1 个道具。
// - 道具是游戏拥有的可变实体（有 HP），但为控制内存：远离玩家的从活动列表剔除，
//   未被摧毁者再次靠近时按同一格子哈希确定性重建（与障碍物"离屏即重建"一致）。
// - 已摧毁的格子记入 destroyed 集合，永不再生成（每局开始 reset 清空）。

import { MapId, DESTRUCTIBLES } from './config';
import { Destructible, createDestructible } from './entities';
import { cellSeed, makeRng } from './background';

/** 各地图道具哈希盐值（与障碍物 / 装饰物盐值错开） */
const D_SALT: Record<MapId, number> = { forest: 0x9e11, village: 0xa42d, ruins: 0xb7f5 };

export class DestructibleField {
  private mapId: MapId = 'forest';
  /** 活动道具：cellKey -> 实体（未摧毁、在剔除半径内） */
  private cells = new Map<string, Destructible>();
  /** 已摧毁格子，永不再生成 */
  private destroyed = new Set<string>();
  /** 供 game / renderer 每帧读取的活动道具列表 */
  active: Destructible[] = [];

  setMap(map: MapId): void {
    this.mapId = map;
    this.reset();
  }

  /** 每局开始清空所有状态 */
  reset(): void {
    this.cells.clear();
    this.destroyed.clear();
    this.active.length = 0;
  }

  /** 每帧推进：在玩家附近生成缺失道具，剔除过远道具，同步 active 列表 */
  update(playerX: number, playerY: number): void {
    const cell = DESTRUCTIBLES.cell;
    const spawn = DESTRUCTIBLES.cullRadius;
    const cx0 = Math.floor((playerX - spawn) / cell);
    const cy0 = Math.floor((playerY - spawn) / cell);
    const cx1 = Math.floor((playerX + spawn) / cell);
    const cy1 = Math.floor((playerY + spawn) / cell);
    // 生成范围内缺失的道具
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = `${cx},${cy}`;
        if (this.destroyed.has(key) || this.cells.has(key)) continue;
        const d = this.generate(cx, cy, key);
        if (d) this.cells.set(key, d);
      }
    }
    // 剔除过远或已被打碎（hp<=0）的道具
    const cullR2 = (spawn + cell) * (spawn + cell);
    for (const [key, d] of this.cells) {
      const dx = d.cx - playerX;
      const dy = d.cy - playerY;
      if (d.hp <= 0 || dx * dx + dy * dy > cullR2) this.cells.delete(key);
    }
    // 重建活动列表（数量小，直接展开）
    this.active.length = 0;
    for (const d of this.cells.values()) this.active.push(d);
  }

  /** 标记某道具已摧毁：记入 destroyed 并从活动集合移除，防止再生成 */
  markDestroyed(d: Destructible): void {
    this.destroyed.add(d.cellKey);
    this.cells.delete(d.cellKey);
  }

  private generate(cx: number, cy: number, key: string): Destructible | null {
    const rng = makeRng(cellSeed(cx, cy, D_SALT[this.mapId]));
    if (rng() >= DESTRUCTIBLES.chance) return null;
    const cell = DESTRUCTIBLES.cell;
    // 锚点向格中偏置（0.25~0.75），避免贴着格边生成
    const x = (cx + 0.25 + rng() * 0.5) * cell;
    const y = (cy + 0.25 + rng() * 0.5) * cell;
    // 出生安全区：原点附近不生成
    if (Math.hypot(x, y) < DESTRUCTIBLES.safeRadius) return null;
    const scale = 0.9 + rng() * 0.3;
    const type = rng() < 0.5 ? 0 : 1;
    const seed = Math.floor(rng() * 0x7fffffff);
    return createDestructible(key, type, x, y, scale, seed);
  }
}
