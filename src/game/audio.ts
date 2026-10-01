// Procedural sound, all synthesized with Web Audio (no audio files):
// a four-stroke engine model for the player and for each AI car (with distance, panning and Doppler so you
// hear them go past), tyre squeal, brake screech, wind, gear-change clunk and crowd.
// Created on the first key press, because browsers only allow audio after a user gesture.

export interface OtherCar {
  /** Distance from the listener (m). */
  dist: number;
  /** -1 = fully left, +1 = fully right. */
  pan: number;
  rpm: number;
  /** Rate the gap is changing (m/s); negative = closing. Drives the Doppler shift. */
  radialSpeed: number;
  /** How fast it is moving relative to the listener (m/s); drives the pass-by whoosh. */
  relSpeed: number;
}

export interface SoundFrame {
  rpm: number;
  throttle: boolean;
  speed: number;
  /** Sideways sliding speed (m/s). */
  slip: number;
  /** 0..1 how many fans are close by and how excited they are. */
  crowd: number;
  braking: boolean;
  others: OtherCar[];
}

const SPEED_OF_SOUND = 343;
const IDLE_RPM = 900;

function noiseBuffer(ctx: AudioContext) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * One period of a four-cylinder four-stroke: the fundamental is the engine cycle (two crank revolutions),
 * so harmonic 4 is the firing frequency. Firing harmonics dominate; the half-orders in between give the
 * uneven "burble" that makes an engine sound like an engine rather than a tone.
 */
