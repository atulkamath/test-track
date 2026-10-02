"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import { Bloom, EffectComposer, HueSaturation, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { COS, DOWN, LAPS, LEFT, RIGHT, SIN, STREET_SEED, UP, generateTrack, racePosition, type Track } from "@/sim";
import { Sound, type OtherCar } from "./audio";
import { CameraRig, VIEWS } from "./camera";
import { animateCar, Car, newCarAnim, PLAYER_MODEL } from "./Car";
import { Cockpit, EYE, type CockpitHandle } from "./Cockpit";
import { Gearbox } from "./gearbox";
import { Crowd } from "./Crowd";
import { BigScreen, Blimp, Helicopter, Lake, Paddock } from "./Life";
import { Obstacles, SkidMarks, Traffic, type SkidHandle } from "./Dynamic";
import { Engine, formatTicks, type Pose } from "./engine";
import { FinishLine, GatePosts, Ground, Road, RunOff, Trees } from "./Scene";
import { Tacho, type TachoHandle } from "./Tacho";
import { Pylons, Ridges, Town } from "./Background";
import { CarPark, CircuitBoxes, FerrisWheel, Flags, GravelTraps, Tents, TimingTower } from "./Circuit";
import { buildLayout, type Layout } from "./layout";
import { Canals, Models, Pavements, Petals } from "./Street";
import { makeHeight } from "./terrain";
import { Billboards } from "./Trackside";
import styles from "./game.module.css";


const KEY_BITS: Record<string, number> = {
  ArrowUp: UP,
  KeyW: UP,
  ArrowDown: DOWN,
  KeyS: DOWN,
  ArrowLeft: LEFT,
  KeyA: LEFT,
  ArrowRight: RIGHT,
  KeyD: RIGHT,
};

/** The maps on offer. `seed` is what the sim builds the track from. */
const MAPS = [
  { id: "sakura", name: "Sakura Street", blurb: "Japanese street circuit" },
  { id: "circuit", name: "Grand Circuit", blurb: "Open race circuit, new layout daily" },
] as const;
type MapId = (typeof MAPS)[number]["id"];

