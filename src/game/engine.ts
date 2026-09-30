// Browser-side glue: turns wall-clock frames into fixed sim ticks and records inputs.
import { createSim, DT, HEADING_STEPS, MAX_TICKS, step, type Run, type Sim, type Track } from "@/sim";

export interface Pose {
  x: number;
  z: number;
  /** Radians, for three.js rotation.y. */
  angle: number;
}

export class Engine {
  sim: Sim;
  inputs: number[] = [];
  private prev = { x: 0, z: 0, heading: 0 };
  private acc = 0;

  constructor(track: Track) {
    this.sim = createSim(track.seed, track);
    this.savePrev();
  }

  get finished(): boolean {
    return this.sim.state.lapTicks !== null;
  }

  /** Run as many whole ticks as `seconds` allows, sampling input once per tick. */
  advance(seconds: number, readInput: () => number): void {
    if (this.finished) return;
    this.acc = Math.min(this.acc + seconds, 0.25);
    while (this.acc >= DT && !this.finished && this.inputs.length < MAX_TICKS) {
      const input = readInput();
      this.savePrev();
      this.inputs.push(input);
      step(this.sim, input);
      this.acc -= DT;
    }
  }

  /** Pose blended between the last two ticks, for smooth rendering only. */
  pose(): Pose {
    const car = this.sim.state.car;
    const a = this.finished ? 1 : this.acc / DT;
    const half = HEADING_STEPS / 2;
    const dh = ((car.heading - this.prev.heading + half + HEADING_STEPS) % HEADING_STEPS) - half;
    return {
      x: this.prev.x + (car.x - this.prev.x) * a,
      z: this.prev.z + (car.z - this.prev.z) * a,
      angle: ((this.prev.heading + dh * a) * 2 * Math.PI) / HEADING_STEPS,
    };
  }

  run(): Run {
    return { version: 1, seed: this.sim.track.seed, inputs: this.inputs, lapTicks: this.sim.state.lapTicks ?? undefined };
  }

  private savePrev() {
    const { x, z, heading } = this.sim.state.car;
    this.prev = { x, z, heading };
  }
}

export function formatTicks(ticks: number): string {
  return (ticks / 60).toFixed(3);
}
