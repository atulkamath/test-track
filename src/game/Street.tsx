"use client";

// Rendering for the street circuit's own pieces: placed models (torii, townhouse fronts, lanterns, pagoda...),
// the canal, pavements, and cherry-blossom petals on the wind. Scenery only.
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Track } from "@/sim";
import type { Layout, ModelSpot } from "./layout";
import { pbr } from "./materials";

// Models from Poly Pizza — see CREDITS.md for each one's author and licence.
const MODEL_NAMES = ["torii", "pagoda", "stonelamp", "redlantern", "bamboo", "sushitruck", "shojiwall", "normalwall", "redwoodwall", "jdoor"];
const modelUrl = (name: string) => `/models/jp/${name}.glb`;

/** One model drawn at many spots: an InstancedMesh per mesh inside it, normalised to bottom-centre and unit height. */
function ModelGroup({ name, spots }: { name: string; spots: ModelSpot[] }) {
  const { scene } = useGLTF(modelUrl(name));
  const { parts, height } = useMemo(() => {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const toOrigin = new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    const parts: { geometry: THREE.BufferGeometry; material: THREE.Material; local: THREE.Matrix4 }[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) parts.push({ geometry: o.geometry, material: o.material as THREE.Material, local: toOrigin.clone().multiply(o.matrixWorld) });
    });
    return { parts, height: box.max.y - box.min.y || 1 };
  }, [scene]);

  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  useLayoutEffect(() => {
    const place = new THREE.Matrix4();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const white = new THREE.Color("#ffffff");
    const tint = new THREE.Color();
    parts.forEach((part, k) => {
      const mesh = refs.current[k];
      if (!mesh) return;
      spots.forEach((s, i) => {
        const scale = s.height / height;
        place.compose(new THREE.Vector3(s.x, s.y, s.z), q.setFromAxisAngle(up, s.rot), new THREE.Vector3(scale, scale, scale));
        mesh.setMatrixAt(i, m.multiplyMatrices(place, part.local));
        mesh.setColorAt(i, s.tint ? tint.set(s.tint) : white);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }, [parts, spots, height]);

  return (
    <group>
      {parts.map((part, k) => (
        <instancedMesh key={k} ref={(m) => void (refs.current[k] = m)} args={[part.geometry, part.material, spots.length]} castShadow receiveShadow />
      ))}
    </group>
  );
}

export function Models({ layout }: { layout: Layout }) {
  const byModel = useMemo(() => {
    const groups = new Map<string, ModelSpot[]>();
    for (const s of layout.models ?? []) groups.set(s.model, [...(groups.get(s.model) ?? []), s]);
    return [...groups.entries()];
  }, [layout]);
  return (
    <group>
      {byModel.map(([name, spots]) => (
        <ModelGroup key={name} name={name} spots={spots} />
      ))}
    </group>
  );
}

/** Water between two banks, with a stone lip along each. */
export function Canals({ layout }: { layout: Layout }) {
  const geometry = useMemo(() => {
    const pos: number[] = [];
    for (const c of layout.canals ?? []) {
      for (let i = 0; i < c.near.length - 1; i++) {
        const a = c.near[i];
        const b = c.near[i + 1];
        const d = c.far[i];
        const e = c.far[i + 1];
        pos.push(a.x, 0.03, a.z, b.x, 0.03, b.z, d.x, 0.03, d.z, b.x, 0.03, b.z, e.x, 0.03, e.z, d.x, 0.03, d.z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }, [layout]);
  if (!layout.canals?.length) return null;
  return (
    <mesh geometry={geometry}>
      <meshPhysicalMaterial color="#2c5a72" roughness={0.05} metalness={0.1} clearcoat={1} clearcoatRoughness={0.05} envMapIntensity={1.6} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Paved strip from the edge of the road out past the wall, on both sides. */
export function Pavements({ track }: { track: Track }) {
  const geometry = useMemo(() => {
    const { points, tangents, halfWidth } = track;
    const n = points.length;
    const pos: number[] = [];
    const uv: number[] = [];
    const reach = halfWidth + 4;
    for (const s of [1, -1])
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const edge = (k: number, off: number) => [points[k].x - tangents[k].z * off * s, 0.012, points[k].z + tangents[k].x * off * s];
        const quad = [edge(i, halfWidth), edge(i, reach), edge(j, halfWidth), edge(i, reach), edge(j, reach), edge(j, halfWidth)];
        const uvs = [
          [0, i],
          [1, i],
          [0, i + 1],
          [1, i],
          [1, i + 1],
          [0, i + 1],
        ];
        quad.forEach((v, k) => {
          pos.push(...v);
          uv.push(uvs[k][0], uvs[k][1] * 0.5);
        });
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }, [track]);
  const stone = useMemo(() => pbr("concrete", 1), []);
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial {...stone} color="#cfcbc3" roughness={1} side={THREE.DoubleSide} />
    </mesh>
  );
}

const PETALS = 2400;

function petalUniforms(u: { uTime: { value: number }; uCam: { value: THREE.Vector3 } }, time: number, cam: THREE.Vector3) {
  u.uTime.value = time;
  u.uCam.value.copy(cam);
}

/**
 * Cherry-blossom petals drifting on the wind. They live in a box that follows the camera and wraps round, so a
 * couple of thousand points are enough to fill the air wherever you are. Animated in the vertex shader.
 */
export function Petals() {
  const { geometry, material, uniforms } = useMemo(() => {
    const seeds = new Float32Array(PETALS * 3);
    const phase = new Float32Array(PETALS);
    // Fixed pseudo-random spread (same every load).
    let state = 12345;
    const rnd = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < PETALS; i++) {
      seeds.set([rnd(), rnd(), rnd()], i * 3);
      phase[i] = rnd();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(seeds, 3));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    const uniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() } };
    const material = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCam;
        attribute float aPhase;
        varying float vShade;
        void main() {
          vec3 area = vec3(110.0, 26.0, 110.0);
          vec3 p = position * area;
          // Wind carries them sideways while they fall and flutter.
          p.x += uTime * 2.2 + sin(uTime * 0.8 + aPhase * 40.0) * 1.6;
          p.z += uTime * 0.9 + cos(uTime * 0.6 + aPhase * 31.0) * 1.3;
          p.y -= uTime * (0.7 + aPhase * 0.8);
          // Wrap inside a box centred on the camera (height stays in the world, just above the ground).
          vec3 w;
          w.x = uCam.x + mod(p.x - uCam.x + area.x * 0.5, area.x) - area.x * 0.5;
          w.z = uCam.z + mod(p.z - uCam.z + area.z * 0.5, area.z) - area.z * 0.5;
          w.y = mod(p.y, area.y) + 0.1;
          vec4 mv = viewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (0.11 + aPhase * 0.07) * 620.0 / max(-mv.z, 0.5);
          vShade = 0.75 + 0.25 * sin(uTime * 3.0 + aPhase * 60.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vShade;
        void main() {
          // A soft-edged oval: a petal seen from any angle.
          vec2 c = gl_PointCoord - 0.5;
          float d = c.x * c.x * 1.8 + c.y * c.y * 4.2;
          if (d > 0.22) discard;
          gl_FragColor = vec4(mix(vec3(1.0, 0.62, 0.78), vec3(1.0, 0.86, 0.92), vShade), 0.9);
        }`,
    });
    return { geometry, material, uniforms };
  }, []);
  useFrame(({ clock, camera }) => petalUniforms(uniforms, clock.elapsedTime, camera.position));
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

MODEL_NAMES.forEach((name) => useGLTF.preload(modelUrl(name)));
