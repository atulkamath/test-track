"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer, Sky } from "@react-three/drei";
import { Bloom, EffectComposer, HueSaturation, N8AO, SMAA, Vignette } from "@react-three/postprocessing";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { DOWN, LEFT, RIGHT, UP, generateTrack, type Track } from "@/sim";
import { animateCar, Car, newCarAnim, PLAYER_MODEL } from "./Car";
import { Crowd } from "./Crowd";
import { Obstacles, SkidMarks, Traffic, type SkidHandle } from "./Dynamic";
import { Engine, formatTicks } from "./engine";
import { FinishLine, GatePosts, Ground, Road, Trees } from "./Scene";
import { Tacho, type TachoHandle } from "./Tacho";
import { CircuitBoxes, FerrisWheel, Flags, GravelTraps, Hills, TimingTower } from "./Circuit";
import { buildLayout, type Layout } from "./layout";
import { Billboards, Mountains } from "./Trackside";
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

/** Advances the engine every frame and moves the car mesh + chase camera. */
function Driver({
  engine,
  input,
  started,
  onTick,
  skids,
}: {
  engine: Engine;
  input: React.RefObject<number>;
  started: React.RefObject<boolean>;
  onTick: () => void;
  skids: React.RefObject<SkidHandle | null>;
}) {
  const car = useRef<THREE.Group>(null);
  const target = useMemo(() => new THREE.Vector3(), []);
  const desired = useMemo(() => new THREE.Vector3(), []);
  const lookAt = useMemo(() => new THREE.Vector3(), []);
  const snapped = useRef(false);
  const sun = useRef<THREE.DirectionalLight>(null);
  const anim = useMemo(() => newCarAnim(), []);

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

    const fx = Math.sin(p.angle);
    const fz = Math.cos(p.angle);
    desired.set(p.x - fx * 11, 4.6, p.z - fz * 11);
    target.set(p.x + fx * 6, 1, p.z + fz * 6);
    if (!snapped.current) {
      camera.position.copy(desired);
      lookAt.copy(target);
      snapped.current = true;
    }
    const k = 1 - Math.exp(-delta * 6);
    camera.position.lerp(desired, k);
    lookAt.lerp(target, 1 - Math.exp(-delta * 10));
    // A little rumble on the grass.
    if (engine.sim.state.car.offRoad && Math.abs(speed) > 3) camera.position.y += (Math.random() - 0.5) * 0.08;
    camera.lookAt(lookAt);

    // Widen the lens as speed builds.
    const cam = camera as THREE.PerspectiveCamera;
    const fov = 58 + Math.min(Math.abs(speed) / 55, 1) * 14;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * (1 - Math.exp(-delta * 3));
      cam.updateProjectionMatrix();
    }
  });

  return (
    <>
      <directionalLight
        ref={sun}
        intensity={2.4}
        color="#ffe2bd"
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
      <Suspense fallback={null}>
        <Car ref={car} model={PLAYER_MODEL} />
      </Suspense>
    </>
  );
}

/** Late-afternoon sun: low, warm, long shadows. Used for both the sky shader and the shadow-casting light. */
const SUN_DIR = new THREE.Vector3(420, 95, 210).normalize();

function World({ track, layout }: { track: Track; layout: Layout }) {
  return (
    <>
      <color attach="background" args={["#c9d6df"]} />
      <Sky sunPosition={SUN_DIR.clone().multiplyScalar(1000).toArray()} turbidity={5} rayleigh={0.9} mieCoefficient={0.006} mieDirectionalG={0.85} />
      <fog attach="fog" args={["#d4dadb", 260, 1500]} />
      <hemisphereLight args={["#e4ecf5", "#56693a", 0.7]} />
      {/* Local reflection map (no network): bright sky above, a warm strip toward the sun, a few highlights. */}
      <Environment resolution={256} environmentIntensity={0.6}>
        <Lightformer form="rect" intensity={2} color="#d6e6f7" position={[0, 12, 0]} rotation-x={Math.PI / 2} scale={[40, 40, 1]} />
        <Lightformer form="rect" intensity={5} color="#ffd9a8" position={SUN_DIR.clone().multiplyScalar(15).toArray()} scale={[14, 3, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={3} position={[-8, 5, -6]} rotation-y={Math.PI / 3} scale={[12, 1.2, 1]} />
        <Lightformer form="rect" intensity={1} color="#4f7a3a" position={[0, -6, 0]} rotation-x={-Math.PI / 2} scale={[40, 40, 1]} />
      </Environment>
      <Ground />
      <Mountains track={track} />
      <Hills track={track} />
      <Road track={track} />
      <GravelTraps track={track} layout={layout} />
      <FinishLine track={track} />
      <CircuitBoxes layout={layout} />
      <TimingTower layout={layout} seed={track.seed} />
      <Flags layout={layout} />
      <FerrisWheel layout={layout} />
      <Billboards track={track} layout={layout} />
      <GatePosts track={track} />
      <Trees track={track} reserved={layout.reserved} />
    </>
  );
}

/** Modern grade: ambient occlusion for contact shading, gentle bloom, clean anti-aliasing. */
function Effects() {
  return (
    <EffectComposer multisampling={0}>
      <N8AO aoRadius={2.5} distanceFalloff={1} intensity={2.2} quality="medium" halfRes />
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
    setEngine(new Engine(track));
    setLapTicks(null);
    setStarted(false);
    startedRef.current = false;
  }, [track]);

  const press = useCallback((bit: number, down: boolean) => {
    input.current = down ? input.current | bit : input.current & ~bit;
    if (down && !startedRef.current) {
      startedRef.current = true;
      setStarted(true);
    }
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "KeyR") return restart();
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
  }, [press, restart]);

  // Called every frame: write HUD text directly (no React re-render) and catch lap completion.
  const onTick = useCallback(() => {
    const s = engine.sim.state;
    if (timeEl.current) timeEl.current.textContent = formatTicks(s.tick);
    tacho.current?.update(s.car.speed);
    if (offRoadEl.current) offRoadEl.current.style.opacity = s.car.offRoad ? "1" : "0";
    if (s.lapTicks !== null && lapTicks === null) {
      const t = s.lapTicks;
      setLapTicks(t);
      setBest((b) => (b === null || t < b ? t : b));
    }
  }, [engine, lapTicks]);

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
        camera={{ fov: 58, near: 0.1, far: 2600 }}
      >
        <World track={track} layout={layout} />
        <Driver engine={engine} input={input} started={startedRef} onTick={onTick} skids={skids} />
        <Traffic engine={engine} skids={skids} />
        <Obstacles engine={engine} />
        <SkidMarks ref={skids} />
        <Crowd people={layout.people} engine={engine} />
        <Effects />
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

      {!started && lapTicks === null && <div className={styles.hint}>Press ↑ / W to start</div>}

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
