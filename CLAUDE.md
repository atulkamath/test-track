@AGENTS.md

# Daily Lap — project rules

Daily time-trial racer: 3D graphics drawn over a flat 2D physics sim, so lap times can be verified by replaying inputs in Node. See `README.md` for layout and commands.

- **`src/sim/` must stay pure and deterministic.** No React/Three/DOM imports, no `Math.random`, `Date`, `performance`, or `Math.sin/cos/atan2/hypot/pow` (use `trig.ts`). `test/sim.test.ts` enforces this.
- **Anything that can change a lap time belongs in `src/sim/`** (AI cars, cones, tyre walls). Everything in `src/game/` is visual/audio only and must only read sim state.
- **Changing sim behaviour = bump `RUN_VERSION`** in `src/sim/sim.ts`, then regenerate `fixtures/autopilot-run.json` (`pnpm tsx scripts/make-fixture.ts`) and update the golden values in `test/sim.test.ts` deliberately.
- **Assets must be free for commercial use** and recorded in `CREDITS.md` with exact source URL. Car models are CC-BY 4.0 (credit must ship with the game); sky and ground textures are CC0 (Poly Haven, ambientCG). New car models go through `scripts/convert-cars.mjs`. No real brands or circuit names.
- Verify with `pnpm test`, `pnpm lint`, `npx tsc --noEmit`, `pnpm build`. Visual checks are done by the user in their own browser.
