// Keyboard & mouse input handling.

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  /** 鼠标在视口内的位置（CSS 像素，与 renderer.width/height 同坐标系） */
  readonly mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  private clickPressed = false;
  private mouseHeld = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      // Prevent page scrolling with arrows / space.
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) {
        e.preventDefault();
      }
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
    });
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    // 只认画布上的左键点击，避免点 UI 按钮/卡片时误触主动武器
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && (e.target as HTMLElement | null)?.tagName === 'CANVAS') {
        this.clickPressed = true;
        this.mouseHeld = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseHeld = false;
    });
    window.addEventListener('blur', () => {
      this.mouseHeld = false;
    });
  }

  down(k: string): boolean {
    return this.keys.has(k.toLowerCase());
  }

  /** True only on the frame the key was first pressed. */
  justPressed(k: string): boolean {
    return this.pressed.has(k.toLowerCase());
  }

  /** True only on the frame the left mouse button was pressed on the canvas. */
  clickJustPressed(): boolean {
    return this.clickPressed;
  }

  /** True while the left mouse button is held down (channeled weapons). */
  mouseIsDown(): boolean {
    return this.mouseHeld;
  }

  /** Movement direction as a normalized-ish vector from WASD / arrows. */
  moveAxis(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.down('a') || this.down('arrowleft')) x -= 1;
    if (this.down('d') || this.down('arrowright')) x += 1;
    if (this.down('w') || this.down('arrowup')) y -= 1;
    if (this.down('s') || this.down('arrowdown')) y += 1;
    const len = Math.hypot(x, y);
    if (len > 0) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  /** Clear per-frame "just pressed" state. Call at end of each frame. */
  endFrame(): void {
    this.pressed.clear();
    this.clickPressed = false;
  }
}
