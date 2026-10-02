// A simple driver that produces inputs exactly like a player would.
// Drives the AI cars inside the sim, and generates test laps.
import { BRAKE, DT, LATERAL_GRIP, type CarState } from "./car";
import { DOWN, LEFT, RIGHT, UP } from "./input";
import type { Track } from "./track";
import { COS, SIN } from "./trig";

export interface Skill {
  /** Multiplies corner speed limits; < 1 drives more cautiously. */
  pace: number;
  /** How many track samples ahead to aim at. */
  lookAhead: number;
}

/** Speed (m/s) a full-pace driver will hold the throttle up to; scaled by `pace`. */
const TOP_SPEED = 64;

export const DEFAULT_SKILL: Skill = { pace: 1, lookAhead: 6 };

/** Index of the centreline sample closest to (x, z). */
export function nearestIndex(track: Track, x: number, z: number): number {
  let best = 0;
  let bestSq = Infinity;
  const pts = track.points;
  for (let i = 0; i < pts.length; i++) {
    const d = (pts[i].x - x) * (pts[i].x - x) + (pts[i].z - z) * (pts[i].z - z);
    if (d < bestSq) {
      bestSq = d;
      best = i;
    }
  }
  return best;
}

/** Share of the tyres' sideways grip a full-pace driver plans to use in a corner. */
const CORNER_GRIP = 0.85;

/** How fast a driver moves across the road when changing line (m/s). */
const LINE_RATE = 3.2;
/** How far ahead and behind a driver watches for other cars (m). */
const AWARENESS = 22;

/**
 * Racecraft: where across the road the driver wants to be, in metres to the right of the centreline.
 * In order of priority: pull out to pass a slower car ahead; cover the side a faster car behind is attacking;
 * otherwise bias toward the inside of the next corner. `current` is last tick's line; the result moves toward
 * the wanted line at a limited rate, so cars sweep across rather than teleport.
 */
export function chooseLine(track: Track, car: CarState, rivals: CarState[], current: number): number {
  const { points, tangents } = track;
  const n = points.length;
  const i = nearestIndex(track, car.x, car.z);
  const p = points[i];
  const t = tangents[i];
  const limit = track.halfWidth - 1.5;
  const lateral = (c: CarState) => (c.x - p.x) * -t.z + (c.z - p.z) * t.x;
  const along = (c: CarState) => (c.x - car.x) * t.x + (c.z - car.z) * t.z;

  // Default: lean toward the inside of the corner coming up (a left turn's inside is the left, negative side).
  const a = tangents[(i + 4) % n];
  const b = tangents[(i + 22) % n];
  const turn = a.x * b.z - a.z * b.x;
  let want = (turn * 6 > 1 ? 1 : turn * 6 < -1 ? -1 : turn * 6) * limit * 0.55;

  let ahead: CarState | null = null;
  let behind: CarState | null = null;
  let aheadGap = AWARENESS;
  let behindGap = -AWARENESS;
  for (const r of rivals) {
    const d = along(r);
    const side = lateral(r) - lateral(car);
    // Only cars on our bit of road count (another part of the lap can be close as the crow flies).
    if (side > 2 * track.halfWidth || side < -2 * track.halfWidth) continue;
    if (d > 1.5 && d < aheadGap) {
      aheadGap = d;
      ahead = r;
    } else if (d < -1.5 && d > behindGap) {
      behindGap = d;
      behind = r;
    }
  }

  const mine = lateral(car);
  if (ahead !== null && car.speed > ahead.speed - 1.5) {
    const theirs = lateral(ahead);
    const gap = theirs - mine;
    // Catching a car that's in the way: go for the side with more room.
    if (gap < 2.8 && gap > -2.8) want = theirs > 0 ? theirs - 3.1 : theirs + 3.1;
  } else if (behind !== null && behind.speed > car.speed - 3) {
    // Being caught: move across to cover the side the chaser is on.
    want = lateral(behind) * 0.9;
  }

  if (want > limit) want = limit;
  if (want < -limit) want = -limit;
  const step = LINE_RATE * DT;
  const move = want - current;
  return current + (move > step ? step : move < -step ? -step : move);
}

/**
 * Steering, throttle and brake for one tick. `line` is the lateral position to aim for (from `chooseLine`);
 * `rivals` lets the driver lift rather than run into the back of a car directly ahead.
 */
export function autopilotInput(track: Track, car: CarState, skill: Skill = DEFAULT_SKILL, line = 0, rivals: CarState[] = []): number {
  const { points, tangents } = track;
  const n = points.length;
  const i = nearestIndex(track, car.x, car.z);
  const j = (i + skill.lookAhead) % n;
  // Aim at a point up the road, shifted sideways onto the chosen line.
  const target = { x: points[j].x - tangents[j].z * line, z: points[j].z + tangents[j].x * line };
  const dx = target.x - car.x;
  const dz = target.z - car.z;
  const fx = SIN[car.heading];
  const fz = COS[car.heading];
  const len = Math.sqrt(dx * dx + dz * dz);
  const turnSide = (dx * fz - dz * fx) / len; // >0 means target is to the left
  let input = 0;
  if (turnSide > 0.03) input |= LEFT;
  else if (turnSide < -0.03) input |= RIGHT;

  // Brake in time for the corners ahead: for each point up the road, how fast may we be there, and can we
  // still slow to that from here? (v^2 = v_corner^2 + 2 * braking * distance, with a safety margin.)
  let brake = false;
  const speedSq = car.speed * car.speed;
  for (let k = 0; k <= 72 && !brake; k += 4) {
    const t0 = tangents[(i + k) % n];
    const t1 = tangents[(i + k + 18) % n];
    const bend = 1 - (t0.x * t1.x + t0.z * t1.z);
    // Corner speed from grip: the road turns through an angle of about sqrt(2 * bend) over those 36 m, which
    // gives its radius, and v^2 = grip * radius. Nearly straight road has no limit worth braking for.
    const safeSq = bend < 0.0008 ? 10000 : (CORNER_GRIP * LATERAL_GRIP * 36) / Math.sqrt(2 * bend);
    const safe = Math.sqrt(safeSq) * skill.pace;
    const dist = k * 2; // samples are 2 m apart
    if (speedSq > safe * safe + 2 * BRAKE * 0.7 * dist) brake = true;
  }
  // Don't drive into the back of a car that's right ahead on the same line and going slower.
  const t = tangents[i];
  for (const r of rivals) {
    const d = (r.x - car.x) * t.x + (r.z - car.z) * t.z;
    const side = (r.x - car.x) * -t.z + (r.z - car.z) * t.x;
    if (d > 0 && d < 9 && side < 1.9 && side > -1.9 && car.speed > r.speed + 1.5) brake = true;
  }
  // Less skilled drivers also lift earlier on the straights, so a quicker car can get past them.
  if (brake) input |= DOWN;
  else if (car.speed < TOP_SPEED * skill.pace) input |= UP;
  return input;
}
