// Procedural map backgrounds: cached base tiles + deterministic decoration layer.
//
// - 底层瓦片：每个地图首次使用时用离屏 canvas 预渲染 512×512 底纹（底色 + 噪点 + 淡网格），
//   运行时按世界坐标对齐平铺，开销极低。
// - 装饰物层：以 256px 为格子，用格子坐标确定性哈希派生种子，每格生成 0~2 个装饰物，
//   同一位置每次经过完全一致；只绘制视口内格子。
// - 性能约束：不使用 shadowBlur，只用 fillRect / arc / 线段 / 渐变等基础调用。

import { MAPS, MapDef, MapId } from './config';

const TILE = 512; // 底纹瓦片尺寸
const CELL = 256; // 装饰物格子尺寸

/** 各地图掺入种子的盐值，避免不同地图装饰落点完全重合 */
const MAP_SALT: Record<MapId, number> = { forest: 0x1f0a, village: 0x2b17, ruins: 0x3c2e };

/** 由格子坐标派生确定性种子（obstacles.ts 复用，掺不同盐值） */
export function cellSeed(cx: number, cy: number, salt: number): number {
  return ((((cx * 73856093) ^ (cy * 19349663)) >>> 0) ^ salt) >>> 0;
}

/** mulberry32：由种子生成 [0,1) 伪随机序列，同种子序列恒定（obstacles.ts 复用） */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MapBackground {
  private mapId: MapId = 'forest';
  private tiles = new Map<MapId, HTMLCanvasElement>();

  setMap(map: MapId): void {
    this.mapId = map;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    w: number,
    h: number,
    time: number,
  ): void {
    // 底纹瓦片平铺（按世界坐标对齐）
    const tile = this.getTile(this.mapId);
    const tx0 = Math.floor(camX / TILE) * TILE;
    const ty0 = Math.floor(camY / TILE) * TILE;
    for (let x = tx0; x < camX + w; x += TILE) {
      for (let y = ty0; y < camY + h; y += TILE) {
        ctx.drawImage(tile, x, y);
      }
    }

    // 装饰物层（仅视口内格子，留 1 格余量避免大装饰物在边缘被裁掉）
    const cx0 = Math.floor(camX / CELL) - 1;
    const cy0 = Math.floor(camY / CELL) - 1;
    const cx1 = Math.floor((camX + w) / CELL) + 1;
    const cy1 = Math.floor((camY + h) / CELL) + 1;
    const def = MAPS[this.mapId];
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        this.drawCell(ctx, def, cx, cy, time);
      }
    }
  }

  // ------------------------------------------------------------------
  // 底纹瓦片（离屏预渲染 + 缓存）
  // ------------------------------------------------------------------
  private getTile(map: MapId): HTMLCanvasElement {
    let tile = this.tiles.get(map);
    if (!tile) {
      tile = this.renderTile(MAPS[map], MAP_SALT[map]);
      this.tiles.set(map, tile);
    }
    return tile;
  }

  private renderTile(def: MapDef, salt: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = TILE;
    canvas.height = TILE;
    const ctx = canvas.getContext('2d')!;
    const rng = makeRng(salt);

    // 底色
    ctx.fillStyle = def.base;
    ctx.fillRect(0, 0, TILE, TILE);

    // 细微噪点（低透明度小方块，形成底纹颗粒感）
    ctx.fillStyle = def.texture;
    for (let i = 0; i < 380; i++) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      const s = 1 + rng() * 2;
      ctx.globalAlpha = 0.12 + rng() * 0.2;
      ctx.fillRect(x, y, s, s);
    }
    ctx.globalAlpha = 1;

    // 淡色调网格痕迹（64px 间隔，几乎不可察觉，仅提供空间参照）
    ctx.strokeStyle = def.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let p = 0; p <= TILE; p += 64) {
      ctx.moveTo(p + 0.5, 0);
      ctx.lineTo(p + 0.5, TILE);
      ctx.moveTo(0, p + 0.5);
      ctx.lineTo(TILE, p + 0.5);
    }
    ctx.stroke();
    return canvas;
  }

  // ------------------------------------------------------------------
  // 装饰物层（格子哈希 → 确定性装饰）
  // ------------------------------------------------------------------
  private drawCell(
    ctx: CanvasRenderingContext2D,
    def: MapDef,
    cx: number,
    cy: number,
    time: number,
  ): void {
    const rng = makeRng(cellSeed(cx, cy, MAP_SALT[this.mapId]));
    if (rng() >= def.decoChance) return;
    const count = rng() < def.decoDouble ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const x = cx * CELL + rng() * CELL;
      const y = cy * CELL + rng() * CELL;
      switch (this.mapId) {
        case 'forest':
          this.drawForestDeco(ctx, def, rng, x, y);
          break;
        case 'village':
          this.drawVillageDeco(ctx, def, rng, x, y);
          break;
        case 'ruins':
          this.drawRuinsDeco(ctx, def, rng, x, y, time);
          break;
      }
    }
  }

  /** 幽暗森林：树冠剪影 / 灌木 / 浅色岩石 */
  private drawForestDeco(
    ctx: CanvasRenderingContext2D,
    def: MapDef,
    rng: () => number,
    x: number,
    y: number,
  ): void {
    const t = rng();
    if (t < 0.55) {
      // 圆形树冠剪影：多层半透明圆叠加
      const r = 26 + rng() * 38;
      for (let k = 0; k < 3; k++) {
        const ox = (rng() - 0.5) * r * 0.8;
        const oy = (rng() - 0.5) * r * 0.8;
        ctx.fillStyle = def.deco[k];
        ctx.globalAlpha = 0.55 - k * 0.14;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r * (1 - k * 0.22), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (t < 0.82) {
      // 灌木：一簇小圆
      ctx.fillStyle = def.deco[3];
      ctx.globalAlpha = 0.4;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.arc(x + (rng() - 0.5) * 20, y + (rng() - 0.5) * 14, 6 + rng() * 7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else {
      // 浅色岩石：扁圆 + 高光短线
      const r = 7 + rng() * 9;
      ctx.fillStyle = def.deco[4];
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.2;
      ctx.strokeStyle = '#9aa89a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.5, y - r * 0.3);
      ctx.lineTo(x + r * 0.3, y - r * 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /** 废弃村庄：房屋轮廓（昏黄窗光）/ 篱笆线段 / 小路色块 */
  private drawVillageDeco(
    ctx: CanvasRenderingContext2D,
    def: MapDef,
    rng: () => number,
    x: number,
    y: number,
  ): void {
    const t = rng();
    if (t < 0.45) {
      // 矩形房屋轮廓
      const bw = 54 + rng() * 56;
      const bh = 44 + rng() * 46;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = def.deco[0];
      ctx.fillRect(x - bw / 2, y - bh / 2, bw, bh);
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = def.deco[2];
      ctx.lineWidth = 2;
      ctx.strokeRect(x - bw / 2, y - bh / 2, bw, bh);
      // 昏黄窗光小点
      const wins = 1 + Math.floor(rng() * 2);
      ctx.fillStyle = def.deco[3];
      ctx.globalAlpha = 0.4;
      for (let k = 0; k < wins; k++) {
        const wx = x - bw / 2 + 8 + rng() * (bw - 20);
        const wy = y - bh / 2 + 8 + rng() * (bh - 20);
        ctx.fillRect(wx, wy, 5, 5);
      }
      ctx.globalAlpha = 1;
    } else if (t < 0.72) {
      // 篱笆：一条横/竖栏杆 + 短桩
      const horiz = rng() < 0.5;
      const len = 60 + rng() * 60;
      ctx.strokeStyle = def.deco[1];
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (horiz) {
        ctx.moveTo(x - len / 2, y);
        ctx.lineTo(x + len / 2, y);
        for (let px = x - len / 2; px <= x + len / 2; px += 14) {
          ctx.moveTo(px, y - 6);
          ctx.lineTo(px, y + 6);
        }
      } else {
        ctx.moveTo(x, y - len / 2);
        ctx.lineTo(x, y + len / 2);
        for (let py = y - len / 2; py <= y + len / 2; py += 14) {
          ctx.moveTo(x - 6, py);
          ctx.lineTo(x + 6, py);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      // 小路色块：低对比土色斑块
      const pw = 50 + rng() * 70;
      const ph = 26 + rng() * 30;
      ctx.fillStyle = def.deco[4];
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.ellipse(x, y, pw / 2, ph / 2, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /** 赛博废墟：霓虹残柱（渐变发光竖线）/ 破碎平台 / 青紫网格残片 */
  private drawRuinsDeco(
    ctx: CanvasRenderingContext2D,
    def: MapDef,
    rng: () => number,
    x: number,
    y: number,
    time: number,
  ): void {
    const t = rng();
    if (t < 0.4) {
      // 霓虹残柱：竖向渐变光带（不用 shadowBlur），亮度随时间缓慢脉动
      const hgt = 60 + rng() * 70;
      const neon = rng() < 0.5 ? def.deco[2] : def.deco[3];
      const phase = rng() * Math.PI * 2;
      const pulse = 0.22 + 0.1 * Math.sin(time * 1.6 + phase);
      const grad = ctx.createLinearGradient(x, y - hgt, x, y);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.7, neon);
      grad.addColorStop(1, neon);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = grad;
      ctx.fillRect(x - 2.5, y - hgt, 5, hgt);
      // 底座残骸
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = def.deco[1];
      ctx.fillRect(x - 7, y - 3, 14, 6);
      ctx.globalAlpha = 1;
    } else if (t < 0.72) {
      // 破碎平台：错位矩形 + 青色边缘亮线
      const pw = 46 + rng() * 50;
      const ph = 30 + rng() * 34;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = def.deco[0];
      ctx.fillRect(x - pw / 2, y - ph / 2, pw, ph);
      ctx.fillStyle = def.deco[4];
      ctx.fillRect(x - pw / 2 + pw * 0.55, y - ph / 2 - 5, pw * 0.4, ph * 0.5);
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = def.deco[2];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - pw / 2, y - ph / 2);
      ctx.lineTo(x + pw / 2, y - ph / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      // 青紫网格残片：局部小网格
      const cols = 2 + Math.floor(rng() * 3);
      const rows = 2 + Math.floor(rng() * 2);
      const s = 14;
      ctx.strokeStyle = rng() < 0.5 ? def.deco[2] : def.deco[3];
      ctx.globalAlpha = 0.14;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k <= cols; k++) {
        ctx.moveTo(x + k * s, y);
        ctx.lineTo(x + k * s, y + rows * s);
      }
      for (let k = 0; k <= rows; k++) {
        ctx.moveTo(x, y + k * s);
        ctx.lineTo(x + cols * s, y + k * s);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
