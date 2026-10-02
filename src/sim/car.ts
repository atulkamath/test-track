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
  /** Fraction of a heading step carried over to the next tick, so gentle high-speed turns stay smooth. */
  turnRem: number;
  /** 0..1 how hard the tyres are sliding: 0 gripping, rising as the car is asked to turn harder than they can. For sound and smoke. */
  slide: number;
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
/**
 * The most sideways acceleration the tyres can give (m/s^2): generous at low speed (~2.4 g, so slow corners stay
 * quick and fun) and falling to a realistic ~1.2 g flat out, so fast corners have to be respected.
 * At speed v the car cannot turn faster than grip / v: the tightest line widens faster than speed squared.
 */
export const LATERAL_GRIP = 24;
const LATERAL_GRIP_FAST = 12;
export function lateralGrip(speed: number): number {
  const f = speed / MAX_SPEED;
  return LATERAL_GRIP - (LATERAL_GRIP - LATERAL_GRIP_FAST) * (f > 1 ? 1 : f);
}
/** Up to this share of the limit the car does exactly what the wheel asks; beyond it the tyres give progressively less. */
const GRIP_LINEAR = 0.7;
/** Share of grip lost when the front tyres are asked for far more than they have (heavy understeer). */
const OVERDRIVE_LOSS = 0.3;
/** Braking uses front-tyre grip: this much is left for turning with the brakes on. */
const BRAKING_TURN_GRIP = 0.6;
const OFFROAD_TURN_GRIP = 0.5;
/** Sliding tyres scrub speed off (m/s^2 at full slide). */
const SLIDE_SCRUB = 1.5;
/** Heading steps per radian. */
const STEPS_PER_RAD = 4096 / (2 * Math.PI);
/** Power oversteer: the share of full drive force above which the rear starts to let go. */
const OVERSTEER_POWER = 0.3;
/** How much extra the tail comes round, and how much rear grip is lost, at full oversteer. */
const OVERSTEER_YAW = 1.2;
const OVERSTEER_SLIP = 0.14;
/** Lift-off oversteer only happens above this speed (m/s), and swings the tail this much at full slide. */
const LIFT_OFF_SPEED = 14;
const LIFT_OFF_YAW = 0.55;
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
  let oversteer = 0;
  car.slide = 0;
  if (car.steer !== 0) {
    const low = speedAbs < STEER_FULL_SPEED ? speedAbs / STEER_FULL_SPEED : 1;
    const high = 1 / (1 + speedAbs / STEER_SPEED_SCALE);
    let turn = car.steer * TURN_STEPS * low * high;
    if (speedAbs > 1) {
      // Understeer. `most` is the fastest the tyres can turn the car at this speed (less under braking).
      // Ask for up to 70% of it and you get it; ask for more and you get less and less of the extra, never
      // quite reaching the limit: the car runs progressively wide rather than hitting a wall of grip.
      const grip = lateralGrip(speedAbs) * (car.offRoad ? OFFROAD_TURN_GRIP : 1) * (input & DOWN && car.speed > 0 ? BRAKING_TURN_GRIP : 1);
      const most = (grip / speedAbs) * DT * STEPS_PER_RAD;
      const asked = (turn < 0 ? -turn : turn) / most;
      let got = asked;
      if (asked > GRIP_LINEAR) {
        const extra = asked - GRIP_LINEAR;
        got = GRIP_LINEAR + ((1 - GRIP_LINEAR) * extra) / (extra + (1 - GRIP_LINEAR));
        car.slide = extra > 1.5 ? 1 : extra / 1.5;
        // Overdriving: tyres asked for far too much give less than their best, so full lock at speed
        // ploughs wider than a measured turn would.
        got *= 1 - OVERDRIVE_LOSS * car.slide;
      }
      // Oversteer: hard on the power in a slow corner, the rear tyres can't both drive and hold the line,
      // so the tail steps out. Strongest in slow corners, where the engine can overwhelm the tyres.
      if (input & UP && car.speed > 0 && got > 0.6) {
        const drive = POWER / (speedAbs < 1 ? 1 : speedAbs);
        const power = (drive < TRACTION ? drive : TRACTION) / TRACTION;
        if (power > OVERSTEER_POWER) {
          oversteer = ((got - 0.6) / 0.4) * ((power - OVERSTEER_POWER) / (1 - OVERSTEER_POWER));
          if (oversteer > 1) oversteer = 1;
          got += oversteer * OVERSTEER_YAW;
          if (oversteer > car.slide) car.slide = oversteer;
        }
      }
      // Lift-off oversteer: arrive too fast, turn hard and come off the throttle (without braking) and the
      // weight goes forward, the rear goes light and the car tucks in tighter with the tail edging out: a nudge, not a spin.
      if (!(input & (UP | DOWN)) && speedAbs > LIFT_OFF_SPEED && car.slide > 0.4) {
        oversteer = (car.slide - 0.4) / 0.6;
        got += oversteer * LIFT_OFF_YAW;
      }
      turn = (turn < 0 ? -got : got) * most;
    }
    turn += car.turnRem;
    const whole = Math.round(turn);
    car.turnRem = turn - whole;
    car.heading = (car.heading + (car.speed < 0 ? -whole : whole)) & HEADING_MASK;
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
  // Air drag always opposes forward motion; so do sliding tyres.
  if (fwd > 0) fwd -= (AIR_DRAG * fwd * fwd + SLIDE_SCRUB * car.slide) * DT;

  if (car.offRoad && fwd > OFFROAD_MAX) fwd = Math.max(OFFROAD_MAX, fwd - OFFROAD_DRAG * DT);
  if (fwd > MAX_SPEED) fwd = MAX_SPEED;
  if (fwd < -REVERSE_MAX) fwd = -REVERSE_MAX;
  side *= car.offRoad ? OFFROAD_GRIP : GRIP + oversteer * OVERSTEER_SLIP;

  car.vx = fwd * fx + side * fz;
  car.vz = fwd * fz - side * fx;
  car.speed = fwd;
  car.x += car.vx * DT;
  car.z += car.vz * DT;
  return car;
}
