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
  braking: boolean;
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
  private shiftGain!: GainNode;
  private brakeGain!: GainNode;
  private brakeOsc!: OscillatorNode;
  private noise!: AudioBufferSourceNode;
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
    // shiftGain is only touched by shift(), so per-frame updates never cancel the gear-change dip.
    this.shiftGain = ctx.createGain();
    mix.connect(shaper).connect(this.engineFilter).connect(this.engineGain).connect(this.shiftGain).connect(this.master);

    // Shared noise source for tyres, wind and crowd.
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx);
    noise.loop = true;
    noise.start();
    this.noise = noise;

    // Brake screech: a warbling high tone over narrow-band noise.
    this.brakeGain = ctx.createGain();
    this.brakeGain.gain.value = 0;
    this.brakeGain.connect(this.master);
    this.brakeOsc = ctx.createOscillator();
    this.brakeOsc.type = "triangle";
    this.brakeOsc.frequency.value = 2900;
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 23;
    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.value = 120;
    vibrato.connect(vibratoDepth).connect(this.brakeOsc.frequency);
    vibrato.start();
    const toneLevel = ctx.createGain();
    toneLevel.gain.value = 0.35;
    this.brakeOsc.connect(toneLevel).connect(this.brakeGain);
    this.brakeOsc.start();
    const brakeNoise = ctx.createBiquadFilter();
    brakeNoise.type = "bandpass";
    brakeNoise.frequency.value = 3200;
    brakeNoise.Q.value = 12;
    noise.connect(brakeNoise).connect(this.brakeGain);

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
    // Screech when the brakes bite at speed; pitch drops as the car slows.
    const screech = f.braking ? Math.min(Math.max((Math.abs(f.speed) - 12) / 25, 0), 1) : 0;
    this.brakeGain.gain.setTargetAtTime(screech * 0.09, t, screech > 0 ? 0.04 : 0.08);
    this.brakeOsc.frequency.setTargetAtTime(2300 + Math.abs(f.speed) * 18, t, 0.1);
    this.crowdGain.gain.setTargetAtTime(0.015 + f.crowd * 0.2, t, 0.3);
    this.crowdFilter.frequency.setTargetAtTime(500 + f.crowd * 500, t, 0.3);
  }

  /** Gear change: the engine note cuts briefly and the gearbox clunks. */
  shift() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = this.shiftGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(1, t);
    g.linearRampToValueAtTime(0.2, t + 0.04);
    g.linearRampToValueAtTime(0.2, t + 0.1);
    g.linearRampToValueAtTime(1, t + 0.2);
    // Clunk: a short burst of low-passed noise.
    const clunk = ctx.createGain();
    clunk.gain.setValueAtTime(0.25, t);
    clunk.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 700;
    this.noise.connect(lp).connect(clunk).connect(this.master);
    setTimeout(() => lp.disconnect(), 150);
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
