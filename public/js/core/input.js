// Keyboard and mouse. Uses pointer lock for mouse look; if the browser or an
// embedding page refuses it, falls back to click-and-drag looking.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, buttons: 0, wheel: 0, clicked: new Set() };
    this.locked = false;
    this.dragLook = false;
    this.dragging = false;
    this.enabled = true;
    this.sensitivity = 1;
    this.invertY = false;
    this.lockFailed = false;
    window.addEventListener('keydown', (e) => {
      if (this.isTyping(e)) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'F1', 'F5'].includes(e.code) || (e.ctrlKey && e.code === 'KeyS')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.onUnlock?.();
    });
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; this.dragLook = true; });
    window.addEventListener('mousemove', (e) => {
      if (this.locked || (this.dragLook && this.dragging)) {
        this.mouse.dx += e.movementX || 0;
        this.mouse.dy += e.movementY || 0;
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      this.mouse.buttons |= 1 << e.button;
      this.mouse.clicked.add(e.button);
      if (this.dragLook) this.dragging = true;
    });
    window.addEventListener('mouseup', (e) => {
      this.mouse.buttons &= ~(1 << e.button);
      if (e.button === 0) this.dragging = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
  }

  isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  requestLock() {
    if (this.dragLook || this.locked) return;
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && p.catch) p.catch(() => { this.lockFailed = true; this.dragLook = true; });
    } catch {
      this.lockFailed = true;
      this.dragLook = true;
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) { return this.enabled && this.keys.has(code); }
  hit(code) { return this.enabled && this.pressed.has(code); }
  button(b) { return this.enabled && (this.mouse.buttons & (1 << b)) !== 0; }
  clicked(b) { return this.enabled && this.mouse.clicked.has(b); }

  // Call once per frame after the game has read input.
  endFrame() {
    this.pressed.clear();
    this.mouse.clicked.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
  }

  look() {
    const s = 0.0022 * this.sensitivity;
    return { yaw: -this.mouse.dx * s, pitch: -this.mouse.dy * s * (this.invertY ? -1 : 1) };
  }
}
