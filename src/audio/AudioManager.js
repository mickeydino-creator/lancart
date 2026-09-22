/**
 * All sound effects are synthesized with the WebAudio API at runtime, so
 * there are no external audio assets to license or ship. If WebAudio is
 * unavailable the manager silently becomes a no-op and the game still
 * works.
 */
export class AudioManager {
  constructor() {
    this.enabled = false;
    this.ctx = null;
    this._engineNodes = null;
    this._driftNoise = null;
  }

  /** Must be called from a user gesture (click/keypress) to satisfy autoplay policies. */
  init() {
    if (this.ctx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.enabled = true;
    } catch (e) {
      this.enabled = false;
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }

  _noiseBuffer(duration = 0.4) {
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  startEngine() {
    if (!this.enabled || this._engineNodes) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const gain = ctx.createGain();
    gain.gain.value = 0.0;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    osc.connect(filter).connect(gain).connect(this.master);
    osc.frequency.value = 60;
    osc.start();
    this._engineNodes = { osc, gain, filter };
  }

  stopEngine() {
    if (!this._engineNodes) return;
    const { osc, gain } = this._engineNodes;
    gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    osc.stop(this.ctx.currentTime + 0.2);
    this._engineNodes = null;
  }

  /** speedRatio 0..1, boosting bool */
  updateEngine(speedRatio, boosting) {
    if (!this.enabled || !this._engineNodes) return;
    const { osc, gain, filter } = this._engineNodes;
    const freq = 55 + speedRatio * 220 + (boosting ? 90 : 0);
    osc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.05);
    filter.frequency.setTargetAtTime(500 + speedRatio * 2500, this.ctx.currentTime, 0.05);
    gain.gain.setTargetAtTime(0.12 + speedRatio * 0.12, this.ctx.currentTime, 0.08);
  }

  _tone({ freq = 440, type = "sine", duration = 0.15, gainValue = 0.3, sweepTo = null }) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    if (sweepTo != null) osc.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + duration);
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.05);
  }

  playBoost() {
    this._tone({ freq: 220, sweepTo: 880, type: "sawtooth", duration: 0.4, gainValue: 0.35 });
  }

  playDriftTick() {
    this._tone({ freq: 300, type: "square", duration: 0.05, gainValue: 0.08 });
  }

  playCollision() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.25);
    const gain = ctx.createGain();
    gain.gain.value = 0.4;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1200;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
  }

  playCountdownBeep(isGo = false) {
    this._tone({ freq: isGo ? 880 : 500, type: "square", duration: isGo ? 0.35 : 0.15, gainValue: 0.35 });
  }

  playLapComplete() {
    if (!this.enabled) return;
    [523, 659, 784].forEach((f, i) => {
      setTimeout(() => this._tone({ freq: f, type: "triangle", duration: 0.2, gainValue: 0.3 }), i * 90);
    });
  }

  playFinish() {
    if (!this.enabled) return;
    [523, 659, 784, 1046].forEach((f, i) => {
      setTimeout(() => this._tone({ freq: f, type: "triangle", duration: 0.35, gainValue: 0.32 }), i * 120);
    });
  }
}
