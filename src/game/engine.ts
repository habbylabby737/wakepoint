import { GameAudio } from "./audio";
import { Input, type Actions } from "./input";
import { loadScores, qualifies, submitScore, type ScoreEntry } from "./scores";

export type Mode = "title" | "playing" | "paused" | "gameover" | "scores" | "help";

export type PowerHud = { multi: number; shield: number; speed: number };

export type Hud = {
  mode: Mode;
  score: number;
  lives: number;
  wave: number;
  waveBanner: string;
  power: PowerHud;
  highScores: ScoreEntry[];
  lastScore: number;
  lastWave: number;
  isNewHigh: boolean;
  muted: boolean;
  ready: boolean;
};

export type ControlsProbe = {
  getX: () => number;
  getY: () => number;
  getSpeed: () => number;
  setKeys: (codes: string[]) => void;
};

declare global {
  interface Window {
    __controlsTest?: ControlsProbe;
  }
}

const WORLD_W = 2200;
const WORLD_H = 1600;
const STEP = 1 / 60;
const MAX_BULLETS = 220;
const MAX_ENEMIES = 80;
const MAX_PARTICLES = 280;
const MAX_PICKUPS = 16;
const MAX_FLASHES = 24;
const MAX_FLOATS = 32;

type Bullet = {
  live: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  ttl: number;
  friendly: boolean;
  frame: number;
};
type Enemy = {
  live: boolean;
  kind: 0 | 1 | 2;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  maxHp: number;
  speed: number;
  shoot: number;
  flash: number;
  frame: number;
  angle: number;
};
type Pickup = {
  live: boolean;
  x: number;
  y: number;
  kind: 0 | 1 | 2 | 3;
  bob: number;
  ttl: number;
};
type Particle = {
  live: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  hue: number;
};
type Flash = { live: boolean; x: number; y: number; angle: number; t: number };
type Floater = { live: boolean; x: number; y: number; t: number; text: string };

const SHEETS = {
  player: "/sprites/player.png",
  drone: "/sprites/enemy-drone.png",
  fighter: "/sprites/enemy-fighter.png",
  pbolt: "/sprites/player-bolt.png",
  ebolt: "/sprites/enemy-bolt.png",
  muzzle: "/sprites/muzzle.png",
  explode: "/sprites/explode.png",
  multi: "/sprites/pu-multi.png",
  shield: "/sprites/pu-shield.png",
  speed: "/sprites/pu-speed.png",
  life: "/sprites/pu-life.png",
} as const;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`asset ${src}`));
    img.src = src;
  });
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function pool<T>(n: number, make: () => T): T[] {
  return Array.from({ length: n }, make);
}

export class WakepointGame {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  input = new Input();
  audio = new GameAudio();
  images = new Map<string, HTMLImageElement>();
  ready = false;

  mode: Mode = "title";
  score = 0;
  lives = 3;
  wave = 0;
  waveBanner = "";
  waveBannerT = 0;
  pendingSpawns: Array<{ kind: 0 | 1 | 2; delay: number }> = [];
  enemiesLeft = 0;
  between = 0;

  player = {
    x: WORLD_W / 2,
    y: WORLD_H / 2,
    vx: 0,
    vy: 0,
    r: 18,
    angle: -Math.PI / 2,
    fireCd: 0,
    invuln: 0,
    multiT: 0,
    multiLvl: 0,
    shieldT: 0,
    shieldHp: 0,
    speedT: 0,
    recoil: 0,
  };

  cam = { x: WORLD_W / 2, y: WORLD_H / 2, sx: 0, sy: 0, trauma: 0 };
  hitstop = 0;
  reduced = false;

  bullets = pool(MAX_BULLETS, (): Bullet => ({
    live: false, x: 0, y: 0, vx: 0, vy: 0, r: 4, ttl: 0, friendly: true, frame: 0,
  }));
  enemies = pool(MAX_ENEMIES, (): Enemy => ({
    live: false, kind: 0, x: 0, y: 0, vx: 0, vy: 0, r: 16, hp: 1, maxHp: 1, speed: 80, shoot: 0, flash: 0, frame: 0, angle: 0,
  }));
  pickups = pool(MAX_PICKUPS, (): Pickup => ({
    live: false, x: 0, y: 0, kind: 0, bob: 0, ttl: 0,
  }));
  particles = pool(MAX_PARTICLES, (): Particle => ({
    live: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 2, hue: 0,
  }));
  flashes = pool(MAX_FLASHES, (): Flash => ({ live: false, x: 0, y: 0, angle: 0, t: 0 }));
  floaters = pool(MAX_FLOATS, (): Floater => ({ live: false, x: 0, y: 0, t: 0, text: "" }));
  booms: Array<{ x: number; y: number; t: number }> = [];

