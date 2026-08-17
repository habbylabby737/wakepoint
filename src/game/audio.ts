type Bus = "master" | "sfx" | "music";

export class GameAudio {
  private ctx: AudioContext | null = null;
  private buses: Record<Bus, GainNode> | null = null;
  muted = false;
  master = 0.7;

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC({ latencyHint: "interactive" });
      const master = this.ctx.createGain();
      const sfx = this.ctx.createGain();
      const music = this.ctx.createGain();
      sfx.gain.value = 0.85;
      music.gain.value = 0.28;
      sfx.connect(master);
      music.connect(master);
      master.connect(this.ctx.destination);
      this.buses = { master, sfx, music };
      this.applyMute();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  resume() {
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  setMuted(next: boolean) {
    this.muted = next;
    this.applyMute();
  }

  toggleMute() {
    this.setMuted(!this.muted);
  }

  private applyMute() {
    if (!this.ctx || !this.buses) return;
    const g = this.muted ? 0 : this.master * this.master;
    this.buses.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.02);
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    bus: Bus = "sfx",
    slide = 0,
  ) {
    if (!this.ctx || !this.buses || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.buses[bus]);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  private noise(dur: number, gain: number, hp = 400) {
    if (!this.ctx || !this.buses || this.muted) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const data = n.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = n;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = hp;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.buses.sfx);
    src.start(t);
    src.stop(t + dur);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
    };
  }

  shoot() {
    const jitter = 1 + (Math.random() * 2 - 1) * 0.08;
    this.tone(620 * jitter, 0.07, "square", 0.07, "sfx", -280);
    this.tone(180 * jitter, 0.05, "triangle", 0.05);
  }

  hit() {
    this.tone(220, 0.08, "sawtooth", 0.06, "sfx", -80);
    this.noise(0.06, 0.05, 800);
  }

  explode() {
    this.noise(0.22, 0.16, 180);
    this.tone(140, 0.2, "sawtooth", 0.08, "sfx", -90);
  }

  pickup() {
    this.tone(520, 0.08, "sine", 0.07);
    this.tone(780, 0.12, "triangle", 0.05);
  }

  wave() {
    this.tone(240, 0.18, "sine", 0.06, "music", 80);
    this.tone(360, 0.22, "triangle", 0.04, "music", 40);
  }

  hurt() {
    this.tone(90, 0.22, "sawtooth", 0.1, "sfx", -40);
    this.noise(0.14, 0.1, 120);
  }

  lifeLost() {
    this.tone(180, 0.28, "triangle", 0.08, "sfx", -100);
  }
}
