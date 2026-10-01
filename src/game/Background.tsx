"use client";

// The world beyond the circuit: a low-rise town, apartment blocks, power pylons with sagging lines,
// and far hazy ridges. Rendering only.
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { hashString, mulberry32 } from "@/sim/rng";
import type { Track } from "@/sim";
import type { HeightFn } from "./terrain";

interface Placed {
  x: number;
  /** Base height (roofs sit on their walls). */
  y?: number;
  z: number;
  rot: number;
  w: number;
  h: number;
  d: number;
  color: THREE.Color;
}

function trackExtent(track: Track) {
  let cx = 0;
  let cz = 0;
  for (const p of track.points) {
    cx += p.x;
    cz += p.z;
  }
  cx /= track.points.length;
  cz /= track.points.length;
  let r = 0;
  for (const p of track.points) r = Math.max(r, Math.hypot(p.x - cx, p.z - cz));
  return { cx, cz, r };
}

/** Smooth-ish 2D value noise for grouping houses into neighbourhoods with fields between. */
function blobs(x: number, z: number) {
  return Math.sin(x * 0.006 + 1.3) * Math.sin(z * 0.0071 + 0.4) + 0.5 * Math.sin((x - z) * 0.013 + 2.1);
}

function Instances({ items, geometry, material, cast = true }: { items: Placed[]; geometry: THREE.BufferGeometry; material: THREE.Material; cast?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    items.forEach((it, i) => {
      q.setFromAxisAngle(up, it.rot);
      m.compose(new THREE.Vector3(it.x, it.y ?? 0, it.z), q, new THREE.Vector3(it.w, it.h, it.d));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, it.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  if (items.length === 0) return null;
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} castShadow={cast} receiveShadow />;
}

const WALLS = ["#eeeae2", "#e2ddd2", "#d6d3cc", "#f3f1ec", "#c9c3b8", "#d9cfc0", "#bfc4c8"];
const ROOFS = ["#3d4655", "#4a5160", "#5a4a42", "#2f3a4a", "#6b3b32", "#56606b", "#3a3f46"];
const BLOCKS = ["#e6e3dc", "#d3d6d9", "#c9ccc9", "#ecebe6", "#b8bec4"];

export function Town({ track, height }: { track: Track; height: HeightFn }) {
  const { houses, roofs, blocks } = useMemo(() => {
    const rand = mulberry32(hashString(track.seed + ":town"));
    const { cx, cz, r } = trackExtent(track);
    const inner = r + 140;
    const outer = r + 1100;
    const houses: Placed[] = [];
    const roofs: Placed[] = [];
    const blocks: Placed[] = [];
    const c = (list: string[]) => new THREE.Color(list[Math.floor(rand() * list.length)]);
    for (let tries = 0; tries < 30000 && houses.length < 3200; tries++) {
      const a = rand() * Math.PI * 2;
      const d = inner + Math.sqrt(rand()) * (outer - inner);
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (blobs(x, z) < 0.05) continue; // leave fields between neighbourhoods
      // Streets run roughly on a grid, so align houses to one of two directions.
      const rot = (Math.floor(rand() * 2) * Math.PI) / 2 + 0.35;
      if (rand() < 0.03) {
        blocks.push({ x, y: height(x, z) - 1, z, rot, w: 14 + rand() * 12, h: 12 + rand() * 22, d: 10 + rand() * 5, color: c(BLOCKS) });
        continue;
      }
      const w = 7 + rand() * 5;
      const dd = 7 + rand() * 4;
      const h = 4 + rand() * 3.5;
      // Sink the base 1 m so houses on a slope never float.
      const y = height(x, z) - 1;
      houses.push({ x, y, z, rot, w, h: h + 1, d: dd, color: c(WALLS) });
      roofs.push({ x, y: y + h + 1, z, rot, w: w + 0.8, h: 1.6 + rand() * 0.8, d: dd + 0.8, color: c(ROOFS) });
    }
    return { houses, roofs, blocks };
  }, [track, height]);

  const unitBox = useMemo(() => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), []);
  // Hip roof: a squashed 4-sided pyramid.
  const roofGeo = useMemo(() => new THREE.ConeGeometry(0.72, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0), []);
  const wallMat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.9 }), []);
  const roofMat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 }), []);

  return (
    <group>
      <Instances items={houses} geometry={unitBox} material={wallMat} />
      <Instances items={roofs} geometry={roofGeo} material={roofMat} />
      <Instances items={blocks} geometry={unitBox} material={wallMat} />
    </group>
  );
}

