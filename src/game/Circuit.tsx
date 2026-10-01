"use client";

// Circuit set dressing: grandstands, pits, fences, timing tower, Ferris wheel, flags, gravel, hills.
// Rendering only; nothing here affects the sim.
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Track } from "@/sim";
import { GRAVEL_WIDTH } from "@/sim";
import { useGLTF } from "@react-three/drei";
import { KERB, type Box, type BoxKind, type Layout } from "./layout";
import { pbr, worldMapped } from "./materials";
import { ADS, adTexture, crowdTexture, fenceTexture, garageTexture, towerTexture } from "./textures";

function useMaterials() {
  return useMemo(() => {
    const concrete = pbr("concrete");
    const asphalt = pbr("asphalt");
    const m: Record<string, THREE.Material> = {
      crowd: new THREE.MeshStandardMaterial({ map: crowdTexture(), roughness: 0.95 }),
      // Scanned concrete, sampled in world space so stretched boxes don't smear it.
      concrete: worldMapped(new THREE.MeshStandardMaterial({ map: concrete.map, roughnessMap: concrete.roughnessMap, color: "#d9dcde", roughness: 1 }), 4, "concrete"),
      roof: new THREE.MeshStandardMaterial({ color: "#f4f6f8", roughness: 0.45, metalness: 0.15 }),
      steel: new THREE.MeshStandardMaterial({ color: "#8a939c", roughness: 0.4, metalness: 0.6 }),
      glass: new THREE.MeshStandardMaterial({ color: "#24384d", roughness: 0.08, metalness: 0.9, envMapIntensity: 1.6 }),
      garage: new THREE.MeshStandardMaterial({ map: garageTexture(), roughness: 0.7 }),
      fence: new THREE.MeshStandardMaterial({ map: fenceTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 }),
      asphalt: worldMapped(new THREE.MeshStandardMaterial({ map: asphalt.map, roughnessMap: asphalt.roughnessMap, color: "#b9bcc0", roughness: 1 }), 3.5, "asphalt"),
      berm: worldMapped(new THREE.MeshStandardMaterial({ map: pbr("grass").map, color: "#e6f0d8", roughness: 1 }), 3, "berm"),
      marshal: new THREE.MeshStandardMaterial({ color: "#f07a1a", roughness: 0.6 }),
    };
    ADS.forEach((_, i) => {
      const map = adTexture(i);
      m[`ad${i}`] = new THREE.MeshStandardMaterial({ map, emissive: "#ffffff", emissiveMap: map, emissiveIntensity: 0.2 });
    });
    return m;
  }, []);
}

function InstancedBoxes({ boxes, material, castShadow }: { boxes: Box[]; material: THREE.Material; castShadow: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler(0, 0, 0, "YZX");
    boxes.forEach((b, i) => {
      q.setFromEuler(e.set(0, b.rot, b.tilt ?? 0, "YZX"));
      m.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.sx, b.sy, b.sz));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [boxes]);
  return (
    <instancedMesh ref={ref} args={[undefined, material, boxes.length]} castShadow={castShadow} receiveShadow>
      <boxGeometry />
    </instancedMesh>
  );
}

export function CircuitBoxes({ layout }: { layout: Layout }) {
  const materials = useMaterials();
  const byKind = useMemo(() => {
    const groups = new Map<BoxKind, Box[]>();
    for (const b of layout.boxes) groups.set(b.kind, [...(groups.get(b.kind) ?? []), b]);
    return [...groups.entries()];
  }, [layout]);
  return (
    <group>
      {byKind.map(([kind, boxes]) => (
        <InstancedBoxes key={kind} boxes={boxes} material={materials[kind]} castShadow={kind !== "fence" && kind !== "asphalt" && kind !== "berm"} />
      ))}
    </group>
  );
}

