# Test Track

A daily 3D time-trial racer in the browser. **Play it: https://test-track-1.vercel.app/**

<!-- TODO: add a screenshot or GIF here, e.g. ![Test Track](docs/preview.gif) -->

Built with Next.js 16, React 19, React Three Fiber and TypeScript. Works on desktop and phones.

## Why it's interesting
- **Deterministic physics.** The race runs on a pure 2D simulation at a fixed 60 ticks/s, with one input bitmask per
  tick. Replaying the same inputs always gives the exact same lap time, in the browser or headless in Node.
- **No floating-point drift between machines.** The sim never calls `Math.sin/cos/atan2`. `trig.ts` builds them from
  `+ - * /` so every JS engine produces identical results.
- **Rendering is separate from the rules.** `src/sim/` has no React, Three.js or DOM imports. `src/game/` draws the 3D
  world on top and only reads sim state. A test enforces the boundary.
- **Golden tests.** A recorded autopilot lap is replayed in the test suite, so any change that would alter a lap time
  fails loudly until it is versioned on purpose (`RUN_VERSION`).
- **Runs on phones.** Instanced, GPU-animated crowds, and a lighter render path on mobile (no shadows or heavy
  post-processing, 1x pixel ratio).

## Maps
Pick on the start screen, or use `?map=sakura` / `?map=circuit`.
- **Sakura Street** (default): a fixed 1.9 km Japanese street circuit with walls at the kerb, cherry blossom, an old
  town, a tunnel and a canal.
- **Grand Circuit**: an open race circuit with gravel run-off and grandstands, a new layout each day (`?seed=...`
  picks one).

**Controls:** arrows / WASD, R restart, C cycle camera, M mute. Touch buttons on phones.

## Run it locally
```sh
pnpm install
pnpm dev                 # http://localhost:3000
pnpm test                # determinism, golden, purity and lap tests
pnpm replay run.json     # headless replay; prints lap ticks, exits 1 on mismatch
pnpm tsx scripts/make-fixture.ts [seed] [out]   # autopilot lap -> run.json
```

## How it's built
- `src/sim/`: the pure, deterministic simulation.
  - A race is 3 laps from a standing grid of 5 cars, the player starting last. A lap means crossing gates 1 to 7 in
    order, then the finish gate.
  - The 4 AI cars live in the sim, so traffic is identical for every player and replays exactly.
  - Cars bump each other, cones get knocked over (small speed loss), and tyre walls and barriers are solid.
  - Acceleration is traction- then power-limited against air drag (0-100 km/h in 3.7 s, top speed 230 km/h). Braking
    is 1.5 g.
  - `RUN_VERSION` (currently 10) is bumped whenever the rules change, and older runs are rejected.
- `src/game/`: the React Three Fiber renderer, audio and browser tick loop (`engine.ts`). Skid marks, suspension and
  brake lights are visual only.
- `test/sim.test.ts`: golden values. If they change, every stored run is invalidated.

## Credits
3D models and textures are free for commercial use and credited in [CREDITS.md](CREDITS.md).
