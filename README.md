# Daily Lap

Daily 3D time-trial racer whose lap times are verifiable by replaying inputs on a server.

```sh
pnpm install
pnpm dev                 # play at http://localhost:3000 (?seed=anything to change track)
pnpm test                # determinism, golden, purity, lap tests
pnpm replay run.json     # headless replay; prints lap ticks, exits 1 on mismatch
pnpm tsx scripts/make-fixture.ts [seed] [out]   # autopilot lap -> run.json
```

Controls: arrows / WASD, R to restart. Touch buttons on phones.

## Layout
- `src/sim/` — pure, deterministic sim (no React/Three/DOM). Reuse this on the server.
  - 60 ticks/s, integer ticks, one input bitmask per tick (`UP=1 DOWN=2 LEFT=4 RIGHT=8`).
  - No `Math.sin/cos` anywhere, including track gen: `trig.ts` builds sin/cos from `+ - * /`.
  - Lap = cross gates 1..7 in order, then the finish gate. Timer starts on the first key press.
  - 4 AI cars (autopilot) live in the sim, so traffic is identical for every player and replays exactly.
  - Collisions: cars bump each other, cones get knocked (small speed loss), corner tyre walls are solid.
    Fences, grandstands etc. are scenery only.
  - `RUN_VERSION` (currently 3) must be bumped whenever sim rules change; older runs are rejected.
- `src/game/` — R3F renderer + browser tick loop (`engine.ts`). Reads sim state only.
  Spectators (`Crowd.tsx`) are GPU-animated instances; skid marks, suspension and brake lights are visual only.
- `test/golden` values in `sim.test.ts`: if they change, every stored run is invalidated.

## Server note
Trust only `replay(run).lapTicks`; ignore the client's `lapTicks`. `replay` rejects runs over 10 minutes.