export function TimingTower({ layout, seed }: { layout: Layout; seed: string }) {
  const map = useMemo(() => towerTexture(seed), [seed]);
  const t = layout.tower;
  if (!t) return null;
  return (
    <group position={[t.x, 0, t.z]} rotation={[0, t.rot, 0]}>
      <mesh position={[0, 12, 0]} castShadow>
        <boxGeometry args={[2.4, 24, 2.4]} />
        <meshStandardMaterial attach="material-0" map={map} emissive="#ffffff" emissiveMap={map} emissiveIntensity={0.6} />
        <meshStandardMaterial attach="material-1" map={map} emissive="#ffffff" emissiveMap={map} emissiveIntensity={0.6} />
        <meshStandardMaterial attach="material-2" color="#1a1f27" />
        <meshStandardMaterial attach="material-3" color="#1a1f27" />
        <meshStandardMaterial attach="material-4" map={map} emissive="#ffffff" emissiveMap={map} emissiveIntensity={0.6} />
        <meshStandardMaterial attach="material-5" map={map} emissive="#ffffff" emissiveMap={map} emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

/** Flags on the grandstand roof, swaying in the breeze. */
export function Flags({ layout }: { layout: Layout }) {
  const cloths = useRef<(THREE.Group | null)[]>([]);
  const colors = ["#c8322b", "#ffffff", "#2f6fd6", "#f2c230", "#15181d"];
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    cloths.current.forEach((m, i) => {
      if (!m) return;
      m.rotation.y = Math.sin(t * 2.1 + i * 1.7) * 0.35 + 0.4;
      m.rotation.x = Math.sin(t * 3.3 + i) * 0.05;
    });
  });
  return (
    <group>
      {layout.flags.map((f, i) => (
        <group key={i} position={[f.x, f.y ?? 0, f.z]} rotation={[0, f.rot, 0]}>
          <mesh position={[0, 2.5, 0]}>
            <cylinderGeometry args={[0.06, 0.06, 5, 6]} />
            <meshStandardMaterial color="#d0d4d8" metalness={0.6} roughness={0.3} />
          </mesh>
          {/* Cloth hangs off the pole and swings around it. */}
          <group position={[0, 4.3, 0]} ref={(g) => void (cloths.current[i] = g)}>
            <mesh position={[1.1, 0, 0]}>
              <planeGeometry args={[2.2, 1.2]} />
              <meshStandardMaterial color={colors[i % colors.length]} side={THREE.DoubleSide} roughness={0.8} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

/** A big slowly turning Ferris wheel behind the main grandstand. */
export function FerrisWheel({ layout }: { layout: Layout }) {
  const wheel = useRef<THREE.Group>(null);
  const cars = useRef<(THREE.Object3D | null)[]>([]);
  const R = 32;
  const H = R + 6;
  const N = 28;
  const LEG_TILT = 0.25;
  const LEG_SPREAD = (H / 2) * Math.tan(LEG_TILT); // centre offset so the leg tops meet at x = 0
  const colors = ["#c8322b", "#f2c230", "#2f6fd6", "#3f9b4a", "#e0701e", "#ffffff", "#7a3fb5"];
  useFrame((_, delta) => {
    if (!wheel.current) return;
    wheel.current.rotation.z += delta * 0.05;
    // Gondolas hang level.
    for (const c of cars.current) if (c) c.rotation.z = -wheel.current.rotation.z;
  });
  const w = layout.wheel;
  if (!w) return null;
  return (
    <group position={[w.x, 0, w.z]} rotation={[0, w.rot, 0]}>
      {/* A-frame legs meeting at the hub */}
      {[-3, 3].map((z) =>
        [-1, 1].map((s) => (
          <mesh key={`${z}${s}`} position={[s * LEG_SPREAD, H / 2, z]} rotation={[0, 0, s * LEG_TILT]} castShadow>
            <cylinderGeometry args={[0.5, 0.7, H / Math.cos(LEG_TILT), 8]} />
            <meshStandardMaterial color="#e8ecef" metalness={0.5} roughness={0.35} />
          </mesh>
        )),
      )}
      <group ref={wheel} position={[0, H, 0]}>
        {[-1.6, 1.6].map((z) => (
          <mesh key={z} position={[0, 0, z]} castShadow>
            <torusGeometry args={[R, 0.45, 8, 96]} />
            <meshStandardMaterial color="#f4f6f8" metalness={0.5} roughness={0.3} />
          </mesh>
        ))}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[1.6, 1.6, 4.5, 16]} />
          <meshStandardMaterial color="#b9c0c7" metalness={0.7} roughness={0.3} />
        </mesh>
        {Array.from({ length: N }, (_, i) => {
          const a = (i / N) * Math.PI * 2;
          return (
            <group key={i}>
              <mesh position={[Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5, 0]} rotation={[0, 0, a + Math.PI / 2]}>
                <boxGeometry args={[0.22, R, 0.22]} />
                <meshStandardMaterial color="#dfe3e7" metalness={0.5} roughness={0.35} />
              </mesh>
              <group position={[Math.cos(a) * R, Math.sin(a) * R, 0]} ref={(o) => void (cars.current[i] = o)}>
                <mesh position={[0, -1.6, 0]} castShadow>
                  <boxGeometry args={[1.8, 2, 2.2]} />
                  <meshStandardMaterial color={colors[i % colors.length]} roughness={0.4} metalness={0.2} />
                </mesh>
              </group>
            </group>
          );
        })}
      </group>
    </group>
  );
}

/** Raked gravel run-off on the outside of every corner, from the kerb back to the tyre wall. */
export function GravelTraps({ track, layout }: { track: Track; layout: Layout }) {
  const geometry = useMemo(() => {
    const { points, tangents, halfWidth } = track;
    const n = points.length;
    const step = track.length / n;
    const pos: number[] = [];
    const uv: number[] = [];
    const edge = (i: number, off: number) => {
      const p = points[i % n];
      const t = tangents[i % n];
      return [p.x - t.z * off, 0.013, p.z + t.x * off];
    };
    const width = GRAVEL_WIDTH + 0.6;
    for (let i = 0; i < n; i++) {
      const s = layout.cornerSide[i];
      if (s === 0) continue;
      const inner = s * (halfWidth + KERB);
      const outer = s * (halfWidth + KERB + width);
      const v0 = (i * step) / 10;
      const v1 = ((i + 1) * step) / 10;
      const a0 = { p: edge(i, inner), uv: [0, v0] };
      const a1 = { p: edge(i, outer), uv: [width / 10, v0] };
      const b0 = { p: edge(i + 1, inner), uv: [0, v1] };
      const b1 = { p: edge(i + 1, outer), uv: [width / 10, v1] };
      const tri = outer > inner ? [a0, a1, b0, a1, b1, b0] : [a0, b0, a1, a1, b0, b1];
      for (const v of tri) {
        pos.push(...v.p);
        uv.push(...v.uv);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }, [track, layout]);
  // Gravel UVs are in units of 10 m; repeat 4 = one scanned tile per 2.5 m.
  const gravel = useMemo(() => pbr("gravel", 4), []);
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial {...gravel} color="#e2d6c2" roughness={1} />
    </mesh>
  );
}


/** White peaked hospitality marquees. */
export function Tents({ layout }: { layout: Layout }) {
  if (layout.tents.length === 0) return null;
  return (
    <group>
      {layout.tents.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]} rotation={[0, t.rot + Math.PI / 4, 0]}>
          <mesh position={[0, 1.4, 0]} castShadow receiveShadow>
            <boxGeometry args={[8, 2.8, 8]} />
            <meshStandardMaterial color="#f4f5f7" roughness={0.7} />
          </mesh>
          <mesh position={[0, 4, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
            <coneGeometry args={[6.2, 2.4, 4]} />
            <meshStandardMaterial color="#ffffff" roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// Generic passenger car pack by Comrade1280 (CC-BY 4.0) — see CREDITS.md.
export const PACK_CARS = ["compact", "coupe", "hatchback", "minivan", "offroad", "pickup", "sedan", "sport", "suv", "wagon"];
const packUrl = (name: string) => `/models/cars/${name}.glb`;

/** One car model drawn many times: an InstancedMesh per mesh inside the model. */
function ParkedModel({ name, spots }: { name: string; spots: { x: number; z: number; rot: number }[] }) {
  const { scene } = useGLTF(packUrl(name));
  const parts = useMemo(() => {
    scene.updateMatrixWorld(true);
    const out: { geometry: THREE.BufferGeometry; material: THREE.Material; local: THREE.Matrix4 }[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) out.push({ geometry: o.geometry, material: o.material as THREE.Material, local: o.matrixWorld.clone() });
    });
    return out;
  }, [scene]);
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  useLayoutEffect(() => {
    const car = new THREE.Matrix4();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    parts.forEach((part, k) => {
      const mesh = refs.current[k];
      if (!mesh) return;
      spots.forEach((s, i) => {
        car.compose(new THREE.Vector3(s.x, 0, s.z), q.setFromAxisAngle(up, s.rot), new THREE.Vector3(1, 1, 1));
        mesh.setMatrixAt(i, m.multiplyMatrices(car, part.local));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }, [parts, spots]);
  return (
    <group>
      {parts.map((part, k) => (
        <instancedMesh key={k} ref={(m) => void (refs.current[k] = m)} args={[part.geometry, part.material, spots.length]} castShadow receiveShadow />
      ))}
    </group>
  );
}

/** Rows of real parked cars behind the pits. */
export function CarPark({ layout }: { layout: Layout }) {
  const byModel = useMemo(() => {
    const groups = PACK_CARS.map(() => [] as { x: number; z: number; rot: number }[]);
    for (const p of layout.parked) groups[(p.y ?? 0) % PACK_CARS.length].push(p);
    return groups;
  }, [layout]);
  if (layout.parked.length === 0) return null;
  return (
    <group>
      {PACK_CARS.map((name, i) => (byModel[i].length > 0 ? <ParkedModel key={name} name={name} spots={byModel[i]} /> : null))}
    </group>
  );
}