/** Lattice-ish transmission tower, ~32 m tall, arms along local x. */
function pylonGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const H = 32;
  // Four tapered legs leaning in.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = new THREE.CylinderGeometry(0.12, 0.2, H, 4);
      leg.rotateZ(sx * -0.09);
      leg.rotateX(sz * 0.09);
      leg.translate(sx * 1.45, H / 2, sz * 1.45);
      parts.push(leg);
    }
  // Cross bracing rings and three cross-arms.
  for (let k = 1; k < 7; k++) {
    const y = (k / 7) * H;
    const w = 3.2 * (1 - (0.75 * k) / 7);
    for (const rot of [0, Math.PI / 2]) parts.push(new THREE.BoxGeometry(w, 0.12, 0.12).rotateY(rot).translate(0, y, 0));
  }
  for (const [y, w] of [
    [H * 0.62, 12],
    [H * 0.77, 10],
    [H * 0.92, 8],
  ])
    parts.push(new THREE.BoxGeometry(w, 0.35, 0.35).translate(0, y, 0));
  parts.push(new THREE.CylinderGeometry(0.05, 0.1, 3, 4).translate(0, H + 1.5, 0));
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

export function Pylons({ track, height }: { track: Track; height: HeightFn }) {
  const { towers, wires } = useMemo(() => {
    const rand = mulberry32(hashString(track.seed + ":pylons"));
    const { cx, cz, r } = trackExtent(track);
    // A straight power line crossing the landscape outside the circuit.
    const a = rand() * Math.PI * 2;
    const off = r + 180 + rand() * 120;
    const ox = cx + Math.cos(a) * off;
    const oz = cz + Math.sin(a) * off;
    const dx = -Math.sin(a);
    const dz = Math.cos(a);
    const towers: { x: number; y: number; z: number; rot: number }[] = [];
    for (let k = -8; k <= 8; k++) {
      const x = ox + dx * k * 110;
      const z = oz + dz * k * 110;
      towers.push({ x, y: height(x, z) - 0.5, z, rot: Math.atan2(dx, dz) }); // arms (local x) across the line
    }
    // Sagging wires between arm tips.
    const pts: number[] = [];
    const arms: [number, number][] = [
      [-6, 32 * 0.62],
      [6, 32 * 0.62],
      [-5, 32 * 0.77],
      [5, 32 * 0.77],
      [-4, 32 * 0.92],
      [4, 32 * 0.92],
    ];
    for (let k = 0; k < towers.length - 1; k++) {
      const t0 = towers[k];
      const t1 = towers[k + 1];
      for (const [ax, ay] of arms) {
        // Arm offset is along the tower's local x = perpendicular to the line direction.
        const px = Math.cos(a) * ax;
        const pz = Math.sin(a) * ax;
        const N = 12;
        for (let j = 0; j < N; j++) {
          for (const u of [j / N, (j + 1) / N]) {
            const sag = 4 * u * (1 - u) * 3.5;
            pts.push(t0.x + (t1.x - t0.x) * u + px, t0.y + (t1.y - t0.y) * u + ay - sag, t0.z + (t1.z - t0.z) * u + pz);
          }
        }
      }
    }
    const wires = new THREE.BufferGeometry();
    wires.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return { towers, wires };
  }, [track, height]);
  const geometry = useMemo(() => pylonGeometry(), []);
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    towers.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
      m.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [towers]);
  return (
    <group>
      <instancedMesh ref={ref} args={[geometry, undefined, towers.length]} castShadow>
        <meshStandardMaterial color="#8c949b" metalness={0.6} roughness={0.5} />
      </instancedMesh>
      <lineSegments geometry={wires}>
        <lineBasicMaterial color="#3a3f45" transparent opacity={0.7} />
      </lineSegments>
    </group>
  );
}

/** Low, far ridges on the horizon; the fog turns them blue-grey. */
export function Ridges({ track }: { track: Track }) {
  const ridges = useMemo(() => {
    const rand = mulberry32(hashString(track.seed + ":ridges"));
    const { cx, cz } = trackExtent(track);
    return Array.from({ length: 26 }, (_, i) => {
      const a = (i / 26) * Math.PI * 2 + rand() * 0.2;
      const d = 1700 + rand() * 400;
      return { x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d, r: 260 + rand() * 200, h: 0.12 + rand() * 0.14 };
    });
  }, [track]);
  return (
    <group>
      {ridges.map((h, i) => (
        <mesh key={i} position={[h.x, -3, h.z]} scale={[h.r, h.r * h.h, h.r]}>
          <sphereGeometry args={[1, 32, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#4f6f4a" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}
