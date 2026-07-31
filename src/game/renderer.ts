// Canvas renderer. Draws the world relative to a camera centered on the player.

import { Enemy, FloatingText, Gem, Particle, Player, Projectile, Destructible } from './entities';
import { MapBackground } from './background';
import { Obstacle, ObstacleField } from './obstacles';
import { MapId, DESTRUCTIBLES } from './config';
import { convexHull } from './math';

export interface Beam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  life: number;
  maxLife: number;
  /** 有值时按直线光束渲染（激光），否则为锯齿闪电风格 */
  width?: number;
}

/** 主动武器准星状态（世界坐标） */
export interface AimState {
  x: number;
  y: number;
  ready: boolean;
  charge: number; // 0..1 充能进度
  color: string;
}

/** 持续引导灼烧区（世界坐标）；targets 为超武选定目标位置（画凸包能量罩） */
export interface ChannelFx {
  x: number;
  y: number;
  radius: number;
  targets: { x: number; y: number }[] | null;
}

/** 近战剑光：以 (x,y) 为支点的一道新月形刃光，随生命周期扫过弧面并向外推 */
export interface Slash {
  x: number;
  y: number;
  angle: number; // 中心方向
  reach: number; // 剑光半径
  arcHalf: number; // 半张角
  dir: 1 | -1; // 扫动方向（逆/顺时针，逐次交替更有挥砍感）
  life: number;
  maxLife: number;
  color: string;
  // 以下为游戏逻辑字段（renderer 不读）：伤害随刃光扫到才结算，保证所见即所得
  dmg?: number;
  knockback?: number;
  hit?: Set<number>; // 已命中集合（敌人 id / 道具 id+偏移）
}

/**
 * 某一时刻剑光的几何状态（渲染与伤害判定共用同一公式，确保视觉覆盖区 = 命中区）：
 * - 前 55% 生命刃口从起刃侧 ease-out 扫向另一侧；
 * - 半径随进度外推 18%（剑气飞出）。
 */
export function slashGeometry(sl: Slash): {
  fade: number;
  sweep: number;
  reach: number;
  a0: number;
  span: number;
  lead: number;
} {
  const t = 1 - sl.life / sl.maxLife;
  const fade = Math.max(0, sl.life / sl.maxLife);
  const sweep = Math.min(1, t / 0.55);
  const eased = 1 - (1 - sweep) ** 3;
  const reach = sl.reach * (1 + 0.18 * t);
  const a0 = sl.angle - sl.arcHalf * sl.dir;
  const span = sl.arcHalf * 2 * sl.dir * eased;
  return { fade, sweep, reach, a0, span, lead: a0 + span };
}

export interface RenderState {
  player: Player;
  enemies: Enemy[];
  destructibles: Destructible[];
  projectiles: Projectile[];
  gems: Gem[];
  particles: Particle[];
  texts: FloatingText[];
  beams: Beam[];
  slashes: Slash[];
  aim: AimState | null;
  channel: ChannelFx | null;
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
  private mapId: MapId = 'forest';
  /** 画布系统光标是否已隐藏（游戏内准星显示时隐藏，避免双光标） */
  private cursorHidden = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setMap(map: MapId): void {
    this.mapId = map;
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
    // 有游戏内准星时隐藏系统光标，避免两个光标叠在一起
    const hideCursor = !!s.aim;
    if (hideCursor !== this.cursorHidden) {
      this.cursorHidden = hideCursor;
      this.canvas.style.cursor = hideCursor ? 'none' : '';
    }
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
    this.drawSlashes(s.slashes);
    if (s.channel) this.drawChannel(s.player, s.channel, s.time);
    this.drawParticles(s.particles);
    this.drawTexts(s.texts);
    if (s.aim) this.drawAim(s.aim, s.time);

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
      // 血包：额外叠一个白色十字，一眼读出“回血”
      if (g.heal) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(g.x - 4, g.y - 1.3, 8, 2.6);
        ctx.fillRect(g.x - 1.3, g.y - 4, 2.6, 8);
      }
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

