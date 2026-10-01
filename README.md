# Daily Lap

Daily 3D time-trial racer whose lap times are verifiable by replaying inputs on a server.

```sh
pnpm install
pnpm dev                 # play at http://localhost:3000 (?seed=anything to change track)
pnpm test                # determinism, golden, purity, lap tests
pnpm replay run.json     # headless replay; prints lap ticks, exits 1 on mismatch
pnpm tsx scripts/make-fixture.ts [seed] [out]   # autopilot lap -> run.json
```

Controls: arrows / WASD, R restart, C cycle camera (classic chase, chase, far chase, cockpit, roof, bumper, TV), M mute. Touch buttons on phones.

## Layout
- `src/sim/` — pure, deterministic sim (no React/Three/DOM). Reuse this on the server.
  - 60 ticks/s, integer ticks, one input bitmask per tick (`UP=1 DOWN=2 LEFT=4 RIGHT=8`).
  - No `Math.sin/cos` anywhere, including track gen: `trig.ts` builds sin/cos from `+ - * /`.
  - Lap = cross gates 1..7 in order, then the finish gate. Timer starts on the first key press.
  - 4 AI cars (autopilot) live in the sim, so traffic is identical for every player and replays exactly.
  - Collisions: cars bump each other, cones get knocked (small speed loss), corner tyre walls are solid, and
    barriers run down both sides of the whole lap so a car can never leave the circuit.
  - Acceleration is traction- then power-limited against air drag (0-100 km/h in 3.7 s, top speed 230 km/h); braking is 1.5 g.
  - `RUN_VERSION` (currently 5) must be bumped whenever sim rules change; older runs are rejected.
- `src/game/` — R3F renderer + browser tick loop (`engine.ts`). Reads sim state only.
  Spectators (`Crowd.tsx`) are GPU-animated instances; skid marks, suspension and brake lights are visual only.
- `test/golden` values in `sim.test.ts`: if they change, every stored run is invalidated.

## Server note
Trust only `replay(run).lapTicks`; ignore the client's `lapTicks`. `replay` rejects runs over 10 minutes.
