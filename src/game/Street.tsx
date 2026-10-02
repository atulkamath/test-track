"use client";

// Rendering for the street circuit's own pieces: placed models (torii, townhouse fronts, lanterns, pagoda...),
// the canal, pavements, and cherry-blossom petals on the wind. Scenery only.
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Track } from "@/sim";
import type { Layout, ModelSpot } from "./layout";
import { NIGHT, pbr } from "./materials";

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
      if (!(o instanceof THREE.Mesh)) return;
      let material = o.material as THREE.MeshStandardMaterial;
      if (name === "redlantern" && material.color && material.color.r > material.color.g * 1.5) {
        // Paper lanterns are lit from inside: make the red paper glow (the bloom pass picks it up).
        material = material.clone();
        material.emissive = material.color.clone();
        material.emissiveIntensity = 0.9;
        material.userData.glow = [0.9, 3.4];
      } else if (name === "shojiwall" && material.color && material.color.r + material.color.g + material.color.b > 1.8) {
        // Paper screens: dark by day, lit from the room behind once evening falls.
        material = material.clone();
        material.emissive = new THREE.Color("#ffc980");
        material.emissiveIntensity = 0;
        material.userData.glow = [0, 0.85];
      }
      parts.push({ geometry: o.geometry, material, local: toOrigin.clone().multiply(o.matrixWorld) });
    });
    return { parts, height: box.max.y - box.min.y || 1 };
  }, [scene, name]);

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

const LAMP_REACH = 9;
const REAL_LIGHTS = 2;

function placeLamps(mesh: THREE.InstancedMesh, lamps: { x: number; z: number }[]) {
  const m = new THREE.Matrix4();
  lamps.forEach((l, i) => mesh.setMatrixAt(i, m.makeScale(LAMP_REACH * 2, 1, LAMP_REACH * 2).setPosition(l.x, 0.045, l.z)));
  mesh.instanceMatrix.needsUpdate = true;
}

/** Move the few real lights to the lamps nearest the camera, fading each with distance so the hand-over never pops. */
function aimRealLights(lights: (THREE.PointLight | null)[], lamps: { x: number; y: number; z: number }[], camera: THREE.Camera) {
  const dark = THREE.MathUtils.smoothstep(NIGHT.value, 0.4, 0.8);
  const near = dark > 0 ? [...lamps].sort((a, b) => (a.x - camera.position.x) ** 2 + (a.z - camera.position.z) ** 2 - (b.x - camera.position.x) ** 2 - (b.z - camera.position.z) ** 2) : [];
  lights.forEach((light, i) => {
    if (!light) return;
    const lamp = near[i];
    if (!lamp) {
      light.intensity = 0;
      return;
    }
    light.position.set(lamp.x, lamp.y - 0.3, lamp.z);
    const d = Math.hypot(lamp.x - camera.position.x, lamp.z - camera.position.z);
    light.intensity = dark * 110 * (1 - THREE.MathUtils.smoothstep(d, 30, 55));
  });
}

/**
 * Street lighting after dark. Every lamp throws a warm pool of light on the road (a soft glowing disc: costs
 * almost nothing), and the two lamps nearest the camera also carry a real light, so the cars and walls passing
 * under them are actually lit.
 */
export function StreetLights({ lamps }: { lamps: { x: number; y: number; z: number }[] }) {
  const pools = useRef<THREE.InstancedMesh>(null);
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      uniforms: { uNight: NIGHT },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying vec2 vUv;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float a = pow(1.0 - smoothstep(0.0, 1.0, d), 1.7) * smoothstep(0.4, 0.8, uNight) * 0.3;
          gl_FragColor = vec4(vec3(1.0, 0.76, 0.46) * a, a);
        }`,
    });
    return { geometry, material };
  }, []);
  useLayoutEffect(() => {
    if (pools.current) placeLamps(pools.current, lamps);
  }, [lamps]);
  useFrame(({ camera }) => aimRealLights(lights.current, lamps, camera));
  return (
    <>
      <instancedMesh ref={pools} args={[geometry, material, lamps.length]} frustumCulled={false} />
      {Array.from({ length: REAL_LIGHTS }, (_, i) => (
        <pointLight key={i} ref={(l) => void (lights.current[i] = l)} color="#ffd29a" intensity={0} distance={26} decay={2} />
      ))}
    </>
  );
}

const PETALS = 1400;

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
    const uniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uNight: NIGHT };
    const material = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCam;
        attribute float aPhase;
        varying float vShade;
        varying float vNear;
        void main() {
          // A shallow box around the camera: petals drift at tree height, not up in the sky.
          vec3 area = vec3(70.0, 11.0, 70.0);
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
          // Fade out with distance so far petals don't read as specks against the sky.
          vNear = 1.0 - smoothstep(18.0, 34.0, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying float vShade;
        varying float vNear;
        void main() {
          // A soft-edged oval: a petal seen from any angle.
          vec2 c = gl_PointCoord - 0.5;
          float d = c.x * c.x * 1.8 + c.y * c.y * 4.2;
          if (d > 0.22 || vNear < 0.02) discard;
          // Clearly pink, and dim enough that the bloom pass leaves them alone.
          gl_FragColor = vec4(mix(vec3(0.86, 0.42, 0.58), vec3(0.92, 0.62, 0.74), vShade) * (1.0 - 0.8 * uNight), 0.85 * vNear);
        }`,
    });
    return { geometry, material, uniforms };
  }, []);
  useFrame(({ clock, camera }) => petalUniforms(uniforms, clock.elapsedTime, camera.position));
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

MODEL_NAMES.forEach((name) => useGLTF.preload(modelUrl(name)));
