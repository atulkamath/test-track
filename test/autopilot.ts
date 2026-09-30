// Test-only bot: produces inputs the same way a player would, so we can drive laps headless.
import { createSim, step, DOWN, LEFT, RIGHT, UP, SIN, COS, type Run, type Sim } from "../src/sim";

function nearestIndex(sim: Sim): number {
  const { x, z } = sim.state.car;
  let best = 0;
  let bestSq = Infinity;
  sim.track.points.forEach((p, i) => {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bestSq) {
      bestSq = d;
      best = i;
    }
  });
  return best;
}

export function autopilotInput(sim: Sim): number {
  const { points, tangents } = sim.track;
  const n = points.length;
  const car = sim.state.car;
  const i = nearestIndex(sim);
  const target = points[(i + 6) % n];
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
  const safeSpeed = bend > 0.5 ? 22 : bend > 0.25 ? 30 : bend > 0.1 ? 40 : 60;
  input |= car.speed > safeSpeed ? DOWN : UP;
  return input;
}

export function autopilotRun(seed: string, maxTicks = 60 * 180): Run & { lapTicks: number } {
  const sim = createSim(seed);
  const inputs: number[] = [];
  while (sim.state.lapTicks === null && inputs.length < maxTicks) {
    const input = autopilotInput(sim);
    inputs.push(input);
    step(sim, input);
  }
  if (sim.state.lapTicks === null) throw new Error(`autopilot did not finish ${seed}`);
  return { version: 1, seed, inputs, lapTicks: sim.state.lapTicks };
}
