// Browser-side glue: turns wall-clock frames into fixed sim ticks and records inputs.
import { createSim, DT, HEADING_STEPS, MAX_TICKS, RUN_VERSION, skipToFinish, step, stepTraffic, type Run, type Sim, type Track } from "@/sim";

/** Length of the start-light sequence (s). Outside the sim: a replay starts at lights out. */
export const START_DELAY = 3;

export interface Pose {
  x: number;
  z: number;
  /** Radians, for three.js rotation.y. */
  angle: number;
}

export class Engine {
  sim: Sim;
  inputs: number[] = [];
  private prev: PoseSource = { x: 0, z: 0, heading: 0 };
  private prevBots: PoseSource[] = [];
  private acc = 0;
  /** Seconds of start lights left; the cars are held on the grid until it reaches zero. */
  countdown = START_DELAY;

  constructor(track: Track) {
    this.sim = createSim(track.seed, track);
    this.savePrev();
  }

  get finished(): boolean {
    return this.sim.state.lapTicks !== null;
  }

  /** Run as many whole ticks as `seconds` allows, sampling input once per tick. */
  advance(seconds: number, readInput: () => number): void {
    if (this.countdown > 0) {
      this.countdown -= seconds;
      if (this.countdown > 0) return;
      // Lights out part-way through this frame: race with whatever time is left of it.
      seconds = -this.countdown;
      this.countdown = 0;
    }
    this.acc = Math.min(this.acc + seconds, 0.25);
    while (this.acc >= DT) {
      this.savePrev();
      if (this.finished || this.inputs.length >= MAX_TICKS) {
        stepTraffic(this.sim); // race is over: AI keeps driving for show, nothing recorded
      } else {
        const input = readInput();
        this.inputs.push(input);
        step(this.sim, input);
      }
      this.acc -= DT;
    }
  }

  /** Testing aid: jump to a few seconds before the end of the final lap, lights already out. */
  skipToFinish(seconds = 5): void {
    skipToFinish(this.sim, seconds);
    this.countdown = 0;
    this.acc = 0;
    this.savePrev();
  }

  /** Pose blended between the last two ticks, for smooth rendering only. */
  pose(): Pose {
    return blendPose(this.prev, this.sim.state.car, this.acc / DT);
  }

  botPose(k: number): Pose {
    const cur = this.sim.state.bots[k];
    return blendPose(this.prevBots[k] ?? cur, cur, this.acc / DT);
  }

  run(): Run {
    return { version: RUN_VERSION, seed: this.sim.track.seed, inputs: this.inputs, lapTicks: this.sim.state.lapTicks ?? undefined };
  }

  private savePrev() {
    const pick = ({ x, z, heading }: PoseSource) => ({ x, z, heading });
    this.prev = pick(this.sim.state.car);
    this.prevBots = this.sim.state.bots.map(pick);
  }
}

type PoseSource = { x: number; z: number; heading: number };

export function blendPose(prev: PoseSource, cur: PoseSource, a: number): Pose {
  const half = HEADING_STEPS / 2;
  const dh = ((cur.heading - prev.heading + half + HEADING_STEPS) % HEADING_STEPS) - half;
  return {
    x: prev.x + (cur.x - prev.x) * a,
    z: prev.z + (cur.z - prev.z) * a,
    angle: ((prev.heading + dh * a) * 2 * Math.PI) / HEADING_STEPS,
  };
}

export function formatTicks(ticks: number): string {
  return (ticks / 60).toFixed(3);
}
