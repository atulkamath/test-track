// Test helper: drive a full lap with the autopilot and return it as a run.
import { autopilotInput as drive, createSim, step, RUN_VERSION, type Run, type Sim } from "../src/sim";

export function autopilotInput(sim: Sim): number {
  return drive(sim.track, sim.state.car);
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
  return { version: RUN_VERSION, seed, inputs, lapTicks: sim.state.lapTicks };
}
