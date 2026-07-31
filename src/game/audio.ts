// Procedural audio: SFX & BGM synthesized in real time with Web Audio API.
// 零素材文件 —— 所有声音由振荡器/噪声实时合成，与「无引擎无框架」的项目气质一致。
//
// 用法：import { audio } from './audio'; 然后调用 audio.hit() / audio.startMusic() 等。
// 浏览器要求用户手势后才能出声：构造时挂了一次性 pointerdown/keydown 解锁监听。

const MUTE_KEY = 'eo-muted';

/** midi 音高转频率 */
function mtof(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private arpDelay!: DelayNode;
  private limiter!: DynamicsCompressorNode;
  private noiseBuf: AudioBuffer | null = null;

  muted = localStorage.getItem(MUTE_KEY) === '1';

  // BGM 步进音序器状态
  private musicOn = false;
  private schedulerId: number | null = null;
  private step = 0;
  private nextStepTime = 0;

  constructor() {
    const unlock = () => this.ensure();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  /** 懒创建 AudioContext（必须发生在用户手势之后） */
  private ensure(): AudioContext | null {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      // 全局限幅器：无论瞬间叠加多少音效，输出都被压在阈值内，杜绝削波爆音
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -10;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.12;
      this.master.connect(this.limiter);
      this.limiter.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.9;
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.55;
      this.musicBus.connect(this.master);
      // 琶音的回声通道（feedback delay），营造空间感
      this.arpDelay = this.ctx.createDelay(1);
      this.arpDelay.delayTime.value = 0.3125; // 与 BPM 同步的附点回声
      const fb = this.ctx.createGain();
      fb.gain.value = 0.35;
      this.arpDelay.connect(fb);
      fb.connect(this.arpDelay);
      this.arpDelay.connect(this.musicBus);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** 静音开关；返回切换后的静音状态 */
  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    const ctx = this.ensure();
    if (ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, ctx.currentTime, 0.02);
    return this.muted;
  }

  // ------------------------------------------------------------------
  // 合成原语
  // ------------------------------------------------------------------
  /** 单振荡器音符：freq 起始频率，slideTo 结尾滑向的频率 */
  private tone(
    type: OscillatorType,
    freq: number,
    dur: number,
    gain: number,
    opts: { slideTo?: number; attack?: number; when?: number; bus?: AudioNode; lowpass?: number } = {},
  ): void {
    const ctx = this.ensure();
    if (!ctx || this.muted) return;
    const t = opts.when ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo), t + dur);
    const g = ctx.createGain();
    const attack = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = osc;
    if (opts.lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.lowpass;
      node.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(opts.bus ?? this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** 白噪声爆发：打击/爆炸质感 */
  private noise(
    dur: number,
    gain: number,
    opts: { filter?: BiquadFilterType; freq?: number; freqEnd?: number; when?: number; bus?: AudioNode } = {},
  ): void {
    const ctx = this.ensure();
    if (!ctx || this.muted) return;
    if (!this.noiseBuf) {
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const t = opts.when ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = opts.filter ?? 'lowpass';
    f.frequency.setValueAtTime(opts.freq ?? 2000, t);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(opts.bus ?? this.sfxBus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------------
  // Boss 提示音（其余战斗/事件/UI 音效已移除，仅保留 BGM 与 Boss 提示）
  // ------------------------------------------------------------------
  /**
   * Boss 击杀：短爆点 + 上行大调琶音 + 高音闪光。
   * 故意与受伤/坠落的“音高下行”语言相反：琶音上行 + 明亮音色，
   * 一听就是胜利正反馈（BGM 为 A 小调，收尾用同主音 A 大调自带凯旋感）。
   */
  bossDie(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    // 1) 击杀确认：短促爆点（低音冲击极短，不做长下扫，避免像受伤）
    this.tone('sine', 90, 0.16, 0.22, { slideTo: 55, when: t });
    this.noise(0.18, 0.13, { filter: 'highpass', freq: 3200, when: t });
    // 2) 上行大调琶音 A-C#-E-A：三角波主体 + 高八度方波点缀
    const notes = [69, 73, 76, 81]; // A4 C#5 E5 A5
    notes.forEach((n, i) => {
      const when = t + 0.06 + i * 0.09;
      this.tone('triangle', mtof(n), 0.3, 0.16, { when, attack: 0.006 });
      this.tone('square', mtof(n + 12), 0.16, 0.035, { when, attack: 0.006, lowpass: 4200 });
    });
    // 3) 顶部闪光：高音长尾走回声通道拖出空间感 + 细碎 shimmer
    this.tone('sine', mtof(93), 0.5, 0.07, { when: t + 0.42, attack: 0.01, bus: this.arpDelay });
    this.noise(0.3, 0.045, { filter: 'highpass', freq: 7500, when: t + 0.42 });
  }

  /** Boss 来袭警报：两组交替的警笛 */
  bossWarn(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    for (let i = 0; i < 3; i++) {
      this.tone('sawtooth', 440, 0.16, 0.1, { when: ctx.currentTime + i * 0.24, lowpass: 2200 });
      this.tone('sawtooth', 560, 0.16, 0.1, { when: ctx.currentTime + i * 0.24 + 0.12, lowpass: 2200 });
    }
  }

  // ------------------------------------------------------------------
  // BGM：4 小节循环的暗色合成器音序（Am – F – C – G）
  // 96 BPM，16 分音符步进；kick / bass / pad / 琶音 / 底鼓噪声镲。
  // ------------------------------------------------------------------
  private static readonly STEP = 60 / 96 / 4; // 16 分音符时长
  private static readonly BARS = 4;
  private static readonly CHORD_ROOTS = [33, 29, 36, 31]; // A1 F1 C2 G1
  private static readonly CHORD_PADS = [
    [57, 60, 64], // Am
    [53, 57, 60], // F
    [55, 60, 64], // C (转位)
    [55, 59, 62], // G
  ];
  private static readonly ARP_SCALE = [69, 72, 74, 76, 79, 81]; // A 小调五声

  startMusic(): void {
    const ctx = this.ensure();
    if (!ctx || this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextStepTime = ctx.currentTime + 0.1;
    this.musicBus.gain.setTargetAtTime(0.55, ctx.currentTime, 0.3);
    this.schedulerId = window.setInterval(() => this.schedule(), 40);
  }

  stopMusic(): void {
    this.musicOn = false;
    if (this.schedulerId !== null) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
    const ctx = this.ctx;
    if (ctx) this.musicBus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2);
  }

  /** 暂停/升级界面时压低 BGM，恢复后回到正常音量 */
  duckMusic(ducked: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicOn) return;
    this.musicBus.gain.setTargetAtTime(ducked ? 0.18 : 0.55, ctx.currentTime, 0.15);
  }

  /** 前瞻式调度：把落入 lookahead 窗口内的步进都排进队列 */
  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicOn || this.muted) {
      // 静音时推进时间指针，避免解除静音后猛灌一串积压音符
      if (ctx) this.nextStepTime = Math.max(this.nextStepTime, ctx.currentTime);
      return;
    }
    const lookahead = 0.15;
    while (this.nextStepTime < ctx.currentTime + lookahead) {
      this.scheduleStep(this.step, this.nextStepTime);
      this.nextStepTime += AudioManager.STEP;
      this.step = (this.step + 1) % (AudioManager.BARS * 16);
    }
  }

  private scheduleStep(step: number, t: number): void {
    const bar = Math.floor(step / 16);
    const beat = step % 16;
    const root = AudioManager.CHORD_ROOTS[bar];

    // Kick：每拍一次的软底鼓
    if (beat % 4 === 0) {
      this.tone('sine', 120, 0.14, 0.16, { slideTo: 48, when: t, bus: this.musicBus });
    }
    // Hat：反拍的短噪声镲
    if (beat % 4 === 2) {
      this.noise(0.03, 0.025, { filter: 'highpass', freq: 6000, when: t, bus: this.musicBus });
    }
    // Bass：八分音符驱动，偶尔跳八度
    if (beat % 2 === 0) {
      const oct = beat === 6 || beat === 14 ? 12 : 0;
      this.tone('triangle', mtof(root + oct), 0.22, 0.14, {
        when: t,
        lowpass: 500,
        attack: 0.01,
        bus: this.musicBus,
      });
    }
    // Pad：每小节起手的和弦长音（慢起音锯齿 + 低通）
    if (beat === 0) {
      for (const n of AudioManager.CHORD_PADS[bar]) {
        this.tone('sawtooth', mtof(n), AudioManager.STEP * 15, 0.028, {
          when: t,
          attack: 0.5,
          lowpass: 900,
          bus: this.musicBus,
        });
      }
    }
    // 琶音：稀疏的高音拨弦，走 delay 回声通道
    if (beat % 4 === 0 || beat === 7 || beat === 11) {
      const idx = (Math.floor(step / 2) + bar) % AudioManager.ARP_SCALE.length;
      const note = AudioManager.ARP_SCALE[idx] + (beat >= 8 ? 12 : 0);
      this.tone('triangle', mtof(note), 0.22, 0.05, {
        when: t,
        attack: 0.005,
        bus: this.arpDelay,
      });
    }
  }
}

/** 全局唯一的音频管理器 */
export const audio = new AudioManager();
