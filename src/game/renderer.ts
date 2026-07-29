// Canvas renderer. Draws the world relative to a camera centered on the player.

import { Enemy, FloatingText, Gem, Particle, Player, Projectile } from './entities';
import { MapBackground } from './background';
import { Obstacle, ObstacleField } from './obstacles';
import { MapId } from './config';

export interface Beam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  life: number;
  maxLife: number;
}

export interface RenderState {
  player: Player;
  enemies: Enemy[];
  projectiles: Projectile[];
  gems: Gem[];
  particles: Particle[];
  texts: FloatingText[];
  beams: Beam[];
  time: number;
  shake: number;
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  width = 0;
  height = 0;
  dpr = 1;
  /** 地图障碍物（game.ts 用它做碰撞推离，渲染层负责绘制与 setMap 联动） */
  readonly obstacles = new ObstacleField();
  private background = new MapBackground();

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setMap(map: MapId): void {
    this.background.setMap(map);
    this.obstacles.setMap(map);
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  render(s: RenderState): void {
    const { ctx } = this;
    const w = this.width;
    const h = this.height;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Camera centered on player, with screen shake.
    let camX = s.player.x - w / 2;
    let camY = s.player.y - h / 2;
    if (s.shake > 0) {
      camX += (Math.random() - 0.5) * s.shake;
      camY += (Math.random() - 0.5) * s.shake;
    }

    ctx.save();
    ctx.translate(-camX, -camY);

    // 障碍物视口裁剪（已按底边 y 升序），交给实体层做逐实体 Y-sort。
    const obs = this.obstacles.getVisible(camX, camY, w, h);

    this.background.draw(ctx, camX, camY, w, h, s.time);
    this.drawGems(s.gems, s.time);
    this.drawAuras(s.projectiles, s.time);
    this.drawFields(s.projectiles, s.time);
    this.drawBeams(s.beams);
    this.drawEntities(s, obs);
    this.drawProjectiles(s.projectiles, s.time);
    this.drawParticles(s.particles);
    this.drawTexts(s.texts);

    ctx.restore();
  }

  private drawGems(gems: Gem[], time: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const g of gems) {
      const pulse = 0.65 + 0.35 * Math.sin(time * 5 + g.x * 0.08 + g.y * 0.08);
      // soft glow halo
      const glow = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, 13 * pulse);
      glow.addColorStop(0, g.color);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(g.x, g.y, 13 * pulse, 0, Math.PI * 2);
      ctx.fill();
      // bright diamond core
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ffffff';
      const r = 3.5;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.fillStyle = g.color;
      ctx.fillRect(-r * 0.6, -r * 0.6, r * 1.2, r * 1.2);
      ctx.restore();
    }
    ctx.restore();
  }

  private drawAuras(projectiles: Projectile[], time: number): void {
    const { ctx } = this;
    for (const p of projectiles) {
      if (p.kind !== 'aura' && p.kind !== 'frost') continue;
      const frost = p.kind === 'frost';
      const pulse = 0.9 + 0.1 * Math.sin(time * 6);
      const r = p.radius * pulse;
      const grd = ctx.createRadialGradient(p.x, p.y, r * 0.15, p.x, p.y, r);
      if (frost) {
        grd.addColorStop(0, 'rgba(150,220,255,0.26)');
        grd.addColorStop(0.55, 'rgba(90,170,255,0.16)');
        grd.addColorStop(1, 'rgba(60,120,255,0)');
      } else {
        grd.addColorStop(0, 'rgba(255,180,90,0.30)');
        grd.addColorStop(0.55, 'rgba(255,110,50,0.18)');
        grd.addColorStop(1, 'rgba(255,60,30,0)');
      }
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      // rotating dashed rim (additive)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = frost ? 'rgba(160,220,255,0.6)' : 'rgba(255,150,70,0.55)';
      ctx.lineWidth = 3;
      // 虚线按角度等分（而非固定像素长）：段数由基础半径定下且整周闭合，
      // 段长与旋转偏移都随当前半径同比缩放，圆环呼吸时整体以圆心缩放，
      // 避免多出的周长全被挤到接缝处、只有一段虚线在变长的怪异观感。
      const rr = r * 0.94;
      const segs = Math.max(8, Math.round((Math.PI * 2 * p.radius * 0.94) / 26));
      const seg = (Math.PI * 2 * rr) / segs;
      ctx.setLineDash([seg * (14 / 26), seg * (12 / 26)]);
      ctx.lineDashOffset = (frost ? time : -time) * 0.5 * rr;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  /** Black holes (dark swirl) and shockwaves (expanding ring). */
  private drawFields(projectiles: Projectile[], time: number): void {
    const { ctx } = this;
    for (const p of projectiles) {
      if (p.kind === 'blackhole') {
        const r = p.radius;
        // dark gravitational core
        const core = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        core.addColorStop(0, 'rgba(8,2,20,0.96)');
        core.addColorStop(0.45, 'rgba(70,30,140,0.55)');
        core.addColorStop(1, 'rgba(120,90,255,0)');
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        // swirling accretion rings (additive)
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let k = 0; k < 2; k++) {
          ctx.strokeStyle = k === 0 ? 'rgba(180,140,255,0.85)' : 'rgba(120,90,255,0.5)';
          ctx.lineWidth = 3 - k;
          ctx.setLineDash([12, 9]);
          ctx.lineDashOffset = time * (90 + k * 40);
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * (0.5 + k * 0.22), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        // 旋臂：两段缓慢旋转的弧，强化旋涡感
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(190,150,255,0.45)';
        for (let arm = 0; arm < 2; arm++) {
          const st = time * 2.1 + arm * Math.PI;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 0.34, st, st + 1.9);
          ctx.stroke();
        }
        // 被吸入的光尘：确定性螺旋向内坠落，中途最亮
        ctx.fillStyle = '#cbb3ff';
        for (let k = 0; k < 6; k++) {
          const t = (time * 0.6 + k / 6) % 1;
          const rad = r * (1.05 - 0.8 * t);
          const ang = time * 2.6 + k * 2.4 + t * 3.2;
          ctx.globalAlpha = 1.4 * t * (1 - t);
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(ang) * rad, p.y + Math.sin(ang) * rad, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
      } else if (p.kind === 'shock') {
        const a = Math.max(0, p.life / p.maxLife);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        // bright leading edge
        ctx.globalAlpha = a;
        ctx.strokeStyle = '#dff0ff';
        ctx.lineWidth = 7 * a + 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.stroke();
        // soft inner fill
        ctx.globalAlpha = a * 0.25;
        ctx.strokeStyle = '#7fbfff';
        ctx.lineWidth = 16 * a + 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 0.92, 0, Math.PI * 2);
        ctx.stroke();
        // 波前碎光：沿扩张环的放射短线，随半径缓慢旋转
        ctx.globalAlpha = a * 0.6;
        ctx.strokeStyle = '#dff0ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let k = 0; k < 12; k++) {
          const ang = (k / 12) * Math.PI * 2 + p.radius * 0.015;
          ctx.moveTo(p.x + Math.cos(ang) * p.radius * 0.82, p.y + Math.sin(ang) * p.radius * 0.82);
          ctx.lineTo(p.x + Math.cos(ang) * (p.radius + 6), p.y + Math.sin(ang) * (p.radius + 6));
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }
  }

  private drawBeams(beams: Beam[]): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const b of beams) {
      const a = b.life / b.maxLife;
      // build a jagged path once, draw it twice (wide glow + bright core)
      const pts: [number, number][] = [[b.x1, b.y1]];
      const segs = 6;
      for (let i = 1; i < segs; i++) {
        const t = i / segs;
        pts.push([
          b.x1 + (b.x2 - b.x1) * t + (Math.random() - 0.5) * 20,
          b.y1 + (b.y2 - b.y1) * t + (Math.random() - 0.5) * 20,
        ]);
      }
      pts.push([b.x2, b.y2]);
      const trace = () => {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
      };
      // outer glow
      ctx.globalAlpha = a * 0.5;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 9;
      trace();
      // bright white core
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      trace();
      // 从主干岐出的分叉小枝（每帧随机，天然闪烁感）
      ctx.globalAlpha = a * 0.4;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 1.5;
      for (const i of [2, 4]) {
        const [bx, by] = pts[i];
        const ang = Math.random() * Math.PI * 2;
        const l1 = 10 + Math.random() * 14;
        const mx = bx + Math.cos(ang) * l1;
        const my = by + Math.sin(ang) * l1;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(mx, my);
        ctx.lineTo(mx + Math.cos(ang + 0.6) * l1 * 0.6, my + Math.sin(ang + 0.6) * l1 * 0.6);
        ctx.stroke();
      }
      // 命中点爆闪
      const fr = 10 + 14 * a;
      const flash = ctx.createRadialGradient(b.x2, b.y2, 0, b.x2, b.y2, fr);
      flash.addColorStop(0, '#ffffff');
      flash.addColorStop(0.4, b.color);
      flash.addColorStop(1, 'transparent');
      ctx.globalAlpha = a;
      ctx.fillStyle = flash;
      ctx.beginPath();
      ctx.arc(b.x2, b.y2, fr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /**
   * 实体层：敌人保持原数组顺序绘制（与旧版一致，避免逐帧按 y 重排
   * 导致密集怪群出现条带/闪烁），仅按障碍物底边分带插入：
   * y <= 底边的怪物/玩家在该障碍物之前绘制，被屋顶、树冠稳定遮挡；
   * 屏幕内无障碍物时退化为旧版顺序（所有敌人 → 玩家）。
   */
  private drawEntities(s: RenderState, obs: Obstacle[]): void {
    const n = obs.length;
    // 所属“带”＝第一个 baseY >= y 的障碍物下标（obs 已升序，二分）
    const bandOf = (y: number): number => {
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (obs[mid].baseY < y) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const bands: Enemy[][] = [];
    for (let k = 0; k <= n; k++) bands.push([]);
    for (const e of s.enemies) bands[bandOf(e.y)].push(e);
    const pBand = bandOf(s.player.y);
    for (let k = 0; k <= n; k++) {
      for (const e of bands[k]) this.drawEnemy(e);
      if (k === pBand) this.drawPlayer(s.player, s.time);
      if (k < n) this.obstacles.drawRange(this.ctx, obs, k, k + 1, s.time);
    }
  }

  private drawEnemy(e: Enemy): void {
    const { ctx } = this;
    const flash = e.hitFlash > 0;
    ctx.save();
    ctx.translate(e.x, e.y);
    const squash = 1 + Math.sin(e.wobble) * 0.06;
    ctx.scale(1, squash);

    // body
    ctx.beginPath();
    ctx.arc(0, 0, e.radius, 0, Math.PI * 2);
    ctx.fillStyle = flash ? '#ffffff' : e.color;
    ctx.shadowColor = e.color;
    ctx.shadowBlur = e.kind === 'boss' ? 24 : 8;
    ctx.fill();
    ctx.shadowBlur = 0;

    // eyes
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    const eo = e.radius * 0.34;
    const er = Math.max(1.6, e.radius * 0.14);
    ctx.beginPath();
    ctx.arc(-eo, -eo * 0.4, er, 0, Math.PI * 2);
    ctx.arc(eo, -eo * 0.4, er, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // hp bar for tougher enemies
    if (e.hp < e.maxHp && (e.kind === 'tank' || e.kind === 'brute' || e.kind === 'boss')) {
      const bw = e.radius * 2;
      const pct = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(e.x - bw / 2, e.y - e.radius - 10, bw, 4);
      ctx.fillStyle = '#ff5d5d';
      ctx.fillRect(e.x - bw / 2, e.y - e.radius - 10, bw * pct, 4);
    }
  }

  private drawProjectiles(projectiles: Projectile[], time: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of projectiles) {
      if (p.kind === 'aura' || p.kind === 'frost' || p.kind === 'blackhole' || p.kind === 'shock') {
        continue; // drawn separately
      }
      if (p.kind === 'knife') {
        // spinning blade with a bright edge
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        const glow = ctx.createLinearGradient(-p.radius, 0, p.radius * 1.8, 0);
        glow.addColorStop(0, 'transparent');
        glow.addColorStop(1, p.color);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.moveTo(p.radius * 1.8, 0);
        ctx.lineTo(-p.radius, p.radius * 0.6);
        ctx.lineTo(-p.radius, -p.radius * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(p.radius * 1.8, 0);
        ctx.lineTo(-p.radius * 0.2, p.radius * 0.22);
        ctx.lineTo(-p.radius * 0.2, -p.radius * 0.22);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        continue;
      }

      // Motion trail for moving projectiles (bolt / nova).
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 1 && !p.orbit) {
        const tx = -p.vx / sp;
        const ty = -p.vy / sp;
        const len = Math.min(34, sp * 0.06);
        const trail = ctx.createLinearGradient(p.x, p.y, p.x + tx * len, p.y + ty * len);
        trail.addColorStop(0, p.color);
        trail.addColorStop(1, 'transparent');
        ctx.strokeStyle = trail;
        ctx.lineWidth = p.radius * 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + tx * len, p.y + ty * len);
        ctx.stroke();
        // 彗尾内芯：更短更细的白热流光
        const core = ctx.createLinearGradient(p.x, p.y, p.x + tx * len * 0.55, p.y + ty * len * 0.55);
        core.addColorStop(0, 'rgba(255,255,255,0.85)');
        core.addColorStop(1, 'transparent');
        ctx.strokeStyle = core;
        ctx.lineWidth = p.radius * 0.7;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + tx * len * 0.55, p.y + ty * len * 0.55);
        ctx.stroke();
      }

      // 守护法球：沿圆轨迹拖出三段渐隐彗尾（画在球体下方）
      if (p.kind === 'orbit' && p.orbit) {
        const ocx = p.x - Math.cos(p.orbit.angle) * p.orbit.radius;
        const ocy = p.y - Math.sin(p.orbit.angle) * p.orbit.radius;
        const dir = p.orbit.speed >= 0 ? 1 : -1;
        ctx.lineCap = 'round';
        for (let seg = 0; seg < 3; seg++) {
          const a0 = p.orbit.angle - dir * 0.17 * (seg + 1);
          const a1 = p.orbit.angle - dir * 0.17 * seg;
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = 0.32 - seg * 0.1;
          ctx.lineWidth = p.radius * (1.1 - seg * 0.28);
          ctx.beginPath();
          ctx.arc(ocx, ocy, p.orbit.radius, Math.min(a0, a1), Math.max(a0, a1));
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // Glowing orb: white-hot core fading into the projectile color.
      const outer = p.radius * (p.kind === 'orbit' ? 2.4 : 2.1);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, outer);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.32, p.color);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, outer, 0, Math.PI * 2);
      ctx.fill();

      if (p.kind === 'nova') {
        // 六芒冰晶：随时间自旋的三根交叉短线
        const ia = time * 4 + p.id * 1.3;
        ctx.strokeStyle = 'rgba(220,245,255,0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const a2 = ia + (k * Math.PI) / 3;
          const dx = Math.cos(a2) * p.radius * 1.9;
          const dy = Math.sin(a2) * p.radius * 1.9;
          ctx.moveTo(p.x - dx, p.y - dy);
          ctx.lineTo(p.x + dx, p.y + dy);
        }
        ctx.stroke();
      }

      if (p.kind === 'orbit') {
        // sparkle ring accent
        const spark = 0.5 + 0.5 * Math.sin(time * 8 + p.x);
        ctx.strokeStyle = `rgba(255,240,200,${0.4 + spark * 0.4})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 1.1, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawPlayer(p: Player, time: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(p.x, p.y);

    // pickup radius faint ring
    ctx.strokeStyle = 'rgba(126,231,135,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, p.stats.pickupRadius, 0, Math.PI * 2);
    ctx.stroke();

    const flash = p.hurtFlash > 0;
    const blink = p.invuln > 0 && Math.floor(time * 20) % 2 === 0;
    if (!blink) {
      // body
      ctx.beginPath();
      ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = flash ? '#ffffff' : '#6bd0ff';
      ctx.shadowColor = '#6bd0ff';
      ctx.shadowBlur = 16;
      ctx.fill();
      ctx.shadowBlur = 0;

      // inner core
      ctx.beginPath();
      ctx.arc(0, 0, p.radius * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#eaf7ff';
      ctx.fill();

      // facing indicator
      const ang = Math.atan2(p.facing.y, p.facing.x);
      ctx.rotate(ang);
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.moveTo(p.radius + 6, 0);
      ctx.lineTo(p.radius - 2, 4);
      ctx.lineTo(p.radius - 2, -4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private drawParticles(particles: Particle[]): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const pt of particles) {
      const a = pt.life / pt.maxLife;
      const rad = pt.size * (0.6 + a);
      const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, rad);
      g.addColorStop(0, pt.color);
      g.addColorStop(1, 'transparent');
      ctx.globalAlpha = a;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private drawTexts(texts: FloatingText[]): void {
    const { ctx } = this;
    ctx.textAlign = 'center';
    for (const t of texts) {
      const a = Math.min(1, t.life * 2);
      ctx.globalAlpha = a;
      ctx.fillStyle = t.color;
      ctx.font = `700 ${t.size}px "Segoe UI", sans-serif`;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}
