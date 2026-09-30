// Math.sin/cos are not bit-identical across JS engines. Everything here uses only
// + - * / and Math.round, which IEEE 754 / ECMAScript fully specify.

const TWO_PI = 2 * Math.PI;

export function dsin(x: number): number {
  x = x - TWO_PI * Math.round(x / TWO_PI); // reduce to [-pi, pi]
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let k = 1; k < 20; k++) {
    term = (-term * x2) / (2 * k * (2 * k + 1));
    sum += term;
  }
  return sum;
}

export function dcos(x: number): number {
  return dsin(x + Math.PI / 2);
}

/** Heading is an integer in [0, HEADING_STEPS). Forward vector = (SIN[h], COS[h]). */
export const HEADING_STEPS = 4096;
export const HEADING_MASK = HEADING_STEPS - 1;
export const SIN: readonly number[] = Array.from({ length: HEADING_STEPS }, (_, i) =>
  dsin((TWO_PI * i) / HEADING_STEPS),
);
export const COS: readonly number[] = Array.from({ length: HEADING_STEPS }, (_, i) =>
  dcos((TWO_PI * i) / HEADING_STEPS),
);

/** Heading index whose forward vector best matches (dx, dz). */
export function headingFromVector(dx: number, dz: number): number {
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < HEADING_STEPS; i++) {
    const dot = SIN[i] * dx + COS[i] * dz;
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}
