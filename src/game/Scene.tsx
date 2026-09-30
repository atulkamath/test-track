"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { hashString, mulberry32 } from "@/sim/rng";
import type { Track } from "@/sim";

const KERB_WIDTH = 1.2;

/**
 * Strip between `inner` and `outer` offsets from the centreline. Non-indexed so each quad can have its own colour.
 * UVs: u runs 0..1 across the strip, v runs along the track in units of `vTile` world units.
 */
function stripGeometry(
  track: Track,
  inner: number,
  outer: number,
  y: number,
  colorOf?: (i: number) => THREE.Color,
  vTile = 14,
) {
  const { points, tangents } = track;
  const n = points.length;
  const step = track.length / n;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const edge = (i: number, off: number) => {
    const p = points[i % n];
    const t = tangents[i % n];
    return [p.x - t.z * off, y, p.z + t.x * off];
  };
  for (let i = 0; i < n; i++) {
    const v0 = (i * step) / vTile;
    const v1 = ((i + 1) * step) / vTile;
    const a0 = { p: edge(i, inner), uv: [0, v0] };
    const a1 = { p: edge(i, outer), uv: [1, v0] };
    const b0 = { p: edge(i + 1, inner), uv: [0, v1] };
    const b1 = { p: edge(i + 1, outer), uv: [1, v1] };
    // Winding chosen so faces point up (+y) whichever side of the centreline the strip is on.
    const tri = outer > inner ? [a0, a1, b0, a1, b1, b0] : [a0, b0, a1, a1, b0, b1];
    for (const v of tri) {
      pos.push(...v.p);
      uv.push(...v.uv);
    }
    if (colorOf) {
      const c = colorOf(i);
      for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  if (colorOf) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Procedural noise texture (seeded, so it looks the same every load). */
function noiseTexture(base: string, specks: string[], count: number, seed: number, repeat: number) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const rand = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  for (let k = 0; k < count; k++) {
    ctx.fillStyle = specks[Math.floor(rand() * specks.length)];
    ctx.globalAlpha = 0.25 + rand() * 0.5;
    const s = rand() < 0.9 ? 1 : 2;
    ctx.fillRect(Math.floor(rand() * 256), Math.floor(rand() * 256), s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function Road({ track }: { track: Track }) {
  const hw = track.halfWidth;
  const { road, kerbs, lines, tarmac } = useMemo(() => {
    const red = new THREE.Color("#d63a2f");
    const white = new THREE.Color("#f2f2f2");
    const kerbColor = (i: number) => (Math.floor(i / 2) % 2 ? red : white);
    const kerbs = [stripGeometry(track, hw, hw + KERB_WIDTH, 0.03, kerbColor), stripGeometry(track, -hw, -hw - KERB_WIDTH, 0.03, kerbColor)];
    const lines = [stripGeometry(track, hw - 0.7, hw - 0.4, 0.025), stripGeometry(track, -hw + 0.7, -hw + 0.4, 0.025)];
    const tarmac = noiseTexture("#50545a", ["#2b2e33", "#6c7076", "#3b3f44", "#7d8187"], 9000, 11, 1);
    return { road: stripGeometry(track, -hw, hw, 0.02), kerbs, lines, tarmac };
  }, [track, hw]);

  return (
    <group>
      <mesh geometry={road} receiveShadow>
        <meshStandardMaterial map={tarmac} roughness={0.9} />
      </mesh>
      {kerbs.map((g, i) => (
        <mesh key={i} geometry={g} receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.8} />
        </mesh>
      ))}
      {lines.map((g, i) => (
        <mesh key={i} geometry={g} receiveShadow>
          <meshStandardMaterial color="#f4f4f4" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

export function FinishLine({ track }: { track: Track }) {
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 16;
    const ctx = c.getContext("2d")!;
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 2; y++) {
        ctx.fillStyle = (x + y) % 2 ? "#111" : "#fff";
        ctx.fillRect(x * 8, y * 8, 8, 8);
      }
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  const p = track.points[0];
  const t = track.tangents[0];
  const width = track.halfWidth * 2;
  const angle = Math.atan2(t.x, t.z);
  const postOffset = track.halfWidth + 2.2;
  return (
    <group position={[p.x, 0, p.z]} rotation={[0, angle, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <planeGeometry args={[width, 2]} />
        <meshStandardMaterial map={texture} />
      </mesh>
      {/* Gantry */}
      {[-postOffset, postOffset].map((x) => (
        <mesh key={x} position={[x, 3, 0]} castShadow>
          <boxGeometry args={[0.5, 6, 0.5]} />
          <meshStandardMaterial color="#e8e8e8" />
        </mesh>
      ))}
      <mesh position={[0, 6.2, 0]} castShadow>
        <boxGeometry args={[postOffset * 2 + 0.5, 1.2, 0.4]} />
        <meshStandardMaterial map={texture} />
      </mesh>
    </group>
  );
}

/** Cones on alternating sides, plus a post at each checkpoint gate. */
export function Cones({ track }: { track: Track }) {
  const cones = useMemo(() => {
    const out: [number, number][] = [];
    const { points, tangents, halfWidth } = track;
    for (let i = 6; i < points.length - 3; i += 7) {
      const side = Math.floor(i / 7) % 2 ? 1 : -1;
      const off = side * (halfWidth + KERB_WIDTH + 1.5);
      out.push([points[i].x - tangents[i].z * off, points[i].z + tangents[i].x * off]);
    }
    return out;
  }, [track]);
  return (
    <group>
      {cones.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 0.45, 0]} castShadow>
            <coneGeometry args={[0.35, 0.9, 12]} />
            <meshStandardMaterial color="#ff7a1a" />
          </mesh>
          <mesh position={[0, 0.03, 0]}>
            <boxGeometry args={[0.8, 0.06, 0.8]} />
            <meshStandardMaterial color="#222" />
          </mesh>
        </group>
      ))}
      {track.gates.slice(1).map((g, i) => (
        <group key={`g${i}`}>
          {[g.a, g.b].map((p, k) => {
            // Posts sit just outside the kerb, not at the far gate ends.
            const cx = (g.a.x + g.b.x) / 2;
            const cz = (g.a.z + g.b.z) / 2;
            const f = (track.halfWidth + KERB_WIDTH + 0.6) / (track.halfWidth * 2.5);
            return (
              <mesh key={k} position={[cx + (p.x - cx) * f, 1.2, cz + (p.z - cz) * f]} castShadow>
                <cylinderGeometry args={[0.18, 0.18, 2.4, 8]} />
                <meshStandardMaterial color="#2f7df6" emissive="#1a4fb0" emissiveIntensity={0.3} />
              </mesh>
            );
          })}
        </group>
      ))}
    </group>
  );
}

export function Ground() {
  const grass = useMemo(() => noiseTexture("#5f9442", ["#4c7d35", "#6fa64d", "#557f3a", "#78ad55"], 14000, 23, 250), []);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[3000, 3000]} />
      <meshStandardMaterial map={grass} roughness={1} />
    </mesh>
  );
}


/** Scenery only (not part of the sim): trees scattered off the road, seeded so the layout is stable per track. */
export function Trees({ track }: { track: Track }) {
  const { trunks, crowns } = useMemo(() => {
    const rand = mulberry32(hashString(track.seed + ":trees"));
    const clear = track.halfWidth + 9;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const trunkMats: THREE.Matrix4[] = [];
    const crownMats: THREE.Matrix4[] = [];
    for (let tries = 0; tries < 2000 && trunkMats.length < 320; tries++) {
      const x = (rand() - 0.5) * 900;
      const z = (rand() - 0.5) * 900;
      if (track.points.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < clear * clear)) continue;
      if ((track.points[0].x - x) ** 2 + (track.points[0].z - z) ** 2 < 55 * 55) continue; // grandstand area
      const s = 0.7 + rand() * 0.9;
      trunkMats.push(m.compose(new THREE.Vector3(x, 1.2 * s, z), q, new THREE.Vector3(s, s, s)).clone());
      crownMats.push(m.compose(new THREE.Vector3(x, 4.2 * s, z), q, new THREE.Vector3(s, s, s)).clone());
    }
    return { trunks: trunkMats, crowns: crownMats };
  }, [track]);

  const setMatrices = (mats: THREE.Matrix4[]) => (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return;
    mats.forEach((mat, i) => mesh.setMatrixAt(i, mat));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  };

  return (
    <group>
      <instancedMesh ref={setMatrices(trunks)} args={[undefined, undefined, trunks.length]} castShadow>
        <cylinderGeometry args={[0.25, 0.35, 2.4, 6]} />
        <meshStandardMaterial color="#6b4a2b" />
      </instancedMesh>
      <instancedMesh ref={setMatrices(crowns)} args={[undefined, undefined, crowns.length]} castShadow>
        <coneGeometry args={[1.8, 5, 7]} />
        <meshStandardMaterial color="#2f6b3a" flatShading />
      </instancedMesh>
    </group>
  );
}
