import { autopilotInput, type Skill } from "./autopilot";
import { stepCar, type CarState } from "./car";
import { collideCars, collideObstacles, collideWalls, type Knock } from "./collide";
import { INPUT_MASK } from "./input";
import { hashString } from "./rng";
import { headingFromVector } from "./trig";
import { crossesGate, distanceToCentre, generateTrack, type Track } from "./track";

export const TICK_RATE = 60;
/** Replays longer than this are rejected (10 minutes). */
export const MAX_TICKS = TICK_RATE * 60 * 10;
/** Bump whenever sim rules change: old runs can't be replayed faithfully. */
export const RUN_VERSION = 4 as const;
const START_INDEX = 3;

/** AI traffic: where each car starts (fraction of a lap ahead of the player) and how well it drives. */
const BOTS: { start: number; skill: Skill }[] = [
  { start: 0.06, skill: { pace: 0.8, lookAhead: 6 } },
  { start: 0.26, skill: { pace: 0.85, lookAhead: 7 } },
  { start: 0.46, skill: { pace: 0.9, lookAhead: 6 } },
  { start: 0.66, skill: { pace: 0.95, lookAhead: 7 } },
];

export interface Run {
  version: typeof RUN_VERSION;
  seed: string;
  /** One input bitmask per tick. */
  inputs: number[];
  /** What the client claimed; the server should ignore it and use its own replay. */
  lapTicks?: number;
}

export interface SimState {
  tick: number;
  car: CarState;
  /** AI cars. Deterministic, so every player meets the same traffic. */
  bots: CarState[];
  /** Per track obstacle: set when a cone is knocked over (tyres never are). */
  knocked: (Knock | null)[];
  /** Index of the next gate to cross. */
  nextGate: number;
  /** Set on the tick the lap completes; the sim stops advancing after that. */
  lapTicks: number | null;
}

export interface Sim {
  track: Track;
  state: SimState;
}

function carAt(track: Track, i: number, speed: number): CarState {
  const p = track.points[i];
  const t = track.tangents[i];
  return { x: p.x, z: p.z, vx: t.x * speed, vz: t.z * speed, heading: headingFromVector(t.x, t.z), speed, offRoad: false };
}

export function createSim(seed: string, track: Track = generateTrack(seed)): Sim {
  const n = track.points.length;
  return {
    track,
    state: {
      tick: 0,
      car: carAt(track, START_INDEX, 0),
      bots: BOTS.map((b) => carAt(track, Math.round(n * b.start) % n, 20)),
      knocked: track.obstacles.map(() => null),
      nextGate: 1,
      lapTicks: null,
    },
  };
}

function moveCar(sim: Sim, car: CarState, input: number): void {
  stepCar(car, input);
  car.offRoad = distanceToCentre(sim.track, car.x, car.z) > sim.track.halfWidth;
  collideObstacles(car, sim.track.obstacles, sim.state.knocked, sim.state.tick);
  collideWalls(car, sim.track.walls);
}

function moveBots(sim: Sim): void {
  const { bots } = sim.state;
  for (let k = 0; k < bots.length; k++) moveCar(sim, bots[k], autopilotInput(sim.track, bots[k], BOTS[k].skill));
}

function collideAll(cars: CarState[]): void {
  for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) collideCars(cars[a], cars[b]);
}

export function step(sim: Sim, input: number): void {
  const s = sim.state;
  if (s.lapTicks !== null) return;
  const x0 = s.car.x;
  const z0 = s.car.z;
  s.tick++;
  moveCar(sim, s.car, input & INPUT_MASK);
  moveBots(sim);
  collideAll([s.car, ...s.bots]);

  const gate = sim.track.gates[s.nextGate];
  if (crossesGate(gate, x0, z0, s.car.x, s.car.z)) {
    if (s.nextGate === 0) s.lapTicks = s.tick;
    else s.nextGate = (s.nextGate + 1) % sim.track.gates.length;
  }
}

/** Display only, after the lap is done: keep the AI cars driving. Never part of a replay. */
export function stepTraffic(sim: Sim): void {
  moveBots(sim);
  collideAll([sim.state.car, ...sim.state.bots]);
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
  if (run.version !== RUN_VERSION) throw new Error(`run version ${run.version} is not replayable (expected ${RUN_VERSION})`);
  if (run.inputs.length > MAX_TICKS) throw new Error(`run too long: ${run.inputs.length} ticks`);
  const sim = createSim(run.seed);
  for (const input of run.inputs) {
    if (!Number.isInteger(input)) throw new Error(`bad input: ${input}`);
    step(sim, input);
    if (sim.state.lapTicks !== null) break;
  }
  return { lapTicks: sim.state.lapTicks, ticks: sim.state.tick, hash: hashState(sim.state) };
}
