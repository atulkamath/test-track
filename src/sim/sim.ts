import { autopilotInput, chooseLine, DEFAULT_SKILL, nearestIndex, type Skill } from "./autopilot";
import { DT, stepCar, type CarState } from "./car";
import { collideCars, collideObstacles, collideWalls, type Knock } from "./collide";
import { INPUT_MASK, LEFT, RIGHT } from "./input";
import { hashString } from "./rng";
import { headingFromVector } from "./trig";
import { crossesGate, distanceToCentre, generateTrack, type Track } from "./track";

export const TICK_RATE = 60;
/** Replays longer than this are rejected (10 minutes). */
export const MAX_TICKS = TICK_RATE * 60 * 10;
/** Bump whenever sim rules change: old runs can't be replayed faithfully. */
export const RUN_VERSION = 10 as const;
/** Race distance. */
export const LAPS = 3;

// The grid: two-wide, staggered, on the straight behind the start line. Slot 0 is pole.
/** Track samples (2 m each) between grid rows, and how far behind the line pole sits. */
const GRID_ROW = 4;
const GRID_FRONT = 4;
/** Sideways offset of each grid column from the centreline (m). */
export const GRID_SIDE = 2.6;

/** The AI field, front of the grid first: quickest on pole. The player starts behind them all. */
const BOTS: { skill: Skill }[] = [
  { skill: { pace: 0.94, lookAhead: 7 } },
  { skill: { pace: 0.9, lookAhead: 6 } },
  { skill: { pace: 0.86, lookAhead: 7 } },
  { skill: { pace: 0.82, lookAhead: 6 } },
];

/** Where grid slot `k` is: sample index and which side of the road (+1 right, -1 left). */
export function gridSlot(track: Track, k: number): { index: number; side: number } {
  const n = track.points.length;
  return { index: (((n - GRID_FRONT - k * GRID_ROW) % n) + n) % n, side: k % 2 ? 1 : -1 };
}

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
  /** AI cars. Deterministic, so every player meets the same field. */
  bots: CarState[];
  /** Each AI car's current line: metres right of the centreline it is aiming for (it attacks and defends with this). */
  botLine: number[];
  /** Per track obstacle: set when a cone is knocked over (tyres never are). */
  knocked: (Knock | null)[];
  /** Index of the next gate to cross. */
  nextGate: number;
  /** Laps the player has completed. */
  lap: number;
  /** Tick the current lap started on, and the quickest lap so far. */
  lapStartTick: number;
  bestLapTicks: number | null;
  /**
   * How far each car has travelled round the track, in centreline samples from the start line (so cars on the
   * grid start negative). Index 0 is the player, then the AI cars. Higher = further ahead.
   */
  progress: number[];
  /** Each car's nearest centreline sample last tick (used to advance `progress`). */
  trackIndex: number[];
  /** Total race time, set on the tick the player finishes the last lap; the sim stops advancing after that. */
  lapTicks: number | null;
}

export interface Sim {
  track: Track;
  state: SimState;
}

/** A stationary car in grid slot k, pointing down the track. */
function carOnGrid(track: Track, k: number): CarState {
  const { index, side } = gridSlot(track, k);
  const p = track.points[index];
  const t = track.tangents[index];
  const off = side * GRID_SIDE;
  return { x: p.x - t.z * off, z: p.z + t.x * off, vx: 0, vz: 0, heading: headingFromVector(t.x, t.z), speed: 0, steer: 0, turnRem: 0, slide: 0, burnout: false, offRoad: false };
}