  /**
   * 主动武器准星（世界坐标）：
   * 就绪——青色双弧圈 + 中心点，微呼吸；充能中——灰圈 + 按进度补全的充能弧。
   */
  private drawAim(aim: AimState, time: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(aim.x, aim.y);
    ctx.lineCap = 'round';
    if (aim.ready) {
      const pulse = 1 + Math.sin(time * 6) * 0.08;
      const r = 11 * pulse;
      ctx.strokeStyle = aim.color;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2;
      // 双弧圈（缺口对称）
      ctx.beginPath();
      ctx.arc(0, 0, r, -0.4 * Math.PI, 0.4 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r, 0.6 * Math.PI, 1.4 * Math.PI);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = aim.color;
      ctx.beginPath();
      ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
      ctx.fill();
      // 就绪但能量/充能未满（如引导中消耗）：外圈细弧实时显示余量
      if (aim.charge < 0.995) {
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, r + 4.5, -Math.PI / 2, -Math.PI / 2 + aim.charge * Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.strokeStyle = 'rgba(150,160,175,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.stroke();
      // 充能进度弧（从顶部顺时针）
      ctx.strokeStyle = aim.color;
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.arc(0, 0, 11, -Math.PI / 2, -Math.PI / 2 + aim.charge * Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /**
   * 持续引导（湮灭引导）：赤色能量从主角飞向光标圆心 + 光标处脉动灼烧圆。
   * 均为加色叠加（lighter），多股能量流带拖影 + 内核白热。
   */
  private drawChannel(player: Player, ch: ChannelFx, time: number): void {
    const { ctx } = this;
    const ang = Math.atan2(ch.y - player.y, ch.x - player.x);
    const sx = player.x + Math.cos(ang) * player.radius;
    const sy = player.y + Math.sin(ang) * player.radius;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    // 能量流带：两股正弦扰动的赤红束 + 白热芯
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    const segs = 10;
    for (let strand = 0; strand < 2; strand++) {
      const amp = 6 + strand * 4;
      const phase = time * 22 + strand * Math.PI;
      ctx.beginPath();
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const wob = Math.sin(t * Math.PI * 2 + phase) * amp * Math.sin(t * Math.PI);
        const px = sx + (ch.x - sx) * t + nx * wob;
        const py = sy + (ch.y - sy) * t + ny * wob;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = strand === 0 ? 'rgba(255,60,60,0.55)' : 'rgba(255,120,80,0.4)';
      ctx.lineWidth = strand === 0 ? 5 : 3;
      ctx.stroke();
    }
    // 主干白热芯
    ctx.strokeStyle = 'rgba(255,220,210,0.9)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ch.x, ch.y);
    ctx.stroke();
    // 光标灼烧圆：径向渐变填充 + 脉动外环
    const pulse = 1 + Math.sin(time * 10) * 0.06;
    const r = ch.radius * pulse;
    const grd = ctx.createRadialGradient(ch.x, ch.y, r * 0.2, ch.x, ch.y, r);
    grd.addColorStop(0, 'rgba(255,80,60,0.45)');
    grd.addColorStop(0.7, 'rgba(200,30,30,0.22)');
    grd.addColorStop(1, 'rgba(120,10,10,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(ch.x, ch.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,90,70,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ch.x, ch.y, r, 0, Math.PI * 2);
    ctx.stroke();
    // 中心集束白热点
    ctx.fillStyle = 'rgba(255,235,220,0.85)';
    ctx.beginPath();
    ctx.arc(ch.x, ch.y, 4, 0, Math.PI * 2);
    ctx.fill();
    // 超武「湮灭·无终」：选定目标的凸包能量罩 + 逐目标覆盖光斑
    if (ch.targets && ch.targets.length > 0) this.drawChannelHull(ch.targets, time);
    ctx.restore();
  }

  /**
   * 湮灭领域：几何流形由选定目标包围的图形决定——
   * 取目标点集的凸包作能量膜（呼吸涨落的填充 + 流动虹红描边），
   * 每个目标另罩一层脉动灼烧光斑（目标 <3 时退化为线/点）。
   * 调用方已开启 lighter 叠加。
   */
  private drawChannelHull(targets: { x: number; y: number }[], time: number): void {
    const { ctx } = this;
    const breathe = 0.75 + Math.sin(time * 8) * 0.25;
    // 逐目标覆盖光斑
    for (const t of targets) {
      const g = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, 16);
      g.addColorStop(0, `rgba(255,120,90,${0.5 * breathe})`);
      g.addColorStop(1, 'rgba(255,60,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    if (targets.length < 2) return;
    if (targets.length === 2) {
      // 两点退化：能量连线
      ctx.strokeStyle = `rgba(255,90,70,${0.5 * breathe})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(targets[0].x, targets[0].y);
      ctx.lineTo(targets[1].x, targets[1].y);
      ctx.stroke();
      return;
    }
    const hull = convexHull(targets);
    if (hull.length < 3) return;
    // 凸包能量膜：低透填充呼吸 + 双层描边
    ctx.beginPath();
    ctx.moveTo(hull[0].x, hull[0].y);
    for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i].x, hull[i].y);
    ctx.closePath();
    ctx.fillStyle = `rgba(255,50,40,${0.1 + 0.06 * breathe})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255,90,70,${0.55 * breathe + 0.2})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,220,200,${0.35 * breathe})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    // 凸包顶点能量节点
    ctx.fillStyle = `rgba(255,200,180,${0.7 * breathe + 0.15})`;
    for (const v of hull) {
      ctx.beginPath();
      ctx.arc(v.x, v.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
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
      // 直线光束（激光）：宽辉光 + 白热芯，随寿命收窄淡出
      if (b.width) {
        ctx.globalAlpha = a * 0.45;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.width * (0.6 + 0.4 * a) * 2.2;
        ctx.beginPath();
        ctx.moveTo(b.x1, b.y1);
        ctx.lineTo(b.x2, b.y2);
        ctx.stroke();
        ctx.globalAlpha = a;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1.5, b.width * a * 0.8);
        ctx.beginPath();
        ctx.moveTo(b.x1, b.y1);
        ctx.lineTo(b.x2, b.y2);
        ctx.stroke();
        continue;
      }
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
   * 近战剑光：新月形刃光随时间扫过弧面（而非静态扇形）。
   * - 前 55% 生命：刃口从一侧快速扫向另一侧（ease-out），身后留下渐薄的刃光带；
   * - 全程：整体半径缓慢外推，像剑气飞出去；
   * - 新月形：中段最厚、两端收尖，叠白热芯 + 刃口高光点。
   */
  private drawSlashes(slashes: Slash[]): void {
    const { ctx } = this;
    if (slashes.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const sl of slashes) {
      const g = slashGeometry(sl);
      const { fade, sweep, reach, a0, span, lead } = g;
      if (Math.abs(span) < 0.03) continue;

      // 新月主体：沿已扫弧采样，厚度 sin 包络（两端收尖）
      const steps = 18;
      const thick = reach * 0.3 * (0.45 + 0.55 * fade);
      this.crescentPath(sl.x, sl.y, a0, span, reach, thick, steps);
      ctx.globalAlpha = fade * 0.55;
      ctx.fillStyle = sl.color;
      ctx.fill();
      // 白热芯（更薄、贴外缘）
      this.crescentPath(sl.x, sl.y, a0, span, reach - 1.5, thick * 0.42, steps);
      ctx.globalAlpha = fade * 0.95;
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      // 刃口高光点：扫动期间追着刃口跑
      if (sweep < 1) {
        const hx = sl.x + Math.cos(lead) * (reach - thick * 0.4);
        const hy = sl.y + Math.sin(lead) * (reach - thick * 0.4);
        const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 14);
        g.addColorStop(0, 'rgba(255,255,255,0.9)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = fade;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(hx, hy, 14, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** 构建新月形路径：外弧半径 r，内弧按 sin 包络向内收（两端尖、中段厚） */
  private crescentPath(
    cx: number,
    cy: number,
    a0: number,
    span: number,
    r: number,
    thick: number,
    steps: number,
  ): void {
    const { ctx } = this;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const ang = a0 + span * u;
      const px = cx + Math.cos(ang) * r;
      const py = cy + Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    for (let i = steps; i >= 0; i--) {
      const u = i / steps;
      const ang = a0 + span * u;
      const w = Math.sin(Math.PI * u) * thick + 1;
      ctx.lineTo(cx + Math.cos(ang) * (r - w), cy + Math.sin(ang) * (r - w));
    }
    ctx.closePath();
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
    const dbands: Destructible[][] = [];
    for (let k = 0; k <= n; k++) {
      bands.push([]);
      dbands.push([]);
    }
    for (const e of s.enemies) bands[bandOf(e.y)].push(e);
    for (const d of s.destructibles) if (d.hp > 0) dbands[bandOf(d.baseY)].push(d);
    const pBand = bandOf(s.player.y);
    for (let k = 0; k <= n; k++) {
      // 道具先于敌人绘制（同带内作为地面物位于其后）
      for (const d of dbands[k]) this.drawDestructible(d, s.time);
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

  /** 可破坏道具：各地图不同造型，受击白闪 + 该伤时显血条 */
  private drawDestructible(d: Destructible, time: number): void {
    const { ctx } = this;
    const { x, y, scale: s } = d;
    const r = DESTRUCTIBLES.radius * s;
    // 地面接触阴影
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(x, y - 2 * s, r * 1.15, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    switch (this.mapId) {
      case 'forest':
        this.drawCrate(d, '#6b4d2a');
        break;
      case 'village':
        if (d.type === 0) this.drawBarrel(d);
        else this.drawCrate(d, '#7a5a30');
        break;
      case 'ruins':
        this.drawTechCrate(d, time);
        break;
    }

    // 受击白闪（叠加一层半透明白光）
    if (d.hitFlash > 0) {
      ctx.globalAlpha = Math.min(0.7, d.hitFlash / 0.09 * 0.6);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(d.cx, d.cy, r * 0.95, r * 1.05, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 受损时显示血条
    if (d.hp < d.maxHp && d.hp > 0) {
      const bw = r * 2;
      const pct = Math.max(0, d.hp / d.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - bw / 2, d.cy - r - 8, bw, 3.5);
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(x - bw / 2, d.cy - r - 8, bw * pct, 3.5);
    }
  }

  /** 木箱：木板箱体 + 十字支撑 + 顶面受光（森林/村庄通用） */
  private drawCrate(d: Destructible, tint: string): void {
    const { ctx } = this;
    const { x, y, scale: s } = d;
    const bw = 2.0 * DESTRUCTIBLES.radius * s;
    const bh = 1.9 * DESTRUCTIBLES.radius * s;
    const x0 = x - bw / 2;
    const y0 = y - bh;
    const g = ctx.createLinearGradient(0, y0, 0, y);
    g.addColorStop(0, '#8a6636');
    g.addColorStop(0.5, tint);
    g.addColorStop(1, '#3f2c16');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, bw, bh);
    // 边框
    ctx.strokeStyle = 'rgba(30,18,8,0.7)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 1, y0 + 1, bw - 2, bh - 2);
    // 十字支撑
    ctx.strokeStyle = 'rgba(20,12,5,0.55)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x0 + 2, y0 + 2);
    ctx.lineTo(x0 + bw - 2, y - 2);
    ctx.moveTo(x0 + bw - 2, y0 + 2);
    ctx.lineTo(x0 + 2, y - 2);
    ctx.stroke();
    // 顶缘高光
    ctx.strokeStyle = 'rgba(220,190,140,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0 + 2, y0 + 2.5);
    ctx.lineTo(x0 + bw - 2, y0 + 2.5);
    ctx.stroke();
  }

  /** 酒桶：木身 + 金属箍（废弃村庄） */
  private drawBarrel(d: Destructible): void {
    const { ctx } = this;
    const { x, y, scale: s } = d;
    const bw = 1.7 * DESTRUCTIBLES.radius * s;
    const bh = 2.0 * DESTRUCTIBLES.radius * s;
    const x0 = x - bw / 2;
    const y0 = y - bh;
    const g = ctx.createLinearGradient(x0, 0, x0 + bw, 0);
    g.addColorStop(0, '#3a2914');
    g.addColorStop(0.45, '#6b4d28');
    g.addColorStop(1, '#2c1f0f');
    ctx.fillStyle = g;
    // 桶身（中部微鼓）
    ctx.beginPath();
    ctx.moveTo(x0, y0 + 3 * s);
    ctx.quadraticCurveTo(x - bw * 0.62, y - bh / 2, x0, y - 3 * s);
    ctx.lineTo(x0 + bw, y - 3 * s);
    ctx.quadraticCurveTo(x + bw * 0.62, y - bh / 2, x0 + bw, y0 + 3 * s);
    ctx.closePath();
    ctx.fill();
    // 金属箍
    ctx.strokeStyle = 'rgba(180,180,190,0.5)';
    ctx.lineWidth = 2.5 * s;
    for (const fy of [y0 + bh * 0.22, y - bh * 0.22]) {
      ctx.beginPath();
      ctx.moveTo(x0 + 1, fy);
      ctx.lineTo(x0 + bw - 1, fy);
      ctx.stroke();
    }
    // 竖板缝
    ctx.strokeStyle = 'rgba(20,12,5,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - bw * 0.16, y0 + 4 * s);
    ctx.lineTo(x - bw * 0.16, y - 4 * s);
    ctx.moveTo(x + bw * 0.16, y0 + 4 * s);
    ctx.lineTo(x + bw * 0.16, y - 4 * s);
    ctx.stroke();
  }

  /** 霓虹能量箱：暗金属箱体 + 发光接缝（赛博废墟） */
  private drawTechCrate(d: Destructible, time: number): void {
    const { ctx } = this;
    const { x, y, scale: s, seed } = d;
    const bw = 2.0 * DESTRUCTIBLES.radius * s;
    const bh = 1.9 * DESTRUCTIBLES.radius * s;
    const x0 = x - bw / 2;
    const y0 = y - bh;
    const neon = d.type === 0 ? '#5ce1ff' : '#b56cff';
    const g = ctx.createLinearGradient(0, y0, 0, y);
    g.addColorStop(0, '#2a2550');
    g.addColorStop(0.5, '#1a1440');
    g.addColorStop(1, '#100c28');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, bw, bh);
    // 外框
    ctx.strokeStyle = 'rgba(120,110,200,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 1, y0 + 1, bw - 2, bh - 2);
    // 发光接缝（十字）+ 轻微脉动
    const phase = (seed % 628) / 100;
    const pulse = 0.55 + 0.3 * Math.sin(time * 2 + phase);
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = neon;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y0 + 4);
    ctx.lineTo(x, y - 4);
    ctx.moveTo(x0 + 4, y - bh / 2);
    ctx.lineTo(x0 + bw - 4, y - bh / 2);
    ctx.stroke();
    // 中心发光点
    const cxp = x;
    const cyp = y - bh / 2;
    const glow = ctx.createRadialGradient(cxp, cyp, 0, cxp, cyp, bw * 0.55);
    glow.addColorStop(0, neon);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = pulse * 0.5;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cxp, cyp, bw * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
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
        // 飞行拖尾：沿速度反方向的渐隐流光（单条，非残影），让刀的轨迹可感知
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > 1) {
          const tx = -p.vx / sp;
          const ty = -p.vy / sp;
          const len = Math.min(52, sp * 0.1);
          const trail = ctx.createLinearGradient(p.x, p.y, p.x + tx * len, p.y + ty * len);
          trail.addColorStop(0, 'rgba(232,238,247,0.55)');
          trail.addColorStop(1, 'transparent');
          ctx.strokeStyle = trail;
          ctx.lineWidth = p.radius * 0.9;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + tx * len, p.y + ty * len);
          ctx.stroke();
        }
        // spinning blade with a bright edge（视觉放大 1.5 倍，命中判定不变）
        const r = p.radius * 1.5;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        const glow = ctx.createLinearGradient(-r, 0, r * 1.8, 0);
        glow.addColorStop(0, 'transparent');
        glow.addColorStop(1, p.color);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.moveTo(r * 1.8, 0);
        ctx.lineTo(-r, r * 0.6);
        ctx.lineTo(-r, -r * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(r * 1.8, 0);
        ctx.lineTo(-r * 0.2, r * 0.22);
        ctx.lineTo(-r * 0.2, -r * 0.22);
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
      // 剑客：先画背后的剑（位于身体下方），再画身体
      if (p.charId === 'swordsman') this.drawSwordGear(p);

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
      ctx.save();
      const ang = Math.atan2(p.facing.y, p.facing.x);
      ctx.rotate(ang);
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.moveTo(p.radius + 6, 0);
      ctx.lineTo(p.radius - 2, 4);
      ctx.lineTo(p.radius - 2, -4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // 标志性装扮（画在身体之上）
      if (p.charId === 'mage') this.drawMageHat(p);
      else if (p.charId === 'swordsman') this.drawHeadband(p);
    }
    ctx.restore();
  }

  /** 法师：头顶巧帽（锥帽 + 帽檐 + 金带与帽尖星光）。坐标为玩家局部。 */
  private drawMageHat(p: Player): void {
    const { ctx } = this;
    const hr = p.radius;
    ctx.save();
    ctx.translate(0, -hr * 0.55);
    // 帽檐
    ctx.fillStyle = '#3a2a6b';
    ctx.beginPath();
    ctx.ellipse(0, 0, hr * 1.25, hr * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    // 锥体（向右小幅倒）
    const tipX = hr * 0.55;
    const tipY = -hr * 2.4;
    const grd = ctx.createLinearGradient(-hr, 0, hr, tipY);
    grd.addColorStop(0, '#5a3fb0');
    grd.addColorStop(1, '#281a52');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(-hr * 0.72, -hr * 0.05);
    ctx.quadraticCurveTo(tipX * 0.2, -hr * 1.2, tipX, tipY);
    ctx.quadraticCurveTo(hr * 0.55, -hr * 0.55, hr * 0.72, -hr * 0.05);
    ctx.closePath();
    ctx.fill();
    // 金带
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-hr * 0.66, -hr * 0.1);
    ctx.quadraticCurveTo(0, -hr * 0.42, hr * 0.66, -hr * 0.1);
    ctx.stroke();
    // 帽尖星光
    ctx.fillStyle = '#ffe28a';
    ctx.beginPath();
    ctx.arc(tipX, tipY, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** 剑客：红色头带 + 飘带（头部上方）。坐标为玩家局部。 */
  private drawHeadband(p: Player): void {
    const { ctx } = this;
    const r = p.radius;
    ctx.fillStyle = '#d64550';
    ctx.fillRect(-r * 0.92, -r * 0.62, r * 1.84, r * 0.3);
    // 向左飘动的飘带
    ctx.beginPath();
    ctx.moveTo(-r * 0.9, -r * 0.58);
    ctx.lineTo(-r * 1.55, -r * 0.16);
    ctx.lineTo(-r * 1.2, -r * 0.08);
    ctx.lineTo(-r * 0.9, -r * 0.34);
    ctx.closePath();
    ctx.fill();
  }

  /** 剑客：手持长剑（朝面向方向，挥剑时随 attackAnim 沿 attackDir 扫过一道弧）。 */
  private drawSwordGear(p: Player): void {
    const { ctx } = this;
    const r = p.radius;
    const face = Math.atan2(p.facing.y, p.facing.x);
    // 挥剑扫弧：attackAnim(0.2..0) 期间从起刃侧扫到收刃侧（ease-out，与剑光同步方向）
    let swing = -0.35 * p.attackDir;
    if (p.attackAnim > 0) {
      const t = 1 - p.attackAnim / 0.2; // 0..1
      const eased = 1 - (1 - t) ** 3;
      swing = (-1.05 + eased * 2.1) * p.attackDir;
    }
    ctx.save();
    ctx.rotate(face + swing);
    // 护手
    ctx.strokeStyle = '#c9a24a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(r * 0.6, -4.5);
    ctx.lineTo(r * 0.6, 4.5);
    ctx.stroke();
    // 剑身
    const bl = r * 2.0;
    const bgrad = ctx.createLinearGradient(r * 0.7, 0, r * 0.7 + bl, 0);
    bgrad.addColorStop(0, '#eef3fb');
    bgrad.addColorStop(1, '#9fb2c9');
    ctx.fillStyle = bgrad;
    ctx.beginPath();
    ctx.moveTo(r * 0.7, -2.6);
    ctx.lineTo(r * 0.7 + bl, 0);
    ctx.lineTo(r * 0.7, 2.6);
    ctx.closePath();
    ctx.fill();
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
    ctx.lineJoin = 'round';
    for (const t of texts) {
      const a = Math.min(1, t.life * 2);
      ctx.globalAlpha = a;
      if (t.crit) {
        // 暴击：生命初期瞬间放大回弹，配暗色描边与发光，从伤害洪流中跳出
        const pop = 1 + 0.5 * Math.max(0, t.life - 0.55) * 10;
        ctx.font = `800 ${t.size * pop}px "Segoe UI", sans-serif`;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(90,30,0,0.9)';
        ctx.strokeText(t.text, t.x, t.y);
        ctx.shadowColor = t.color;
        ctx.shadowBlur = 12;
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = t.color;
        ctx.font = `700 ${t.size}px "Segoe UI", sans-serif`;
        ctx.fillText(t.text, t.x, t.y);
      }
    }
    ctx.globalAlpha = 1;
  }
}
