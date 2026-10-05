"use client";

// Things that make the world feel lived-in: drifting clouds, a TV helicopter tracking the car,
// a sponsor blimp, a live big screen, an infield lake and paddock trucks. Rendering only.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { hashString, mulberry32 } from "@/sim/rng";
import type { Track } from "@/sim";
import { formatTicks, type Engine } from "./engine";
import type { Layout } from "./layout";
import { canvasTexture } from "./textures";

/** TV helicopter hovering above and to the side of the player's car. */
export function Helicopter({ engine }: { engine: Engine }) {
  const heli = useRef<THREE.Group>(null);
  const rotor = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const pos = useRef<THREE.Vector3 | null>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }, delta) => {
    const h = heli.current;
    if (!h) return;
    const p = engine.pose();
    const t = clock.elapsedTime;
    // Hover off to one side and slightly behind, swinging slowly around the car.
    const a = p.angle + Math.PI * 0.7 + Math.sin(t * 0.05) * 0.6;
    tmp.set(p.x + Math.sin(a) * 70, 60 + Math.sin(t * 0.3) * 4, p.z + Math.cos(a) * 70);
    if (!pos.current) pos.current = tmp.clone();
    const prev = pos.current.clone();
    pos.current.lerp(tmp, 1 - Math.exp(-delta * 0.6));
    h.position.copy(pos.current);
    // Nose toward the car, bank into the direction of travel.
    const vx = (pos.current.x - prev.x) / Math.max(delta, 1e-3);
    const vz = (pos.current.z - prev.z) / Math.max(delta, 1e-3);
    h.rotation.set(0, Math.atan2(p.x - pos.current.x, p.z - pos.current.z), 0);
    h.rotateX(THREE.MathUtils.clamp(Math.hypot(vx, vz) * 0.006, 0, 0.25));
    if (rotor.current) rotor.current.rotation.y += delta * 40;
    if (tail.current) tail.current.rotation.x += delta * 60;
  });
  return (
    <group ref={heli}>
      <mesh scale={[1.3, 1.2, 2.4]} castShadow>
        <sphereGeometry args={[1, 20, 14]} />
        <meshStandardMaterial color="#1d3f7a" metalness={0.4} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.25, 1.1]} scale={[1.05, 0.8, 1.2]}>
        <sphereGeometry args={[1, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#9fc4e6" metalness={0.9} roughness={0.05} />
      </mesh>
      <mesh position={[0, 0.3, -3.6]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.18, 0.35, 4, 10]} />
        <meshStandardMaterial color="#1d3f7a" metalness={0.4} roughness={0.35} />
      </mesh>
      <mesh position={[0, 1, -5.4]}>
        <boxGeometry args={[0.12, 1.4, 0.8]} />
        <meshStandardMaterial color="#f2c230" />
      </mesh>
      {[-0.8, 0.8].map((x) => (
        <mesh key={x} position={[x, -1.35, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.06, 0.06, 3.6, 6]} />
          <meshStandardMaterial color="#222" />
        </mesh>
      ))}
      <group ref={rotor} position={[0, 1.45, 0]}>
        {[0, Math.PI / 2].map((r) => (
          <mesh key={r} rotation={[0, r, 0]}>
            <boxGeometry args={[11, 0.05, 0.3]} />
            <meshStandardMaterial color="#1a1a1a" transparent opacity={0.55} />
          </mesh>
        ))}
      </group>
      <group ref={tail} position={[0.2, 1, -5.6]}>
        <mesh>
          <boxGeometry args={[0.04, 1.8, 0.14]} />
          <meshStandardMaterial color="#1a1a1a" transparent opacity={0.55} />
        </mesh>
      </group>
    </group>
  );
}

/** A slow sponsor blimp circling high above the circuit. */
export function Blimp({ track }: { track: Track }) {
  const blimp = useRef<THREE.Group>(null);
  const centre = useMemo(() => {
    let x = 0;
    let z = 0;
    for (const p of track.points) {
      x += p.x;
      z += p.z;
    }
    return { x: x / track.points.length, z: z / track.points.length };
  }, [track]);
  const banner = useMemo(
    () =>
      canvasTexture(512, 96, (ctx) => {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, 512, 96);
        ctx.fillStyle = "#c8322b";
        ctx.font = "italic 900 64px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("TEST TRACK", 256, 52);
      }),
    [],
  );
  useFrame(({ clock }) => {
    const b = blimp.current;
    if (!b) return;
    const a = clock.elapsedTime * 0.012;
    b.position.set(centre.x + Math.cos(a) * 320, 170, centre.z + Math.sin(a) * 320);
    b.rotation.set(0, -a, 0); // travel along the circle (tangent)
  });
  return (
    <group ref={blimp}>
      <mesh scale={[11, 11, 40]} castShadow>
        <sphereGeometry args={[1, 32, 20]} />
        <meshStandardMaterial color="#f2f3f5" roughness={0.5} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 11.05, 0, 0]} rotation={[0, (s * Math.PI) / 2, 0]}>
          <planeGeometry args={[40, 7.5]} />
          <meshStandardMaterial map={banner} transparent polygonOffset polygonOffsetFactor={-1} />
        </mesh>
      ))}
      <mesh position={[0, -11.5, 4]}>
        <boxGeometry args={[3, 2, 9]} />
        <meshStandardMaterial color="#c8322b" />
      </mesh>
      {[0, Math.PI / 2, Math.PI, -Math.PI / 2].map((r) => (
        <mesh key={r} position={[0, 0, -34]} rotation={[0, 0, r]}>
          <boxGeometry args={[0.5, 18, 7]} />
          <meshStandardMaterial color="#c8322b" />
        </mesh>
      ))}
    </group>
  );
}

