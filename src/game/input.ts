export type Actions = {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fire: boolean;
  pause: boolean;
  justPause: boolean;
};

const GAME_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "KeyP",
  "Escape",
  "KeyM",
]);

function radialDeadzone(x: number, y: number, dz = 0.18) {
  const m = Math.hypot(x, y);
  if (m < dz) return { x: 0, y: 0 };
  const scale = (m - dz) / (1 - dz) / m;
  return { x: x * scale, y: y * scale };
}

export class Input {
  keys = new Set<string>();
  private forced = new Set<string>();
  pointer = { x: 0, y: 0, down: false, id: -1 };
  private fireHeld = false;
  private stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private lastPause = false;
  private pauseQueued = false;
  touchMode = false;
  virtual = { moveX: 0, moveY: 0, fire: false };
  private canvas: HTMLCanvasElement | null = null;
  private unbind: Array<() => void> = [];

  attach(canvas: HTMLCanvasElement) {
    this.detach();
    this.canvas = canvas;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) {
        if (GAME_KEYS.has(e.code)) e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      if (e.code === "Escape" || e.code === "KeyP") this.pauseQueued = true;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    const clear = () => {
      this.keys.clear();
      this.pointer.down = false;
      this.fireHeld = false;
      this.stick.active = false;
      this.virtual.moveX = 0;
      this.virtual.moveY = 0;
      this.virtual.fire = false;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") this.touchMode = true;
      this.updatePointerPos(e);
      const rect = canvas.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      if (e.pointerType === "touch" && nx < 0.42) {
        this.stick = {
          active: true,
          id: e.pointerId,
          ox: e.clientX,
          oy: e.clientY,
          x: 0,
          y: 0,
        };
      } else {
        this.pointer.down = true;
        this.pointer.id = e.pointerId;
        this.fireHeld = true;
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      this.updatePointerPos(e);
      if (this.stick.active && e.pointerId === this.stick.id) {
        const max = 56;
        const dx = e.clientX - this.stick.ox;
        const dy = e.clientY - this.stick.oy;
        const m = Math.hypot(dx, dy);
        const s = m > max ? max / m : 1;
        this.stick.x = (dx * s) / max;
        this.stick.y = (dy * s) / max;
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId === this.stick.id) {
        this.stick.active = false;
        this.stick.x = 0;
        this.stick.y = 0;
      }
      if (e.pointerId === this.pointer.id) {
        this.pointer.down = false;
        this.fireHeld = false;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) clear();
    });
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    this.unbind = [
      () => window.removeEventListener("keydown", onKeyDown),
      () => window.removeEventListener("keyup", onKeyUp),
      () => window.removeEventListener("blur", clear),
      () => canvas.removeEventListener("pointerdown", onPointerDown),
      () => window.removeEventListener("pointermove", onPointerMove),
      () => window.removeEventListener("pointerup", onPointerUp),
      () => window.removeEventListener("pointercancel", onPointerUp),
    ];
  }

  detach() {
    for (const fn of this.unbind) fn();
    this.unbind = [];
  }

  setForcedKeys(codes: string[]) {
    this.forced = new Set(codes);
  }

  private has(code: string) {
    return this.keys.has(code) || this.forced.has(code);
  }

  private updatePointerPos(e: PointerEvent) {
    const canvas = this.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    this.pointer.y = ((e.clientY - rect.top) / rect.height) * canvas.height;
  }

  poll(): Actions {
    let moveX = 0;
    let moveY = 0;
    if (this.has("KeyA") || this.has("ArrowLeft")) moveX -= 1;
    if (this.has("KeyD") || this.has("ArrowRight")) moveX += 1;
    if (this.has("KeyW") || this.has("ArrowUp")) moveY -= 1;
    if (this.has("KeyS") || this.has("ArrowDown")) moveY += 1;

    const pads = typeof navigator !== "undefined" ? navigator.getGamepads?.() ?? [] : [];
    let padPause = false;
    for (const pad of pads) {
      if (!pad) continue;
      const ls = radialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
      const rs = radialDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
      moveX += ls.x;
      moveY += ls.y;
      if (Math.hypot(rs.x, rs.y) > 0.2) {
        this.pointer.x = (this.canvas?.width ?? 800) * 0.5 + rs.x * 280;
        this.pointer.y = (this.canvas?.height ?? 600) * 0.5 + rs.y * 280;
        this.fireHeld = true;
      } else if (!this.pointer.down && !this.has("Space") && !this.virtual.fire) {
        this.fireHeld = pad.buttons[7]?.pressed || pad.buttons[0]?.pressed || false;
      }
      if (pad.buttons[9]?.pressed || pad.buttons[8]?.pressed) padPause = true;
    }

    moveX += this.stick.x + this.virtual.moveX;
    moveY += this.stick.y + this.virtual.moveY;

    const len = Math.hypot(moveX, moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }

    const pause = this.has("Escape") || this.has("KeyP") || padPause;
    const justPause = this.pauseQueued || (pause && !this.lastPause);
    this.pauseQueued = false;
    this.lastPause = pause;

    return {
      moveX,
      moveY,
      aimX: this.pointer.x,
      aimY: this.pointer.y,
      fire: this.fireHeld || this.has("Space") || this.virtual.fire,
      pause,
      justPause,
    };
  }

  stickVisual() {
    return this.stick.active
      ? { x: this.stick.ox, y: this.stick.oy, kx: this.stick.x, ky: this.stick.y }
      : null;
  }
}
