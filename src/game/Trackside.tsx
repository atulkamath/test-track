"use client";

// Scenery only. Nothing here affects the sim.
import { useMemo } from "react";
import * as THREE from "three";
import { hashString, mulberry32 } from "@/sim/rng";
import type { Track } from "@/sim";

const KERB = 1.2;

/** Right-hand normal of the track at i (tangent (0,1) -> (-1,0)). */
function side(track: Track, i: number, off: number) {
  const p = track.points[i];
  const t = track.tangents[i];
  return { x: p.x - t.z * off, z: p.z + t.x * off };
}

function clearance(track: Track, x: number, z: number): number {
  let best = Infinity;
  for (const p of track.points) best = Math.min(best, (p.x - x) ** 2 + (p.z - z) ** 2);
  return Math.sqrt(best);
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Hazy low-poly mountains ringing the horizon. */
export function Mountains({ track }: { track: Track }) {
  const peaks = useMemo(() => {
    const rand = mulberry32(hashString(track.seed + ":mountains"));
    return Array.from({ length: 30 }, (_, i) => {
      const a = (i / 30) * Math.PI * 2 + rand() * 0.15;
      const r = 950 + rand() * 300;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r, h: 160 + rand() * 260, w: 220 + rand() * 160, rot: rand() * 6 };
    });
  }, [track]);
  return (
    <group>
      {peaks.map((m, i) => (
        <mesh key={i} position={[m.x, m.h / 2 - 5, m.z]} rotation={[0, m.rot, 0]}>
          <coneGeometry args={[m.w, m.h, 6]} />
          <meshStandardMaterial color={i % 3 ? "#6f8499" : "#7b8fa2"} flatShading roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

/** Tyre stacks on the outside of every real corner. */
export function TyreWalls({ track }: { track: Track }) {
  const stacks = useMemo(() => {
    const { tangents } = track;
    const n = tangents.length;
    const out: { x: number; z: number; band: boolean }[] = [];
    for (let i = 0; i < n; i += 2) {
      const a = tangents[(i - 8 + n) % n];
      const b = tangents[(i + 8) % n];
      const turn = a.x * b.z - a.z * b.x; // < 0: left turn, outside is the right (+normal) side
      if (Math.abs(turn) < 0.22) continue;
      const s = turn < 0 ? 1 : -1;
      const p = side(track, i, s * (track.halfWidth + KERB + 5));
      if (clearance(track, p.x, p.z) < track.halfWidth + 4) continue;
      out.push({ ...p, band: (i / 2) % 2 === 0 });
    }
    return out;
  }, [track]);

  const count = stacks.length * 3;
  const setup = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const black = new THREE.Color("#1b1b1b");
    const red = new THREE.Color("#c8322b");
    const white = new THREE.Color("#eeeeee");
    stacks.forEach((s, k) => {
      for (let j = 0; j < 3; j++) {
        m.makeTranslation(s.x, 0.18 + j * 0.36, s.z);
        mesh.setMatrixAt(k * 3 + j, m);
        mesh.setColorAt(k * 3 + j, j === 2 ? (s.band ? red : white) : black);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  };

  if (count === 0) return null;
  return (
    <instancedMesh ref={setup} args={[undefined, undefined, count]} castShadow receiveShadow>
      <cylinderGeometry args={[0.55, 0.55, 0.34, 10]} />
      <meshStandardMaterial roughness={0.9} />
    </instancedMesh>
  );
}

/** Grandstand beside the start straight, on whichever side has room. */
export function Grandstand({ track }: { track: Track }) {
  const placement = useMemo(() => {
    for (const s of [1, -1]) {
      // Sample the footprint; every point must stay clear of the whole track.
      let ok = true;
      for (let d = 12; d <= 26 && ok; d += 3)
        for (let i = -10; i <= 10 && ok; i += 5) {
          const p = side(track, (i + track.points.length) % track.points.length, s * (track.halfWidth + d));
          if (clearance(track, p.x, p.z) < track.halfWidth + 3) ok = false;
        }
      if (ok) return s;
    }
    return null;
  }, [track]);

  const crowd = useMemo(
    () =>
      canvasTexture(256, 64, (ctx) => {
        const rand = mulberry32(7);
        ctx.fillStyle = "#5a6470";
        ctx.fillRect(0, 0, 256, 64);
        const colors = ["#e9e2d0", "#c8322b", "#2f6fd6", "#f2c230", "#222", "#fff", "#3f9b4a"];
        for (let k = 0; k < 900; k++) {
          ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
          ctx.fillRect(Math.floor(rand() * 128) * 2, Math.floor(rand() * 32) * 2, 2, 2);
        }
      }),
    [],
  );

  if (placement === null) return null;
  const p = track.points[0];
  const t = track.tangents[0];
  const angle = Math.atan2(t.x, t.z);
  // Local frame: +z along the track; right normal is -x.
  const dir = -placement;
  const tiers = 6;
  const base = track.halfWidth + 13;
  return (
    <group position={[p.x, 0, p.z]} rotation={[0, angle, 0]}>
      {Array.from({ length: tiers }, (_, k) => (
        <mesh key={k} position={[dir * (base + k * 2), ((k + 1) * 0.9) / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[2, (k + 1) * 0.9, 40]} />
          <meshStandardMaterial map={crowd} roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[dir * (base + tiers - 1), tiers * 0.9 + 3.2, 0]} castShadow>
        <boxGeometry args={[tiers * 2 + 3, 0.4, 42]} />
        <meshStandardMaterial color="#e9edf2" />
      </mesh>
      {[-20, 0, 20].map((z) => (
        <mesh key={z} position={[dir * (base + tiers * 2 - 0.5), (tiers * 0.9 + 3.2) / 2, z]}>
          <boxGeometry args={[0.4, tiers * 0.9 + 3.2, 0.4]} />
          <meshStandardMaterial color="#9aa3ad" />
        </mesh>
      ))}
    </group>
  );
}

// Invented sponsor names only; no real brands.
const ADS: [string, string, string][] = [
  ["DAILY LAP", "#c8322b", "#ffffff"],
  ["APEX FUEL", "#f2c230", "#15181d"],
  ["GRIPLINE", "#15181d", "#f2c230"],
  ["REDLINE", "#ffffff", "#c8322b"],
  ["TARMAC CO.", "#2f6fd6", "#ffffff"],
];

/** Billboards angled toward oncoming cars, near each checkpoint. */
export function Billboards({ track }: { track: Track }) {
  const boards = useMemo(() => {
    const n = track.points.length;
    const out: { x: number; z: number; rot: number; ad: number }[] = [];
    track.gates.forEach((_, g) => {
      if (g === 0) return;
      const i = (Math.round((g * n) / track.gates.length) + 10) % n;
      const s = g % 2 ? 1 : -1;
      const p = side(track, i, s * (track.halfWidth + KERB + 9));
      if (clearance(track, p.x, p.z) < track.halfWidth + 6) return;
      const t = track.tangents[i];
      // Face back toward approaching cars and in toward the road.
      const nx = -t.x * 0.6 + t.z * s * 0.8;
      const nz = -t.z * 0.6 - t.x * s * 0.8;
      out.push({ ...p, rot: Math.atan2(nx, nz), ad: g % ADS.length });
    });
    return out;
  }, [track]);

  const textures = useMemo(
    () =>
      ADS.map(([text, bg, fg]) =>
        canvasTexture(512, 128, (ctx) => {
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, 512, 128);
          ctx.fillStyle = fg;
          ctx.font = "italic 800 76px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(text, 256, 68);
        }),
      ),
    [],
  );

  return (
    <group>
      {boards.map((b, k) => (
        <group key={k} position={[b.x, 0, b.z]} rotation={[0, b.rot, 0]}>
          <mesh position={[0, 3.2, 0]} castShadow>
            <boxGeometry args={[10, 2.5, 0.2]} />
            <meshStandardMaterial attach="material-0" color="#333" />
            <meshStandardMaterial attach="material-1" color="#333" />
            <meshStandardMaterial attach="material-2" color="#333" />
            <meshStandardMaterial attach="material-3" color="#333" />
            <meshStandardMaterial attach="material-4" map={textures[b.ad]} emissive="#ffffff" emissiveMap={textures[b.ad]} emissiveIntensity={0.25} />
            <meshStandardMaterial attach="material-5" color="#333" />
          </mesh>
          {[-4, 4].map((x) => (
            <mesh key={x} position={[x, 1, -0.2]}>
              <boxGeometry args={[0.25, 2, 0.25]} />
              <meshStandardMaterial color="#777" />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}