export function createSim(seed: string, track: Track = generateTrack(seed)): Sim {
  const n = track.points.length;
  const bots = BOTS.map((_, k) => carOnGrid(track, k));
  const car = carOnGrid(track, BOTS.length);
  const trackIndex = [car, ...bots].map((c) => nearestIndex(track, c.x, c.z));
  return {
    track,
    state: {
      tick: 0,
      car,
      bots,
      // Start each AI car aiming at the side of the road its grid slot is on.
      botLine: BOTS.map((_, k) => gridSlot(track, k).side * GRID_SIDE),
      knocked: track.obstacles.map(() => null),
      nextGate: 1,
      lap: 0,
      lapStartTick: 0,
      bestLapTicks: null,
      // Everyone starts just behind the line: a small negative distance.
      progress: trackIndex.map((i) => i - n),
      trackIndex,
      lapTicks: null,
    },
  };
}

/** Advance each car's distance round the track by how far its nearest centreline sample moved this tick. */
function updateProgress(sim: Sim): void {
  const s = sim.state;
  const n = sim.track.points.length;
  const cars = [s.car, ...s.bots];
  for (let c = 0; c < cars.length; c++) {
    const i = nearestIndex(sim.track, cars[c].x, cars[c].z);
    let d = i - s.trackIndex[c];
    // Take the short way round the loop (crossing the start line wraps the index).
    if (d > n / 2) d -= n;
    else if (d < -n / 2) d += n;
    s.progress[c] += d;
    s.trackIndex[c] = i;
  }
}

/** The player's race position: 1 = leading. */
export function racePosition(state: SimState): number {
  let ahead = 0;
  for (let c = 1; c < state.progress.length; c++) if (state.progress[c] > state.progress[0]) ahead++;
  return ahead + 1;
}

function moveCar(sim: Sim, car: CarState, input: number): void {
  stepCar(car, input);
  car.offRoad = distanceToCentre(sim.track, car.x, car.z) > sim.track.halfWidth;
  collideObstacles(car, sim.track.obstacles, sim.state.knocked, sim.state.tick);
  collideWalls(car, sim.track.walls);
}

function moveBots(sim: Sim): void {
  const s = sim.state;
  const field = [s.car, ...s.bots];
  for (let k = 0; k < s.bots.length; k++) {
    const bot = s.bots[k];
    const rivals = field.filter((c) => c !== bot);
    s.botLine[k] = chooseLine(sim.track, bot, rivals, s.botLine[k] ?? 0);
    moveCar(sim, bot, autopilotInput(sim.track, bot, BOTS[k].skill, s.botLine[k], rivals));
  }
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

  updateProgress(sim);

  const gate = sim.track.gates[s.nextGate];
  if (crossesGate(gate, x0, z0, s.car.x, s.car.z)) {
    if (s.nextGate === 0) {
      // Across the line with every checkpoint passed: a lap done.
      const lapTime = s.tick - s.lapStartTick;
      if (s.bestLapTicks === null || lapTime < s.bestLapTicks) s.bestLapTicks = lapTime;
      s.lap++;
      s.lapStartTick = s.tick;
      if (s.lap >= LAPS) s.lapTicks = s.tick;
      else s.nextGate = 1;
    } else s.nextGate = (s.nextGate + 1) % sim.track.gates.length;
  }
}

/** How hard the player's car slows after the flag (m/s^2): from racing speed to a stop in 4-5 seconds. */
const COOLDOWN_DECEL = 9;

/**
 * Display only, after the player has finished: the AI cars keep racing, and the player's car rolls on over
 * the line on its own, steering itself and slowing gently to a stop. Never part of a replay.
 */
export function stepTraffic(sim: Sim): void {
  const s = sim.state;
  const car = s.car;
  if (car.speed > 0.3) {
    moveCar(sim, car, autopilotInput(sim.track, car, DEFAULT_SKILL, 0, s.bots) & (LEFT | RIGHT));
    const keep = car.speed > COOLDOWN_DECEL * DT ? 1 - (COOLDOWN_DECEL * DT) / car.speed : 0;
    car.vx *= keep;
    car.vz *= keep;
    car.speed *= keep;
  } else {
    car.vx = 0;
    car.vz = 0;
    car.speed = 0;
  }
  moveBots(sim);
  collideAll([sim.state.car, ...sim.state.bots]);
  updateProgress(sim);
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
