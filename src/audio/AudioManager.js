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
    this._roadNodes = null;
    this._brakeCooldown = 0;
    this._revPhase = Math.random() * Math.PI * 2;
  }

  /** Must be called from a user gesture (click/keypress) to satisfy autoplay policies. */
  init() {
    if (this.ctx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      // A gentle limiter on the master bus so overlapping SFX (collision +
      // engine + drift tick) never clip or feel harsh.
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 18;
      compressor.ratio.value = 6;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.2;
      compressor.connect(this.ctx.destination);

      this.master = this.ctx.createGain();
      this.master.gain.value = 0.42;
      this.master.connect(compressor);
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

  _loopingNoiseSource(duration = 2) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(duration);
    src.loop = true;
    return src;
  }

  startEngine() {
    if (!this.enabled || this._engineNodes) return;
    const ctx = this.ctx;

    // Two slightly-detuned oscillators (saw + a low square "putter") through
    // a resonant lowpass reads as a much smoother, richer engine than a
    // single raw sawtooth. A third, very quiet detuned saw gives it a
    // faint "chorus" so it doesn't read as a single static loop.
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 60;
    const osc2 = ctx.createOscillator();
    osc2.type = "sawtooth";
    osc2.frequency.value = 60;
    osc2.detune.value = 9;
    const sub = ctx.createOscillator();
    sub.type = "square";
    sub.frequency.value = 30;
    sub.detune.value = -6;

    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.75;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.22;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.35;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 700;
    filter.Q.value = 0.6;

    const gain = ctx.createGain();
    gain.gain.value = 0.0;

    // A slow LFO on pitch gives the idle/cruise tone a subtle organic
    // waver instead of a perfectly flat, "cheap synth loop" pitch.
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 5.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 1.4;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.detune);
    lfoGain.connect(osc2.detune);
    lfo.start();

    osc.connect(oscGain).connect(filter);
    osc2.connect(osc2Gain).connect(filter);
    sub.connect(subGain).connect(filter);
    filter.connect(gain).connect(this.master);
    osc.start();
    osc2.start();
    sub.start();
    this._engineNodes = { osc, osc2, sub, gain, filter, lfo };

    // Continuous tire/road rolling noise - a filtered noise bed whose
    // level and brightness track speed, mixed low enough to sit under the
    // engine rather than compete with it.
    const roadSrc = this._loopingNoiseSource(2);
    const roadFilter = ctx.createBiquadFilter();
    roadFilter.type = "bandpass";
    roadFilter.frequency.value = 500;
    roadFilter.Q.value = 0.5;
    const roadGain = ctx.createGain();
    roadGain.gain.value = 0;
    roadSrc.connect(roadFilter).connect(roadGain).connect(this.master);
    roadSrc.start();
    this._roadNodes = { src: roadSrc, filter: roadFilter, gain: roadGain };
  }

  stopEngine() {
    if (!this._engineNodes) return;
    const { osc, osc2, sub, gain, lfo } = this._engineNodes;
    const t = this.ctx.currentTime;
    gain.gain.setTargetAtTime(0, t, 0.06);
    osc.stop(t + 0.25);
    osc2.stop(t + 0.25);
    sub.stop(t + 0.25);
    lfo.stop(t + 0.25);
    this._engineNodes = null;

    if (this._roadNodes) {
      const { src, gain: roadGain } = this._roadNodes;
      roadGain.gain.setTargetAtTime(0, t, 0.06);
      src.stop(t + 0.25);
      this._roadNodes = null;
    }
  }

  /**
   * speedRatio 0..1, boosting bool, throttle 0..1 (how hard the pedal is
   * down right now), offRoad bool - drives engine pitch/tone, a light
   * "rev" wobble under acceleration, and the underlying road/tire noise.
   */
  updateEngine(speedRatio, boosting, throttle = 0, offRoad = false) {
    if (!this.enabled || !this._engineNodes) return;
    const { osc, osc2, sub, gain, filter } = this._engineNodes;
    const t = this.ctx.currentTime;

    // Under throttle the engine note rises a bit faster than road speed
    // alone would suggest (revving against the gear) and brightens; off
    // throttle it settles back - this is what reads as "connected to the
    // road" rather than a single flat pitch-vs-speed mapping.
    this._revPhase += 0.05 + throttle * 0.12;
    const revWobble = Math.sin(this._revPhase) * throttle * 4;
    const load = throttle * 26;

    const freq = 55 + speedRatio * 190 + load + (boosting ? 70 : 0) + revWobble;
    osc.frequency.setTargetAtTime(freq, t, 0.07);
    osc2.frequency.setTargetAtTime(freq, t, 0.07);
    sub.frequency.setTargetAtTime(freq * 0.5, t, 0.07);
    filter.frequency.setTargetAtTime(450 + speedRatio * 2200 + load * 20 + (boosting ? 800 : 0), t, 0.09);
    gain.gain.setTargetAtTime(0.1 + speedRatio * 0.11 + throttle * 0.02, t, 0.12);

    if (this._roadNodes) {
      const { filter: roadFilter, gain: roadGain } = this._roadNodes;
      roadGain.gain.setTargetAtTime(speedRatio * (offRoad ? 0.05 : 0.03), t, 0.15);
      roadFilter.frequency.setTargetAtTime(offRoad ? 260 : 700 + speedRatio * 600, t, 0.15);
      roadFilter.Q.value = offRoad ? 0.3 : 0.6;
    }
  }

  /** A short tire screech for hard braking at real speed - distinct from
   * the drift tick's soft scuff. Rate-limited so it can't chatter. */
  playBrakeScreech(intensity = 1) {
    if (!this.enabled || this._brakeCooldown > 0) return;
    this._brakeCooldown = 0.35;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.3);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1800, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(1100, ctx.currentTime + 0.28);
    filter.Q.value = 3;
    const gain = ctx.createGain();
    const peak = 0.18 * Math.min(1, Math.max(0.3, intensity));
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(peak, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
  }

  /** Called once per frame; decays the brake-screech cooldown. */
  tick(dt) {
    if (this._brakeCooldown > 0) this._brakeCooldown -= dt;
  }

  _tone({ freq = 440, type = "sine", duration = 0.15, gainValue = 0.3, sweepTo = null, attack = 0.005 }) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    if (sweepTo != null) osc.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(gainValue, ctx.currentTime + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.05);
  }

  playBoost() {
    if (!this.enabled) return;
    // Tonal rise plus a filtered noise "whoosh" layered underneath.
    this._tone({ freq: 240, sweepTo: 760, type: "triangle", duration: 0.4, gainValue: 0.3 });
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.4);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(500, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(2200, ctx.currentTime + 0.35);
    filter.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
  }

  playDriftTick() {
    if (!this.enabled) return;
    // A soft filtered noise scuff reads as tire scrub far better than a
    // repeated tone blip.
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.08);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1400 + Math.random() * 400;
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.value = 0.06;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
  }

  playCollision() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    // Filtered noise crack...
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.22);
    const gain = ctx.createGain();
    gain.gain.value = 0.32;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 900;
    filter.Q.value = 0.7;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    // ...plus a short low thump underneath for impact weight.
    this._tone({ freq: 140, sweepTo: 60, type: "sine", duration: 0.18, gainValue: 0.28 });
  }

  playCountdownBeep(isGo = false) {
    this._tone({ freq: isGo ? 880 : 500, type: "triangle", duration: isGo ? 0.35 : 0.14, gainValue: 0.3 });
  }

  playLapComplete() {
    if (!this.enabled) return;
    [523, 659, 784].forEach((f, i) => {
      setTimeout(() => this._tone({ freq: f, type: "triangle", duration: 0.2, gainValue: 0.28 }), i * 90);
    });
  }

  playFinish() {
    if (!this.enabled) return;
    [523, 659, 784, 1046].forEach((f, i) => {
      setTimeout(() => this._tone({ freq: f, type: "triangle", duration: 0.35, gainValue: 0.3 }), i * 120);
    });
  }

  playUIClick() {
    this._tone({ freq: 720, type: "sine", duration: 0.06, gainValue: 0.12, attack: 0.001 });
  }

  playUIHover() {
    this._tone({ freq: 540, type: "sine", duration: 0.04, gainValue: 0.05, attack: 0.001 });
  }
}