/** Which map to load: `?map=circuit` or `?map=sakura` (default). `?seed=...` forces a particular circuit layout. */
function chosenMap(): { id: MapId; seed: string } {
  const params = new URLSearchParams(window.location.search);
  const seed = params.get("seed");
  if (seed) return { id: "circuit", seed };
  if (params.get("map") !== "circuit") return { id: "sakura", seed: STREET_SEED };
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { id: "circuit", seed: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` };
}

/** Gear + rpm to show: neutral at idle until the run starts. */
function gearDisplay(g: Gearbox, started: boolean): [number, number] {
  return started ? [g.gear, g.rpm] : [0, 900];
}

/** Where each AI car is relative to ours and how it's moving, for the pass-by sound. */
function hearOtherCars(engine: Engine, gearboxes: Gearbox[], lastGaps: number[], p: Pose, delta: number): OtherCar[] {
  const me = engine.sim.state.car;
  // Right-hand direction of our car (forward is (sin, cos); +x is its left).
  const rx = -Math.cos(p.angle);
  const rz = Math.sin(p.angle);
  return engine.sim.state.bots.map((bot, k) => {
    const bp = engine.botPose(k);
    const dx = bp.x - p.x;
    const dz = bp.z - p.z;
    const dist = Math.hypot(dx, dz);
    const radialSpeed = delta > 0 && lastGaps[k] !== undefined ? (dist - lastGaps[k]) / delta : 0;
    lastGaps[k] = dist;
    gearboxes[k].update(bot.speed, delta);
    return {
      dist,
      pan: (dx * rx + dz * rz) / Math.max(dist, 3),
      rpm: gearboxes[k].rpm,
      radialSpeed,
      relSpeed: Math.hypot(bot.vx - me.vx, bot.vz - me.vz),
    };
  });
}

/**
 * The model's interior is a shell made to be seen through the windows: roof lining and pillars, plus a flat black
 * lid at dash height that would bury the steering wheel and shifter. This returns the shell without the lid
 * (every triangle wholly below `cut` metres, car-local); Cockpit.tsx supplies the real lower cabin.
 */
function openInterior(mesh: THREE.Mesh, car: THREE.Object3D, cut: number) {
  car.updateMatrixWorld(true);
  const toCar = car.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  const pos = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.getIndex();
  const count = index ? index.count : pos.count;
  const v = new THREE.Vector3();
  const height = (i: number) => v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(toCar).y;
  const kept: number[] = [];
  for (let i = 0; i < count; i += 3) {
    if (Math.max(height(i), height(i + 1), height(i + 2)) < cut) continue;
    for (let k = i; k < i + 3; k++) kept.push(index ? index.getX(k) : k);
  }
  const open = mesh.geometry.clone();
  open.setIndex(kept);
  return open;
}

/** Hide the player's driver figure, open up the interior shell and thin the window tint while looking out from inside. */
function setCockpitLook(car: THREE.Object3D, inside: boolean) {
  if (car.userData.inside === inside) return;
  const driver = car.getObjectByName("driver");
  if (!driver) return; // model still loading; try again next frame
  car.userData.inside = inside;
  driver.visible = !inside;
  car.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name.startsWith("Interior")) {
      o.userData.closed ??= o.geometry;
      o.userData.open ??= openInterior(o, car, 0.86);
      o.geometry = (inside ? o.userData.open : o.userData.closed) as THREE.BufferGeometry;
    }
    const mat = o instanceof THREE.Mesh ? (o.material as THREE.MeshStandardMaterial) : null;
    if (!mat) return;
    if (/Glass$/.test(mat.name)) {
      mat.userData.opacity ??= mat.opacity;
      mat.opacity = inside ? 0.1 : (mat.userData.opacity as number);
    } else if (/_Black$/.test(mat.name)) {
      // The cabin trim is pure black in the model, which reads as a void from inside: lift it to dark grey.
      mat.userData.color ??= mat.color.getHex();
      mat.color.set(inside ? "#30343b" : (mat.userData.color as number));
    }
  });
}

function ordinal(n: number): string {
  return `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
}

function resetGears(g: Gearbox) {
  g.reset();
}

function updateGears(g: Gearbox, speed: number, delta: number) {
  return g.update(speed, delta);
}

/** Advances the engine every frame and moves the car mesh + chase camera. */
function Driver({
  engine,
  input,
  started,
  onTick,
  skids,
  layout,
  view,
  sound,
  gears,
}: {
  engine: Engine;
  input: React.RefObject<number>;
  started: React.RefObject<boolean>;
  onTick: () => void;
  skids: React.RefObject<SkidHandle | null>;
  layout: Layout;
  view: React.RefObject<number>;
  sound: React.RefObject<Sound | null>;
  gears: Gearbox;
}) {
  const car = useRef<THREE.Group>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const anim = useMemo(() => newCarAnim(), []);
  const rig = useMemo(() => new CameraRig(layout.tvSpots.map((s) => new THREE.Vector3(s.x, s.y, s.z))), [layout]);
  const crowdNear = useRef({ level: 0, frame: 0 });
  const cockpit = useRef<CockpitHandle>(null);
  const cockpitGroup = useRef<THREE.Group>(null);
  const exterior = useRef<THREE.Group>(null);
  const lastGear = useRef(0);
  // For the sound of the other cars: a gearbox each (so their engines rev believably) and last frame's gaps.
  const botGears = useMemo(() => engine.sim.state.bots.map(() => new Gearbox()), [engine]);
  const lastGaps = useRef<number[]>([]);

  useFrame(({ camera }, delta) => {
    if (started.current) engine.advance(delta, () => input.current);
    onTick();
    const p = engine.pose();
    const speed = engine.sim.state.car.speed;
    car.current?.position.set(p.x, 0, p.z);
    car.current?.rotation.set(0, p.angle, 0);

    // The sim's own steering wheel position (it ramps), so the visible wheels match what the car is doing.
    const steer = engine.sim.state.car.steer;
    const braking = (input.current & DOWN) !== 0 && speed > 0.5 && !engine.finished;
    if (car.current) animateCar(car.current, anim, speed, p.angle, engine.finished ? 0 : steer, braking, delta);
    skids.current?.track("player", engine.sim.state.car, p.x, p.z, p.angle, braking);
    // Keep the shadow camera centred on the car so a small shadow map stays sharp.
    if (sun.current) {
      sun.current.position.set(p.x + SUN_DIR.x * 150, SUN_DIR.y * 150, p.z + SUN_DIR.z * 150);
      sun.current.target.position.set(p.x, 0, p.z);
      sun.current.target.updateMatrixWorld();
    }

    const sim = engine.sim.state.car;
    const viewName = VIEWS[view.current];
    rig.update(camera as THREE.PerspectiveCamera, viewName, p, speed, sim.offRoad, delta, car.current ?? undefined, EYE);
    // From the driver's seat you see the car's real interior, so the car stays visible; only the driver's own
    // body is hidden (the camera is inside his head) and the glass is made clearer. Bumper cam hides the car.
    const inCockpit = viewName === "Cockpit";
    if (exterior.current) {
      exterior.current.visible = viewName !== "Bumper";
      setCockpitLook(exterior.current, inCockpit);
    }
    if (cockpitGroup.current) cockpitGroup.current.visible = inCockpit;

    // Gears: the cockpit hand reaches for the lever and the engine note cuts on every change.
    const shifted = started.current && updateGears(gears, speed, delta);
    const gear = started.current ? gears.gear : 0;
    if (shifted && lastGear.current !== 0) sound.current?.shift();
    lastGear.current = gear;
    if (viewName === "Cockpit") cockpit.current?.update({ steer, gear, speedKmh: Math.abs(speed) * 3.6, rpm: started.current ? gears.rpm : 900, delta });

    // Sound: engine from the cosmetic gearbox, tyres from sideways slip, crowd from nearby fans.
    const cn = crowdNear.current;
    if (cn.frame++ % 10 === 0) {
      let near = 0;
      for (const f of layout.people) if ((f.x - p.x) ** 2 + (f.z - p.z) ** 2 < 90 * 90) near++;
      cn.level = Math.min(1, near / 350);
    }
    const slip = Math.abs(sim.vx * COS[sim.heading] - sim.vz * SIN[sim.heading]);
    const others = hearOtherCars(engine, botGears, lastGaps.current, p, delta);
    sound.current?.update({
      rpm: started.current ? gears.rpm : 900,
      throttle: started.current && !engine.finished && (input.current & UP) !== 0,
      speed,
      slip: sim.offRoad ? 0 : slip,
      crowd: cn.level,
      braking,
      others,
    });
  });

  return (
    <>
      <directionalLight
        ref={sun}
        intensity={4.6}
        color="#fff1dc"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-radius={4}
        shadow-camera-far={400}
        shadow-bias={-0.0005}
      />
      <group ref={car}>
        <group ref={exterior}>
          <Suspense fallback={null}>
            <Car model={PLAYER_MODEL} />
          </Suspense>
        </group>
        <group ref={cockpitGroup} visible={false}>
          <Cockpit ref={cockpit} />
        </group>
      </group>
    </>
  );
}

// Sky: "Kloofendal 48d Partly Cloudy (Pure Sky)" from Poly Haven (CC0). It is both the visible sky and the
// light source. The two values below were measured from the HDR file so the scene matches it:
/** Direction to the sun in the sky image (48° up); the shadow-casting light shines from here. */
const SUN_DIR = new THREE.Vector3(0.554, 0.742, 0.378).normalize();
/** Average linear radiance of the sky just above the horizon; used as the haze colour so distance fades into the sky. */
const HORIZON = new THREE.Color().setRGB(0.45, 0.48, 0.59, THREE.LinearSRGBColorSpace);

function World({ track, layout }: { track: Track; layout: Layout }) {
  const height = useMemo(() => makeHeight(track, layout), [track, layout]);
  const street = track.kind === "street";
  return (
    <>
      <Suspense fallback={<color attach="background" args={["#9fb4cc"]} />}>
        <Environment files="/env/sky_2k.hdr" background environmentIntensity={0.32} />
      </Suspense>
      <fog attach="fog" args={[HORIZON, 350, 3000]} />
      <Ground height={height} />
      <Ridges track={track} />
      <Town track={track} height={height} />
      <Road track={track} />
      <FinishLine track={track} />
      <CircuitBoxes layout={layout} />
      <TimingTower layout={layout} seed={track.seed} />
      <Flags layout={layout} />
      <Blimp track={track} />
      {street ? (
        <>
          {/* Street circuit: pavements to the walls, the canal, placed models, petals on the wind. */}
          <Pavements track={track} />
          <Canals layout={layout} />
          <Suspense fallback={null}>
            <Models layout={layout} />
          </Suspense>
          <Petals />
        </>
      ) : (
        <>
          {/* Race circuit: run-off, gravel, checkpoint posts, paddock, car park, lake, Ferris wheel. */}
          <Pylons track={track} height={height} />
          <RunOff track={track} />
          <GravelTraps track={track} layout={layout} />
          <FerrisWheel layout={layout} />
          <Billboards track={track} layout={layout} />
          <GatePosts track={track} />
          <Tents layout={layout} />
          <Suspense fallback={null}>
            <CarPark layout={layout} />
          </Suspense>
          <Paddock layout={layout} />
          <Lake layout={layout} />
        </>
      )}
      <Suspense fallback={null}>
        <Trees track={track} reserved={layout.reserved} height={height} spots={layout.trees} />
      </Suspense>
    </>
  );
}

/** Post-processing: ambient occlusion for contact shading, gentle bloom, vignette, filmic tone mapping, anti-aliasing. */
function Effects({ ao }: { ao: boolean }) {
  return (
    <EffectComposer multisampling={0}>
      {/* AO off in the cockpit: surfaces centimetres from the lens would darken the whole view. */}
      <N8AO enabled={ao} aoRadius={2.5} distanceFalloff={1} intensity={2.2} quality="medium" halfRes />
      <Bloom mipmapBlur luminanceThreshold={0.9} luminanceSmoothing={0.15} intensity={0.3} />
      <HueSaturation saturation={0.06} />
      <Vignette offset={0.35} darkness={0.35} />
      {/* The composer switches the renderer's own tone mapping off, so do it here: HDR light -> filmic screen colours. */}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <SMAA />
    </EffectComposer>
  );
}

/** Draw at most 60 frames a second: on a 120 Hz display the uncapped loop doubles the GPU work for no gain here. */
function FrameCap() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 1000 / 60 - 2) return;
      last = now;
      invalidate();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [invalidate]);
  return null;
}

