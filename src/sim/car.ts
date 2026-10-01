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
  /** Steering wheel position, -1 (full right) .. 1 (full left). Ramps toward the pressed direction. */
  steer: number;
  offRoad: boolean;
}

export const DT = 1 / 60;

// Acceleration is traction-limited off the line, then power-limited (force = power / speed), against air drag
// that grows with speed squared. Roughly a 300 hp sports coupe: 0-100 km/h in ~4 s, top speed ~230 km/h.
/** Launch acceleration the tyres can put down (m/s^2). */
const TRACTION = 8.5;
/** Engine power per unit mass (m^2/s^3). */
const POWER = 150;
/** Air drag coefficient: drag = AIR_DRAG * v^2. Top speed is where POWER / v equals it. */
const AIR_DRAG = 0.000572;
/** Full braking (m/s^2), about 1.5 g. Exported so the autopilot can judge braking distances. */
export const BRAKE = 15;
const REVERSE_ACCEL = 5;
/** Engine braking and rolling resistance with no pedal pressed. */
const COAST = 1.2;
/** Top speed reference (m/s) used to scale steering; the drag model settles just under it. */
export const MAX_SPEED = 64;
const REVERSE_MAX = 12;
const OFFROAD_MAX = 16;
/** How hard the car is dragged down to OFFROAD_MAX when it leaves the road. */
const OFFROAD_DRAG = 22;
/** Heading steps per tick at full lock and low speed (4096 steps = one turn). */
const TURN_STEPS = 26;
/** Below this speed steering weakens linearly. */
const STEER_FULL_SPEED = 12;
/** Steering gets slower with speed: turn rate is divided by (1 + speed / STEER_SPEED_SCALE). */
const STEER_SPEED_SCALE = 40;
/** How fast the wheel turns toward full lock, and back to centre when released (per second). */
const STEER_RATE = 5;
const STEER_RETURN = 8;
/** Fraction of sideways velocity kept each tick; lower = grippier. */
const GRIP = 0.84;
const OFFROAD_GRIP = 0.7;

/** Advance one tick. Mutates and returns car. Position change only; road check happens in sim. */
export function stepCar(car: CarState, input: number): CarState {
  const speedAbs = car.speed < 0 ? -car.speed : car.speed;

  // The wheel doesn't snap to full lock: it winds toward the pressed direction and unwinds when released.
  const want = (input & LEFT ? 1 : 0) - (input & RIGHT ? 1 : 0);
  const rate = (want === 0 || want * car.steer < 0 ? STEER_RETURN : STEER_RATE) * DT;
  if (car.steer < want) car.steer = car.steer + rate > want ? want : car.steer + rate;
  else if (car.steer > want) car.steer = car.steer - rate < want ? want : car.steer - rate;
  if (car.steer !== 0) {
    const low = speedAbs < STEER_FULL_SPEED ? speedAbs / STEER_FULL_SPEED : 1;
    const high = 1 / (1 + speedAbs / STEER_SPEED_SCALE);
    const turn = Math.round(car.steer * TURN_STEPS * low * high);
    car.heading = (car.heading + (car.speed < 0 ? -turn : turn)) & HEADING_MASK;
  }

  // Split velocity into the (new) forward and sideways directions.
  const fx = SIN[car.heading];
  const fz = COS[car.heading];
  let fwd = car.vx * fx + car.vz * fz;
  let side = car.vx * fz - car.vz * fx;

  if (input & UP) {
    if (fwd < 0) fwd += BRAKE * DT;
    else {
      const drive = POWER / (fwd < 1 ? 1 : fwd);
      fwd += (drive < TRACTION ? drive : TRACTION) * DT;
    }
  } else if (input & DOWN) fwd -= (fwd > 0 ? BRAKE : REVERSE_ACCEL) * DT;
  else if (fwd > 0) fwd = Math.max(0, fwd - COAST * DT);
  else if (fwd < 0) fwd = Math.min(0, fwd + COAST * DT);
  // Air drag always opposes forward motion.
  if (fwd > 0) fwd -= AIR_DRAG * fwd * fwd * DT;

  if (car.offRoad && fwd > OFFROAD_MAX) fwd = Math.max(OFFROAD_MAX, fwd - OFFROAD_DRAG * DT);
  if (fwd > MAX_SPEED) fwd = MAX_SPEED;
  if (fwd < -REVERSE_MAX) fwd = -REVERSE_MAX;
  side *= car.offRoad ? OFFROAD_GRIP : GRIP;

  car.vx = fwd * fx + side * fz;
  car.vz = fwd * fz - side * fx;
  car.speed = fwd;
  car.x += car.vx * DT;
  car.z += car.vz * DT;
  return car;
}
