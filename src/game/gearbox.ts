// Purely cosmetic gearbox: the sim has no gears. Shared by the tacho and the engine sound so they agree.
const GEAR_TOP_KMH = [0, 55, 95, 130, 160, 185, 999];
export const IDLE_RPM = 1100;
export const MAX_RPM = 9000;

export function gearbox(speedMs: number): { gear: number; rpm: number } {
  const kmh = Math.abs(speedMs) * 3.6;
  let g = 1;
  while (g < GEAR_TOP_KMH.length - 1 && kmh > GEAR_TOP_KMH[g]) g++;
  const lo = GEAR_TOP_KMH[g - 1];
  const hi = Math.min(GEAR_TOP_KMH[g], 200);
  return { gear: g, rpm: IDLE_RPM + ((kmh - lo) / (hi - lo)) * 6600 };
}
