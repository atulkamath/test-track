import type { CarState } from "./car";
import type { Obstacle, Wall } from "./obstacles";
import { COS, SIN } from "./trig";

// Each car is two circles (front and back) so long cars don't overlap nose-first.
const CAR_R = 0.95;
const CAR_HALF = 0.95;
const WALL_BOUNCE = 0.3;
const CAR_BOUNCE = 0.4;
/** Speed kept after clipping a cone. */
const CONE_DRAG = 0.9;

export interface Knock {
  tick: number;
  vx: number;
  vz: number;
}

function circles(car: CarState): [number, number][] {
  const fx = SIN[car.heading] * CAR_HALF;
  const fz = COS[car.heading] * CAR_HALF;
  return [
    [car.x + fx, car.z + fz],
    [car.x - fx, car.z - fz],
  ];
}

/** Push the car out of solid obstacles; knock over cones it touches. */
export function collideObstacles(car: CarState, obstacles: Obstacle[], knocked: (Knock | null)[], tick: number): void {
  for (const [cx, cz] of circles(car)) {
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      const dx = cx - o.x;
      const dz = cz - o.z;
      const reach = o.r + CAR_R;
      const dSq = dx * dx + dz * dz;
      if (dSq >= reach * reach || dSq === 0) continue;
      if (o.kind === "cone") {
        if (knocked[i] !== null) continue;
        knocked[i] = { tick, vx: car.vx * 1.2, vz: car.vz * 1.2 };
        car.vx *= CONE_DRAG;
        car.vz *= CONE_DRAG;
        continue;
      }
      const d = Math.sqrt(dSq);
      const nx = dx / d;
      const nz = dz / d;
      const pen = reach - d;
      car.x += nx * pen;
      car.z += nz * pen;
      const vn = car.vx * nx + car.vz * nz;
      if (vn < 0) {
        car.vx -= (1 + WALL_BOUNCE) * vn * nx;
        car.vz -= (1 + WALL_BOUNCE) * vn * nz;
      }
    }
  }
}

/** Equal-mass bump between two cars: separate them and exchange momentum along the contact normal. */
export function collideCars(a: CarState, b: CarState): void {
  for (const [ax, az] of circles(a)) {
    for (const [bx, bz] of circles(b)) {
      const dx = ax - bx;
      const dz = az - bz;
      const reach = CAR_R * 2;
      const dSq = dx * dx + dz * dz;
      if (dSq >= reach * reach || dSq === 0) continue;
      const d = Math.sqrt(dSq);
      const nx = dx / d;
      const nz = dz / d;
      const half = (reach - d) / 2;
      a.x += nx * half;
      a.z += nz * half;
      b.x -= nx * half;
      b.z -= nz * half;
      const vrel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (vrel < 0) {
        const j = (-(1 + CAR_BOUNCE) * vrel) / 2;
        a.vx += j * nx;
        a.vz += j * nz;
        b.vx -= j * nx;
        b.vz -= j * nz;
      }
    }
  }
}

/** Cars this far beyond a wall are left alone (only reachable by being placed there, e.g. in tests). */
const WALL_REACH = 4;
const BARRIER_BOUNCE = 0.15;
/** Speed kept along the wall while scraping it. */
const BARRIER_SCRUB = 0.985;

/** Keep the car on the track side of every barrier: push it back and kill the speed going into the wall. */
export function collideWalls(car: CarState, walls: Wall[]): void {
  for (const [cx, cz] of circles(car)) {
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      // Signed distance from the wall line (positive = track side).
      const d = (cx - w.ax) * w.nx + (cz - w.az) * w.nz;
      if (d >= CAR_R || d < -WALL_REACH) continue;
      // Only the stretch of line this segment actually covers.
      const ex = w.bx - w.ax;
      const ez = w.bz - w.az;
      const t = ((cx - w.ax) * ex + (cz - w.az) * ez) / (ex * ex + ez * ez);
      if (t < -0.05 || t > 1.05) continue;
      const pen = CAR_R - d;
      car.x += w.nx * pen;
      car.z += w.nz * pen;
      const vn = car.vx * w.nx + car.vz * w.nz;
      if (vn < 0) {
        car.vx -= (1 + BARRIER_BOUNCE) * vn * w.nx;
        car.vz -= (1 + BARRIER_BOUNCE) * vn * w.nz;
        car.vx *= BARRIER_SCRUB;
        car.vz *= BARRIER_SCRUB;
      }
    }
  }
}