export default function Game() {
  const map = useMemo(() => chosenMap(), []);
  const track = useMemo(() => generateTrack(map.seed), [map]);
  const layout = useMemo(() => buildLayout(track), [track]);
  const skids = useRef<SkidHandle>(null);
  const gears = useMemo(() => new Gearbox(), []);
  const view = useRef(0);
  const [viewIdx, setViewIdx] = useState(0);
  const [viewName, setViewName] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const sound = useRef<Sound | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [engine, setEngine] = useState(() => new Engine(track));
  const [lapTicks, setLapTicks] = useState<number | null>(null);
  const [result, setResult] = useState<{ position: number; bestLap: number | null } | null>(null);
  const lapEl = useRef<HTMLDivElement>(null);
  const posEl = useRef<HTMLDivElement>(null);
  const bestEl = useRef<HTMLDivElement>(null);
  const lightsEl = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const input = useRef(0);
  const startedRef = useRef(false);
  const timeEl = useRef<HTMLDivElement>(null);
  const tacho = useRef<TachoHandle>(null);
  const offRoadEl = useRef<HTMLDivElement>(null);

  const restart = useCallback(() => {
    skids.current?.clear();
    resetGears(gears);
    setEngine(new Engine(track));
    setLapTicks(null);
    setResult(null);
    setStarted(false);
    startedRef.current = false;
  }, [track, gears]);

  const cycleView = useCallback(() => {
    view.current = (view.current + 1) % VIEWS.length;
    setViewIdx(view.current);
    setViewName(VIEWS[view.current]);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setViewName(null), 1400);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      sound.current?.setMuted(!m);
      return !m;
    });
  }, []);

  const press = useCallback((bit: number, down: boolean) => {
    if (!sound.current) sound.current = new Sound();
    sound.current.start();
    input.current = down ? input.current | bit : input.current & ~bit;
    if (down && !startedRef.current) {
      startedRef.current = true;
      setStarted(true);
    }
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "KeyR") return restart();
      if (e.code === "KeyC" && !e.repeat) return cycleView();
      if (e.code === "KeyM" && !e.repeat) return toggleMute();
      const bit = KEY_BITS[e.code];
      if (bit) {
        e.preventDefault();
        press(bit, true);
      }
    };
    const up = (e: KeyboardEvent) => {
      const bit = KEY_BITS[e.code];
      if (bit) press(bit, false);
    };
    const blur = () => (input.current = 0);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [press, restart, cycleView, toggleMute]);

  useEffect(() => () => sound.current?.dispose(), []);

  // Called every frame: write HUD text directly (no React re-render) and catch lap completion.
  const onTick = useCallback(() => {
    const s = engine.sim.state;
    // Current lap's time while racing; the total once finished.
    if (timeEl.current) timeEl.current.textContent = formatTicks(s.lapTicks ?? s.tick - s.lapStartTick);
    if (lapEl.current) lapEl.current.textContent = `${Math.min(s.lap + 1, LAPS)}/${LAPS}`;
    if (posEl.current) posEl.current.textContent = ordinal(racePosition(s));
    if (bestEl.current) bestEl.current.textContent = s.bestLapTicks === null ? "--.---" : formatTicks(s.bestLapTicks);
    if (lightsEl.current) {
      // Start lights: 3, 2, 1, then GO for the first second of the race.
      const c = engine.countdown;
      const text = !startedRef.current ? "" : c > 0 ? String(Math.ceil(c)) : s.tick < 60 && s.lapTicks === null ? "GO" : "";
      if (lightsEl.current.textContent !== text) lightsEl.current.textContent = text;
      lightsEl.current.dataset.go = text === "GO" ? "1" : "0";
    }
    const [gear, rpm] = gearDisplay(gears, startedRef.current);
    tacho.current?.update(s.car.speed, gear, rpm);
    if (offRoadEl.current) offRoadEl.current.style.opacity = s.car.offRoad ? "1" : "0";
    if (s.lapTicks !== null && lapTicks === null) {
      setLapTicks(s.lapTicks);
      setResult({ position: racePosition(s), bestLap: s.bestLapTicks });
    }
  }, [engine, lapTicks, gears]);

  const download = () => {
    const blob = new Blob([JSON.stringify(engine.run())], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "run.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className={styles.root}>
      <Canvas
        shadows="percentage"
        // Capped below full Retina: every post-processing pass is paid per pixel.
        dpr={[1, 1.5]}
        frameloop="demand"
        gl={{ antialias: false, powerPreference: "high-performance" }}
        camera={{ fov: 58, near: 0.1, far: 3200 }}
      >
        <World track={track} layout={layout} />
        <Driver engine={engine} input={input} started={startedRef} onTick={onTick} skids={skids} layout={layout} view={view} sound={sound} gears={gears} />
        <Traffic engine={engine} skids={skids} />
        <Obstacles engine={engine} />
        <SkidMarks ref={skids} />
        <Crowd people={layout.people} engine={engine} />
        <Helicopter engine={engine} />
        <BigScreen layout={layout} engine={engine} />
        <FrameCap />
        <Effects ao={VIEWS[viewIdx] !== "Cockpit"} />
      </Canvas>

      <div className={styles.hud}>
        <div className={styles.box}>
          <div className={styles.label}>Lap time</div>
          <div className={styles.time} ref={timeEl}>
            0.000
          </div>
        </div>
        <div className={styles.box}>
          <div className={styles.label}>Best lap</div>
          <div className={styles.best} ref={bestEl}>
            --.---
          </div>
        </div>
        <div className={styles.seed}>{MAPS.find((m) => m.id === map.id)?.name}{map.id === "circuit" ? ` · ${track.seed}` : ""}</div>
      </div>
      <div className={styles.race}>
        <div className={styles.box}>
          <div className={styles.label}>Position</div>
          <div className={styles.position}>
            <span ref={posEl}>5th</span>
            <small>/ {engine.sim.state.bots.length + 1}</small>
          </div>
        </div>
        <div className={styles.box}>
          <div className={styles.label}>Lap</div>
          <div className={styles.best} ref={lapEl}>
            1/{LAPS}
          </div>
        </div>
      </div>
      <div className={styles.lights} ref={lightsEl} />
      {/* The cockpit has its own dials on the dash */}
      {VIEWS[viewIdx] !== "Cockpit" && <Tacho ref={tacho} />}
      <div className={styles.offRoad} ref={offRoadEl}>
        Off road
      </div>

      {!started && lapTicks === null && (
        <>
          <div className={styles.maps}>
            {MAPS.map((m) => (
              <a key={m.id} href={`?map=${m.id}`} className={m.id === map.id ? styles.mapOn : styles.map}>
                <strong>{m.name}</strong>
                <span>{m.blurb}</span>
              </a>
            ))}
          </div>
          <div className={styles.hint}>Press ↑ / W to start · C camera · M sound</div>
        </>
      )}
      {viewName && <div className={styles.toast}>{viewName}</div>}
      <div className={styles.status}>
        <button onClick={cycleView} aria-label="Change camera">
          📷
        </button>
        <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
          {muted ? "🔇" : "🔊"}
        </button>
      </div>

      {lapTicks !== null && (
        <div className={styles.panel}>
          <div className={styles.panelLabel}>Race finished</div>
          <div className={styles.panelPosition}>{result ? ordinal(result.position) : ""}</div>
          <div className={styles.panelTime}>{formatTicks(lapTicks)}</div>
          <div className={styles.panelTicks}>best lap {result?.bestLap != null ? formatTicks(result.bestLap) : "--.---"}</div>
          <div className={styles.actions}>
            <button onClick={download}>Download run.json</button>
            <button onClick={restart}>Retry (R)</button>
          </div>
        </div>
      )}

      <TouchControls press={press} />
    </div>
  );
}

function TouchControls({ press }: { press: (bit: number, down: boolean) => void }) {
  const btn = (bit: number, label: string, cls: string) => (
    <button
      className={cls}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        press(bit, true);
      }}
      onPointerUp={() => press(bit, false)}
      onPointerCancel={() => press(bit, false)}
      aria-label={label}
    >
      {label}
    </button>
  );
  return (
    <div className={styles.touch}>
      <div className={styles.touchGroup}>
        {btn(LEFT, "◀", styles.touchBtn)}
        {btn(RIGHT, "▶", styles.touchBtn)}
      </div>
      <div className={styles.touchGroup}>
        {btn(DOWN, "▼", styles.touchBtn)}
        {btn(UP, "▲", styles.touchBtn)}
      </div>
    </div>
  );
}
