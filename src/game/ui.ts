// DOM-based UI: start menu, HUD, level-up selection, pause and game-over.

import { Choice, WEAPONS as WEAPON_REGISTRY, getWeaponDef } from './skills';
import { formatTime } from './math';
import { GAME_MODES, GameMode, MAPS, MapId, CHARACTERS, CharacterId } from './config';
import { audio } from './audio';

/** 训练模式装备项：武器 id + 等级（evolved 为超武） */
export interface TrainLoadoutItem {
  id: string;
  level: number;
  evolved: boolean;
}

export interface HudData {
  hp: number;
  maxHp: number;
  xp: number;
  xpToNext: number;
  level: number;
  time: number;
  kills: number;
  tray: { icon: string; level: number; mode: 'auto' | 'active'; evolved: boolean }[];
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
  private muteBtn!: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.buildHud();
    this.buildMuteButton();
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

  // ---------------- Mute button ----------------
  /** 常驻右上角的静音开关（与键盘 M 同步） */
  private buildMuteButton(): void {
    const btn = document.createElement('button');
    btn.className = 'mute-btn';
    btn.title = '静音 / 开启声音 (M)';
    btn.addEventListener('click', () => this.toggleMute());
    this.root.appendChild(btn);
    this.muteBtn = btn;
    this.updateMuteIcon();
  }

  private updateMuteIcon(): void {
    this.muteBtn.textContent = audio.muted ? '🔇' : '🔊';
    this.muteBtn.classList.toggle('muted', audio.muted);
  }

