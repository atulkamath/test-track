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

/**
 * Procedural surface texture (seeded, so it looks the same every load): soft large-scale blotches for
 * natural variation, plus a faint fine grain so it doesn't look flat up close. Tiles seamlessly.
 */
function surfaceTexture(base: string, tones: string[], seed: number, repeat: number, grain: number) {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const rand = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  const blob = (x: number, y: number, r: number, color: string, alpha: number) => {
    // Draw wrapped copies so the texture tiles without seams.
    for (const dx of [-S, 0, S])
      for (const dy of [-S, 0, S]) {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        g.addColorStop(0, color);
        g.addColorStop(1, "transparent");
        ctx.globalAlpha = alpha;
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
  };
  for (let k = 0; k < 140; k++) blob(rand() * S, rand() * S, 30 + rand() * 110, tones[Math.floor(rand() * tones.length)], 0.18);
  for (let k = 0; k < 6000; k++) {
    ctx.globalAlpha = grain * (0.5 + rand() * 0.5);
    ctx.fillStyle = rand() < 0.5 ? "#000" : "#fff";
    ctx.fillRect(rand() * S, rand() * S, 1, 1);
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
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
    const tarmac = surfaceTexture("#4a4e54", ["#3c4046", "#565a60", "#44484e"], 11, 1, 0.05);
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

/** A blue post either side of the road at each checkpoint gate. */
export function GatePosts({ track }: { track: Track }) {
  return (
    <group>
      {track.gates.slice(1).map((g, i) => (
        <group key={i}>
          {[g.a, g.b].map((p, k) => {
            // Posts sit just outside the kerb, not at the far gate ends.
            const cx = (g.a.x + g.b.x) / 2;
            const cz = (g.a.z + g.b.z) / 2;
            const f = (track.halfWidth + KERB_WIDTH + 0.6) / (track.halfWidth * 2.5);
            return (
              <mesh key={k} position={[cx + (p.x - cx) * f, 1.2, cz + (p.z - cz) * f]} castShadow>
                <cylinderGeometry args={[0.18, 0.18, 2.4, 12]} />
                <meshStandardMaterial color="#2f7df6" emissive="#1a4fb0" emissiveIntensity={0.3} />
              </mesh>
            );
          })}
        </group>
      ))}
    </group>
  );
}

/** Mowed-stripe grass: broad alternating light/dark bands with soft variation, like a circuit's infield. */
function mowedGrassTexture() {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const rand = mulberry32(31);
  const bands = 8;
  for (let b = 0; b < bands; b++) {
    ctx.fillStyle = b % 2 ? "#5d9a3a" : "#4f8a31";
    ctx.fillRect((b * S) / bands, 0, S / bands, S);
  }
  // Soft blotches and fine grain so the stripes don't look painted on.
  for (let k = 0; k < 160; k++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 20 + rand() * 80;
    for (const dx of [-S, 0, S])
      for (const dy of [-S, 0, S]) {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        g.addColorStop(0, rand() < 0.5 ? "rgba(40,70,25,0.12)" : "rgba(140,170,80,0.10)");
        g.addColorStop(1, "transparent");
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
  }
  for (let k = 0; k < 9000; k++) {
    ctx.fillStyle = rand() < 0.5 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.05)";
    ctx.fillRect(rand() * S, rand() * S, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(60, 60); // ~6 m wide stripes
  t.center.set(0.5, 0.5);
  t.rotation = 0.6;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

export function Ground() {
  const grass = useMemo(() => mowedGrassTexture(), []);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[3000, 3000]} />
      <meshStandardMaterial map={grass} roughness={1} />
    </mesh>
  );
}

/** Green-painted asphalt run-off just beyond the kerbs (gravel traps draw over it on corners). */
export function RunOff({ track }: { track: Track }) {
  const geos = useMemo(() => {
    const hw = track.halfWidth;
    return [stripGeometry(track, hw + KERB_WIDTH, hw + KERB_WIDTH + 1.6, 0.011), stripGeometry(track, -hw - KERB_WIDTH, -hw - KERB_WIDTH - 1.6, 0.011)];
  }, [track]);
  return (
    <group>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} receiveShadow>
          <meshStandardMaterial color="#2f8a5a" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

/** Round broadleaf trees and a few conifers, grouped into clumps and tree lines. Scenery only. */
export function Trees({ track, reserved }: { track: Track; reserved: { x: number; z: number; r: number }[] }) {
  const { trunks, round, conifer } = useMemo(() => {
    const rand = mulberry32(hashString(track.seed + ":trees"));
    // Clear of the road, run-off, gravel and tyre walls.
    const clear = track.halfWidth + 24;
    const clump = (x: number, z: number) => Math.sin(x * 0.021 + 0.7) * Math.sin(z * 0.017 + 1.9) + 0.6 * Math.sin((x + z) * 0.009);
    const trunks: THREE.Matrix4[] = [];
    const round: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    const conifer: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    const q = new THREE.Quaternion();
    const greens = ["#3f7a34", "#4a8a3a", "#355f2c", "#5a8f3e", "#2f5a2a"];
    for (let tries = 0; tries < 20000 && trunks.length < 1800; tries++) {
      const x = (rand() - 0.5) * 1500;
      const z = (rand() - 0.5) * 1500;
      if (clump(x, z) < 0.35) continue;
      if (reserved.some((r) => (r.x - x) ** 2 + (r.z - z) ** 2 < r.r * r.r)) continue;
      if (track.points.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < clear * clear)) continue;
      const s = 0.8 + rand() * 0.8;
      const color = new THREE.Color(greens[Math.floor(rand() * greens.length)]);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
      trunks.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 1.5 * s, z), q, new THREE.Vector3(s, s, s)));
      if (rand() < 0.75) {
        const w = s * (0.9 + rand() * 0.4);
        round.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, 4.6 * s, z), q, new THREE.Vector3(w, s * (0.8 + rand() * 0.3), w)), c: color });
      } else {
        conifer.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, 5 * s, z), q, new THREE.Vector3(s, s, s)), c: color });
      }
    }
    return { trunks, round, conifer };
  }, [track, reserved]);

  const fill = (items: { m: THREE.Matrix4; c?: THREE.Color }[]) => (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return;
    items.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      if (it.c) mesh.setColorAt(i, it.c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  };

  return (
    <group>
      <instancedMesh ref={fill(trunks.map((m) => ({ m })))} args={[undefined, undefined, trunks.length]} castShadow>
        <cylinderGeometry args={[0.22, 0.32, 3, 8]} />
        <meshStandardMaterial color="#5e452e" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={fill(round)} args={[undefined, undefined, round.length]} castShadow receiveShadow>
        <icosahedronGeometry args={[2.9, 1]} />
        <meshStandardMaterial roughness={0.9} flatShading />
      </instancedMesh>
      <instancedMesh ref={fill(conifer)} args={[undefined, undefined, conifer.length]} castShadow receiveShadow>
        <coneGeometry args={[2, 6.5, 12]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
    </group>
  );
}
