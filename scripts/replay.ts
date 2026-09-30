// Usage: pnpm replay run.json
import { readFileSync } from "node:fs";
import { replay, type Run } from "../src/sim";

const file = process.argv[2];
if (!file) {
  console.error("usage: pnpm replay <run.json>");
  process.exit(2);
}

const run = JSON.parse(readFileSync(file, "utf8")) as Run;
const result = replay(run);

console.log(`seed:     ${run.seed}`);
console.log(`inputs:   ${run.inputs.length} ticks`);
if (result.lapTicks === null) {
  console.log("lap:      NOT COMPLETED");
  process.exit(1);
}
console.log(`lap:      ${result.lapTicks} ticks (${(result.lapTicks / 60).toFixed(3)}s)`);
console.log(`hash:     ${result.hash}`);
if (run.lapTicks !== undefined) {
  const ok = run.lapTicks === result.lapTicks;
  console.log(`claimed:  ${run.lapTicks} ticks -> ${ok ? "MATCH" : "MISMATCH"}`);
  if (!ok) process.exit(1);
}
