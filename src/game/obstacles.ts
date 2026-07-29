// 地图不可通行障碍物系统：确定性生成 + 碰撞推离 + 纯 Canvas 几何绘制。
//
// - 生成：以 OBSTACLES.cell（640px）大格做确定性哈希（复用 background.ts 的
//   cellSeed / mulberry32，掺不同盐值避免与装饰物落点重合），每格 0~1 个障碍物；
//   锚点向格中偏置，保证相邻格障碍物之间必然留出可通行走道。
// - 出生安全区：世界原点（玩家出生点）半径 OBSTACLES.safeRadius 内不生成。
// - 碰撞：圆形 / 轴对齐矩形两种碰撞体，每个障碍物 1~2 个；对外提供圆形实体
//   推离解算（circle-vs-circle 与 circle-vs-AABB 标准推出），查询按格子索引，
//   实体只访问自身附近格子，敌人同屏 100+ 也不做全量遍历。
// - 绘制：锚点即底边（baseY），供渲染层按底边 y 与玩家做 Y-sort；
//   不使用 shadowBlur，发光一律用径向 / 线性渐变。

import { MAPS, MapId, OBSTACLES } from './config';
import { cellSeed, makeRng } from './background';
import { clamp } from './math';

export interface CircleCollider {
  kind: 'circle';
  x: number;
  y: number;
  r: number;
}

export interface RectCollider {
  kind: 'rect';
  x: number; // 左上角
  y: number;
  w: number;
  h: number;
}

export type ObstacleCollider = CircleCollider | RectCollider;

export interface Obstacle {
  /** 每张地图两种造型：0 / 1 */
  type: number;
  /** 锚点（底部中心） */
  x: number;
  y: number;
  scale: number;
  /** 派生绘制细节用的确定性种子 */
  seed: number;
  /** 底边 y（Y-sort 依据），等于锚点 y */
  baseY: number;
  colliders: ObstacleCollider[];
}

/** 各地图障碍物哈希盐值（与 background.ts 装饰物盐值错开） */
const OB_SALT: Record<MapId, number> = { forest: 0x51a7, village: 0x62b9, ruins: 0x73cb };

/** 碰撞体距锚点的最大延伸（含余量），用于附近格子查询范围 */
const COLLIDER_REACH = 160;
/** 视口裁剪余量：覆盖最高绘制体（树冠 / 高楼上部） */
const VIEW_MARGIN = 300;
/** 格子缓存上限，超过则整体清空（确定性生成，重建代价极低） */
const CACHE_LIMIT = 600;

/** 单个碰撞体对圆形实体的标准推出 */
function resolveCircle(body: { x: number; y: number }, r: number, c: ObstacleCollider): void {
  if (c.kind === 'circle') {
    const dx = body.x - c.x;
    const dy = body.y - c.y;
    const minD = r + c.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= minD * minD) return;
    const d = Math.sqrt(d2);
    if (d > 0.0001) {
      body.x = c.x + (dx / d) * minD;
      body.y = c.y + (dy / d) * minD;
    } else {
      body.y = c.y + minD; // 圆心完全重合时向下推出
    }
  } else {
    // circle-vs-AABB：先取矩形上最近点
    const nx = clamp(body.x, c.x, c.x + c.w);
    const ny = clamp(body.y, c.y, c.y + c.h);
    const dx = body.x - nx;
    const dy = body.y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return;
    if (d2 > 0.000001) {
      const d = Math.sqrt(d2);
      body.x = nx + (dx / d) * r;
      body.y = ny + (dy / d) * r;
    } else {
      // 圆心落在矩形内部：沿穿透最浅的轴推出
      const left = body.x - c.x;
      const right = c.x + c.w - body.x;
      const top = body.y - c.y;
      const bottom = c.y + c.h - body.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) body.x = c.x - r;
      else if (m === right) body.x = c.x + c.w + r;
      else if (m === top) body.y = c.y - r;
      else body.y = c.y + c.h + r;
    }
  }
}

export class ObstacleField {
  private mapId: MapId = 'forest';
  private cache = new Map<string, Obstacle | null>();
  private visible: Obstacle[] = [];

  setMap(map: MapId): void {
    this.mapId = map;
    this.cache.clear();
  }

  // ------------------------------------------------------------------
  // 查询与碰撞
  // ------------------------------------------------------------------

