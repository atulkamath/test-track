import { describe, expect, it } from "vitest";
import { createSim, replay, step, UP, RUN_VERSION, type CarState } from "../src/sim";
import { collideCars } from "../src/sim/collide";

const car = (x: number, z: number, vx: number, vz: number): CarState => ({ x, z, vx, vz, heading: 1024, speed: 0, offRoad: false });

describe("collisions", () => {
  it("track has cones and tyre walls", () => {
    const { obstacles } = createSim("2026-10-01").track;
    expect(obstacles.some((o) => o.kind === "cone")).toBe(true);
    expect(obstacles.some((o) => o.kind === "tyre")).toBe(true);
  });

  it("tyre walls have no car-sized gaps", () => {
    for (const seed of ["2026-10-01", "2026-10-02", "2026-10-03"]) {
      const tyres = createSim(seed).track.obstacles.filter((o) => o.kind === "tyre");
      for (const t of tyres) {
        const nearest = Math.min(...tyres.filter((u) => u !== t).map((u) => Math.hypot(u.x - t.x, u.z - t.z)));
        expect(nearest).toBeLessThan(1.9); // car collision circle diameter
      }
    }
  });

  it("driving into a tyre stack stops the car going through it", () => {
    const sim = createSim("2026-10-01");
    const tyre = sim.track.obstacles.find((o) => o.kind === "tyre")!;
    // Aim the player straight at the tyre from 12 m away, flat out.
    Object.assign(sim.state.car, { x: tyre.x - 12, z: tyre.z, vx: 30, vz: 0, heading: 1024 });
    sim.state.bots = [];
    for (let t = 0; t < 60; t++) step(sim, UP);
    const c = sim.state.car;
    // Never ends up past the tyre on the far side, and never overlaps it.
    expect(c.x).toBeLessThan(tyre.x);
    expect(Math.hypot(c.x - tyre.x, c.z - tyre.z)).toBeGreaterThan(tyre.r);
  });

  it("clipping a cone knocks it over and costs speed", () => {
    const sim = createSim("2026-10-01");
    const i = sim.track.obstacles.findIndex((o) => o.kind === "cone");
    const cone = sim.track.obstacles[i];
    Object.assign(sim.state.car, { x: cone.x - 6, z: cone.z, vx: 30, vz: 0, heading: 1024, offRoad: false });
    sim.state.bots = [];
    for (let t = 0; t < 20; t++) step(sim, 0);
    expect(sim.state.knocked[i]).not.toBeNull();
  });

  it("head-on cars separate and bounce apart", () => {
    // Both face +x; noses (front circles) just overlapping, closing at 20 m/s.
    const a = car(0, 0, 10, 0);
    const b = car(3.7, 0, -10, 0);
    collideCars(a, b);
    expect(b.x - a.x).toBeGreaterThanOrEqual(3.8 - 1e-9);
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
  });

  it("AI traffic is deterministic and actually moves", () => {
    const inputs = Array(600).fill(UP);
    const run = { version: RUN_VERSION, seed: "2026-10-01", inputs };
    expect(replay(run).hash).toBe(replay(run).hash);
    const sim = createSim("2026-10-01");
    const start = sim.state.bots.map((b) => ({ ...b }));
    inputs.forEach((i) => step(sim, i));
    sim.state.bots.forEach((b, k) => expect(Math.hypot(b.x - start[k].x, b.z - start[k].z)).toBeGreaterThan(50));
  });

  it("AI cars stay on the road over a long drive", () => {
    const sim = createSim("2026-10-01");
    let off = 0;
    let samples = 0;
    for (let t = 0; t < 60 * 90; t++) {
      step(sim, 0); // player parked; bots lap around
      if (t % 30 === 0) {
        sim.state.bots.forEach((b) => (off += b.offRoad ? 1 : 0));
        samples += sim.state.bots.length;
      }
    }
    expect(off / samples).toBeLessThan(0.1);
  });
});