function drawScreen(canvas: HTMLCanvasElement, texture: THREE.Texture, tick: number, kmh: number, sector: string) {
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#070b12";
  ctx.fillRect(0, 0, 512, 288);
  ctx.fillStyle = "#c8322b";
  ctx.fillRect(0, 0, 512, 54);
  ctx.fillStyle = "#fff";
  ctx.font = "italic 900 34px sans-serif";
  ctx.fillText("● LIVE   TEST TRACK", 20, 39);
  ctx.font = "bold 92px monospace";
  ctx.fillText(formatTicks(tick), 30, 160);
  ctx.fillStyle = "#f2c230";
  ctx.font = "bold 40px monospace";
  ctx.fillText(`${Math.round(kmh)} KM/H`, 30, 230);
  ctx.fillStyle = "#9fb4c8";
  ctx.font = "28px monospace";
  ctx.fillText(sector, 30, 272);
  texture.needsUpdate = true;
}

/** Pit-roof video screen, facing the main grandstand, showing live timing for the current lap. */
export function BigScreen({ layout, engine }: { layout: Layout; engine: Engine }) {
  const canvas = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 288;
    return c;
  }, []);
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [canvas]);
  const last = useRef("");
  useFrame(() => {
    const s = engine.sim.state;
    const key = `${s.tick}|${Math.round(Math.abs(s.car.speed) * 3.6)}|${s.nextGate}|${s.lapTicks}`;
    if (key === last.current) return;
    last.current = key;
    drawScreen(canvas, texture, s.tick, Math.abs(s.car.speed) * 3.6, s.lapTicks !== null ? "FINISH" : `SECTOR ${s.nextGate === 0 ? 8 : s.nextGate}/8`);
  });
  const sp = layout.screen;
  if (!sp) return null;
  return (
    <group position={[sp.x, sp.y ?? 13, sp.z]} rotation={[0, sp.rot, 0]}>
      <mesh castShadow>
        <boxGeometry args={[0.6, 8.2, 14.4]} />
        <meshStandardMaterial attach="material-0" map={texture} emissive="#ffffff" emissiveMap={texture} emissiveIntensity={0.9} />
        <meshStandardMaterial attach="material-1" map={texture} emissive="#ffffff" emissiveMap={texture} emissiveIntensity={0.9} />
        <meshStandardMaterial attach="material-2" color="#15181d" />
        <meshStandardMaterial attach="material-3" color="#15181d" />
        <meshStandardMaterial attach="material-4" color="#15181d" />
        <meshStandardMaterial attach="material-5" color="#15181d" />
      </mesh>
      {[-5, 5].map((z) => (
        <mesh key={z} position={[0, -2.6, z]}>
          <boxGeometry args={[0.4, 3, 0.4]} />
          <meshStandardMaterial color="#8a939c" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

const TRUCK_COLORS = ["#c8322b", "#1d3f7a", "#f2c230", "#1d1f24", "#3f9b4a", "#e0701e"];

export function Paddock({ layout }: { layout: Layout }) {
  return (
    <group>
      {layout.trucks.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]} rotation={[0, t.rot, 0]}>
          <mesh position={[0, 2.2, -1]} castShadow receiveShadow>
            <boxGeometry args={[2.5, 3.6, 12]} />
            <meshStandardMaterial color={TRUCK_COLORS[(t.y ?? 0) % TRUCK_COLORS.length]} metalness={0.3} roughness={0.4} />
          </mesh>
          <mesh position={[0, 1.9, 6.3]} castShadow>
            <boxGeometry args={[2.4, 2.9, 2.4]} />
            <meshStandardMaterial color="#e9ecef" metalness={0.3} roughness={0.4} />
          </mesh>
          <mesh position={[0, 2.4, 7.52]}>
            <boxGeometry args={[2.1, 1.1, 0.04]} />
            <meshStandardMaterial color="#1c2a3a" metalness={0.9} roughness={0.1} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** An irregular lake with a sandy shore and reeds of trees nearby (trees already avoid it). */
export function Lake({ layout }: { layout: Layout }) {
  const shapes = useMemo(() => {
    const l = layout.lake;
    if (!l) return null;
    const rand = mulberry32(hashString(`${l.x},${l.z}`));
    const wobble = Array.from({ length: 5 }, () => [rand() * 0.12, 1 + Math.floor(rand() * 4), rand() * 6] as const);
    const shape = (grow: number) => {
      const sh = new THREE.Shape();
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        let r = l.r + grow;
        for (const [amp, freq, ph] of wobble) r *= 1 + amp * Math.sin(a * freq + ph);
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) sh.moveTo(x, y);
        else sh.lineTo(x, y);
      }
      return new THREE.ShapeGeometry(sh, 1);
    };
    return { water: shape(0), shore: shape(4) };
  }, [layout]);
  const l = layout.lake;
  if (!l || !shapes) return null;
  return (
    <group position={[l.x, 0, l.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh geometry={shapes.shore} position={[0, 0, 0.015]} receiveShadow>
        <meshStandardMaterial color="#b9a987" roughness={1} />
      </mesh>
      <mesh geometry={shapes.water} position={[0, 0, 0.03]}>
        <meshPhysicalMaterial color="#2f607e" roughness={0.06} metalness={0.1} clearcoat={1} clearcoatRoughness={0.05} envMapIntensity={1.4} />
      </mesh>
    </group>
  );
}