  stars: Array<{ x: number; y: number; z: number; s: number }> = [];
  lastScore = 0;
  lastWave = 0;
  isNewHigh = false;
  highScores: ScoreEntry[] = [];
  time = 0;
  acc = 0;
  lastTs = 0;
  raf = 0;
  onHud: ((h: Hud) => void) | null = null;
  hudDirty = true;
  lastHudSend = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("canvas");
    this.ctx = ctx;
    this.reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.seedStars();
    this.highScores = loadScores();
    this.input.attach(canvas);
    this.resize();
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVis);
    this.wireControlsTest();
  }

  private wireControlsTest() {
    window.__controlsTest = {
      getX: () => this.player.x,
      getY: () => this.player.y,
      getSpeed: () => Math.hypot(this.player.vx, this.player.vy),
      setKeys: (codes) => this.input.setForcedKeys(codes),
    };
  }

  async boot() {
    const entries = Object.entries(SHEETS);
    const loaded = await Promise.all(entries.map(([, src]) => loadImage(src)));
    entries.forEach(([key], i) => this.images.set(key, loaded[i]!));
    this.ready = true;
    this.hudDirty = true;
    this.loop(performance.now());
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.input.detach();
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.onVis);
    delete window.__controlsTest;
  }

  private onVis = () => {
    if (document.hidden) {
      if (this.mode === "playing") this.setMode("paused");
    } else {
      this.audio.resume();
    }
  };

  resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    if (!this.input.pointer.down) {
      this.input.pointer.x = this.canvas.width * 0.5;
      this.input.pointer.y = this.canvas.height * 0.38;
    }
  };

  setMode(mode: Mode) {
    this.mode = mode;
    this.hudDirty = true;
  }

  startRun() {
    this.audio.unlock();
    this.score = 0;
    this.lives = 3;
    this.wave = 0;
    this.player.x = WORLD_W / 2;
    this.player.y = WORLD_H / 2;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.angle = -Math.PI / 2;
    this.player.fireCd = 0;
    this.player.invuln = 1.2;
    this.player.multiT = 0;
    this.player.multiLvl = 0;
    this.player.shieldT = 0;
    this.player.shieldHp = 0;
    this.player.speedT = 0;
    this.cam.x = this.player.x;
    this.cam.y = this.player.y;
    this.cam.trauma = 0;
    for (const b of this.bullets) b.live = false;
    for (const e of this.enemies) e.live = false;
    for (const p of this.pickups) p.live = false;
    for (const p of this.particles) p.live = false;
    for (const f of this.flashes) f.live = false;
    this.booms.length = 0;
    this.pendingSpawns = [];
    this.between = 0.6;
    this.waveBanner = "";
    this.setMode("playing");
    this.audio.wave();
  }

  submitName(name: string) {
    this.highScores = submitScore({ name, score: this.lastScore, wave: this.lastWave });
    this.isNewHigh = false;
    this.hudDirty = true;
  }

  toggleMute() {
    this.audio.toggleMute();
    this.hudDirty = true;
  }

  snapshot(): Hud {
    return {
      mode: this.mode,
      score: this.score,
      lives: this.lives,
      wave: this.wave,
      waveBanner: this.waveBanner,
      power: {
        multi: this.player.multiT,
        shield: this.player.shieldHp > 0 ? this.player.shieldT : 0,
        speed: this.player.speedT,
      },
      highScores: this.highScores,
      lastScore: this.lastScore,
      lastWave: this.lastWave,
      isNewHigh: this.isNewHigh,
      muted: this.audio.muted,
      ready: this.ready,
    };
  }

  private seedStars() {
    this.stars = [];
    for (let i = 0; i < 220; i++) {
      this.stars.push({
        x: Math.random() * WORLD_W,
        y: Math.random() * WORLD_H,
        z: i < 80 ? 0.18 : i < 150 ? 0.42 : 0.78,
        s: i < 80 ? 0.8 : i < 150 ? 1.2 : 1.8,
      });
    }
  }

  private loop = (ts: number) => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.lastTs) this.lastTs = ts;
    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    dt = Math.min(dt, 0.1);
    this.acc += dt;
    const actions = this.input.poll();
    this.handleMenu(actions);
    while (this.acc >= STEP) {
      if (this.mode === "playing") {
        if (this.hitstop > 0) this.hitstop -= STEP;
        else this.sim(STEP, actions);
      }
      this.acc -= STEP;
    }
    this.draw();
    if (this.hudDirty || ts - this.lastHudSend > 120) {
      this.onHud?.(this.snapshot());
      this.hudDirty = false;
      this.lastHudSend = ts;
    }
  };

  private handleMenu(a: Actions) {
    if (this.mode === "playing" && a.justPause) this.setMode("paused");
    else if (this.mode === "paused" && a.justPause) this.setMode("playing");
  }

  private sim(dt: number, a: Actions) {
    this.time += dt;
    this.tickPlayer(dt, a);
    this.tickWaves(dt);
    this.tickEnemies(dt);
    this.tickBullets(dt);
    this.tickPickups(dt);
    this.tickFx(dt);
    this.collide();
    this.tickCamera(dt, a);
    if (this.waveBannerT > 0) {
      this.waveBannerT -= dt;
      if (this.waveBannerT <= 0) {
        this.waveBanner = "";
        this.hudDirty = true;
      }
    }
  }

  private tickPlayer(dt: number, a: Actions) {
    const p = this.player;
    const max = p.speedT > 0 ? 490 : 340;
    const accel = p.speedT > 0 ? 2800 : 2100;
    let mx = a.moveX;
    let my = a.moveY;
    const worldAim = this.screenToWorld(a.aimX, a.aimY);

    if (mx === 0 && my === 0 && a.fire && this.input.pointer.down && !this.input.touchMode) {
      const dx = worldAim.x - p.x;
      const dy = worldAim.y - p.y;
      const len = Math.hypot(dx, dy);
      if (len > 28) {
        mx = dx / len;
        my = dy / len;
      }
    }

    p.vx += mx * accel * dt;
    p.vy += my * accel * dt;
    const spd = Math.hypot(p.vx, p.vy);
    if (spd > max) {
      p.vx = (p.vx / spd) * max;
      p.vy = (p.vy / spd) * max;
    }
    if (mx === 0 && my === 0) {
      const k = Math.exp(-5.5 * dt);
      p.vx *= k;
      p.vy *= k;
    }
    p.x = clamp(p.x + p.vx * dt, p.r, WORLD_W - p.r);
    p.y = clamp(p.y + p.vy * dt, p.r, WORLD_H - p.r);

    p.angle = Math.atan2(worldAim.y - p.y, worldAim.x - p.x);
    p.fireCd = Math.max(0, p.fireCd - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.recoil = Math.max(0, p.recoil - dt * 6);
    if (p.multiT > 0) {
      p.multiT = Math.max(0, p.multiT - dt);
      if (p.multiT === 0) p.multiLvl = 0;
    }
    if (p.shieldT > 0) {
      p.shieldT = Math.max(0, p.shieldT - dt);
      if (p.shieldT === 0) p.shieldHp = 0;
    }
    p.speedT = Math.max(0, p.speedT - dt);

    if (a.fire && p.fireCd <= 0 && p.invuln < 1.15) this.firePlayer();
  }

  private firePlayer() {
    const p = this.player;
    const lvl = p.multiLvl;
    const spread = lvl >= 2 ? [-0.38, -0.18, 0, 0.18, 0.38] : lvl >= 1 ? [-0.22, 0, 0.22] : [0];
    const speed = 760;
    for (const off of spread) {
      const ang = p.angle + off;
      this.spawnBullet(p.x + Math.cos(ang) * 22, p.y + Math.sin(ang) * 22, Math.cos(ang) * speed, Math.sin(ang) * speed, true, 4.5, 1.05);
    }
    this.spawnFlash(p.x + Math.cos(p.angle) * 26, p.y + Math.sin(p.angle) * 26, p.angle);
    p.fireCd = lvl >= 2 ? 0.11 : 0.155;
    p.recoil = 1;
    this.audio.shoot();
    this.addTrauma(0.08);
  }

  private tickWaves(dt: number) {
    for (const s of this.pendingSpawns) s.delay -= dt;
    while (this.pendingSpawns.length && this.pendingSpawns[0]!.delay <= 0) {
      const s = this.pendingSpawns.shift()!;
      this.spawnEnemy(s.kind);
    }
    const live = this.enemies.some((e) => e.live);
    if (!live && this.pendingSpawns.length === 0) {
      this.between -= dt;
      if (this.between <= 0) this.beginWave();
    }
  }

  private beginWave() {
    this.wave += 1;
    this.waveBanner = `WAVE ${String(this.wave).padStart(2, "0")}`;
    this.waveBannerT = 2.1;
    this.hudDirty = true;
    this.audio.wave();
    const n = this.wave;
    const drones = 4 + n * 2;
    const fighters = n >= 2 ? n + Math.floor(n / 2) : 0;
    const bruisers = n >= 4 ? Math.floor((n - 2) / 2) : 0;
    let t = 0.15;
    for (let i = 0; i < drones; i++) {
      this.pendingSpawns.push({ kind: 0, delay: t });
      t += 0.22;
    }
    for (let i = 0; i < fighters; i++) {
      this.pendingSpawns.push({ kind: 1, delay: t });
      t += 0.38;
    }
    for (let i = 0; i < bruisers; i++) {
      this.pendingSpawns.push({ kind: 2, delay: t });
      t += 0.55;
    }
    this.between = 1.6;
    if (n > 1) this.spawnPickup(WORLD_W * (0.35 + Math.random() * 0.3), WORLD_H * (0.35 + Math.random() * 0.3), (Math.floor(Math.random() * 3) as 0 | 1 | 2));
  }

  private spawnEnemy(kind: 0 | 1 | 2) {
    const e = this.enemies.find((x) => !x.live);
    if (!e) return;
    const edge = Math.floor(Math.random() * 4);
    let x = 0;
    let y = 0;
    if (edge === 0) {
      x = Math.random() * WORLD_W;
      y = 40;
    } else if (edge === 1) {
      x = Math.random() * WORLD_W;
      y = WORLD_H - 40;
    } else if (edge === 2) {
      x = 40;
      y = Math.random() * WORLD_H;
    } else {
      x = WORLD_W - 40;
      y = Math.random() * WORLD_H;
    }
    if (Math.hypot(x - this.player.x, y - this.player.y) < 260) {
      x = this.player.x < WORLD_W / 2 ? WORLD_W - 60 : 60;
      y = this.player.y < WORLD_H / 2 ? WORLD_H - 60 : 60;
    }
    const stats =
      kind === 0
        ? { r: 16, hp: 1, speed: 108 + this.wave * 4, shoot: 0 }
        : kind === 1
          ? { r: 20, hp: 3, speed: 78 + this.wave * 2, shoot: 1.6 }
          : { r: 28, hp: 8 + Math.floor(this.wave / 2), speed: 52 + this.wave, shoot: 2.2 };
    e.live = true;
    e.kind = kind;
    e.x = x;
    e.y = y;
    e.vx = 0;
    e.vy = 0;
    e.r = stats.r;
    e.hp = stats.hp;
    e.maxHp = stats.hp;
    e.speed = stats.speed;
    e.shoot = 0.6 + Math.random() * stats.shoot;
    e.flash = 0;
    e.frame = 0;
    e.angle = 0;
  }

  private tickEnemies(dt: number) {
    const p = this.player;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]!;
      if (!e.live) continue;
      e.frame += dt * 8;
      e.flash = Math.max(0, e.flash - dt);
      let ax = p.x - e.x;
      let ay = p.y - e.y;
      const dist = Math.hypot(ax, ay) || 1;
      ax /= dist;
      ay /= dist;
      let sepX = 0;
      let sepY = 0;
      for (let j = 0; j < this.enemies.length; j++) {
        if (i === j) continue;
        const o = this.enemies[j]!;
        if (!o.live) continue;
        const dx = e.x - o.x;
        const dy = e.y - o.y;
        const d = Math.hypot(dx, dy);
        if (d > 0 && d < e.r + o.r + 26) {
          sepX += dx / d;
          sepY += dy / d;
        }
      }
      const steerX = ax * 1 + sepX * 0.85;
      const steerY = ay * 1 + sepY * 0.85;
      const sl = Math.hypot(steerX, steerY) || 1;
      e.vx = (steerX / sl) * e.speed;
      e.vy = (steerY / sl) * e.speed;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.angle = Math.atan2(p.y - e.y, p.x - e.x);
      if (e.kind > 0) {
        e.shoot -= dt;
        if (e.shoot <= 0 && dist < 720) {
          const spd = e.kind === 2 ? 240 : 280;
          this.spawnBullet(e.x + Math.cos(e.angle) * 18, e.y + Math.sin(e.angle) * 18, Math.cos(e.angle) * spd, Math.sin(e.angle) * spd, false, e.kind === 2 ? 6 : 4.2, 2.4);
          e.shoot = e.kind === 2 ? 2.1 : 1.45 - Math.min(0.4, this.wave * 0.03);
        }
      }
    }
  }

  private spawnBullet(x: number, y: number, vx: number, vy: number, friendly: boolean, r: number, ttl: number) {
    const b = this.bullets.find((q) => !q.live);
    if (!b) return;
    b.live = true;
    b.x = x;
    b.y = y;
    b.vx = vx;
    b.vy = vy;
    b.r = r;
    b.ttl = ttl;
    b.friendly = friendly;
    b.frame = 0;
  }

  private spawnFlash(x: number, y: number, angle: number) {
    const f = this.flashes.find((q) => !q.live);
    if (!f) return;
    f.live = true;
    f.x = x;
    f.y = y;
    f.angle = angle;
    f.t = 0;
  }

  private spawnPickup(x: number, y: number, kind: 0 | 1 | 2 | 3) {
    const p = this.pickups.find((q) => !q.live);
    if (!p) return;
    p.live = true;
    p.x = x;
    p.y = y;
    p.kind = kind;
    p.bob = Math.random() * Math.PI * 2;
    p.ttl = 14;
  }

  private spawnFloater(x: number, y: number, text: string) {
    const f = this.floaters.find((q) => !q.live);
    if (!f) return;
    f.live = true;
    f.x = x;
    f.y = y;
    f.t = 0;
    f.text = text;
  }

  private burst(x: number, y: number, n: number, hue: number) {
    for (let i = 0; i < n; i++) {
      const p = this.particles.find((q) => !q.live);
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const s = 40 + Math.random() * 180;
      p.live = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.max = 0.28 + Math.random() * 0.4;
      p.life = p.max;
      p.size = 1.4 + Math.random() * 2.6;
      p.hue = hue;
    }
  }

  private tickBullets(dt: number) {
    for (const b of this.bullets) {
      if (!b.live) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.ttl -= dt;
      b.frame += dt * 14;
      if (b.ttl <= 0 || b.x < -40 || b.y < -40 || b.x > WORLD_W + 40 || b.y > WORLD_H + 40) b.live = false;
    }
  }

  private tickPickups(dt: number) {
    for (const p of this.pickups) {
      if (!p.live) continue;
      p.bob += dt * 3;
      p.ttl -= dt;
      if (p.ttl <= 0) p.live = false;
    }
  }

  private tickFx(dt: number) {
    for (const p of this.particles) {
      if (!p.live) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-2.2 * dt);
      p.life -= dt;
      if (p.life <= 0) p.live = false;
    }
    for (const f of this.flashes) {
      if (!f.live) continue;
      f.t += dt;
      if (f.t > 0.12) f.live = false;
    }
    for (const f of this.floaters) {
      if (!f.live) continue;
      f.t += dt;
      f.y -= 28 * dt;
      if (f.t > 0.7) f.live = false;
    }
    for (let i = this.booms.length - 1; i >= 0; i--) {
      this.booms[i]!.t += dt;
      if (this.booms[i]!.t > 0.32) this.booms.splice(i, 1);
    }
    this.cam.trauma = Math.max(0, this.cam.trauma - dt * 1.6);
  }

  private collide() {
    const p = this.player;
    for (const b of this.bullets) {
      if (!b.live || !b.friendly) continue;
      for (const e of this.enemies) {
        if (!e.live) continue;
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        if (dx * dx + dy * dy < (b.r + e.r) * (b.r + e.r)) {
          b.live = false;
          this.hurtEnemy(e, 1);
          break;
        }
      }
    }
    if (p.invuln <= 0) {
      for (const b of this.bullets) {
        if (!b.live || b.friendly) continue;
        const dx = b.x - p.x;
        const dy = b.y - p.y;
        if (dx * dx + dy * dy < (b.r + p.r) * (b.r + p.r)) {
          b.live = false;
          this.hurtPlayer();
          break;
        }
      }
    }
    if (p.invuln <= 0) {
      for (const e of this.enemies) {
        if (!e.live) continue;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        if (dx * dx + dy * dy < (e.r + p.r - 4) * (e.r + p.r - 4)) {
          this.hurtPlayer();
          this.hurtEnemy(e, 2);
          break;
        }
      }
    }
    for (const u of this.pickups) {
      if (!u.live) continue;
      const dx = u.x - p.x;
      const dy = u.y - p.y;
      if (dx * dx + dy * dy < (22 + p.r) * (22 + p.r)) {
        this.collect(u);
      }
    }
  }

  private hurtEnemy(e: Enemy, dmg: number) {
    e.hp -= dmg;
    e.flash = 0.08;
    this.burst(e.x, e.y, 5, e.kind === 0 ? 18 : 12);
    this.audio.hit();
    if (e.hp <= 0) {
      e.live = false;
      const pts = e.kind === 0 ? 100 : e.kind === 1 ? 250 : 500;
      this.score += pts;
      this.spawnFloater(e.x, e.y, `+${pts}`);
      this.booms.push({ x: e.x, y: e.y, t: 0 });
      this.burst(e.x, e.y, 18, 20);
      this.audio.explode();
      this.addTrauma(0.28);
      this.hitstop = this.reduced ? 0 : 0.035;
      this.hudDirty = true;
      if (Math.random() < 0.16) this.spawnPickup(e.x, e.y, Math.floor(Math.random() * 4) as 0 | 1 | 2 | 3);
    }
  }

  private hurtPlayer() {
    const p = this.player;
    if (p.invuln > 0) return;
    if (p.shieldHp > 0) {
      p.shieldHp -= 1;
      if (p.shieldHp <= 0) p.shieldT = 0;
      p.invuln = 0.7;
      this.audio.hit();
      this.addTrauma(0.25);
      this.hudDirty = true;
      return;
    }
    this.lives -= 1;
    p.invuln = 1.6;
    this.burst(p.x, p.y, 16, 200);
    this.audio.hurt();
    this.addTrauma(0.55);
    this.hudDirty = true;
    if (this.lives <= 0) this.gameOver();
    else this.audio.lifeLost();
  }

  private collect(u: Pickup) {
    u.live = false;
    const p = this.player;
    if (u.kind === 0) {
      p.multiLvl = Math.min(2, p.multiLvl + 1);
      p.multiT = 11;
      this.spawnFloater(u.x, u.y, p.multiLvl >= 2 ? "PENTA" : "TRI");
    } else if (u.kind === 1) {
      p.shieldHp = 2;
      p.shieldT = 14;
      this.spawnFloater(u.x, u.y, "SHIELD");
    } else if (u.kind === 2) {
      p.speedT = 9;
      this.spawnFloater(u.x, u.y, "BURN");
    } else {
      this.lives = Math.min(6, this.lives + 1);
      this.spawnFloater(u.x, u.y, "+LIFE");
    }
    this.score += 50;
    this.audio.pickup();
    this.hudDirty = true;
  }

  private gameOver() {
    this.lastScore = this.score;
    this.lastWave = this.wave;
    this.isNewHigh = qualifies(this.score);
    this.setMode("gameover");
    this.audio.explode();
  }

  private addTrauma(n: number) {
    if (this.reduced) return;
    this.cam.trauma = clamp(this.cam.trauma + n, 0, 1);
  }

  private tickCamera(dt: number, a: Actions) {
    const aim = this.screenToWorld(a.aimX, a.aimY);
    const lookX = this.player.x + (aim.x - this.player.x) * 0.16;
    const lookY = this.player.y + (aim.y - this.player.y) * 0.16;
    const k = 1 - Math.exp(-7 * dt);
    this.cam.x += (lookX - this.cam.x) * k;
    this.cam.y += (lookY - this.cam.y) * k;
    const viewW = this.viewW();
    const viewH = this.viewH();
    this.cam.x = clamp(this.cam.x, viewW / 2, Math.max(viewW / 2, WORLD_W - viewW / 2));
    this.cam.y = clamp(this.cam.y, viewH / 2, Math.max(viewH / 2, WORLD_H - viewH / 2));
    const shake = this.cam.trauma * this.cam.trauma;
    this.cam.sx = (Math.random() * 2 - 1) * shake * 14;
    this.cam.sy = (Math.random() * 2 - 1) * shake * 14;
  }

  private viewW() {
    return this.canvas.width;
  }
  private viewH() {
    return this.canvas.height;
  }

  screenToWorld(sx: number, sy: number) {
    return {
      x: this.cam.x - this.viewW() / 2 + sx + (this.reduced ? 0 : -this.cam.sx),
      y: this.cam.y - this.viewH() / 2 + sy + (this.reduced ? 0 : -this.cam.sy),
    };
  }

  private worldToScreen(x: number, y: number) {
    return {
      x: x - this.cam.x + this.viewW() / 2 + (this.reduced ? 0 : this.cam.sx),
      y: y - this.cam.y + this.viewH() / 2 + (this.reduced ? 0 : this.cam.sy),
    };
  }

  private draw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.fillStyle = "#07080a";
    ctx.fillRect(0, 0, w, h);

    const neb = ctx.createRadialGradient(w * 0.5, h * 0.45, 20, w * 0.5, h * 0.45, Math.max(w, h) * 0.7);
    neb.addColorStop(0, "rgba(28,30,38,0.55)");
    neb.addColorStop(1, "rgba(7,8,10,0)");
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, w, h);

    for (const s of this.stars) {
      const px = ((s.x - this.cam.x * s.z) % WORLD_W + WORLD_W) % WORLD_W;
      const py = ((s.y - this.cam.y * s.z) % WORLD_H + WORLD_H) % WORLD_H;
      const sx = (px / WORLD_W) * w;
      const sy = (py / WORLD_H) * h;
      const tw = 0.55 + 0.45 * Math.sin(this.time * (1.2 + s.z) + s.x);
      ctx.fillStyle = `rgba(236,236,232,${0.18 + s.z * 0.45 * tw})`;
      ctx.fillRect(sx, sy, s.s * (window.devicePixelRatio || 1), s.s * (window.devicePixelRatio || 1));
    }

    if (this.mode === "title" || this.mode === "scores" || this.mode === "help") {
      this.drawTitleDrift();
      return;
    }

    ctx.save();
    this.drawArena(ctx);
    for (const u of this.pickups) if (u.live) this.drawPickup(ctx, u);
    for (const e of this.enemies) if (e.live) this.drawEnemy(ctx, e);
    for (const b of this.bullets) if (b.live) this.drawBullet(ctx, b);
    this.drawPlayer(ctx);
    for (const f of this.flashes) if (f.live) this.drawMuzzle(ctx, f);
    for (const boom of this.booms) this.drawBoom(ctx, boom);
    for (const p of this.particles) if (p.live) this.drawParticle(ctx, p);
    for (const f of this.floaters) if (f.live) this.drawFloater(ctx, f);
    ctx.restore();
  }

  private drawTitleDrift() {
    const ctx = this.ctx;
    for (const s of this.stars) {
      s.x = (s.x + s.z * 8 * STEP * 60 * 0.016) % WORLD_W;
    }
    const img = this.images.get("player");
    if (!img) return;
    const c = { x: this.canvas.width * 0.72, y: this.canvas.height * 0.58 };
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(Math.sin(this.time * 0.4) * 0.12 - 0.5);
    const size = Math.min(this.canvas.width, this.canvas.height) * 0.28;
    this.blit(ctx, img, Math.floor(this.time * 6) % 4, 0, 0, size, -Math.PI / 2);
    ctx.restore();
  }

  private drawArena(ctx: CanvasRenderingContext2D) {
    const a = this.worldToScreen(0, 0);
    const b = this.worldToScreen(WORLD_W, WORLD_H);
    ctx.strokeStyle = "rgba(236,236,232,0.08)";
    ctx.lineWidth = 2;
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  }

  private blit(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    frame: number,
    x: number,
    y: number,
    size: number,
    angle: number,
    flash = false,
  ) {
    const cols = 2;
    const rows = 2;
    const fw = img.width / cols;
    const fh = img.height / rows;
    const i = ((frame % 4) + 4) % 4;
    const col = i % cols;
    const row = Math.floor(i / cols);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    if (flash) ctx.filter = "brightness(2.4) saturate(0.2)";
    ctx.drawImage(img, col * fw, row * fh, fw, fh, -size / 2, -size / 2, size, size);
    ctx.restore();
    ctx.filter = "none";
  }

  private drawPlayer(ctx: CanvasRenderingContext2D) {
    const p = this.player;
    const s = this.worldToScreen(p.x, p.y);
    const img = this.images.get("player");
    if (p.invuln > 0 && Math.floor(this.time * 16) % 2 === 0) ctx.globalAlpha = 0.4;
    if (p.shieldHp > 0) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 30 + Math.sin(this.time * 6) * 2, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(158,201,212,0.7)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s.x, s.y, 34, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(158,201,212,0.2)";
      ctx.stroke();
    }
    if (img) {
      const size = 52 + p.recoil * 4;
      this.blit(ctx, img, Math.floor(this.time * 8) % 4, s.x, s.y, size, p.angle);
    }
    ctx.globalAlpha = 1;
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy) {
    const s = this.worldToScreen(e.x, e.y);
    const key = e.kind === 0 ? "drone" : "fighter";
    const img = this.images.get(key);
    const size = e.kind === 0 ? 42 : e.kind === 1 ? 52 : 74;
    if (img) this.blit(ctx, img, Math.floor(e.frame) % 4, s.x, s.y, size, e.angle, e.flash > 0);
    if (e.maxHp > 1) {
      const w = size * 0.7;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(s.x - w / 2, s.y - size * 0.55, w, 3);
      ctx.fillStyle = "#c45a4a";
      ctx.fillRect(s.x - w / 2, s.y - size * 0.55, w * (e.hp / e.maxHp), 3);
    }
  }

  private drawBullet(ctx: CanvasRenderingContext2D, b: Bullet) {
    const s = this.worldToScreen(b.x, b.y);
    const img = this.images.get(b.friendly ? "pbolt" : "ebolt");
    const ang = Math.atan2(b.vy, b.vx);
    if (img) this.blit(ctx, img, Math.floor(b.frame) % 4, s.x, s.y, b.friendly ? 28 : 24, ang);
  }

  private drawMuzzle(ctx: CanvasRenderingContext2D, f: Flash) {
    const s = this.worldToScreen(f.x, f.y);
    const img = this.images.get("muzzle");
    const frame = Math.min(3, Math.floor(f.t / 0.03));
    if (img) this.blit(ctx, img, frame, s.x, s.y, 36, f.angle);
  }

  private drawBoom(ctx: CanvasRenderingContext2D, boom: { x: number; y: number; t: number }) {
    const s = this.worldToScreen(boom.x, boom.y);
    const img = this.images.get("explode");
    const frame = Math.min(3, Math.floor(boom.t / 0.08));
    if (img) this.blit(ctx, img, frame, s.x, s.y, 72 + boom.t * 40, 0);
  }

  private drawPickup(ctx: CanvasRenderingContext2D, u: Pickup) {
    const s = this.worldToScreen(u.x, u.y + Math.sin(u.bob) * 5);
    const keys = ["multi", "shield", "speed", "life"] as const;
    const img = this.images.get(keys[u.kind]);
    const pulse = 30 + Math.sin(u.bob * 2) * 3;
    if (img) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.drawImage(img, -pulse / 2, -pulse / 2, pulse, pulse);
      ctx.restore();
    }
  }

  private drawParticle(ctx: CanvasRenderingContext2D, p: Particle) {
    const s = this.worldToScreen(p.x, p.y);
    const a = p.life / p.max;
    ctx.fillStyle = p.hue > 100 ? `rgba(158,201,212,${a})` : `rgba(232,196,164,${a})`;
    ctx.fillRect(s.x, s.y, p.size, p.size);
  }

  private drawFloater(ctx: CanvasRenderingContext2D, f: Floater) {
    const s = this.worldToScreen(f.x, f.y);
    ctx.globalAlpha = 1 - f.t / 0.7;
    ctx.fillStyle = "#ecece8";
    ctx.font = `600 ${12 * (window.devicePixelRatio || 1)}px "IBM Plex Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(f.text, s.x, s.y);
    ctx.globalAlpha = 1;
  }
}