  /** 切换静音；键盘 M 与按钮点击共用 */
  toggleMute(): void {
    audio.toggleMute();
    this.updateMuteIcon();
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
    const sig = d.tray.map((t) => `${t.icon}${t.level}${t.mode}${t.evolved ? 'E' : ''}`).join('|');
    if (this.trayEl.dataset.sig !== sig) {
      this.trayEl.dataset.sig = sig;
      this.trayEl.innerHTML = d.tray
        .map(
          (t) =>
            `<div class="tray-slot ${t.evolved ? 'slot-evo' : t.mode === 'active' ? 'slot-active' : 'slot-auto'}">${t.icon}<span class="lvl${t.evolved ? ' lvl-evo' : ''}">${t.evolved ? 'EX' : t.level}</span></div>`,
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

  showStart(
    onStart: (mode: GameMode, map: MapId | 'random', char: CharacterId, loadout: TrainLoadoutItem[] | null) => void,
  ): void {
    this.clearOverlay();
    this.setHudVisible(false);
    let mode: GameMode = 'endless';
    let map: MapId | 'random' = 'random';
    let char: CharacterId = 'mage';
    // 训练模式装备：武器 id -> 等级（0 不带，9 代表 EX 超武）
    const trainLevels = new Map<string, number>();
    // 开发者选项：训练模式默认隐藏，连点标题「幸」字 5 下切换显隐（持久化）
    const DEV_KEY = 'eo-devmode';
    let devMode = localStorage.getItem(DEV_KEY) === '1';
    const modeChips = (Object.keys(GAME_MODES) as GameMode[])
      .map((id) => {
        // 训练模式为开发者选项，未解锁时隐藏其芯片
        const attrs =
          id === 'training' ? ` id="ui-train-chip"${devMode ? '' : ' style="display:none"'}` : '';
        return `
        <div class="select-chip ${id === mode ? 'active' : ''}" data-mode="${id}"${attrs}>
          <b>${GAME_MODES[id].name}</b><span>${GAME_MODES[id].desc}</span>
        </div>`;
      })
      .join('');
    const charChips = (Object.keys(CHARACTERS) as CharacterId[])
      .map(
        (id) => `
        <div class="select-chip ${id === char ? 'active' : ''}" data-char="${id}" title="${CHARACTERS[id].trait}">
          <b>${CHARACTERS[id].icon} ${CHARACTERS[id].name}</b><span>${CHARACTERS[id].desc}</span>
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
    // 训练模式武器配置芯片：点击循环 —→Lv.1→Lv.4→Lv.8→EX（可进化武器）→—
    const trainChips = Array.from(WEAPON_REGISTRY.values())
      .map(
        (w) => `
        <div class="train-chip" data-tw="${w.id}" title="${w.name}">
          <span class="t-icon">${w.icon}</span><span class="t-name">${w.name}</span><span class="t-lvl">—</span>
        </div>`,
      )
      .join('');
    const ov = this.addOverlay(`
      <div class="panel">
        <div class="title">暗夜<span id="ui-secret" class="secret-tap">幸</span>存者</div>
        <div class="subtitle">在无尽的敌潮中生存下来。击败敌人获取经验，升级以习得或强化你的技能。</div>
        <div class="controls">
          <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 或 方向键 &nbsp;移动</div>
          <div>自动武器<b style="color:var(--accent)"> 自动攻击 </b>敌人，主动武器用 <kbd>鼠标左键</kbd> 朝光标施放</div>
          <div><kbd>P</kbd> / <kbd>ESC</kbd> 暂停游戏</div>
        </div>
        <div class="select-group">
          <div class="select-label">角色</div>
          <div class="select-row" id="ui-chars">${charChips}</div>
        </div>
        <div class="select-group">
          <div class="select-label">模式</div>
          <div class="select-row" id="ui-modes">${modeChips}</div>
        </div>
        <div class="select-group" id="ui-train-group" style="display:none">
          <div class="select-label">训练装备（点击武器循环等级；不选则用职业初始武器）</div>
          <div class="train-grid">${trainChips}</div>
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
    // 角色选择
    ov.querySelectorAll<HTMLElement>('#ui-chars .select-chip').forEach((el) => {
      el.addEventListener('click', () => {
        ov.querySelectorAll('#ui-chars .select-chip').forEach((c) => c.classList.remove('active'));
        el.classList.add('active');
        char = el.dataset.char as CharacterId;
      });
    });
    // 选择切换：点击芯片高亮选中态；训练模式时展开装备配置区
    const trainGroup = ov.querySelector<HTMLElement>('#ui-train-group')!;
    ov.querySelectorAll<HTMLElement>('#ui-modes .select-chip').forEach((el) => {
      el.addEventListener('click', () => {
        ov.querySelectorAll('#ui-modes .select-chip').forEach((c) => c.classList.remove('active'));
        el.classList.add('active');
        mode = el.dataset.mode as GameMode;
        trainGroup.style.display = mode === 'training' ? '' : 'none';
      });
    });
    // 开发者选项：连点标题「幸」字 5 下切换训练模式显隐（1.5s 无点击则重置计数）
    const trainChip = ov.querySelector<HTMLElement>('#ui-train-chip')!;
    let secretClicks = 0;
    let secretResetTimer = 0;
    ov.querySelector<HTMLElement>('#ui-secret')!.addEventListener('click', () => {
      window.clearTimeout(secretResetTimer);
      secretResetTimer = window.setTimeout(() => (secretClicks = 0), 1500);
      if (++secretClicks < 5) return;
      secretClicks = 0;
      devMode = !devMode;
      localStorage.setItem(DEV_KEY, devMode ? '1' : '0');
      trainChip.style.display = devMode ? '' : 'none';
      // 关闭时若正选中训练模式，回退到无尽模式
      if (!devMode && mode === 'training') {
        mode = 'endless';
        ov.querySelectorAll('#ui-modes .select-chip').forEach((c) => c.classList.remove('active'));
        ov.querySelector('#ui-modes .select-chip[data-mode="endless"]')!.classList.add('active');
        trainGroup.style.display = 'none';
      }
    });
    // 训练装备：点击循环等级；主动武器互斥（每局限一把，与正式规则一致）
    const lvlText = (lv: number) => (lv === 0 ? '—' : lv === 9 ? 'EX' : `Lv.${lv}`);
    ov.querySelectorAll<HTMLElement>('.train-chip').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.tw!;
        const def = getWeaponDef(id);
        const cycle = def.evolve ? [0, 1, 4, 8, 9] : [0, 1, 4, 8];
        const cur = trainLevels.get(id) ?? 0;
        const next = cycle[(cycle.indexOf(cur) + 1) % cycle.length];
        trainLevels.set(id, next);
        if (next > 0 && def.mode === 'active') {
          for (const other of WEAPON_REGISTRY.values()) {
            if (other.id !== id && other.mode === 'active' && (trainLevels.get(other.id) ?? 0) > 0) {
              trainLevels.set(other.id, 0);
              const oel = ov.querySelector<HTMLElement>(`.train-chip[data-tw="${other.id}"]`)!;
              oel.classList.remove('on');
              oel.querySelector('.t-lvl')!.textContent = '—';
            }
          }
        }
        el.classList.toggle('on', next > 0);
        el.querySelector('.t-lvl')!.textContent = lvlText(next);
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
      let loadout: TrainLoadoutItem[] | null = null;
      if (mode === 'training') {
        loadout = [];
        for (const [id, lv] of trainLevels) {
          if (lv > 0) loadout.push({ id, level: lv === 9 ? 8 : lv, evolved: lv === 9 });
        }
      }
      onStart(mode, map, char, loadout);
    });
  }

  showLevelUp(choices: Choice[], onPick: (c: Choice) => void, onReroll: (() => void) | null = null): void {
    this.clearOverlay();
    const cards = choices
      .map(
        (c, i) => `
        <div class="card${c.type === 'evolve-weapon' ? ' card-evo' : ''}" data-idx="${i}">
          <div class="card-icon">${c.icon}</div>
          <div class="card-name">${c.name}</div>
          <span class="card-tag ${c.tagClass}">${c.tag}</span>${c.mode ? `<span class="card-mode ${c.mode === 'active' ? 'mode-active' : 'mode-auto'}">${c.mode === 'active' ? '🖱 主动' : '⚙ 自动'}</span>` : ''}
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
