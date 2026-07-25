// Canvas renderer. Draws the world relative to a camera centered on the player.

import { Enemy, FloatingText, Gem, Particle, Player, Projectile } from './entities';

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

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
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

    this.drawBackground(camX, camY, w, h);
    this.drawGems(s.gems, s.time);
    this.drawAuras(s.projectiles, s.time);
    this.drawFields(s.projectiles, s.time);
    this.drawBeams(s.beams);
    this.drawEnemies(s.enemies);
    this.drawProjectiles(s.projectiles, s.time);
    this.drawPlayer(s.player, s.time);
    this.drawParticles(s.particles);
    this.drawTexts(s.texts);

    ctx.restore();

    // Vignette
    const grd = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.85);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
  }

  private drawBackground(camX: number, camY: number, w: number, h: number): void {
    const { ctx } = this;
    const grid = 64;
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(camX, camY, w, h);
    ctx.strokeStyle = 'rgba(120,140,180,0.06)';
    ctx.lineWidth = 1;
    const startX = Math.floor(camX / grid) * grid;
    const startY = Math.floor(camY / grid) * grid;
    ctx.beginPath();
    for (let x = startX; x < camX + w + grid; x += grid) {
      ctx.moveTo(x, camY);
      ctx.lineTo(x, camY + h);
    }
    for (let y = startY; y < camY + h + grid; y += grid) {
      ctx.moveTo(camX, y);
      ctx.lineTo(camX + w, y);
    }
    ctx.stroke();
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
      ctx.setLineDash([14, 12]);
      ctx.lineDashOffset = frost ? time * 40 : -time * 40;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.94, 0, Math.PI * 2);
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
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private drawEnemies(enemies: Enemy[]): void {
    const { ctx } = this;
    for (const e of enemies) {
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
