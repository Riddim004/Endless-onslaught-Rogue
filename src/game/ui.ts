// DOM-based UI: start menu, HUD, level-up selection, pause and game-over.

import { Choice, WEAPONS as WEAPON_REGISTRY, getWeaponDef } from './skills';
import { formatTime } from './math';
import { GAME_MODES, GameMode, MAPS, MapId, CHARACTERS, CharacterId } from './config';
import { audio } from './audio';
import { meta, COSMETICS, COINS_PER_KILLS, RunResult } from './meta';

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
  run: RunResult; // 本局获得货币与新纪录
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

  /** 排行榜 HTML（按击杀降序的前几名），供开始菜单渲染 */
  private leaderboardHtml(): string {
    const rows = meta.scores;
    if (rows.length === 0) {
      return '<div class="lb-empty">暂无记录 —— 开始你的第一局吧</div>';
    }
    const medals = ['🥇', '🥈', '🥉'];
    return rows
      .map((s, i) => {
        const char = CHARACTERS[s.char as CharacterId];
        const icon = char ? char.icon : '❓';
        const modeName = GAME_MODES[s.mode as GameMode]?.name ?? s.mode;
        const rank = medals[i] ?? `<span class="lb-num">${i + 1}</span>`;
        return `<div class="lb-row">
          <span class="lb-rank">${rank}</span>
          <span class="lb-char">${icon}</span>
          <span class="lb-kills"><b>${s.kills}</b> 击杀</span>
          <span class="lb-sub">⏱ ${formatTime(s.time)} · ⭐${s.level} · ${modeName}</span>
        </div>`;
      })
      .join('');
  }

  showStart(
    onStart: (mode: GameMode, map: MapId | 'random', char: CharacterId, loadout: TrainLoadoutItem[] | null) => void,
    onShop: () => void = () => {},
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
      <div class="start-screen">
        <header class="start-header">
          <div class="start-brand">
            <div class="title">暗夜<span id="ui-secret" class="secret-tap">幸</span>存者</div>
            <div class="start-tagline">在无尽敌潮中生存，升级构筑，活到最后。</div>
          </div>
          <div class="start-meta">
            <span class="meta-coins">🪙 ${meta.coins}</span>
            <button class="btn btn-ghost meta-shop" id="ui-shop">🛒 商店</button>
          </div>
        </header>
        <div class="start-body">
          <div class="start-col">
            <div class="select-group">
              <div class="select-label">角色</div>
              <div class="select-row" id="ui-chars">${charChips}</div>
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
          </div>
          <div class="start-col">
            <div class="select-group">
              <div class="select-label">排行榜 · 按击杀</div>
              <div class="leaderboard">${this.leaderboardHtml()}</div>
            </div>
            <div class="select-group">
              <div class="select-label">操作</div>
              <div class="controls">
                <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 或 方向键 &nbsp;移动</div>
                <div>自动武器<b style="color:var(--accent)"> 自动攻击 </b>敌人，主动武器用 <kbd>鼠标左键</kbd> 朝光标施放</div>
                <div><kbd>P</kbd> / <kbd>ESC</kbd> 暂停游戏</div>
              </div>
            </div>
          </div>
          <div class="select-group" id="ui-train-group" style="display:none">
            <div class="select-label">训练装备（点击武器循环等级；不选则用职业初始武器；游戏内 <kbd>[</kbd> / <kbd>]</kbd> 调整时间±1分钟）</div>
            <div class="train-grid">${trainChips}</div>
          </div>
        </div>
        <button class="btn btn-start" id="ui-start">开始游戏</button>
      </div>
    `);
    ov.classList.add('overlay-start');
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
    ov.querySelector<HTMLButtonElement>('#ui-shop')!.addEventListener('click', () => {
      this.clearOverlay();
      onShop();
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

  showLevelUp(
    choices: Choice[],
    onPick: (c: Choice) => void,
    onReroll: (() => void) | null = null,
    rerollsLeft = 0,
  ): void {
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
      ? `<button class="btn btn-ghost" id="ui-reroll">🎲 重随 (剩 ${rerollsLeft} · R)</button>`
      : `<button class="btn btn-ghost" id="ui-reroll" disabled style="opacity:.4;cursor:default">🎲 重随 已用完</button>`;
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

  /** 局外商店：购买/装备装扮，内部自重建以刷新余额与状态 */
  showShop(onBack: () => void): void {
    this.clearOverlay();
    this.setHudVisible(false);
    const render = () => {
      this.clearOverlay();
      const items = COSMETICS.map((c) => {
        const owned = meta.owns(c.id);
        const equipped = meta.equippedId === c.id;
        const affordable = meta.coins >= c.price;
        const swatch = c.color
          ? `<span class="shop-swatch" style="background:${c.color};box-shadow:0 0 8px ${c.color}"></span>`
          : `<span class="shop-swatch shop-swatch-none"></span>`;
        const state = equipped
          ? '<span class="shop-state on">已装备</span>'
          : owned
            ? '<span class="shop-state">点击装备</span>'
            : `<span class="shop-state ${affordable ? '' : 'poor'}">🪙 ${c.price}</span>`;
        const cls = `shop-item${equipped ? ' equipped' : ''}${owned ? ' owned' : ''}${!owned && !affordable ? ' locked' : ''}`;
        return `<div class="${cls}" data-cos="${c.id}">
          ${swatch}
          <div class="shop-info"><b>${c.name}</b><span>${c.desc}</span></div>
          ${state}
        </div>`;
      }).join('');
      const ov = this.addOverlay(`
        <div class="panel">
          <div class="title">🛒 商店</div>
          <div class="subtitle">每局每击杀 ${COINS_PER_KILLS} 个敌人获得 1 🪙。当前余额：<b style="color:var(--accent)">🪙 ${meta.coins}</b></div>
          <div class="shop-grid">${items}</div>
          <button class="btn btn-ghost" id="ui-shop-back">← 返回菜单</button>
        </div>
      `);
      ov.querySelectorAll<HTMLElement>('.shop-item').forEach((el) => {
        el.addEventListener('click', () => {
          const id = el.dataset.cos!;
          if (meta.owns(id)) {
            meta.equip(id);
          } else {
            meta.buy(id); // 不足/已有时 buy 自行拒绝，无需处理返回值
          }
          render(); // 重建刷新余额/状态
        });
      });
      ov.querySelector<HTMLButtonElement>('#ui-shop-back')!.addEventListener('click', () => {
        this.clearOverlay();
        onBack();
      });
    };
    render();
  }

  showGameOver(d: GameOverData, onRestart: () => void, onMenu: () => void): void {
    this.clearOverlay();
    const title = d.victory ? '🏆 胜利！' : '💀 你倒下了';
    const sub = d.victory ? '你在暗夜中坚持到了最后。' : '暗夜吞没了你，但你战斗得很英勇。';
    const rankLine =
      d.run.rank > 0
        ? `<div class="reward-line">🏆 登上排行榜第 <b style="color:var(--accent)">${d.run.rank}</b> 名 · 本局获得 🪙 ${d.run.earned}</div>`
        : `<div class="reward-line">本局获得 <b style="color:var(--accent)">🪙 ${d.run.earned}</b> · 余额 🪙 ${meta.coins}</div>`;
    const ov = this.addOverlay(`
      <div class="panel">
        <div class="title">${title}</div>
        <div class="subtitle">${sub}</div>
        <div class="result-grid">
          <div class="result-cell"><div class="val">${formatTime(d.time)}</div><div class="lbl">存活时间</div></div>
          <div class="result-cell"><div class="val">${d.level}</div><div class="lbl">等级</div></div>
          <div class="result-cell"><div class="val">${d.kills}</div><div class="lbl">击杀数</div></div>
        </div>
        ${rankLine}
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
