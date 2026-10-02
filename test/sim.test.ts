import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { autopilotInput as drive, chooseLine, createSim, generateTrack, hashState, racePosition, replay, step, DOWN, LAPS, LEFT, RIGHT, STREET_SEED, UP } from "../src/sim";
import { autopilotInput, autopilotRun } from "./autopilot";

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
    const run = { version: 8 as const, seed: "2026-10-01", inputs: scriptedInputs(1800) };
    const a = replay(run);
    const b = replay(run);
    expect(a).toEqual(b);
  });

  it("step-by-step matches replay()", () => {
    const inputs = scriptedInputs(900);
    const sim = createSim("2026-10-01");
    inputs.forEach((i) => step(sim, i));
    expect(hashState(sim.state)).toBe(replay({ version: 8, seed: "2026-10-01", inputs }).hash);
  });

  it("different inputs -> different state", () => {
    const inputs = scriptedInputs(600);
    const changed = [...inputs];
    changed[10] ^= UP; // lift off the throttle for one tick early on
    const seed = "2026-10-01";
    expect(replay({ version: 8, seed, inputs }).hash).not.toBe(replay({ version: 8, seed, inputs: changed }).hash);
  });

  // Golden values: if these change, sim behaviour changed and every stored run is invalidated.
  // Update deliberately, never to "make the test pass".
  it("golden: scripted run", () => {
    expect(replay({ version: 8, seed: "golden", inputs: scriptedInputs(1200) }).hash).toBe("cf948556");
  });

  it("golden: autopilot lap", () => {
    const run = autopilotRun("golden");
    const result = replay(run);
    expect({ lapTicks: result.lapTicks, hash: result.hash }).toEqual({ lapTicks: 5677, hash: "743a6afa" });
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

describe("race", () => {
  it("starts from a standing grid with the player last", () => {
    const { state } = createSim("2026-10-01");
    const cars = [state.car, ...state.bots];
    expect(cars.length).toBe(5);
    for (const c of cars) expect(c.speed).toBe(0);
    for (let a = 0; a < cars.length; a++)
      for (let b = a + 1; b < cars.length; b++) expect(Math.hypot(cars[a].x - cars[b].x, cars[a].z - cars[b].z)).toBeGreaterThan(4);
    expect(racePosition(state)).toBe(5);
    expect(state.lap).toBe(0);
  });

  it("counts three laps, tracks the best lap and position, then finishes", () => {
    const sim = createSim("2026-10-03");
    const laps: number[] = [];
    for (let t = 0; t < 60 * 240 && sim.state.lapTicks === null; t++) {
      const before = sim.state.lap;
      step(sim, autopilotInput(sim));
      if (sim.state.lap !== before) laps.push(sim.state.tick);
      const pos = racePosition(sim.state);
      expect(pos).toBeGreaterThanOrEqual(1);
      expect(pos).toBeLessThanOrEqual(5);
    }
    expect(laps.length).toBe(LAPS);
    expect(sim.state.lapTicks).toBe(laps[LAPS - 1]);
    const lapTimes = laps.map((t, i) => t - (laps[i - 1] ?? 0));
    expect(sim.state.bestLapTicks).toBe(Math.min(...lapTimes));
    // The whole AI field keeps racing: every car has covered at least two laps by the time the player finishes.
    const n = sim.track.points.length;
    for (const p of sim.state.progress.slice(1)) expect(p / n).toBeGreaterThan(2);
  });
});

describe("racecraft", () => {
  // Three cars on the main straight of the street circuit, lined up along the road.
  const track = generateTrack(STREET_SEED);
  const i = 40;
  const p = track.points[i];
  const t = track.tangents[i];
  const carAt = (along: number, side: number, speed: number) => ({
    x: p.x + t.x * along - t.z * side,
    z: p.z + t.z * along + t.x * side,
    vx: t.x * speed,
    vz: t.z * speed,
    heading: 0,
    speed,
    steer: 0,
    turnRem: 0,
    slide: 0,
    offRoad: false,
  });
  const settle = (me: ReturnType<typeof carAt>, rivals: ReturnType<typeof carAt>[]) => {
    let line = 0;
    for (let k = 0; k < 120; k++) line = chooseLine(track, me, rivals, line);
    return line;
  };

  it("with nobody around, holds a line near the middle on a straight", () => {
    expect(Math.abs(settle(carAt(0, 0, 40), []))).toBeLessThan(1);
  });

  it("defends: moves across to cover the side a faster car behind is on", () => {
    expect(settle(carAt(0, 0, 40), [carAt(-8, 2.5, 45)])).toBeGreaterThan(1.5);
    expect(settle(carAt(0, 0, 40), [carAt(-8, -2.5, 45)])).toBeLessThan(-1.5);
  });

  it("attacks: pulls out to the emptier side to pass a slower car ahead", () => {
    // Slower car ahead, slightly right of centre: go left.
    expect(settle(carAt(0, 0, 45), [carAt(9, 0.8, 38)])).toBeLessThan(-1.5);
    expect(settle(carAt(0, 0, 45), [carAt(9, -0.8, 38)])).toBeGreaterThan(1.5);
  });

  it("changes line gradually and never asks for a line off the road", () => {
    const me = carAt(0, 0, 40);
    const rival = [carAt(-8, 5, 45)];
    let line = 0;
    for (let k = 0; k < 600; k++) {
      const next = chooseLine(track, me, rival, line);
      expect(Math.abs(next - line)).toBeLessThanOrEqual(3.2 / 60 + 1e-9);
      line = next;
    }
    expect(Math.abs(line)).toBeLessThanOrEqual(track.halfWidth - 1.5 + 1e-9);
  });

  it("lifts instead of ramming a slower car directly ahead", () => {
    const me = carAt(0, 0, 45);
    expect(drive(track, me, undefined, 0, [carAt(6, 0.3, 30)]) & DOWN).toBe(DOWN);
    expect(drive(track, me, undefined, 0, [carAt(6, 4, 30)]) & DOWN).toBe(0); // alongside, not in the way
  });
});

describe("street circuit", () => {
  const track = generateTrack(STREET_SEED);

  it("is a fixed layout with walls at the kerb and no run-off furniture", () => {
    expect(track.kind).toBe("street");
    expect(generateTrack(STREET_SEED).points).toEqual(track.points);
    expect(track.obstacles.length).toBe(0);
    // Every wall segment is within a metre of the edge of the road.
    for (const w of track.walls) {
      const d = Math.min(...track.points.map((p) => Math.hypot(p.x - w.ax, p.z - w.az)));
      expect(d).toBeLessThan(track.halfWidth + 1.2);
      expect(d).toBeGreaterThan(track.halfWidth - 0.3);
    }
  });

  it("no two parts of the lap are close enough for their buildings to collide", () => {
    const P = track.points;
    for (let i = 0; i < P.length; i += 3)
      for (let j = i + 40; j < P.length; j += 3) {
        if (P.length - (j - i) < 40) continue;
        expect(Math.hypot(P[i].x - P[j].x, P[i].z - P[j].z)).toBeGreaterThan(45);
      }
  });

  it("the autopilot races three laps, and the AI field stays between the walls", () => {
    const sim = createSim(STREET_SEED);
    let wallHugging = 0;
    let samples = 0;
    for (let t = 0; t < 60 * 420 && sim.state.lapTicks === null; t++) {
      step(sim, autopilotInput(sim));
      if (t % 30 === 0)
        for (const b of sim.state.bots) {
          samples++;
          if (b.offRoad) wallHugging++;
        }
    }
    expect(sim.state.lapTicks).not.toBeNull();
    expect(sim.state.lap).toBe(LAPS);
    expect(wallHugging / samples).toBeLessThan(0.1);
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
    expect(replay({ version: 8, seed: "2026-10-01", inputs }).lapTicks).toBeNull();
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
