"use client";

import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { hashString, mulberry32 } from "@/sim/rng";
import { GRID_SIDE, gridSlot, type Track } from "@/sim";
import { grassMaterial, roadMaterial } from "./materials";
import type { HeightFn } from "./terrain";

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

export function Road({ track }: { track: Track }) {
  const hw = track.halfWidth;
  const { road, kerbs, lines, asphalt, grid } = useMemo(() => {
    const red = new THREE.Color("#d63a2f");
    const white = new THREE.Color("#f2f2f2");
    const kerbColor = (i: number) => (Math.floor(i / 2) % 2 ? red : white);
    const kerbs = [stripGeometry(track, hw, hw + KERB_WIDTH, 0.03, kerbColor), stripGeometry(track, -hw, -hw - KERB_WIDTH, 0.03, kerbColor)];
    const lines = [stripGeometry(track, hw - 0.7, hw - 0.4, 0.025), stripGeometry(track, -hw + 0.7, -hw + 0.4, 0.025)];
    const asphalt = roadMaterial();
    // Starting grid: a painted box for each of the sim's grid slots, plus a few empty ones behind.
    const { points, tangents } = track;
    const grid = Array.from({ length: 8 }, (_, k) => {
      const { index, side } = gridSlot(track, k);
      const t = tangents[index];
      return { x: points[index].x - t.z * side * GRID_SIDE, z: points[index].z + t.x * side * GRID_SIDE, rot: Math.atan2(t.x, t.z) };
    });
    return { road: stripGeometry(track, -hw, hw, 0.02), kerbs, lines, asphalt, grid };
  }, [track, hw]);

  return (
    <group>
      <mesh geometry={road} material={asphalt} receiveShadow />
      {grid.map((g, i) => (
        <group key={i} position={[g.x, 0.027, g.z]} rotation={[0, g.rot, 0]}>
          {/* Front bar and two short side ticks of a grid slot */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 2.2]}>
            <planeGeometry args={[2.6, 0.14]} />
            <meshStandardMaterial color="#e8e8e8" roughness={0.85} />
          </mesh>
          {[-1.23, 1.23].map((x) => (
            <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0, 1.75]}>
              <planeGeometry args={[0.14, 0.9]} />
              <meshStandardMaterial color="#e8e8e8" roughness={0.85} />
            </mesh>
          ))}
        </group>
      ))}
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

/** Grass terrain: flat around the circuit, rolling hills beyond. Stripes and colour variation come from the shader. */
export function Ground({ height }: { height: HeightFn }) {
  const geometry = useMemo(() => {
    const SIZE = 3200;
    const SEG = 256;
    const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG).rotateX(-Math.PI / 2);
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)));
    g.computeVertexNormals();
    return g;
  }, [height]);
  const material = useMemo(() => {
    const m = grassMaterial();
    // Plane UVs run 0..1 across 3200 m; the normal map tiles every ~3 m.
    m.normalMap?.repeat.set(1067, 1067);
    m.roughnessMap?.repeat.set(1067, 1067);
    return m;
  }, []);
  return <mesh geometry={geometry} material={material} receiveShadow />;
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

const MAPLES_URL = "/models/trees/maples.glb";

/**
 * Maple trees (Quaternius, CC0 — see CREDITS.md): five modelled trees with real trunks, branches and leaf
 * clusters, instanced in clumps and tree lines. Most are in summer green, some in autumn red. Scenery only.
 */
