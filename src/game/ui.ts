// DOM-based UI: start menu, HUD, level-up selection, pause and game-over.

import { Choice } from './skills';
import { formatTime } from './math';
import { GAME_MODES, GameMode, MAPS, MapId } from './config';

export interface HudData {
  hp: number;
  maxHp: number;
  xp: number;
  xpToNext: number;
  level: number;
  time: number;
  kills: number;
  tray: { icon: string; level: number }[];
  /** 限时模式：剩余秒数（存在时时间栏显示倒计时） */
  countdown?: number;
}

export interface GameOverData {
  time: number;
  level: number;
  kills: number;
  victory: boolean;
}

export class UI {
  private root: HTMLElement;

  // cached HUD nodes
  private hpFill!: HTMLElement;
  private hpLabel!: HTMLElement;
  private xpFill!: HTMLElement;
  private timeEl!: HTMLElement;
  private levelEl!: HTMLElement;
  private killsEl!: HTMLElement;
  private trayEl!: HTMLElement;
  private hudEl!: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.buildHud();
  }

  // ---------------- HUD ----------------
  private buildHud(): void {
    const hud = document.createElement('div');
    hud.className = 'hud hidden';
    hud.innerHTML = `
      <div class="hud-top">
        <div class="hud-stats">
          <span class="stat-time" id="ui-time">0:00</span>
          <span class="hud-level" id="ui-level">Lv.1</span>
          <span class="stat-chip">击杀 <b id="ui-kills">0</b></span>
        </div>
        <div class="bar bar-hp">
          <div class="bar-fill" id="ui-hp-fill"></div>
          <div class="bar-label" id="ui-hp-label">100 / 100</div>
        </div>
        <div class="bar bar-xp">
          <div class="bar-fill" id="ui-xp-fill"></div>
        </div>
      </div>
      <div class="tray" id="ui-tray"></div>
      <div class="pause-hint">P / ESC 暂停</div>
    `;
    this.root.appendChild(hud);
    this.hudEl = hud;
    this.hpFill = hud.querySelector('#ui-hp-fill')!;
    this.hpLabel = hud.querySelector('#ui-hp-label')!;
    this.xpFill = hud.querySelector('#ui-xp-fill')!;
    this.timeEl = hud.querySelector('#ui-time')!;
    this.levelEl = hud.querySelector('#ui-level')!;
    this.killsEl = hud.querySelector('#ui-kills')!;
    this.trayEl = hud.querySelector('#ui-tray')!;
  }

  setHudVisible(v: boolean): void {
    this.hudEl.classList.toggle('hidden', !v);
  }

  updateHud(d: HudData): void {
    this.hpFill.style.transform = `scaleX(${Math.max(0, d.hp / d.maxHp)})`;
    this.hpLabel.textContent = `${Math.ceil(Math.max(0, d.hp))} / ${d.maxHp}`;
    this.xpFill.style.transform = `scaleX(${Math.max(0, Math.min(1, d.xp / d.xpToNext))})`;
    this.timeEl.textContent =
      d.countdown !== undefined ? `剩余 ${formatTime(d.countdown)}` : formatTime(d.time);
    this.levelEl.textContent = `Lv.${d.level}`;
    this.killsEl.textContent = String(d.kills);

    // tray (rebuild only when count/levels change)
    const sig = d.tray.map((t) => `${t.icon}${t.level}`).join('|');
    if (this.trayEl.dataset.sig !== sig) {
      this.trayEl.dataset.sig = sig;
      this.trayEl.innerHTML = d.tray
        .map(
          (t) => `<div class="tray-slot">${t.icon}<span class="lvl">${t.level}</span></div>`,
        )
        .join('');
    }
  }

  // ---------------- Overlays ----------------
  private clearOverlay(): void {
    this.root.querySelectorAll('.overlay').forEach((el) => el.remove());
  }

  private addOverlay(html: string): HTMLElement {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = html;
    this.root.appendChild(ov);
    return ov;
  }

  showStart(onStart: (mode: GameMode, map: MapId | 'random') => void): void {
    this.clearOverlay();
    this.setHudVisible(false);
    let mode: GameMode = 'endless';
    let map: MapId | 'random' = 'random';
    const modeChips = (Object.keys(GAME_MODES) as GameMode[])
      .map(
        (id) => `
        <div class="select-chip ${id === mode ? 'active' : ''}" data-mode="${id}">
          <b>${GAME_MODES[id].name}</b><span>${GAME_MODES[id].desc}</span>
        </div>`,
      )
      .join('');
    const mapChips = (Object.keys(MAPS) as MapId[])
      .map(
        (id) => `
        <div class="select-chip select-chip-sm" data-map="${id}" title="${MAPS[id].desc}">
          <b>${MAPS[id].name}</b>
        </div>`,
      )
      .join('');
    const ov = this.addOverlay(`
      <div class="panel">
        <div class="title">暗夜幸存者</div>
        <div class="subtitle">在无尽的敌潮中生存下来。击败敌人获取经验，升级以习得或强化你的技能。</div>
        <div class="controls">
          <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 或 方向键 &nbsp;移动</div>
          <div>武器<b style="color:var(--accent)"> 自动攻击 </b>最近的敌人</div>
          <div><kbd>P</kbd> / <kbd>ESC</kbd> 暂停游戏</div>
        </div>
        <div class="select-group">
          <div class="select-label">模式</div>
          <div class="select-row" id="ui-modes">${modeChips}</div>
        </div>
        <div class="select-group">
          <div class="select-label">地图</div>
          <div class="select-row" id="ui-maps">${mapChips}
            <div class="select-chip select-chip-sm active" data-map="random" title="每局从三张地图中随机选择">
              <b>🎲 随机地图</b>
            </div>
          </div>
        </div>
        <button class="btn" id="ui-start">开始游戏</button>
      </div>
    `);
    // 选择切换：点击芯片高亮选中态
    ov.querySelectorAll<HTMLElement>('#ui-modes .select-chip').forEach((el) => {
      el.addEventListener('click', () => {
        ov.querySelectorAll('#ui-modes .select-chip').forEach((c) => c.classList.remove('active'));
        el.classList.add('active');
        mode = el.dataset.mode as GameMode;
      });
    });
    ov.querySelectorAll<HTMLElement>('#ui-maps .select-chip').forEach((el) => {
      el.addEventListener('click', () => {
        ov.querySelectorAll('#ui-maps .select-chip').forEach((c) => c.classList.remove('active'));
        el.classList.add('active');
        map = el.dataset.map as MapId | 'random';
      });
    });
    ov.querySelector<HTMLButtonElement>('#ui-start')!.addEventListener('click', () => {
      this.clearOverlay();
      onStart(mode, map);
    });
  }

  showLevelUp(choices: Choice[], onPick: (c: Choice) => void, onReroll: (() => void) | null = null): void {
    this.clearOverlay();
    const cards = choices
      .map(
        (c, i) => `
        <div class="card" data-idx="${i}">
          <div class="card-icon">${c.icon}</div>
          <div class="card-name">${c.name}</div>
          <span class="card-tag ${c.tagClass}">${c.tag}</span>
          <div class="card-desc">${c.desc}</div>
          <div class="card-lvl">${c.levelText}</div>
        </div>`,
      )
      .join('');
    const rerollBtn = onReroll
      ? `<button class="btn btn-ghost" id="ui-reroll">🎲 重随 (R)</button>`
      : `<button class="btn btn-ghost" id="ui-reroll" disabled style="opacity:.4;cursor:default">🎲 重随 已用</button>`;
    const ov = this.addOverlay(`
      <div class="panel">
        <div class="levelup-title">⬆ 升级！</div>
        <div class="levelup-sub">选择一项强化 &nbsp;(按 <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> 快速选择)</div>
        <div class="cards">${cards}</div>
        <div style="margin-top:16px">${rerollBtn}</div>
      </div>
    `);
    const cleanup = () => window.removeEventListener('keydown', keyHandler);
    const pick = (idx: number) => {
      if (idx < 0 || idx >= choices.length) return;
      cleanup();
      this.clearOverlay();
      onPick(choices[idx]);
    };
    const reroll = () => {
      if (!onReroll) return;
      cleanup();
      this.clearOverlay();
      onReroll();
    };
    ov.querySelectorAll<HTMLElement>('.card').forEach((el) => {
      el.addEventListener('click', () => pick(Number(el.dataset.idx)));
    });
    if (onReroll) {
      ov.querySelector<HTMLButtonElement>('#ui-reroll')!.addEventListener('click', reroll);
    }
    // keyboard: 1/2/3 to pick, R to re-roll
    const keyHandler = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'r') {
        reroll();
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= choices.length) pick(n - 1);
    };
    window.addEventListener('keydown', keyHandler);
  }

  showPause(onResume: () => void, onRestart: () => void, onMenu: () => void): void {
    this.clearOverlay();
    const ov = this.addOverlay(`
      <div class="panel">
        <div class="levelup-title">⏸ 已暂停</div>
        <div class="levelup-sub">休息一下。</div>
        <button class="btn" id="ui-resume">继续</button>
        <button class="btn btn-ghost" id="ui-restart">重新开始</button>
        <button class="btn btn-ghost" id="ui-pause-menu">返回菜单</button>
      </div>
    `);
    ov.querySelector<HTMLButtonElement>('#ui-resume')!.addEventListener('click', () => {
      this.clearOverlay();
      onResume();
    });
    ov.querySelector<HTMLButtonElement>('#ui-restart')!.addEventListener('click', () => {
      this.clearOverlay();
      onRestart();
    });
    ov.querySelector<HTMLButtonElement>('#ui-pause-menu')!.addEventListener('click', () => {
      this.clearOverlay();
      onMenu();
    });
  }

  hidePause(): void {
    this.clearOverlay();
  }

  showGameOver(d: GameOverData, onRestart: () => void, onMenu: () => void): void {
    this.clearOverlay();
    const title = d.victory ? '🏆 胜利！' : '💀 你倒下了';
    const sub = d.victory ? '你在暗夜中坚持到了最后。' : '暗夜吞没了你，但你战斗得很英勇。';
    const ov = this.addOverlay(`
      <div class="panel">
        <div class="title">${title}</div>
        <div class="subtitle">${sub}</div>
        <div class="result-grid">
          <div class="result-cell"><div class="val">${formatTime(d.time)}</div><div class="lbl">存活时间</div></div>
          <div class="result-cell"><div class="val">${d.level}</div><div class="lbl">等级</div></div>
          <div class="result-cell"><div class="val">${d.kills}</div><div class="lbl">击杀数</div></div>
        </div>
        <button class="btn" id="ui-again">再来一局</button>
        <button class="btn btn-ghost" id="ui-menu">返回菜单</button>
      </div>
    `);
    ov.querySelector<HTMLButtonElement>('#ui-again')!.addEventListener('click', () => {
      this.clearOverlay();
      onRestart();
    });
    ov.querySelector<HTMLButtonElement>('#ui-menu')!.addEventListener('click', () => {
      this.clearOverlay();
      onMenu();
    });
  }
}
