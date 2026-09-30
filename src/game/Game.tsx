"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer, Sky } from "@react-three/drei";
import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, Vignette } from "@react-three/postprocessing";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { DOWN, LEFT, RIGHT, UP, generateTrack, type Track } from "@/sim";
import { ALL_WHEELS, Car, FRONT_WHEELS, WHEEL_RADIUS } from "./Car";
import { Engine, formatTicks } from "./engine";
import { Cones, FinishLine, Ground, Road, Trees } from "./Scene";
import { Tacho, type TachoHandle } from "./Tacho";
import { Billboards, Grandstand, Mountains, TyreWalls } from "./Trackside";
import styles from "./game.module.css";

/** PS2 output height. The canvas is drawn at this many lines and upscaled with hard pixels. */
const RENDER_LINES = 448;

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
}: {
  engine: Engine;
  input: React.RefObject<number>;
  started: React.RefObject<boolean>;
  onTick: () => void;
}) {
  const car = useRef<THREE.Group>(null);
  const target = useMemo(() => new THREE.Vector3(), []);
  const desired = useMemo(() => new THREE.Vector3(), []);
  const lookAt = useMemo(() => new THREE.Vector3(), []);
  const snapped = useRef(false);
  const sun = useRef<THREE.DirectionalLight>(null);
  const steerVisual = useRef(0);

  useFrame(({ camera }, delta) => {
    if (started.current) engine.advance(delta, () => input.current);
    onTick();
    const p = engine.pose();
    const speed = engine.sim.state.car.speed;
    car.current?.position.set(p.x, 0, p.z);
    car.current?.rotation.set(0, p.angle, 0);

    // Wheels: roll with speed, front pair turns toward the held steering direction.
    const steerTarget = (input.current & LEFT ? 1 : 0) - (input.current & RIGHT ? 1 : 0);
    steerVisual.current += (steerTarget * 0.4 - steerVisual.current) * (1 - Math.exp(-delta * 12));
    for (const name of ALL_WHEELS) {
      const w = car.current?.getObjectByName(name);
      if (!w) continue;
      w.rotation.x += (engine.finished ? 0 : speed * delta) / WHEEL_RADIUS;
      if (FRONT_WHEELS.includes(name)) w.rotation.y = steerVisual.current;
    }
    // Keep the shadow camera centred on the car so a small shadow map stays sharp.
    if (sun.current) {
      sun.current.position.set(p.x + 60, 90, p.z + 40);
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
        intensity={1.8}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-far={300}
        shadow-bias={-0.0005}
      />
      <Suspense fallback={null}>
        <Car ref={car} />
      </Suspense>
    </>
  );
}

function World({ track }: { track: Track }) {
  return (
    <>
      <color attach="background" args={["#a9c9e6"]} />
      <Sky sunPosition={[200, 140, 100]} turbidity={3} rayleigh={0.5} mieCoefficient={0.004} />
      <fog attach="fog" args={["#b9d2e6", 220, 1500]} />
      <hemisphereLight args={["#e6f2ff", "#51703d", 0.8]} />
      {/* Local reflection map (no network): bright sky above, a few light strips for paint highlights. */}
      <Environment resolution={128} environmentIntensity={0.55}>
        <Lightformer form="rect" intensity={2} color="#cfe4ff" position={[0, 12, 0]} rotation-x={Math.PI / 2} scale={[40, 40, 1]} />
        <Lightformer form="rect" intensity={4} position={[-8, 5, -6]} rotation-y={Math.PI / 3} scale={[12, 1.2, 1]} />
        <Lightformer form="rect" intensity={4} position={[8, 5, 6]} rotation-y={-Math.PI / 2.5} scale={[12, 1.2, 1]} />
        <Lightformer form="rect" intensity={1} color="#4f7a3a" position={[0, -6, 0]} rotation-x={-Math.PI / 2} scale={[40, 40, 1]} />
      </Environment>
      <Ground />
      <Mountains track={track} />
      <Road track={track} />
      <FinishLine track={track} />
      <Grandstand track={track} />
      <TyreWalls track={track} />
      <Billboards track={track} />
      <Cones track={track} />
      <Trees track={track} />
    </>
  );
}

/** PS2-era glow and grade: soft bloom on bright bits, slightly punchy colour, dark corners. */
function Effects() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur luminanceThreshold={0.78} luminanceSmoothing={0.2} intensity={0.55} />
      <HueSaturation saturation={0.12} />
      <BrightnessContrast contrast={0.06} />
      <Vignette offset={0.3} darkness={0.55} />
    </EffectComposer>
  );
}

function useRenderDpr() {
  const calc = () => Math.min(1, RENDER_LINES / window.innerHeight);
  const [dpr, setDpr] = useState(calc);
  useEffect(() => {
    const onResize = () => setDpr(calc());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return dpr;
}

export default function Game() {
  const track = useMemo(() => generateTrack(todaySeed()), []);
  const [engine, setEngine] = useState(() => new Engine(track));
  const [lapTicks, setLapTicks] = useState<number | null>(null);
  const [best, setBest] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  const input = useRef(0);
  const startedRef = useRef(false);
  const timeEl = useRef<HTMLDivElement>(null);
  const tacho = useRef<TachoHandle>(null);
  const offRoadEl = useRef<HTMLDivElement>(null);
  const dpr = useRenderDpr();

  const restart = useCallback(() => {
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
        className={styles.canvas}
        shadows
        dpr={dpr}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        camera={{ fov: 58, near: 0.1, far: 2600 }}
      >
        <World track={track} />
        <Driver engine={engine} input={input} started={startedRef} onTick={onTick} />
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