export function Trees({ track, reserved, height }: { track: Track; reserved: { x: number; z: number; r: number }[]; height: HeightFn }) {
  const { scene } = useGLTF(MAPLES_URL);

  // Each tree in the file is a trunk mesh and a leaves mesh, laid out in a row. Bring each to its own origin.
  const kinds = useMemo(() => {
    scene.updateMatrixWorld(true);
    const groups = new Map<string, THREE.Mesh[]>();
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      // Multi-material meshes load as a group of meshes named after the tree; fall back to the mesh's own name.
      const name = /MapleTree_\d/.exec(o.name)?.[0] ?? /MapleTree_\d/.exec(o.parent?.name ?? "")?.[0];
      if (name) groups.set(name, [...(groups.get(name) ?? []), o]);
    });
    return [...groups.values()].map((meshes) => {
      const box = new THREE.Box3();
      for (const m of meshes) box.expandByObject(m);
      const shift = new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
      const parts = meshes.map((m) => ({
        geometry: m.geometry.clone().applyMatrix4(m.matrixWorld).applyMatrix4(shift),
        leaves: /leaves/i.test((m.material as THREE.Material).name),
        source: m.material as THREE.MeshStandardMaterial,
      }));
      return { parts, height: box.max.y - box.min.y };
    });
  }, [scene]);

  const materials = useMemo(() => {
    const leaf = kinds.flatMap((k) => k.parts).find((p) => p.leaves)?.source;
    const bark = kinds.flatMap((k) => k.parts).find((p) => !p.leaves)?.source;
    const foliage = (map: THREE.Texture | null) => {
      // Leaves are cut-out cards: alpha-test them (cheap, sorts correctly, casts leaf-shaped shadows).
      const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 });
      return m;
    };
    const green = new THREE.TextureLoader().load("/textures/maple_leaves_green.webp");
    green.colorSpace = THREE.SRGBColorSpace;
    green.flipY = false; // glTF texture convention
    return { bark: bark ?? new THREE.MeshStandardMaterial({ color: "#5e452e" }), green: foliage(green), autumn: foliage(leaf?.map ?? null) };
  }, [kinds]);

  // Where the trees go: clumps and lines, clear of the road, run-off, barriers and everything built.
  const placed = useMemo(() => {
    const rand = mulberry32(hashString(track.seed + ":trees"));
    const clear = track.halfWidth + 24;
    const clump = (x: number, z: number) => Math.sin(x * 0.021 + 0.7) * Math.sin(z * 0.017 + 1.9) + 0.6 * Math.sin((x + z) * 0.009);
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    // One list per tree kind and foliage colour.
    const lists = kinds.map(() => ({ green: [] as THREE.Matrix4[], autumn: [] as THREE.Matrix4[] }));
    let count = 0;
    for (let tries = 0; tries < 20000 && count < 1000 && kinds.length > 0; tries++) {
      const x = (rand() - 0.5) * 1500;
      const z = (rand() - 0.5) * 1500;
      if (clump(x, z) < 0.35) continue;
      if (reserved.some((r) => (r.x - x) ** 2 + (r.z - z) ** 2 < r.r * r.r)) continue;
      if (track.points.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < clear * clear)) continue;
      const k = Math.floor(rand() * kinds.length);
      // Scale every kind to a mature tree, 8-14 m tall.
      const s = (8 + rand() * 6) / kinds[k].height;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, height(x, z) - 0.15, z), q, new THREE.Vector3(s, s * (0.9 + rand() * 0.2), s));
      // Autumn colour comes in patches, like a stand of maples turning together.
      (Math.sin(x * 0.011 + 2.3) * Math.sin(z * 0.013 + 0.9) > 0.45 ? lists[k].autumn : lists[k].green).push(m);
      count++;
    }
    return lists;
  }, [track, reserved, height, kinds]);

  const fill = (mats: THREE.Matrix4[]) => (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return;
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  };

  return (
    <group>
      {kinds.map((kind, k) =>
        (["green", "autumn"] as const).map((season) => {
          const mats = placed[k]?.[season] ?? [];
          if (mats.length === 0) return null;
          return kind.parts.map((part, i) => (
            <instancedMesh
              key={`${k}-${season}-${i}`}
              ref={fill(mats)}
              args={[part.geometry, part.leaves ? materials[season] : materials.bark, mats.length]}
              castShadow
              receiveShadow
            />
          ));
        }),
      )}
    </group>
  );
}

useGLTF.preload(MAPLES_URL);
