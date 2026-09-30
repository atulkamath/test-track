import { stepCar, type CarState } from "./car";
import { INPUT_MASK } from "./input";
import { hashString } from "./rng";
import { headingFromVector } from "./trig";
import { crossesGate, distanceToCentre, generateTrack, type Track } from "./track";

export const TICK_RATE = 60;
/** Replays longer than this are rejected (10 minutes). */
export const MAX_TICKS = TICK_RATE * 60 * 10;
const START_INDEX = 3;

export interface Run {
  version: 1;
  seed: string;
  /** One input bitmask per tick. */
  inputs: number[];
  /** What the client claimed; the server should ignore it and use its own replay. */
  lapTicks?: number;
}

export interface SimState {
  tick: number;
  car: CarState;
  /** Index of the next gate to cross. */
  nextGate: number;
  /** Set on the tick the lap completes; the sim stops advancing after that. */
  lapTicks: number | null;
}

export interface Sim {
  track: Track;
  state: SimState;
}

export function createSim(seed: string, track: Track = generateTrack(seed)): Sim {
  const p = track.points[START_INDEX];
  const t = track.tangents[START_INDEX];
  return {
    track,
    state: {
      tick: 0,
      car: { x: p.x, z: p.z, vx: 0, vz: 0, heading: headingFromVector(t.x, t.z), speed: 0, offRoad: false },
      nextGate: 1,
      lapTicks: null,
    },
  };
}

export function step(sim: Sim, input: number): void {
  const s = sim.state;
  if (s.lapTicks !== null) return;
  const x0 = s.car.x;
  const z0 = s.car.z;
  stepCar(s.car, input & INPUT_MASK);
  s.tick++;
  s.car.offRoad = distanceToCentre(sim.track, s.car.x, s.car.z) > sim.track.halfWidth;

  const gate = sim.track.gates[s.nextGate];
  if (crossesGate(gate, x0, z0, s.car.x, s.car.z)) {
    if (s.nextGate === 0) s.lapTicks = s.tick;
    else s.nextGate = (s.nextGate + 1) % sim.track.gates.length;
  }
}

/** Stable fingerprint of the full sim state. Number->string is exactly specified, so this is portable. */
export function hashState(state: SimState): string {
  return hashString(JSON.stringify(state)).toString(16).padStart(8, "0");
}

export interface ReplayResult {
  lapTicks: number | null;
  ticks: number;
  hash: string;
}

export function replay(run: Run): ReplayResult {
  if (run.inputs.length > MAX_TICKS) throw new Error(`run too long: ${run.inputs.length} ticks`);
  const sim = createSim(run.seed);
  for (const input of run.inputs) {
    if (!Number.isInteger(input)) throw new Error(`bad input: ${input}`);
    step(sim, input);
    if (sim.state.lapTicks !== null) break;
  }
  return { lapTicks: sim.state.lapTicks, ticks: sim.state.tick, hash: hashState(sim.state) };
}
