import { describe, expect, it } from "vitest";
import { createSim, replay, step, LEFT, RIGHT, STREET_SEED, STREET_WALL_GAP, UP, RUN_VERSION, WALL_OFFSET_CORNER, type CarState } from "../src/sim";
import { headingFromVector } from "../src/sim/trig";
import { collideCars } from "../src/sim/collide";

const car = (x: number, z: number, vx: number, vz: number): CarState => ({ x, z, vx, vz, heading: 1024, speed: 0, turnRem: 0, slide: 0, burnout: false, steer: 0, offRoad: false });

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
    // Approach from the track side: start 8 m from the tyre toward the nearest bit of road, aimed straight at it.
    const road = sim.track.points.reduce((best, p) => (Math.hypot(p.x - tyre.x, p.z - tyre.z) < Math.hypot(best.x - tyre.x, best.z - tyre.z) ? p : best));
    const len = Math.hypot(road.x - tyre.x, road.z - tyre.z);
    const ux = (road.x - tyre.x) / len;
    const uz = (road.z - tyre.z) / len;
    Object.assign(sim.state.car, { x: tyre.x + ux * 8, z: tyre.z + uz * 8, vx: -ux * 25, vz: -uz * 25, heading: headingFromVector(-ux, -uz) });
    sim.state.bots = [];
    for (let t = 0; t < 90; t++) step(sim, UP);
    const c = sim.state.car;
    // Still on the track side of the tyre, and not overlapping it.
    expect((c.x - tyre.x) * ux + (c.z - tyre.z) * uz).toBeGreaterThan(0);
    expect(Math.hypot(c.x - tyre.x, c.z - tyre.z)).toBeGreaterThan(tyre.r);
  });

  it("barriers keep the car inside the circuit whatever the driver does", () => {
    for (const seed of ["2026-10-01", "2026-10-02", "2026-10-03", STREET_SEED]) {
      const sim = createSim(seed);
      sim.state.bots = [];
      let worst = 0;
      for (let t = 0; t < 60 * 60; t++) {
        // Flat out, yanking the wheel left and right in long bursts: guaranteed to hit both walls repeatedly.
        step(sim, UP | (Math.floor(t / 90) % 3 === 0 ? LEFT : Math.floor(t / 90) % 3 === 1 ? RIGHT : 0));
        const { x, z } = sim.state.car;
        const d = Math.min(...sim.track.points.map((p) => Math.hypot(p.x - x, p.z - z)));
        worst = Math.max(worst, d);
      }
      expect(worst).toBeLessThan((sim.track.kind === "street" ? sim.track.halfWidth + STREET_WALL_GAP : WALL_OFFSET_CORNER) + 0.5);
    }
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
