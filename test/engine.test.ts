import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Engine } from "../src/game/engine";
import { generateTrack, replay, type Run } from "../src/sim";
import { autopilotInput } from "./autopilot";

describe("browser engine -> run.json -> replay", () => {
  it("jittery frame times record a run that replays to the same lap", () => {
    const engine = new Engine(generateTrack("2026-10-01"));
    // Irregular frames (7ms..40ms, plus an occasional stall) like a real browser.
    const frames = [0.007, 0.016, 0.017, 0.033, 0.016, 0.04, 0.011, 0.3];
    for (let f = 0; !engine.finished && f < 100000; f++) {
      engine.advance(frames[f % frames.length], () => autopilotInput(engine.sim));
    }
    const run = JSON.parse(JSON.stringify(engine.run())) as Run;
    expect(run.lapTicks).toBeGreaterThan(0);
    expect(replay(run).lapTicks).toBe(run.lapTicks);
  });

  it("committed fixture still replays to its recorded lap time", () => {
    const run = JSON.parse(readFileSync("fixtures/autopilot-run.json", "utf8")) as Run;
    expect(replay(run).lapTicks).toBe(run.lapTicks);
  });
});
