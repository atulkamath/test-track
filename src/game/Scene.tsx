"use client";

import { forwardRef, useMemo } from "react";
import * as THREE from "three";
import type { Track } from "@/sim";

const KERB_WIDTH = 1.2;

/** Strip between `inner` and `outer` offsets from the centreline. Non-indexed so each quad can have its own colour. */
function stripGeometry(track: Track, inner: number, outer: number, y: number, colorOf?: (i: number) => THREE.Color) {
  const { points, tangents } = track;
  const n = points.length;
  const pos: number[] = [];
  const col: number[] = [];
  const edge = (i: number, off: number) => {
    const p = points[i % n];
    const t = tangents[i % n];
    return [p.x - t.z * off, y, p.z + t.x * off];
  };
  for (let i = 0; i < n; i++) {
    const a0 = edge(i, inner);
    const a1 = edge(i, outer);
    const b0 = edge(i + 1, inner);
    const b1 = edge(i + 1, outer);
    // Winding chosen so faces point up (+y) whichever side of the centreline the strip is on.
    const tri = outer > inner ? [a0, a1, b0, a1, b1, b0] : [a0, b0, a1, a1, b0, b1];
    for (const v of tri) pos.push(...v);
    if (colorOf) {
      const c = colorOf(i);
      for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  if (colorOf) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function Road({ track }: { track: Track }) {
  const hw = track.halfWidth;
  const { road, kerbs, line } = useMemo(() => {
    const red = new THREE.Color("#d63a2f");
    const white = new THREE.Color("#f2f2f2");
    const kerbColor = (i: number) => (Math.floor(i / 2) % 2 ? red : white);
    const kerbs = [stripGeometry(track, hw, hw + KERB_WIDTH, 0.03, kerbColor), stripGeometry(track, -hw, -hw - KERB_WIDTH, 0.03, kerbColor)];
    const dash = new THREE.Color("#ffffff");
    const gap = new THREE.Color("#3a3d42");
    const line = stripGeometry(track, -0.15, 0.15, 0.025, (i) => (Math.floor(i / 3) % 2 ? dash : gap));
    return { road: stripGeometry(track, -hw, hw, 0.02), kerbs, line };
  }, [track, hw]);

  return (
    <group>
      <mesh geometry={road} receiveShadow>
        <meshStandardMaterial color="#3a3d42" roughness={0.95} />
      </mesh>
      {kerbs.map((g, i) => (
        <mesh key={i} geometry={g} receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.8} />
        </mesh>
      ))}
      <mesh geometry={line}>
        <meshStandardMaterial vertexColors roughness={0.9} />
      </mesh>
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
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[3000, 3000]} />
      <meshStandardMaterial color="#5d8f45" roughness={1} />
    </mesh>
  );
}

/** Box car; front faces +z so rotation.y = heading angle. */
export const CarModel = forwardRef<THREE.Group>(function CarModel(_, ref) {
  return (
    <group ref={ref}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[1.8, 0.6, 3.8]} />
        <meshStandardMaterial color="#e63946" metalness={0.3} roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.05, -0.3]} castShadow>
        <boxGeometry args={[1.5, 0.5, 1.8]} />
        <meshStandardMaterial color="#1d2a3a" metalness={0.5} roughness={0.2} />
      </mesh>
      {[
        [-0.95, 1.25],
        [0.95, 1.25],
        [-0.95, -1.25],
        [0.95, -1.25],
      ].map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[x, 0.38, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.38, 0.38, 0.3, 16]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      ))}
    </group>
  );
});
