// Procedural sound: engine, tyre squeal, wind and crowd, all synthesized with Web Audio (no audio files).
// Created on the first key press, because browsers only allow audio after a user gesture.

export interface SoundFrame {
  rpm: number;
  throttle: boolean;
  speed: number;
  /** Sideways sliding speed (m/s). */
  slip: number;
  /** 0..1 how many fans are close by and how excited they are. */
  crowd: number;
}

function noiseBuffer(ctx: AudioContext) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineOsc: OscillatorNode[] = [];
  /** Frequency multiplier per engine oscillator. */
  private engineMult: number[] = [];
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private tyreGain!: GainNode;
  private windGain!: GainNode;
  private crowdGain!: GainNode;
  private crowdFilter!: BiquadFilterNode;
  muted = false;

  /** Call from a user gesture (key press / tap). Safe to call repeatedly. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(ctx.destination);

    // Engine: two detuned saws + a sub square, soft-clipped and low-passed.
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    shaper.curve = curve;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.Q.value = 4;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const mix = ctx.createGain();
    mix.gain.value = 0.25;
    for (const [type, mult, detune] of [
      ["sawtooth", 1, 0],
      ["sawtooth", 1, 9],
      ["square", 0.5, 0],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = detune;
      o.frequency.value = 55 * mult;
      o.connect(mix);
      o.start();
      this.engineOsc.push(o);
      this.engineMult.push(mult);
    }
    mix.connect(shaper).connect(this.engineFilter).connect(this.engineGain).connect(this.master);

    // Shared noise source for tyres, wind and crowd.
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx);
    noise.loop = true;
    noise.start();

    const tyreFilter = ctx.createBiquadFilter();
    tyreFilter.type = "bandpass";
    tyreFilter.frequency.value = 1500;
    tyreFilter.Q.value = 8;
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    noise.connect(tyreFilter).connect(this.tyreGain).connect(this.master);

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 900;
    windFilter.Q.value = 0.5;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    noise.connect(windFilter).connect(this.windGain).connect(this.master);

    this.crowdFilter = ctx.createBiquadFilter();
    this.crowdFilter.type = "bandpass";
    this.crowdFilter.frequency.value = 600;
    this.crowdFilter.Q.value = 0.8;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0;
    noise.connect(this.crowdFilter).connect(this.crowdGain).connect(this.master);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.6, this.ctx.currentTime, 0.05);
  }

  update(f: SoundFrame) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const hz = (f.rpm / 60) * 3; // six-cylinder firing frequency
    this.engineOsc.forEach((o, i) => o.frequency.setTargetAtTime(hz * this.engineMult[i], t, 0.03));
    this.engineFilter.frequency.setTargetAtTime(250 + f.rpm * 0.16 + (f.throttle ? 900 : 0), t, 0.05);
    this.engineGain.gain.setTargetAtTime(f.throttle ? 0.22 : 0.12, t, 0.08);
    const slip = Math.min(Math.max((f.slip - 2.5) / 6, 0), 1);
    this.tyreGain.gain.setTargetAtTime(slip * 0.18, t, 0.05);
    const s = Math.min(Math.abs(f.speed) / 55, 1);
    this.windGain.gain.setTargetAtTime(s * s * 0.12, t, 0.1);
    this.crowdGain.gain.setTargetAtTime(0.015 + f.crowd * 0.2, t, 0.3);
    this.crowdFilter.frequency.setTargetAtTime(500 + f.crowd * 500, t, 0.3);
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