function engineWave(ctx: AudioContext, roughness: number) {
  const N = 40;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  for (let h = 1; h < N; h++) {
    const firing = h % 4 === 0;
    const even = h % 2 === 0;
    const base = firing ? 1 : even ? 0.38 : 0.16 * roughness;
    // Roll off with harmonic number; firing harmonics carry further.
    imag[h] = base / Math.pow(h / 4, firing ? 0.9 : 1.25);
    // Fixed pseudo-random phases stop the harmonics lining up into a buzzy spike.
    real[h] = imag[h] * Math.sin(h * 12.9898) * 0.6;
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

/** A complete engine: harmonic core + exhaust noise pulsing at the firing rate, through a throttle-controlled filter. */
class EngineVoice {
  private oscA: OscillatorNode;
  private oscB: OscillatorNode;
  private firing: OscillatorNode;
  private drive: GainNode;
  private filter: BiquadFilterNode;
  private body: BiquadFilterNode;
  private exhaustFilter: BiquadFilterNode;
  private exhaustLevel: GainNode;
  readonly out: GainNode;

  constructor(
    private ctx: AudioContext,
    noise: AudioNode,
    destination: AudioNode,
    roughness: number,
  ) {
    const wave = engineWave(ctx, roughness);
    this.oscA = ctx.createOscillator();
    this.oscB = ctx.createOscillator();
    this.oscA.setPeriodicWave(wave);
    this.oscB.setPeriodicWave(wave);
    this.oscB.detune.value = 7; // slight thickness, like two exhaust paths

    // Soft clipping: more drive = harder-edged note under load.
    this.drive = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 2.4);
    shaper.curve = curve;
    shaper.oversample = "2x";

    // Exhaust: noise chopped at the firing frequency.
    this.exhaustFilter = ctx.createBiquadFilter();
    this.exhaustFilter.type = "bandpass";
    this.exhaustFilter.Q.value = 1.2;
    const chop = ctx.createGain();
    chop.gain.value = 0.5;
    this.firing = ctx.createOscillator();
    this.firing.type = "sine";
    const chopDepth = ctx.createGain();
    chopDepth.gain.value = 0.5;
    this.firing.connect(chopDepth).connect(chop.gain);
    this.exhaustLevel = ctx.createGain();
    noise.connect(this.exhaustFilter).connect(chop).connect(this.exhaustLevel);

    // Throttle opens the low-pass; a fixed resonance stands in for the exhaust and cabin.
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = 1.4;
    this.body = ctx.createBiquadFilter();
    this.body.type = "peaking";
    this.body.frequency.value = 320;
    this.body.Q.value = 1.1;
    this.body.gain.value = 6;

    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.oscA.connect(this.drive);
    this.oscB.connect(this.drive);
    this.drive.connect(shaper).connect(this.filter);
    this.exhaustLevel.connect(this.filter);
    this.filter.connect(this.body).connect(this.out).connect(destination);
    for (const o of [this.oscA, this.oscB, this.firing]) o.start();
  }

  /** load: 0 (throttle shut) .. 1 (full throttle). pitch: extra multiplier (Doppler). */
  set(rpm: number, load: number, level: number, pitch = 1) {
    const t = this.ctx.currentTime;
    const cycle = (rpm / 120) * pitch; // Hz of one full engine cycle
    this.oscA.frequency.setTargetAtTime(cycle, t, 0.025);
    this.oscB.frequency.setTargetAtTime(cycle, t, 0.025);
    this.firing.frequency.setTargetAtTime(cycle * 4, t, 0.025);
    this.drive.gain.setTargetAtTime(0.35 + load * 0.75, t, 0.05);
    this.filter.frequency.setTargetAtTime(260 + rpm * (0.12 + load * 0.3), t, 0.06);
    this.exhaustFilter.frequency.setTargetAtTime((140 + rpm * 0.07) * pitch, t, 0.06);
    this.exhaustLevel.gain.setTargetAtTime(0.25 + load * 0.5, t, 0.06);
    this.out.gain.setTargetAtTime(level, t, 0.06);
  }
}

/** Another car as heard from ours: its engine plus a rush of tyre/wind noise, placed left or right. */
class PassingCar {
  private engine: EngineVoice;
  private pan: StereoPannerNode;
  private rush: GainNode;

  constructor(
    private ctx: AudioContext,
    noise: AudioNode,
    destination: AudioNode,
    roughness: number,
  ) {
    this.pan = ctx.createStereoPanner();
    this.pan.connect(destination);
    this.engine = new EngineVoice(ctx, noise, this.pan, roughness);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1100;
    band.Q.value = 0.6;
    this.rush = ctx.createGain();
    this.rush.gain.value = 0;
    noise.connect(band).connect(this.rush).connect(this.pan);
  }

  set(c: OtherCar) {
    const t = this.ctx.currentTime;
    // Inverse-square-ish falloff: loud alongside, gone by ~120 m.
    const near = 1 / (1 + (c.dist / 9) * (c.dist / 9));
    // Doppler: higher pitch while closing, dropping as it goes away.
    const pitch = SPEED_OF_SOUND / (SPEED_OF_SOUND + Math.max(-60, Math.min(60, c.radialSpeed)));
    this.engine.set(c.rpm, 0.75, near * 0.5, pitch);
    this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, c.pan)), t, 0.05);
    // The whoosh: only right alongside, and stronger the faster the pass.
    const close = 1 / (1 + (c.dist / 4) * (c.dist / 4));
    this.rush.gain.setTargetAtTime(close * Math.min(Math.abs(c.relSpeed) / 25, 1) * 0.35, t, 0.04);
  }
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engine!: EngineVoice;
  private others: PassingCar[] = [];
  private tyreGain!: GainNode;
  private windGain!: GainNode;
  private crowdGain!: GainNode;
  private crowdFilter!: BiquadFilterNode;
  private shiftGain!: GainNode;
  private brakeGain!: GainNode;
  private brakeOsc!: OscillatorNode;
  private brakeOsc2!: OscillatorNode;
  private noise!: AudioBufferSourceNode;
  private wasThrottle = false;
  private idlePhase = 0;
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
    // A gentle limiter so several engines plus effects never clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 6;
    this.master.connect(limiter).connect(ctx.destination);

    // Shared noise source for exhausts, tyres, wind and crowd.
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx);
    noise.loop = true;
    noise.start();
    this.noise = noise;

    // shiftGain is only touched by shift(), so per-frame updates never cancel the gear-change dip.
    this.shiftGain = ctx.createGain();
    this.shiftGain.connect(this.master);
    this.engine = new EngineVoice(ctx, noise, this.shiftGain, 1);

    // Brake screech: two detuned squares warbling around 2 kHz, band-passed, over a bed of hiss.
    this.brakeGain = ctx.createGain();
    this.brakeGain.gain.value = 0;
    this.brakeGain.connect(this.master);
    const screechBand = ctx.createBiquadFilter();
    screechBand.type = "bandpass";
    screechBand.frequency.value = 2200;
    screechBand.Q.value = 2.5;
    screechBand.connect(this.brakeGain);
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 17;
    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.value = 90;
    vibrato.connect(vibratoDepth);
    vibrato.start();
    this.brakeOsc = ctx.createOscillator();
    this.brakeOsc2 = ctx.createOscillator();
    for (const [o, f] of [
      [this.brakeOsc, 1900],
      [this.brakeOsc2, 2430],
    ] as const) {
      o.type = "square";
      o.frequency.value = f;
      vibratoDepth.connect(o.frequency);
      const lvl = ctx.createGain();
      lvl.gain.value = 0.5;
      o.connect(lvl).connect(screechBand);
      o.start();
    }
    const hiss = ctx.createBiquadFilter();
    hiss.type = "bandpass";
    hiss.frequency.value = 2800;
    hiss.Q.value = 1.5;
    const hissLvl = ctx.createGain();
    hissLvl.gain.value = 0.6;
    noise.connect(hiss).connect(hissLvl).connect(this.brakeGain);

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

    // Idle isn't perfectly steady: let the revs hunt a little when the engine is just ticking over.
    this.idlePhase += 0.11;
    const idling = f.rpm < IDLE_RPM + 400 && !f.throttle;
    const rpm = idling ? f.rpm + 28 * Math.sin(this.idlePhase) + 14 * Math.sin(this.idlePhase * 2.7) : f.rpm;
    this.engine.set(rpm, f.throttle ? 1 : 0.12, f.throttle ? 0.3 : 0.17);

    // Lifting off at high revs: a few pops from the exhaust.
    if (this.wasThrottle && !f.throttle && f.rpm > 5200) this.pops(3 + Math.floor(Math.random() * 3));
    this.wasThrottle = f.throttle;

    // One voice per other car, created the first time it's needed.
    while (this.others.length < f.others.length) this.others.push(new PassingCar(ctx, this.noise, this.master, 0.7 + this.others.length * 0.25));
    f.others.forEach((c, i) => this.others[i].set(c));

    const slip = Math.min(Math.max((f.slip - 2.5) / 6, 0), 1);
    this.tyreGain.gain.setTargetAtTime(slip * 0.18, t, 0.05);
    const s = Math.min(Math.abs(f.speed) / 64, 1);
    this.windGain.gain.setTargetAtTime(s * s * 0.12, t, 0.1);
    // Screech whenever the brakes bite above ~18 km/h; louder and higher at speed.
    const screech = f.braking ? Math.min(Math.max((Math.abs(f.speed) - 5) / 20, 0), 1) : 0;
    this.brakeGain.gain.setTargetAtTime(screech * 0.2, t, screech > 0 ? 0.02 : 0.12);
    this.brakeOsc.frequency.setTargetAtTime(1600 + Math.abs(f.speed) * 12, t, 0.08);
    this.brakeOsc2.frequency.setTargetAtTime(2050 + Math.abs(f.speed) * 15, t, 0.08);
    this.crowdGain.gain.setTargetAtTime(0.015 + f.crowd * 0.2, t, 0.3);
    this.crowdFilter.frequency.setTargetAtTime(500 + f.crowd * 500, t, 0.3);
  }

  /** Short bursts of low-passed noise, slightly irregular in time: overrun crackle. */
  private pops(count: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    let when = ctx.currentTime + 0.03;
    for (let i = 0; i < count; i++) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(0.22 + Math.random() * 0.15, when + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900 + Math.random() * 700;
      this.noise.connect(lp).connect(g).connect(this.master);
      setTimeout(() => lp.disconnect(), (when - ctx.currentTime) * 1000 + 200);
      when += 0.05 + Math.random() * 0.09;
    }
  }

  /** Gear change: the engine note cuts briefly and the gearbox clunks. */
  shift() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = this.shiftGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(1, t);
    g.linearRampToValueAtTime(0.15, t + 0.035);
    g.linearRampToValueAtTime(0.15, t + 0.12);
    g.linearRampToValueAtTime(1, t + 0.22);
    // Clunk: a short burst of low-passed noise.
    const clunk = ctx.createGain();
    clunk.gain.setValueAtTime(0, t);
    clunk.gain.setValueAtTime(0.3, t + 0.03);
    clunk.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 600;
    this.noise.connect(lp).connect(clunk).connect(this.master);
    setTimeout(() => lp.disconnect(), 250);
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
