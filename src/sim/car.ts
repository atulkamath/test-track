import { DOWN, LEFT, RIGHT, UP } from "./input";
import { COS, HEADING_MASK, SIN } from "./trig";

export interface CarState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Integer index into the SIN/COS tables. */
  heading: number;
  /** Signed forward speed (units/s), for the HUD. */
  speed: number;
  offRoad: boolean;
}

export const DT = 1 / 60;

const ACCEL = 28;
const BRAKE = 70;
const REVERSE_ACCEL = 16;
const COAST = 6;
const MAX_SPEED = 55;
const REVERSE_MAX = 12;
const OFFROAD_MAX = 16;
/** How hard the car is dragged down to OFFROAD_MAX when it leaves the road. */
const OFFROAD_DRAG = 80;
/** Heading steps per tick at full steer (4096 steps = one turn). */
const TURN_STEPS = 26;
/** Below this speed steering weakens linearly. */
const STEER_FULL_SPEED = 12;
/** Fraction of sideways velocity kept each tick; lower = grippier. */
const GRIP = 0.84;
const OFFROAD_GRIP = 0.7;

/** Advance one tick. Mutates and returns car. Position change only; road check happens in sim. */
export function stepCar(car: CarState, input: number): CarState {
  const speedAbs = car.speed < 0 ? -car.speed : car.speed;

  const steer = (input & LEFT ? 1 : 0) - (input & RIGHT ? 1 : 0);
  if (steer !== 0) {
    const low = speedAbs < STEER_FULL_SPEED ? speedAbs / STEER_FULL_SPEED : 1;
    const high = 1 - 0.4 * (speedAbs / MAX_SPEED);
    const turn = Math.round(steer * TURN_STEPS * low * high);
    car.heading = (car.heading + (car.speed < 0 ? -turn : turn)) & HEADING_MASK;
  }

  // Split velocity into the (new) forward and sideways directions.
  const fx = SIN[car.heading];
  const fz = COS[car.heading];
  let fwd = car.vx * fx + car.vz * fz;
  let side = car.vx * fz - car.vz * fx;

  if (input & UP) fwd += (fwd < 0 ? BRAKE : ACCEL) * DT;
  else if (input & DOWN) fwd -= (fwd > 0 ? BRAKE : REVERSE_ACCEL) * DT;
  else if (fwd > 0) fwd = Math.max(0, fwd - COAST * DT);
  else if (fwd < 0) fwd = Math.min(0, fwd + COAST * DT);

  const max = car.offRoad ? OFFROAD_MAX : MAX_SPEED;
  if (fwd > max) fwd = Math.max(max, fwd - (car.offRoad ? OFFROAD_DRAG * DT : Infinity));
  if (fwd < -REVERSE_MAX) fwd = -REVERSE_MAX;
  side *= car.offRoad ? OFFROAD_GRIP : GRIP;

  car.vx = fwd * fx + side * fz;
  car.vz = fwd * fz - side * fx;
  car.speed = fwd;
  car.x += car.vx * DT;
  car.z += car.vz * DT;
  return car;
}
