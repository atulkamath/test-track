// Writes an autopilot lap as a run.json, for trying `pnpm replay` without playing.
// Usage: pnpm tsx scripts/make-fixture.ts [seed] [out]
import { writeFileSync } from "node:fs";
import { autopilotRun } from "../test/autopilot";

const seed = process.argv[2] ?? "2026-10-01";
const out = process.argv[3] ?? "fixtures/autopilot-run.json";
const run = autopilotRun(seed);
writeFileSync(out, JSON.stringify(run));
console.log(`wrote ${out}: ${run.lapTicks} ticks on ${seed}`);