  /** 返回 (x,y) 半径 radius 覆盖范围附近格子的所有碰撞体 */
  getCollidersNear(x: number, y: number, radius: number): ObstacleCollider[] {
    const out: ObstacleCollider[] = [];
    this.forEachNearby(x, y, radius, (ob) => {
      for (const c of ob.colliders) out.push(c);
    });
    return out;
  }

  /** 将圆形实体（玩家/敌人）从附近障碍物碰撞体中推出 */
  collide(body: { x: number; y: number }, radius: number): void {
    this.forEachNearby(body.x, body.y, radius, (ob) => {
      for (const c of ob.colliders) resolveCircle(body, radius, c);
    });
  }

  private forEachNearby(x: number, y: number, radius: number, fn: (ob: Obstacle) => void): void {
    const cell = OBSTACLES.cell;
    const reach = radius + COLLIDER_REACH;
    const cx0 = Math.floor((x - reach) / cell);
    const cy0 = Math.floor((y - reach) / cell);
    const cx1 = Math.floor((x + reach) / cell);
    const cy1 = Math.floor((y + reach) / cell);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const ob = this.cellAt(cx, cy);
        if (ob) fn(ob);
      }
    }
  }

  // ------------------------------------------------------------------
  // 生成（格子哈希 + 缓存）
  // ------------------------------------------------------------------
  private cellAt(cx: number, cy: number): Obstacle | null {
    const k = `${cx},${cy}`;
    let ob = this.cache.get(k);
    if (ob === undefined) {
      if (this.cache.size > CACHE_LIMIT) this.cache.clear();
      ob = this.generate(cx, cy);
      this.cache.set(k, ob);
    }
    return ob;
  }

  private generate(cx: number, cy: number): Obstacle | null {
    const def = MAPS[this.mapId].obstacle;
    const rng = makeRng(cellSeed(cx, cy, OB_SALT[this.mapId]));
    if (rng() >= def.chance) return null;
    const cell = OBSTACLES.cell;
    // 锚点向格中偏置（0.3~0.7），相邻格障碍物锚点最近也有 0.6*cell，间距足够走人
    const x = (cx + 0.3 + rng() * 0.4) * cell;
    const y = (cy + 0.3 + rng() * 0.4) * cell;
    // 出生安全区：原点附近整体不生成（150 为碰撞体最大延伸余量）
    if (Math.hypot(x, y) < OBSTACLES.safeRadius + 150) return null;
    const scale = def.scaleMin + rng() * (def.scaleMax - def.scaleMin);
    const type = rng() < 0.5 ? 0 : 1;
    const seed = Math.floor(rng() * 0x7fffffff);
    return { type, x, y, scale, seed, baseY: y, colliders: this.buildColliders(type, x, y, scale) };
  }

  private buildColliders(type: number, x: number, y: number, s: number): ObstacleCollider[] {
    switch (this.mapId) {
      case 'forest': {
        if (type === 0) {
          // 巨石组：主石 + 侧石两个圆
          return [
            { kind: 'circle', x: x - 6 * s, y: y - 30 * s, r: 36 * s },
            { kind: 'circle', x: x + 34 * s, y: y - 18 * s, r: 22 * s },
          ];
        }
        // 古树：只算树干，树冠可通行（玩家可站在冠下）
        return [{ kind: 'circle', x, y: y - 14 * s, r: 20 * s }];
      }
      case 'village': {
        if (type === 0) {
          // 小木屋：墙体矩形（屋顶为纯视觉，用于遮挡）
          const w = 124 * s;
          const h = 86 * s;
          return [{ kind: 'rect', x: x - w / 2, y: y - h, w, h }];
        }
        // 石砌水井：圆形
        return [{ kind: 'circle', x, y: y - 14 * s, r: 27 * s }];
      }
      case 'ruins': {
        if (type === 0) {
          // 楼体残块：底部楼体矩形 + 墙脚碎石圆（上部残楼为纯视觉遮挡）
          const w = 116 * s;
          return [
            { kind: 'rect', x: x - w / 2, y: y - 96 * s, w, h: 96 * s },
            { kind: 'circle', x: x + w / 2 + 12 * s, y: y - 10 * s, r: 15 * s },
          ];
        }
        // 倒塌巨柱：横躺胶囊形，用矩形近似
        const w = 150 * s;
        const h = 46 * s;
        return [{ kind: 'rect', x: x - w / 2, y: y - h, w, h }];
      }
    }
  }

  // ------------------------------------------------------------------
  // 渲染：视口收集 + 按底边 y 排序，绘制交给 drawRange
  // ------------------------------------------------------------------

  /** 收集视口内障碍物，按 baseY 升序返回（数组复用，仅当帧有效） */
  getVisible(camX: number, camY: number, w: number, h: number): Obstacle[] {
    const cell = OBSTACLES.cell;
    const cx0 = Math.floor((camX - VIEW_MARGIN) / cell);
    const cy0 = Math.floor((camY - VIEW_MARGIN) / cell);
    const cx1 = Math.floor((camX + w + VIEW_MARGIN) / cell);
    const cy1 = Math.floor((camY + h + VIEW_MARGIN) / cell);
    const out = this.visible;
    out.length = 0;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const ob = this.cellAt(cx, cy);
        if (ob) out.push(ob);
      }
    }
    out.sort((a, b) => a.baseY - b.baseY);
    return out;
  }

  /** 绘制 list[start, end) 区间的障碍物（渲染层用它做玩家 Y-sort 分组） */
  drawRange(
    ctx: CanvasRenderingContext2D,
    list: Obstacle[],
    start: number,
    end: number,
    time: number,
  ): void {
    for (let i = start; i < end; i++) {
      const ob = list[i];
      switch (this.mapId) {
        case 'forest':
          if (ob.type === 0) this.drawBoulders(ctx, ob);
          else this.drawTree(ctx, ob);
          break;
        case 'village':
          if (ob.type === 0) this.drawHouse(ctx, ob);
          else this.drawWell(ctx, ob);
          break;
        case 'ruins':
          if (ob.type === 0) this.drawRuinBlock(ctx, ob, time);
          else this.drawPillar(ctx, ob, time);
          break;
      }
    }
  }

  /** 通用地面接触阴影 */
  private groundShadow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    rx: number,
    ry: number,
    alpha: number,
  ): void {
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ------------------------------------------------------------------
  // 幽暗森林：巨石组 / 古树
  // ------------------------------------------------------------------
  private drawBoulders(ctx: CanvasRenderingContext2D, ob: Obstacle): void {
    const { x, y, scale: s } = ob;
    const rng = makeRng(ob.seed);
    this.groundShadow(ctx, x, y - 6 * s, 66 * s, 17 * s, 0.32);

    // 三块石头，从后到前叠放（第三块小石纯视觉，藏在主石脚下）
    const stones = [
      { ox: -6, oy: -30, r: 36 },
      { ox: 34, oy: -18, r: 22 },
      { ox: -32, oy: -12, r: 14 },
    ];
    for (const st of stones) {
      const sx = x + st.ox * s;
      const sy = y + st.oy * s;
      const r = st.r * s;
      // 石体：左上受光的径向渐变
      const g = ctx.createRadialGradient(sx - r * 0.4, sy - r * 0.5, r * 0.12, sx, sy, r * 1.05);
      g.addColorStop(0, '#7a8770');
      g.addColorStop(0.5, '#4a5442');
      g.addColorStop(1, '#232b20');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      // 顶部高光弧
      ctx.strokeStyle = 'rgba(202,216,190,0.28)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, r * 0.78, -2.5, -1.2);
      ctx.stroke();
      // 苔藓色斑（偏石头下半部）
      ctx.fillStyle = '#2f4a2b';
      ctx.globalAlpha = 0.55;
      const moss = 2 + Math.floor(rng() * 2);
      for (let k = 0; k < moss; k++) {
        const ma = Math.PI * (0.15 + rng() * 0.7); // 下半圆
        const md = r * (0.45 + rng() * 0.45);
        ctx.beginPath();
        ctx.arc(sx + Math.cos(ma) * md, sy + Math.sin(ma) * md, r * (0.16 + rng() * 0.16), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawTree(ctx: CanvasRenderingContext2D, ob: Obstacle): void {
    const { x, y, scale: s } = ob;
    const rng = makeRng(ob.seed);
    this.groundShadow(ctx, x, y - 4 * s, 42 * s, 12 * s, 0.35);

    // 根部：向外张开的粗根
    ctx.fillStyle = '#1c1409';
    for (const dir of [-1, 0.2, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + dir * 8 * s, y - 16 * s);
      ctx.lineTo(x + dir * (24 + rng() * 8) * s, y);
      ctx.lineTo(x + dir * 4 * s, y);
      ctx.closePath();
      ctx.fill();
    }

    // 树干：上窄下宽的梯形 + 横向受光渐变
    const trunk = ctx.createLinearGradient(x - 20 * s, 0, x + 20 * s, 0);
    trunk.addColorStop(0, '#3f3122');
    trunk.addColorStop(0.45, '#2a1f12');
    trunk.addColorStop(1, '#140e06');
    ctx.fillStyle = trunk;
    ctx.beginPath();
    ctx.moveTo(x - 19 * s, y);
    ctx.quadraticCurveTo(x - 14 * s, y - 34 * s, x - 12 * s, y - 70 * s);
    ctx.lineTo(x + 12 * s, y - 70 * s);
    ctx.quadraticCurveTo(x + 14 * s, y - 34 * s, x + 19 * s, y);
    ctx.closePath();
    ctx.fill();
    // 树皮竖纹
    ctx.strokeStyle = 'rgba(10,6,2,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const dir of [-0.5, 0.15, 0.6]) {
      ctx.moveTo(x + dir * 14 * s, y - 6 * s);
      ctx.lineTo(x + dir * 10 * s, y - 60 * s);
    }
    ctx.stroke();

    // 树冠：多层半透明圆（玩家在冠下仍可见），中心受光
    const cy0 = y - 148 * s;
    const layers = [
      { ox: -50, oy: 28, r: 52 },
      { ox: 48, oy: 24, r: 56 },
      { ox: -6, oy: -50, r: 48 },
      { ox: 0, oy: 0, r: 84 },
    ];
    for (const ly of layers) {
      const lx = x + ly.ox * s;
      const lyy = cy0 + ly.oy * s;
      const r = ly.r * s;
      const g = ctx.createRadialGradient(lx - r * 0.25, lyy - r * 0.3, r * 0.1, lx, lyy, r);
      g.addColorStop(0, '#2f5a35');
      g.addColorStop(0.6, '#1c3d24');
      g.addColorStop(1, '#102616');
      ctx.fillStyle = g;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(lx, lyy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 冠顶光斑
    ctx.fillStyle = '#5c8a55';
    ctx.globalAlpha = 0.16;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.arc(
        x + (rng() - 0.5) * 110 * s,
        cy0 - (10 + rng() * 40) * s,
        (7 + rng() * 9) * s,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------
  // 废弃村庄：小木屋 / 石砌水井
  // ------------------------------------------------------------------
  private drawHouse(ctx: CanvasRenderingContext2D, ob: Obstacle): void {
    const { x, y, scale: s } = ob;
    const rng = makeRng(ob.seed);
    const w = 124 * s;
    const hgt = 86 * s;
    const x0 = x - w / 2;
    const y0 = y - hgt;
    this.groundShadow(ctx, x, y - 3 * s, w * 0.64, 13 * s, 0.35);

    // 木墙：上亮下暗的纵向渐变
    const wall = ctx.createLinearGradient(0, y0, 0, y);
    wall.addColorStop(0, '#61492a');
    wall.addColorStop(0.55, '#41321d');
    wall.addColorStop(1, '#2a2012');
    ctx.fillStyle = wall;
    ctx.fillRect(x0, y0, w, hgt);
    // 横向木板缝
    ctx.strokeStyle = 'rgba(18,12,6,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let py = y0 + 13 * s; py < y - 4 * s; py += 13 * s) {
      ctx.moveTo(x0 + 2, py);
      ctx.lineTo(x0 + w - 2, py);
    }
    ctx.stroke();
    // 两侧立柱
    ctx.fillStyle = '#241a0e';
    ctx.fillRect(x0, y0, 6 * s, hgt);
    ctx.fillRect(x0 + w - 6 * s, y0, 6 * s, hgt);

    // 门（偏右）：门洞 + 门框 + 门把
    const dw = 26 * s;
    const dh = 46 * s;
    const dx = x + 22 * s;
    ctx.fillStyle = '#170f07';
    ctx.fillRect(dx - dw / 2, y - dh, dw, dh);
    ctx.strokeStyle = '#6b5636';
    ctx.lineWidth = 2;
    ctx.strokeRect(dx - dw / 2, y - dh, dw, dh);
    ctx.fillStyle = '#d9a066';
    ctx.beginPath();
    ctx.arc(dx + dw * 0.28, y - dh * 0.45, 1.8 * s, 0, Math.PI * 2);
    ctx.fill();

    // 昏黄发光窗（偏左，或再加一扇小窗）：径向渐变光晕 + 暖色窗面 + 十字格
    const winCount = rng() < 0.5 ? 2 : 1;
    for (let k = 0; k < winCount; k++) {
      const wx = k === 0 ? x - 30 * s : x - 2 * s;
      const wy = y0 + hgt * 0.4;
      const ww = (k === 0 ? 20 : 13) * s;
      const wh = (k === 0 ? 18 : 12) * s;
      const glow = ctx.createRadialGradient(wx, wy, 2, wx, wy, ww * 2.1);
      glow.addColorStop(0, 'rgba(255,196,110,0.32)');
      glow.addColorStop(1, 'rgba(255,196,110,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(wx, wy, ww * 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#140d05';
      ctx.fillRect(wx - ww / 2 - 2, wy - wh / 2 - 2, ww + 4, wh + 4);
      const pane = ctx.createLinearGradient(0, wy - wh / 2, 0, wy + wh / 2);
      pane.addColorStop(0, '#ffd98a');
      pane.addColorStop(1, '#dd8f43');
      ctx.fillStyle = pane;
      ctx.fillRect(wx - ww / 2, wy - wh / 2, ww, wh);
      ctx.strokeStyle = 'rgba(40,26,12,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(wx, wy - wh / 2);
      ctx.lineTo(wx, wy + wh / 2);
      ctx.moveTo(wx - ww / 2, wy);
      ctx.lineTo(wx + ww / 2, wy);
      ctx.stroke();
    }

    // 三角屋顶（带出檐）+ 屋脊高光 + 烟囱
    const roofH = 46 * s;
    const ov = 12 * s;
    const roof = ctx.createLinearGradient(0, y0 - roofH, 0, y0);
    roof.addColorStop(0, '#55422a');
    roof.addColorStop(1, '#231a0e');
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(x0 - ov, y0);
    ctx.lineTo(x, y0 - roofH);
    ctx.lineTo(x0 + w + ov, y0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(217,160,102,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y0 - roofH);
    ctx.lineTo(x0 - ov, y0);
    ctx.stroke();
    ctx.fillStyle = '#33281a';
    ctx.fillRect(x + w * 0.2, y0 - roofH * 0.86, 9 * s, roofH * 0.5);
  }

  private drawWell(ctx: CanvasRenderingContext2D, ob: Obstacle): void {
    const { x, y, scale: s } = ob;
    const ringR = 27 * s;
    const cy = y - 14 * s;
    this.groundShadow(ctx, x, y - 2 * s, 36 * s, 10 * s, 0.32);

    // 石砌井身：左上受光的径向渐变
    const stone = ctx.createRadialGradient(x - ringR * 0.35, cy - ringR * 0.35, ringR * 0.15, x, cy, ringR * 1.02);
    stone.addColorStop(0, '#77705f');
    stone.addColorStop(0.55, '#4c463a');
    stone.addColorStop(1, '#2b2820');
    ctx.fillStyle = stone;
    ctx.beginPath();
    ctx.arc(x, cy, ringR, 0, Math.PI * 2);
    ctx.fill();
    // 石块缝（放射短线）
    ctx.strokeStyle = 'rgba(12,10,6,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + 0.3;
      ctx.moveTo(x + Math.cos(a) * ringR * 0.66, cy + Math.sin(a) * ringR * 0.66);
      ctx.lineTo(x + Math.cos(a) * ringR * 0.97, cy + Math.sin(a) * ringR * 0.97);
    }
    ctx.stroke();
    // 井口：深水 + 幽幽水光
    ctx.fillStyle = '#0a1116';
    ctx.beginPath();
    ctx.arc(x, cy, ringR * 0.6, 0, Math.PI * 2);
    ctx.fill();
    const water = ctx.createRadialGradient(x, cy + ringR * 0.1, 0, x, cy, ringR * 0.6);
    water.addColorStop(0, 'rgba(96,168,208,0.22)');
    water.addColorStop(1, 'rgba(96,168,208,0)');
    ctx.fillStyle = water;
    ctx.beginPath();
    ctx.arc(x, cy, ringR * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // 木支架 + 小顶棚 + 辘轳吊桶
    const postX = ringR - 4 * s;
    const topY = cy - 42 * s;
    ctx.fillStyle = '#43341e';
    ctx.fillRect(x - postX - 2.5 * s, topY, 5 * s, 42 * s);
    ctx.fillRect(x + postX - 2.5 * s, topY, 5 * s, 42 * s);
    ctx.strokeStyle = '#241c12';
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.moveTo(x - postX, topY + 6 * s);
    ctx.lineTo(x + postX, topY + 6 * s);
    ctx.stroke();
    // 顶棚
    const roof = ctx.createLinearGradient(0, topY - 16 * s, 0, topY + 2 * s);
    roof.addColorStop(0, '#4a3a22');
    roof.addColorStop(1, '#241a0e');
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(x - ringR - 7 * s, topY + 2 * s);
    ctx.lineTo(x, topY - 16 * s);
    ctx.lineTo(x + ringR + 7 * s, topY + 2 * s);
    ctx.closePath();
    ctx.fill();
    // 吊绳 + 桶
    ctx.strokeStyle = 'rgba(200,180,140,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, topY + 6 * s);
    ctx.lineTo(x, cy - 12 * s);
    ctx.stroke();
    ctx.fillStyle = '#57452a';
    ctx.fillRect(x - 4 * s, cy - 12 * s, 8 * s, 7 * s);
  }

  // ------------------------------------------------------------------
  // 赛博废墟：霓虹楼体残块 / 倒塌巨柱
  // ------------------------------------------------------------------
  private drawRuinBlock(ctx: CanvasRenderingContext2D, ob: Obstacle, time: number): void {
    const { x, y, scale: s } = ob;
    const rng = makeRng(ob.seed);
    const w = 116 * s;
    const hgt = 168 * s;
    const x0 = x - w / 2;
    const y0 = y - hgt;
    this.groundShadow(ctx, x, y - 3 * s, w * 0.64, 12 * s, 0.4);

    // 主体混凝土 + 破损锯齿顶边（确定性锯齿）
    const body = ctx.createLinearGradient(0, y0, 0, y);
    body.addColorStop(0, '#2d2560');
    body.addColorStop(0.5, '#1c1545');
    body.addColorStop(1, '#130e30');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0, y0 + 30 * s);
    const jags = 5;
    for (let k = 0; k <= jags; k++) {
      const jx = x0 + (w * k) / jags;
      const jy = y0 + (k % 2 === 0 ? rng() * 22 : 24 + rng() * 14) * s;
      ctx.lineTo(jx, jy);
    }
    ctx.lineTo(x0 + w, y);
    ctx.closePath();
    ctx.fill();
    // 断口亮边
    ctx.strokeStyle = 'rgba(130,116,220,0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 窗洞网格：大多熄灭，随机 1~2 扇亮着霓虹
    const cols = 3;
    const rows = 4;
    const ww = w * 0.16;
    const wh = 15 * s;
    const litA = Math.floor(rng() * cols * rows);
    const litB = Math.floor(rng() * cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = x0 + w * 0.16 + c * w * 0.28;
        const wy = y0 + 44 * s + r * 27 * s;
        const idx = r * cols + c;
        if (idx === litA || idx === litB) {
          const neon = idx === litA ? '#5ce1ff' : '#b56cff';
          const glow = ctx.createRadialGradient(wx + ww / 2, wy + wh / 2, 1, wx + ww / 2, wy + wh / 2, ww * 1.6);
          glow.addColorStop(0, neon);
          glow.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = glow;
          ctx.fillRect(wx - ww, wy - wh, ww * 3, wh * 3);
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = neon;
          ctx.fillRect(wx, wy, ww, wh);
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = '#0b081e';
          ctx.fillRect(wx, wy, ww, wh);
        }
      }
    }

    // 竖向霓虹灯带（贴一侧墙缘）：线性渐变 + 缓慢脉动，底部地面反光
    const neon = rng() < 0.5 ? '#5ce1ff' : '#b56cff';
    const edgeX = rng() < 0.5 ? x0 + 7 * s : x0 + w - 7 * s;
    const phase = (ob.seed % 628) / 100;
    const pulse = 0.55 + 0.25 * Math.sin(time * 1.8 + phase);
    const strip = ctx.createLinearGradient(0, y0 + 34 * s, 0, y - 6 * s);
    strip.addColorStop(0, 'rgba(0,0,0,0)');
    strip.addColorStop(0.25, neon);
    strip.addColorStop(0.85, neon);
    strip.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = pulse;
    ctx.fillStyle = strip;
    ctx.fillRect(edgeX - 2.5 * s, y0 + 34 * s, 5 * s, hgt - 40 * s);
    // 地面反光
    const rf = ctx.createRadialGradient(edgeX, y - 2 * s, 0, edgeX, y - 2 * s, 30 * s);
    rf.addColorStop(0, neon);
    rf.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = pulse * 0.22;
    ctx.fillStyle = rf;
    ctx.beginPath();
    ctx.ellipse(edgeX, y - 2 * s, 30 * s, 9 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // 墙脚碎石堆（对应第二个圆形碰撞体）
    const rx = x + w / 2 + 12 * s;
    for (const st of [
      { ox: -6, oy: -8, r: 13 },
      { ox: 8, oy: -5, r: 9 },
    ]) {
      const g = ctx.createRadialGradient(
        rx + st.ox * s - 3, y + st.oy * s - 4, 1,
        rx + st.ox * s, y + st.oy * s, st.r * s,
      );
      g.addColorStop(0, '#3c3378');
      g.addColorStop(1, '#161038');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(rx + st.ox * s, y + st.oy * s, st.r * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawPillar(ctx: CanvasRenderingContext2D, ob: Obstacle, time: number): void {
    const { x, y, scale: s } = ob;
    const rng = makeRng(ob.seed);
    const w = 150 * s;
    const hgt = 46 * s;
    const x0 = x - w / 2;
    const y0 = y - hgt;
    const r = hgt / 2;
    this.groundShadow(ctx, x, y - 2 * s, w * 0.56, 10 * s, 0.38);

    // 横躺柱体：胶囊形 + 纵向受光渐变
    const body = ctx.createLinearGradient(0, y0, 0, y);
    body.addColorStop(0, '#443a85');
    body.addColorStop(0.45, '#292059');
    body.addColorStop(1, '#141034');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.lineTo(x0 + w - r, y0);
    ctx.arc(x0 + w - r, y0 + r, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x0 + r, y);
    ctx.arc(x0 + r, y0 + r, r, Math.PI / 2, (Math.PI * 3) / 2);
    ctx.closePath();
    ctx.fill();
    // 顶缘高光
    ctx.strokeStyle = 'rgba(150,138,230,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0 + 1.5);
    ctx.lineTo(x0 + w - r, y0 + 1.5);
    ctx.stroke();
    // 柱身分段环线（微弧模拟圆柱）
    ctx.strokeStyle = 'rgba(10,7,30,0.6)';
    ctx.lineWidth = 2;
    for (let k = 1; k <= 3; k++) {
      const px = x0 + (w * k) / 4 + (rng() - 0.5) * 8 * s;
      ctx.beginPath();
      ctx.moveTo(px, y0 + 2);
      ctx.quadraticCurveTo(px - 5 * s, y0 + r, px, y - 2);
      ctx.stroke();
    }
    // 断裂端面：右端双椭圆
    ctx.fillStyle = '#332a6b';
    ctx.beginPath();
    ctx.ellipse(x0 + w - r, y0 + r, r * 0.42, r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#181242';
    ctx.beginPath();
    ctx.ellipse(x0 + w - r, y0 + r, r * 0.24, r * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();

    // 霓虹裂纹：宽淡光 + 亮芯两遍，亮度缓慢脉动
    const phase = (ob.seed % 628) / 100;
    const pulse = 0.4 + 0.2 * Math.sin(time * 2.2 + phase);
    const crack: [number, number][] = [
      [x0 + w * 0.2, y0 + r * 0.7],
      [x0 + w * 0.38, y0 + r * 1.15],
      [x0 + w * 0.52, y0 + r * 0.6],
      [x0 + w * 0.72, y0 + r * 1.05],
    ];
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(crack[0][0], crack[0][1]);
      for (let k = 1; k < crack.length; k++) ctx.lineTo(crack[k][0], crack[k][1]);
      ctx.stroke();
    };
    ctx.globalAlpha = pulse * 0.35;
    ctx.strokeStyle = '#b56cff';
    ctx.lineWidth = 5;
    trace();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = '#e0b8ff';
    ctx.lineWidth = 1.5;
    trace();
    ctx.globalAlpha = 1;
  }
}
