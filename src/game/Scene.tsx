"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { hashString, mulberry32 } from "@/sim/rng";
import { GRID_SIDE, gridSlot, type Track } from "@/sim";
import { grassMaterial, roadMaterial, SUN_DIR } from "./materials";
import type { TreeSpot } from "./layout";
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
      {/* Kerbs belong to a race circuit; a street runs straight up to its walls. */}
      {track.kind === "circuit" &&
        kerbs.map((g, i) => (
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
/** Shared clock for the wind in the leaves. */
const LEAF_TIME = { value: 0 };
function setLeafTime(t: number) {
  LEAF_TIME.value = t;
}

/**
 * Shafts of sunlight coming down through the canopy of the trees a map has planted. Each is a pair of crossed,
 * see-through sheets running from the crown to the ground along the sun's direction, brightest in the middle and
 * faintly shimmering: drawn in the world, so nothing is done to the finished picture.
 */
export function SunShafts({ spots }: { spots: TreeSpot[] }) {
  const { geometry, material } = useMemo(() => {
    const down = SUN_DIR.clone().negate();
    const w1 = new THREE.Vector3().crossVectors(down, new THREE.Vector3(0, 1, 0)).normalize();
    const w2 = new THREE.Vector3().crossVectors(down, w1).normalize();
    const pos: number[] = [];
    const uv: number[] = [];
    const phase: number[] = [];
    spots.forEach((t, i) => {
      if (i % 2) return;
      const topY = t.height * 0.72;
      // Start a little off-centre in the crown, so the shafts of a row of trees don't line up.
      const top = new THREE.Vector3(t.x + Math.sin(i * 2.4) * 1.2, topY, t.z + Math.cos(i * 1.7) * 1.2);
      const foot = top.clone().addScaledVector(down, topY / SUN_DIR.y);
      const half = 0.7 + (i % 5) * 0.16;
      for (const w of [w1, w2]) {
        const corners = [
          [top.clone().addScaledVector(w, -half), 0, 0],
          [top.clone().addScaledVector(w, half), 1, 0],
          [foot.clone().addScaledVector(w, -half * 1.5), 0, 1],
          [foot.clone().addScaledVector(w, half * 1.5), 1, 1],
        ] as const;
        for (const k of [0, 2, 1, 1, 2, 3]) {
          const [v, u, vv] = corners[k];
          pos.push(v.x, v.y, v.z);
          uv.push(u, vv);
          phase.push(i * 0.37);
        }
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute("aPhase", new THREE.Float32BufferAttribute(phase, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: LEAF_TIME },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aPhase;
        varying vec2 vUv;
        varying float vPhase;
        varying float vDist;
        void main() {
          vUv = uv;
          vPhase = aPhase;
          vec4 mv = viewMatrix * vec4(position, 1.0);
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        varying float vPhase;
        varying float vDist;
        void main() {
          // Soft across the width, with a few brighter streaks; fades in below the crown and out at the ground.
          float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float streaks = 0.65 + 0.35 * sin(vUv.x * 19.0 + vPhase * 9.0);
          float along = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
          float shimmer = 0.8 + 0.2 * sin(uTime * 0.9 + vPhase * 13.0 + vUv.x * 5.0);
          // Gone when the camera is right inside one, and in the far distance.
          float range = smoothstep(2.0, 9.0, vDist) * (1.0 - smoothstep(90.0, 160.0, vDist));
          float a = across * across * streaks * along * shimmer * range * 0.085;
          gl_FragColor = vec4(vec3(1.0, 0.93, 0.76) * a, a);
        }`,
    });
    return { geometry, material };
  }, [spots]);
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

export function Trees({
  track,
  reserved,
  height,
  spots,
}: {
  track: Track;
  reserved: { x: number; z: number; r: number }[];
  height: HeightFn;
  /** Trees a map has placed deliberately (e.g. cherry trees lining a street), on top of the scattered woodland. */
  spots?: TreeSpot[];
}) {
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
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uLeafTime = LEAF_TIME;
        shader.uniforms.uSunDir = { value: SUN_DIR };
        // Wind: the canopy sways, more the higher up, each tree out of step with its neighbours.
        shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform float uLeafTime;").replace(
          "#include <begin_vertex>",
          /* glsl */ `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float leafPhase = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.23;
          #else
            float leafPhase = 0.0;
          #endif
          float leafSway = sin(uLeafTime * 1.3 + leafPhase + position.y * 0.9) + 0.5 * sin(uLeafTime * 2.9 + leafPhase * 1.7 + position.x * 2.0);
          transformed.x += leafSway * 0.012 * position.y;
          transformed.z += leafSway * 0.007 * position.y;`,
        );
        // Leaves are thin: sunlight comes through them. Seen against the sun the canopy glows instead of going dark.
        shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 uSunDir;").replace(
          "#include <emissivemap_fragment>",
          /* glsl */ `#include <emissivemap_fragment>
          {
            vec3 sunView = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
            float against = pow(max(dot(-normalize(vViewPosition), sunView), 0.0), 3.0);
            totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.92, 0.78) * (0.1 + 0.75 * against);
          }`,
        );
      };
      m.customProgramCacheKey = () => "leaf-translucent";
      return m;
    };
    const green = new THREE.TextureLoader().load("/textures/maple_leaves_green.webp");
    green.colorSpace = THREE.SRGBColorSpace;
    green.flipY = false; // glTF texture convention
    const blossom = new THREE.TextureLoader().load("/textures/sakura_blossom.webp");
    blossom.colorSpace = THREE.SRGBColorSpace;
    blossom.flipY = false;
    return {
      bark: bark ?? new THREE.MeshStandardMaterial({ color: "#5e452e" }),
      green: foliage(green),
      autumn: foliage(leaf?.map ?? null),
      sakura: foliage(blossom),
    };
  }, [kinds]);

  // Where the trees go: clumps and lines, clear of the road, run-off, barriers and everything built.
  const placed = useMemo(() => {
    const rand = mulberry32(hashString(track.seed + ":trees"));
    const clear = track.halfWidth + 24;
    const clump = (x: number, z: number) => Math.sin(x * 0.021 + 0.7) * Math.sin(z * 0.017 + 1.9) + 0.6 * Math.sin((x + z) * 0.009);
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    // One list per tree kind and foliage colour.
    const lists = kinds.map(() => ({ green: [] as THREE.Matrix4[], autumn: [] as THREE.Matrix4[], sakura: [] as THREE.Matrix4[] }));
    // Where the map has planted cherry trees, the woodland behind is mostly in blossom too.
    const blossomWoods = spots !== undefined;
    let count = 0;
    // A map that plants its own trees needs less woodland behind them.
    const scattered = spots ? 450 : 1000;
    for (let tries = 0; tries < 20000 && count < scattered && kinds.length > 0; tries++) {
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
      const patch = Math.sin(x * 0.011 + 2.3) * Math.sin(z * 0.013 + 0.9);
      (blossomWoods ? (patch > -0.1 ? lists[k].sakura : lists[k].green) : patch > 0.45 ? lists[k].autumn : lists[k].green).push(m);
      count++;
    }
    // The map's own trees: exact spot and height, a different shape each time.
    (spots ?? []).forEach((t, i) => {
      if (kinds.length === 0) return;
      const k = (i * 7 + 3) % kinds.length;
      const s = t.height / kinds[k].height;
      q.setFromAxisAngle(up, i * 2.399);
      lists[k][t.kind].push(new THREE.Matrix4().compose(new THREE.Vector3(t.x, height(t.x, t.z) - 0.1, t.z), q, new THREE.Vector3(s, s, s)));
    });
    return lists;
  }, [track, reserved, height, kinds, spots]);

  useFrame(({ clock }) => setLeafTime(clock.elapsedTime));

  const fill = (mats: THREE.Matrix4[]) => (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return;
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  };

  return (
    <group>
      {kinds.map((kind, k) =>
        (["green", "autumn", "sakura"] as const).map((season) => {
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
