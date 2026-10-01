// Test helper: drive a full lap with the autopilot and return it as a run.
import { autopilotInput as drive, chooseLine, createSim, step, RUN_VERSION, type Run, type Sim } from "../src/sim";

// The test driver races like the AI does: it keeps its own line from tick to tick, per sim.
const lines = new WeakMap<Sim, number>();

export function autopilotInput(sim: Sim): number {
  const { car, bots } = sim.state;
  const line = chooseLine(sim.track, car, bots, lines.get(sim) ?? 0);
  lines.set(sim, line);
  return drive(sim.track, car, undefined, line, bots);
}

export function autopilotRun(seed: string, maxTicks = 60 * 300): Run & { lapTicks: number } {
  const sim = createSim(seed);
  const inputs: number[] = [];
  while (sim.state.lapTicks === null && inputs.length < maxTicks) {
    const input = autopilotInput(sim);
    inputs.push(input);
    step(sim, input);
  }
  if (sim.state.lapTicks === null) throw new Error(`autopilot did not finish ${seed}`);
  return { version: RUN_VERSION, seed, inputs, lapTicks: sim.state.lapTicks };
}
