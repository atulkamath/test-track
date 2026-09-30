import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSim, generateTrack, hashState, replay, step, DOWN, LEFT, RIGHT, UP } from "../src/sim";
import { autopilotRun } from "./autopilot";

/** A fixed, human-ish input script: accelerate, weave, brake. */
function scriptedInputs(ticks: number): number[] {
  const out: number[] = [];
  for (let t = 0; t < ticks; t++) {
    let input = t % 400 < 330 ? UP : DOWN;
    if (t % 150 > 100) input |= LEFT;
    if (t % 230 > 190) input |= RIGHT;
    out.push(input);
  }
  return out;
}

describe("determinism", () => {
  it("same seed + inputs -> identical state every run", () => {
    const run = { version: 1 as const, seed: "2026-10-01", inputs: scriptedInputs(1800) };
    const a = replay(run);
    const b = replay(run);
    expect(a).toEqual(b);
  });

  it("step-by-step matches replay()", () => {
    const inputs = scriptedInputs(900);
    const sim = createSim("2026-10-01");
    inputs.forEach((i) => step(sim, i));
    expect(hashState(sim.state)).toBe(replay({ version: 1, seed: "2026-10-01", inputs }).hash);
  });

  it("different inputs -> different state", () => {
    const inputs = scriptedInputs(600);
    const changed = [...inputs];
    changed[300] ^= LEFT;
    const seed = "2026-10-01";
    expect(replay({ version: 1, seed, inputs }).hash).not.toBe(replay({ version: 1, seed, inputs: changed }).hash);
  });

  // Golden values: if these change, sim behaviour changed and every stored run is invalidated.
  // Update deliberately, never to "make the test pass".
  it("golden: scripted run", () => {
    expect(replay({ version: 1, seed: "golden", inputs: scriptedInputs(1200) }).hash).toBe("abcb366c");
  });

  it("golden: autopilot lap", () => {
    const run = autopilotRun("golden");
    const result = replay(run);
    expect({ lapTicks: result.lapTicks, hash: result.hash }).toEqual({ lapTicks: 1173, hash: "41aa06df" });
  });
});

describe("track", () => {
  it("same seed -> same track, different seed -> different track", () => {
    expect(generateTrack("a")).toEqual(generateTrack("a"));
    expect(generateTrack("a").points[5]).not.toEqual(generateTrack("b").points[5]);
  });

  it("generates valid tracks for a year of daily seeds", () => {
    for (let d = 0; d < 365; d++) {
      const date = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
      const t = generateTrack(date);
      expect(t.points.length).toBeGreaterThan(200);
      expect(t.gates.length).toBe(8);
    }
  });
});

describe("laps", () => {
  it.each(["2026-10-01", "2026-10-02", "2026-10-03"])("autopilot completes a lap on %s", (seed) => {
    const run = autopilotRun(seed);
    expect(replay(run).lapTicks).toBe(run.lapTicks);
    expect(run.lapTicks).toBeGreaterThan(60 * 10);
  });

  it("no lap without passing every checkpoint (reversing over the line)", () => {
    // Drive backwards over the start line: gate 0 is behind the start position.
    const inputs = Array(600).fill(DOWN);
    expect(replay({ version: 1, seed: "2026-10-01", inputs }).lapTicks).toBeNull();
  });

  it("no lap when skipping a checkpoint", () => {
    // Teleport-style shortcut: put the car just before the finish with only gate 1 passed.
    const sim = createSim("2026-10-01");
    const { points, tangents } = sim.track;
    const n = points.length;
    const p = points[n - 3];
    Object.assign(sim.state.car, { x: p.x, z: p.z, vx: tangents[n - 3].x * 40, vz: tangents[n - 3].z * 40 });
    sim.state.nextGate = 2;
    for (let t = 0; t < 60; t++) step(sim, UP);
    expect(sim.state.lapTicks).toBeNull();
  });

  it("off-road slows the car", () => {
    const sim = createSim("2026-10-01");
    const p = sim.track.points[0];
    Object.assign(sim.state.car, { x: p.x + 500, z: p.z + 500 });
    for (let t = 0; t < 600; t++) step(sim, UP);
    expect(sim.state.car.offRoad).toBe(true);
    expect(sim.state.car.speed).toBeLessThanOrEqual(16);
  });
});

describe("purity", () => {
  const dir = join(__dirname, "../src/sim");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it.each(files)("%s has no forbidden APIs or imports", (file) => {
    const src = readFileSync(join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
      expect(m[1], `import in ${file}`).toMatch(/^\.\//);
    }
    const forbidden = /Math\.(random|sin|cos|tan|atan|atan2|asin|acos|hypot|pow|exp|log|cbrt)\b|\bDate\b|performance\.|\bwindow\b|\bdocument\b|\bprocess\b|\*\*/;
    expect(src.match(forbidden)?.[0], `forbidden API in ${file}`).toBeUndefined();
  });
});
