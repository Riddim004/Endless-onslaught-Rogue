// 敌人空间哈希网格。
//
// 每帧重建一次（game.updateEnemies 内），供分离 / 范围查询 / 最近搜索共用，
// 避免多处 O(投射物×敌人) 或 O(武器×敌人) 的全表扫描。
// key 用数字（而非 `${cx},${cy}` 字符串），消掉每帧大量临时字符串的 GC 压力。

import { Enemy } from './entities';

/** 无 maxDist 时最近搜索的兜底半径（像素）：覆盖屏幕 + 出怪边缘即可 */
const NEAREST_FALLBACK_RADIUS = 2000;

export class SpatialGrid {
  private readonly cell: number;
  /** 查询宽容：敌人最大半径（boss 44）+ 网格建成后分离/推离造成的位移 */
  private readonly slack: number;
  private cells = new Map<number, Enemy[]>();

  constructor(cell = 48, slack = 52) {
    this.cell = cell;
    this.slack = slack;
  }

  private key(cx: number, cy: number): number {
    return (cx + 32768) * 65536 + (cy + 32768);
  }

  /** 每帧重建：清空并按当前坐标重新装桶 */
  rebuild(enemies: Enemy[]): void {
    this.cells.clear();
    const cell = this.cell;
    for (const e of enemies) {
      const k = this.key(Math.floor(e.x / cell), Math.floor(e.y / cell));
      let arr = this.cells.get(k);
      if (!arr) this.cells.set(k, (arr = []));
      arr.push(e);
    }
  }

  /** 遍历可能与圆 (x,y,r) 相交的敌人（已含敌人半径与位移宽容）；回调返回 true 时提前终止 */
  forEachNear(x: number, y: number, r: number, fn: (e: Enemy) => boolean | void): void {
    const cell = this.cell;
    const reach = r + this.slack;
    const cx0 = Math.floor((x - reach) / cell);
    const cy0 = Math.floor((y - reach) / cell);
    const cx1 = Math.floor((x + reach) / cell);
    const cy1 = Math.floor((y + reach) / cell);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const arr = this.cells.get(this.key(cx, cy));
        if (!arr) continue;
        for (const e of arr) {
          if (fn(e)) return;
        }
      }
    }
  }

  /**
   * 最近敌人搜索（逐环外扩，保证返回真正最近者）：
   * - 跳过 hp<=0 与 exclude 集合中的敌人；
   * - maxDist 限制搜索半径（如闪电按射程用）；缺省用兜底半径，并以 ring 上限保证空场时不无限外扩。
   *
   * 正确性：位于第 r 环（Chebyshev 距离 r 格）的格子，其离查询点的最近距离 ≥ (r-1)*cell，
   * 故一旦已找到目标且 (r-1)*cell > 当前最优距离，更外的环不可能更近，可提前终止。
   */
  nearest(x: number, y: number, exclude?: Set<number>, maxDist = Infinity): Enemy | null {
    const cell = this.cell;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const limit = Number.isFinite(maxDist) ? maxDist : NEAREST_FALLBACK_RADIUS;
    const maxRing = Math.ceil(limit / cell) + 1;
    let best: Enemy | null = null;
    let bestD2 = Number.isFinite(maxDist) ? maxDist * maxDist : Infinity;
    for (let ring = 0; ring <= maxRing; ring++) {
      if (best && (ring - 1) * cell > Math.sqrt(bestD2)) break;
      for (let gx = cx - ring; gx <= cx + ring; gx++) {
        for (let gy = cy - ring; gy <= cy + ring; gy++) {
          // 只扫本环外圈（内部格子已在更小的 ring 处理过）
          if (ring > 0 && gx > cx - ring && gx < cx + ring && gy > cy - ring && gy < cy + ring) continue;
          const arr = this.cells.get(this.key(gx, gy));
          if (!arr) continue;
          for (const e of arr) {
            if (e.hp <= 0) continue;
            if (exclude && exclude.has(e.id)) continue;
            const d2 = (e.x - x) ** 2 + (e.y - y) ** 2;
            if (d2 < bestD2) {
              bestD2 = d2;
              best = e;
            }
          }
        }
      }
    }
    return best;
  }

  /** 轻量分离：让敌人不完全重叠（就地推离，读自身 3x3 邻域） */
  separate(enemies: Enemy[]): void {
    const cell = this.cell;
    for (const e of enemies) {
      const cx = Math.floor(e.x / cell);
      const cy = Math.floor(e.y / cell);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const arr = this.cells.get(this.key(cx + ox, cy + oy));
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
}
