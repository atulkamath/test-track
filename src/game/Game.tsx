"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer, Sky } from "@react-three/drei";
import { Bloom, EffectComposer, HueSaturation, N8AO, SMAA, Vignette } from "@react-three/postprocessing";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { COS, DOWN, LEFT, RIGHT, SIN, UP, generateTrack, type Track } from "@/sim";
import { Sound } from "./audio";
import { CameraRig, VIEWS } from "./camera";
import { animateCar, Car, newCarAnim, PLAYER_MODEL } from "./Car";
import { Cockpit, EYE, type CockpitHandle } from "./Cockpit";
import { Gearbox } from "./gearbox";
import { Crowd } from "./Crowd";
import { BigScreen, Blimp, Clouds, Helicopter, Lake, Paddock } from "./Life";
import { Obstacles, SkidMarks, Traffic, type SkidHandle } from "./Dynamic";
import { Engine, formatTicks } from "./engine";
import { FinishLine, GatePosts, Ground, Road, RunOff, Trees } from "./Scene";
import { Tacho, type TachoHandle } from "./Tacho";
import { Pylons, Ridges, Town } from "./Background";
import { CarPark, CircuitBoxes, FerrisWheel, Flags, GravelTraps, Tents, TimingTower } from "./Circuit";
import { buildLayout, type Layout } from "./layout";
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

function todaySeed(): string {
  const fromUrl = new URLSearchParams(window.location.search).get("seed");
  if (fromUrl) return fromUrl;
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Gear + rpm to show: neutral at idle until the run starts. */
function gearDisplay(g: Gearbox, started: boolean): [number, number] {
  return started ? [g.gear, g.rpm] : [0, 900];
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

  useFrame(({ camera }, delta) => {
    if (started.current) engine.advance(delta, () => input.current);
    onTick();
    const p = engine.pose();
    const speed = engine.sim.state.car.speed;
    car.current?.position.set(p.x, 0, p.z);
    car.current?.rotation.set(0, p.angle, 0);

    const steer = (input.current & LEFT ? 1 : 0) - (input.current & RIGHT ? 1 : 0);
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
    // Exterior hidden when the camera is inside or in front of the car; interior only from the driver's seat.
    if (exterior.current) exterior.current.visible = viewName !== "Bumper" && viewName !== "Cockpit";
    if (cockpitGroup.current) cockpitGroup.current.visible = viewName === "Cockpit";

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
    sound.current?.update({
      rpm: started.current ? gears.rpm : 900,
      throttle: started.current && !engine.finished && (input.current & UP) !== 0,
      speed,
      slip: sim.offRoad ? 0 : slip,
      crowd: cn.level,
      braking,
    });
  });

  return (
    <>
      <directionalLight
        ref={sun}
        intensity={2.8}
        color="#fff4e4"
        castShadow
        shadow-mapSize={[4096, 4096]}
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

/** Clear early-afternoon sun. Used for both the sky shader and the shadow-casting light. */
const SUN_DIR = new THREE.Vector3(300, 240, 140).normalize();

function World({ track, layout }: { track: Track; layout: Layout }) {
  return (
    <>
      <color attach="background" args={["#b9d3ea"]} />
      <Sky sunPosition={SUN_DIR.clone().multiplyScalar(1000).toArray()} turbidity={2.2} rayleigh={0.7} mieCoefficient={0.004} mieDirectionalG={0.8} />
      <fog attach="fog" args={["#c6d8e8", 420, 2900]} />
      <hemisphereLight args={["#e2edfa", "#5d7a3e", 0.8]} />
      {/* Local reflection map (no network): bright sky above, a warm strip toward the sun, a few highlights. */}
      <Environment resolution={256} environmentIntensity={0.6}>
        <Lightformer form="rect" intensity={2} color="#d6e6f7" position={[0, 12, 0]} rotation-x={Math.PI / 2} scale={[40, 40, 1]} />
        <Lightformer form="rect" intensity={5} color="#fff1dc" position={SUN_DIR.clone().multiplyScalar(15).toArray()} scale={[14, 3, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={3} position={[-8, 5, -6]} rotation-y={Math.PI / 3} scale={[12, 1.2, 1]} />
        <Lightformer form="rect" intensity={1} color="#4f7a3a" position={[0, -6, 0]} rotation-x={-Math.PI / 2} scale={[40, 40, 1]} />
      </Environment>
      <Ground />
      <Ridges track={track} />
      <Town track={track} />
      <Pylons track={track} />
      <RunOff track={track} />
      <Road track={track} />
      <GravelTraps track={track} layout={layout} />
      <FinishLine track={track} />
      <CircuitBoxes layout={layout} />
      <TimingTower layout={layout} seed={track.seed} />
      <Flags layout={layout} />
      <FerrisWheel layout={layout} />
      <Billboards track={track} layout={layout} />
      <GatePosts track={track} />
      <Tents layout={layout} />
      <CarPark layout={layout} />
      <Paddock layout={layout} />
      <Lake layout={layout} />
      <Clouds track={track} />
      <Blimp track={track} />
      <Trees track={track} reserved={layout.reserved} />
    </>
  );
}

/** Modern grade: ambient occlusion for contact shading, gentle bloom, clean anti-aliasing. */
function Effects({ ao }: { ao: boolean }) {
  return (
    <EffectComposer multisampling={0}>
      {/* AO off in the cockpit: surfaces centimetres from the lens would darken the whole view. */}
      <N8AO enabled={ao} aoRadius={2.5} distanceFalloff={1} intensity={2.2} quality="medium" halfRes />
      <Bloom mipmapBlur luminanceThreshold={0.9} luminanceSmoothing={0.15} intensity={0.3} />
      <HueSaturation saturation={0.06} />
      <Vignette offset={0.35} darkness={0.35} />
      <SMAA />
    </EffectComposer>
  );
}

export default function Game() {
  const track = useMemo(() => generateTrack(todaySeed()), []);
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
  const [best, setBest] = useState<number | null>(null);
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
    if (timeEl.current) timeEl.current.textContent = formatTicks(s.tick);
    const [gear, rpm] = gearDisplay(gears, startedRef.current);
    tacho.current?.update(s.car.speed, gear, rpm);
    if (offRoadEl.current) offRoadEl.current.style.opacity = s.car.offRoad ? "1" : "0";
    if (s.lapTicks !== null && lapTicks === null) {
      const t = s.lapTicks;
      setLapTicks(t);
      setBest((b) => (b === null || t < b ? t : b));
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
        shadows="soft"
        dpr={[1, 2]}
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
          <div className={styles.label}>Best</div>
          <div className={styles.best}>{best === null ? "--.---" : formatTicks(best)}</div>
        </div>
        <div className={styles.seed}>{track.seed}</div>
      </div>
      <Tacho ref={tacho} />
      <div className={styles.offRoad} ref={offRoadEl}>
        Off road
      </div>

      {!started && lapTicks === null && <div className={styles.hint}>Press ↑ / W to start · C camera · M sound</div>}
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
          <div className={styles.panelLabel}>Lap complete</div>
          <div className={styles.panelTime}>{formatTicks(lapTicks)}</div>
          <div className={styles.panelTicks}>{lapTicks} ticks</div>
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
