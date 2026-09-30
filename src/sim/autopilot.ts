// A simple driver that produces inputs exactly like a player would.
// Drives the AI cars inside the sim, and generates test laps.
import type { CarState } from "./car";
import { DOWN, LEFT, RIGHT, UP } from "./input";
import type { Track } from "./track";
import { COS, SIN } from "./trig";

export interface Skill {
  /** Multiplies corner speed limits; < 1 drives more cautiously. */
  pace: number;
  /** How many track samples ahead to aim at. */
  lookAhead: number;
}

export const DEFAULT_SKILL: Skill = { pace: 1, lookAhead: 6 };

function nearestIndex(track: Track, x: number, z: number): number {
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

export function autopilotInput(track: Track, car: CarState, skill: Skill = DEFAULT_SKILL): number {
  const { points, tangents } = track;
  const n = points.length;
  const i = nearestIndex(track, car.x, car.z);
  const target = points[(i + skill.lookAhead) % n];
  const dx = target.x - car.x;
  const dz = target.z - car.z;
  const fx = SIN[car.heading];
  const fz = COS[car.heading];
  const len = Math.sqrt(dx * dx + dz * dz);
  const turnSide = (dx * fz - dz * fx) / len; // >0 means target is to the left
  let input = 0;
  if (turnSide > 0.03) input |= LEFT;
  else if (turnSide < -0.03) input |= RIGHT;

  // Brake before sharp corners: compare the tangent here with one further ahead.
  const t0 = tangents[i];
  const t1 = tangents[(i + 18) % n];
  const bend = 1 - (t0.x * t1.x + t0.z * t1.z);
  const safeSpeed = (bend > 0.5 ? 22 : bend > 0.25 ? 30 : bend > 0.1 ? 40 : 60) * skill.pace;
  input |= car.speed > safeSpeed ? DOWN : UP;
  return input;
}
