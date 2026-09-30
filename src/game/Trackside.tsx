"use client";

// Scenery only. Nothing here affects the sim.
import { useMemo } from "react";
import { hashString, mulberry32 } from "@/sim/rng";
import type { Track } from "@/sim";
import { clearance, KERB, type Layout } from "./layout";
import { ADS, adTexture } from "./textures";

/** Right-hand normal of the track at i (tangent (0,1) -> (-1,0)). */
function side(track: Track, i: number, off: number) {
  const p = track.points[i];
  const t = track.tangents[i];
  return { x: p.x - t.z * off, z: p.z + t.x * off };
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

/** Billboards angled toward oncoming cars, near each checkpoint. */
export function Billboards({ track, layout }: { track: Track; layout: Layout }) {
  const boards = useMemo(() => {
    const n = track.points.length;
    const out: { x: number; z: number; rot: number; ad: number }[] = [];
    track.gates.forEach((_, g) => {
      if (g === 0) return;
      const i = (Math.round((g * n) / track.gates.length) + 10) % n;
      const s = g % 2 ? 1 : -1;
      const p = side(track, i, s * (track.halfWidth + KERB + 9));
      if (clearance(track, p.x, p.z) < track.halfWidth + 6) return;
      if (layout.reserved.some((r) => (r.x - p.x) ** 2 + (r.z - p.z) ** 2 < (r.r + 6) ** 2)) return;
      const t = track.tangents[i];
      // Face back toward approaching cars and in toward the road.
      const nx = -t.x * 0.6 + t.z * s * 0.8;
      const nz = -t.z * 0.6 - t.x * s * 0.8;
      out.push({ ...p, rot: Math.atan2(nx, nz), ad: g % ADS.length });
    });
    return out;
  }, [track, layout]);

  const textures = useMemo(() => ADS.map((_, i) => adTexture(i)), []);

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
