// Purely cosmetic gearbox: the sim has no gears. One instance drives the tacho, cockpit and engine sound,
// so they always agree. The sim car accelerates very hard, so upshifts are held for a minimum time:
// the revs climb onto the limiter, then it changes gear, instead of flicking through all six in 2 seconds.
const GEAR_TOP_KMH = [0, 55, 95, 130, 160, 185, 999];
export const IDLE_RPM = 1100;
export const MAX_RPM = 9000;
const LIMITER_RPM = 8500;
/** Minimum seconds between upshifts (and between downshifts). */
const MIN_UPSHIFT_GAP = 0.9;
const MIN_DOWNSHIFT_GAP = 0.35;

function idealGear(kmh: number) {
  let g = 1;
  while (g < GEAR_TOP_KMH.length - 1 && kmh > GEAR_TOP_KMH[g]) g++;
  return g;
}

function rpmFor(gear: number, kmh: number) {
  const lo = GEAR_TOP_KMH[gear - 1];
  const hi = Math.min(GEAR_TOP_KMH[gear], 200);
  return IDLE_RPM + ((kmh - lo) / (hi - lo)) * 6600;
}

export class Gearbox {
  gear = 1;
  rpm = IDLE_RPM;
  private sinceShift = 10;

  reset() {
    this.gear = 1;
    this.rpm = IDLE_RPM;
    this.sinceShift = 10;
  }

  /** Advance by `delta` seconds at the given sim speed (m/s). Returns true if the gear changed this frame. */
  update(speedMs: number, delta: number): boolean {
    const kmh = Math.abs(speedMs) * 3.6;
    this.sinceShift += delta;
    const want = idealGear(kmh);
    let shifted = false;
    if (want > this.gear && this.sinceShift >= MIN_UPSHIFT_GAP) {
      this.gear++;
      shifted = true;
    } else if (want < this.gear && this.sinceShift >= MIN_DOWNSHIFT_GAP) {
      this.gear--;
      shifted = true;
    }
    if (shifted) this.sinceShift = 0;
    const raw = Math.max(IDLE_RPM, rpmFor(this.gear, kmh));
    // Held gear past its range: bounce on the rev limiter.
    this.rpm = raw > LIMITER_RPM ? LIMITER_RPM - Math.random() * 350 : raw;
    return shifted;
  }
}
