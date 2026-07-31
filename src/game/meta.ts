// 局外元进度：持久化到 localStorage —— 货币、最佳成绩、已购/已装备的装扮。
// 与游戏内状态解耦：每局结束时 game 调用 recordRun 结算；菜单/商店/渲染读取本模块。

const KEY = 'eo-profile';

export interface CosmeticDef {
  id: string;
  name: string;
  desc: string;
  price: number; // 0 = 默认免费
  /** 光环颜色；null 表示无视觉（默认「无」装扮） */
  color: string | null;
}

// 可购买装扮：目前为角色光环（后期可扩展其他可购买内容）
export const COSMETICS: CosmeticDef[] = [
  { id: 'none', name: '朴素', desc: '不佩戴任何光环。', price: 0, color: null },
  { id: 'ember', name: '赤焰之辉', desc: '身周萦绕温暖的赤焰光环。', price: 15, color: '#ff6b3d' },
  { id: 'frost', name: '霜华之辉', desc: '身周萦绕清冷的霜蓝光环。', price: 15, color: '#5ce1ff' },
  { id: 'verdant', name: '翠脉之辉', desc: '身周萦绕盎然的翠绿光环。', price: 25, color: '#7ee787' },
  { id: 'void', name: '虚空之辉', desc: '身周萦绕幽邃的紫色光环。', price: 40, color: '#b56cff' },
  { id: 'gold', name: '鎏金之辉', desc: '身周萦绕华贵的鎏金光环。', price: 60, color: '#ffd166' },
];

export interface ScoreEntry {
  kills: number;
  time: number;
  level: number;
  char: string; // 角色 id
  mode: string; // 模式 id
  ts: number; // 完成时间戳
}

export interface RunResult {
  earned: number;
  rank: number; // 上榜名次（1-based），0 = 未进入榜单
}

/** 排行榜保留前几名 */
export const MAX_SCORES = 3;

interface Profile {
  coins: number;
  scores: ScoreEntry[]; // 排行榜（按击杀降序，最多 MAX_SCORES 条）
  owned: string[];
  equipped: string;
}

/** 每 10 次击杀兑换 1 枚货币；不足 10 忽略不计 */
export const COINS_PER_KILLS = 10;

function freshProfile(): Profile {
  return { coins: 0, scores: [], owned: ['none'], equipped: 'none' };
}

class MetaStore {
  private data: Profile = this.load();

  private load(): Profile {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return freshProfile();
      const p = JSON.parse(raw);
      const owned: string[] = Array.isArray(p.owned) ? p.owned.slice() : [];
      if (!owned.includes('none')) owned.unshift('none');
      // 排行榜：新结构直接读；旧存档的单条 best 迁移为一条榜单记录
      let scores: ScoreEntry[] = [];
      if (Array.isArray(p.scores)) {
        scores = p.scores.map((s: Partial<ScoreEntry>) => ({
          kills: Number(s.kills) || 0,
          time: Number(s.time) || 0,
          level: Number(s.level) || 0,
          char: typeof s.char === 'string' ? s.char : 'mage',
          mode: typeof s.mode === 'string' ? s.mode : 'endless',
          ts: Number(s.ts) || 0,
        }));
      } else if (p.best && Number(p.best.kills) > 0) {
        scores = [
          {
            kills: Number(p.best.kills) || 0,
            time: Number(p.best.time) || 0,
            level: Number(p.best.level) || 0,
            char: 'mage',
            mode: 'endless',
            ts: 0,
          },
        ];
      }
      scores.sort((a, b) => b.kills - a.kills || b.time - a.time);
      return {
        coins: Number(p.coins) || 0,
        scores: scores.slice(0, MAX_SCORES),
        owned,
        equipped: typeof p.equipped === 'string' && owned.includes(p.equipped) ? p.equipped : 'none',
      };
    } catch {
      return freshProfile();
    }
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* localStorage 不可用时静默忽略 */
    }
  }

  get coins(): number {
    return this.data.coins;
  }

  get best(): ScoreEntry | null {
    return this.data.scores[0] ?? null;
  }

  get scores(): ScoreEntry[] {
    return this.data.scores;
  }

  get equippedId(): string {
    return this.data.equipped;
  }

  /** 当前装备的装扮定义；若为「无」或无视觉则返回 null */
  equippedCosmetic(): CosmeticDef | null {
    const def = COSMETICS.find((c) => c.id === this.data.equipped);
    return def && def.color ? def : null;
  }

  owns(id: string): boolean {
    return this.data.owned.includes(id);
  }

  /** 结算一局：发放货币（每 10 杀 1 枚），写入排行榜并返回上榜名次 */
  recordRun(kills: number, time: number, level: number, char: string, mode: string): RunResult {
    const earned = Math.floor(kills / COINS_PER_KILLS);
    this.data.coins += earned;
    const entry: ScoreEntry = { kills, time, level, char, mode, ts: Date.now() };
    this.data.scores.push(entry);
    this.data.scores.sort((a, b) => b.kills - a.kills || b.time - a.time);
    this.data.scores = this.data.scores.slice(0, MAX_SCORES);
    const idx = this.data.scores.indexOf(entry);
    this.save();
    return { earned, rank: idx >= 0 ? idx + 1 : 0 };
  }

  /** 购买装扮：成功扣币并加入已购返回 true；已拥有或货币不足返回 false */
  buy(id: string): boolean {
    const def = COSMETICS.find((c) => c.id === id);
    if (!def || this.owns(id) || this.data.coins < def.price) return false;
    this.data.coins -= def.price;
    this.data.owned.push(id);
    this.save();
    return true;
  }

  /** 装备已拥有的装扮 */
  equip(id: string): boolean {
    if (!this.owns(id)) return false;
    this.data.equipped = id;
    this.save();
    return true;
  }
}

/** 全局唯一的元进度存档 */
export const meta = new MetaStore();
