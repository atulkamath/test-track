"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { DOWN, LEFT, RIGHT, UP, generateTrack, type Track } from "@/sim";
import { Engine, formatTicks } from "./engine";
import { CarModel, Cones, FinishLine, Ground, Road } from "./Scene";
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
}: {
  engine: Engine;
  input: React.RefObject<number>;
  started: React.RefObject<boolean>;
  onTick: () => void;
}) {
  const car = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const target = useMemo(() => new THREE.Vector3(), []);
  const desired = useMemo(() => new THREE.Vector3(), []);
  const lookAt = useMemo(() => new THREE.Vector3(), []);
  const snapped = useRef(false);

  useFrame((_, delta) => {
    if (started.current) engine.advance(delta, () => input.current);
    onTick();
    const p = engine.pose();
    car.current?.position.set(p.x, 0, p.z);
    car.current?.rotation.set(0, p.angle, 0);

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
    camera.lookAt(lookAt);
  });

  return <CarModel ref={car} />;
}

function World({ track }: { track: Track }) {
  const start = track.points[0];
  return (
    <>
      <Sky sunPosition={[200, 120, 100]} turbidity={4} rayleigh={0.6} />
      <fog attach="fog" args={["#bcd6ea", 150, 600]} />
      <hemisphereLight args={["#dfefff", "#4b6b3a", 0.9]} />
      <directionalLight position={[start.x + 120, 180, start.z + 80]} intensity={1.8} />
      <Ground />
      <Road track={track} />
      <FinishLine track={track} />
      <Cones track={track} />
    </>
  );
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
  const speedEl = useRef<HTMLDivElement>(null);
  const offRoadEl = useRef<HTMLDivElement>(null);

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
    if (speedEl.current) speedEl.current.textContent = String(Math.round(Math.abs(s.car.speed) * 3.6));
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
      <Canvas camera={{ fov: 60, near: 0.1, far: 2000 }} dpr={[1, 2]}>
        <World track={track} />
        <Driver engine={engine} input={input} started={startedRef} onTick={onTick} />
      </Canvas>

      <div className={styles.hud}>
        <div className={styles.seed}>Daily Lap · {track.seed}</div>
        <div className={styles.time} ref={timeEl}>
          0.000
        </div>
        <div className={styles.best}>Best {best === null ? "—" : `${formatTicks(best)} (${best} ticks)`}</div>
      </div>
      <div className={styles.speed}>
        <span ref={speedEl}>0</span> km/h
      </div>
      <div className={styles.offRoad} ref={offRoadEl}>
        Off road
      </div>

      {!started && lapTicks === null && <div className={styles.hint}>Press ↑ / W to start · R to restart</div>}

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
