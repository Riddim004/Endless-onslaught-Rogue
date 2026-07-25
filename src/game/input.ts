// Keyboard input handling.

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();

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
  }

  down(k: string): boolean {
    return this.keys.has(k.toLowerCase());
  }

  /** True only on the frame the key was first pressed. */
  justPressed(k: string): boolean {
    return this.pressed.has(k.toLowerCase());
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
  }
}
