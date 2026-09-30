"use client";

// Thousands of low-poly spectators, animated entirely on the GPU: they idle, clap, wave, cheer and jump,
// get louder as the car comes past, and turn their heads to follow it. Rendering only.
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { hashString, mulberry32 } from "@/sim/rng";
import type { Engine } from "./engine";
import type { Person } from "./layout";

// Body parts, encoded per vertex so the shader knows what to move and how to colour it.
const LEGS = 0;
const TORSO = 1;
const HEAD = 2;
const ARM_L = 3;
const ARM_R = 4;
const HAIR = 5;

function part(geo: THREE.BufferGeometry, id: number, x: number, y: number, z: number) {
  const g = (geo.index ? geo.toNonIndexed() : geo).translate(x, y, z);
  g.deleteAttribute("uv");
  const n = g.getAttribute("position").count;
  g.setAttribute("part", new THREE.Float32BufferAttribute(new Array(n).fill(id), 1));
  return g;
}

/** Person facing +z, feet (standing) or seat (seated) at y = 0. */
function personGeometry(seated: boolean) {
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const head = () => new THREE.IcosahedronGeometry(0.12, 1);
  const hipY = seated ? 0 : 0.86;
  const parts = seated
    ? [
        part(box(0.36, 0.17, 0.46), LEGS, 0, 0.085, 0.2), // thighs
        part(box(0.34, 0.46, 0.15), LEGS, 0, -0.2, 0.42), // shins hanging over the step
      ]
    : [part(box(0.36, 0.86, 0.22), LEGS, 0, 0.43, 0)];
  parts.push(
    part(box(0.44, 0.6, 0.25), TORSO, 0, hipY + 0.3, 0),
    part(head(), HEAD, 0, hipY + 0.76, 0),
    part(box(0.25, 0.07, 0.25), HAIR, 0, hipY + 0.86, -0.01),
    part(box(0.1, 0.58, 0.12), ARM_L, 0.28, hipY + 0.29, 0),
    part(box(0.1, 0.58, 0.12), ARM_R, -0.28, hipY + 0.29, 0),
  );
  return mergeGeometries(parts)!;
}

const SHIRTS = ["#e9e2d0", "#c8322b", "#2f6fd6", "#f2c230", "#1d1f24", "#ffffff", "#3f9b4a", "#e0701e", "#7a3fb5", "#e84d8a", "#1f8a8a"];
const PANTS = ["#23262d", "#2f3e5c", "#4a4136", "#6b6f75", "#1b2233", "#8a7a5c"];
const SKIN = ["#f1c9a5", "#e0ac86", "#c68c64", "#9a6a47", "#6e4a33", "#f5d6bc"];
const HAIRS = ["#1a1411", "#3b2a1d", "#6b4a2b", "#b08850", "#d9c9a8", "#2a2a2a", "#8c3b22"];

function makeMaterial(seated: boolean, uniforms: { uTime: { value: number }; uCar: { value: THREE.Vector3 } }) {
  const shoulderY = (seated ? 0 : 0.86) + 0.58;
  const headY = (seated ? 0 : 0.86) + 0.66;
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uCar = uniforms.uCar;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        attribute float part;
        attribute vec3 aShirt;
        attribute vec3 aPants;
        attribute vec3 aSkin;
        attribute vec3 aHair;
        attribute vec3 aAnim; // phase, action, mood
        uniform float uTime;
        uniform vec3 uCar;
        varying vec3 vCrowdColor;
        mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }`,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        {
          float t = uTime + aAnim.x * 17.0;
          float action = aAnim.y;
          vec3 origin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float dist = distance(origin.xz, uCar.xz);
          float excite = 1.0 - smoothstep(12.0, 90.0, dist);
          float energy = clamp(aAnim.z * 0.35 + excite, 0.0, 1.0);

          if (part > 2.5 && part < 4.5) {
            // Arms pivot at the shoulder: fwd swings them forward, up raises them sideways.
            float side = part < 3.5 ? 1.0 : -1.0;
            vec3 pivot = vec3(side * 0.22, ${shoulderY.toFixed(3)}, 0.0);
            vec3 p = transformed - pivot;
            float fwd = 0.08 + 0.05 * sin(t * 1.3 + side);
            float up = side * 0.06;
            if (action > 0.5 && action < 1.5) {        // clap
              fwd = 1.15 + 0.12 * sin(t * 15.0) * energy;
              up = -side * (0.28 + 0.12 * sin(t * 15.0)) * max(energy, 0.35);
            } else if (action > 1.5 && action < 2.5) { // wave (left arm)
              if (side > 0.0) { up = mix(0.2, 2.5, max(energy, 0.25)); fwd = 0.25 * sin(t * 7.0); }
            } else if (action > 2.5) {                 // cheer / jump: both arms up
              up = side * mix(0.15, 2.75 + 0.2 * sin(t * 9.0 + side), energy);
            }
            p.yz = rot2(-fwd) * p.yz;
            p.xy = rot2(up) * p.xy;
            transformed = p + pivot;
          }

          if (part > 1.5 && (part < 2.5 || part > 4.5)) {
            // Head (and hair) turn toward the car when it's close enough to notice.
            vec3 local = (inverse(instanceMatrix) * vec4(uCar, 1.0)).xyz;
            float yaw = clamp(atan(local.x, local.z), -1.3, 1.3) * (1.0 - smoothstep(30.0, 160.0, dist));
            vec3 h = transformed - vec3(0.0, ${headY.toFixed(3)}, 0.0);
            vec2 zx = rot2(yaw) * vec2(h.z, h.x);
            transformed = vec3(zx.y, h.y, zx.x) + vec3(0.0, ${headY.toFixed(3)}, 0.0);
          }

          // Whole body: gentle idle sway, bounce when excited, jumpers jump.
          transformed.x += sin(t * 0.8) * 0.03 * transformed.y;
          transformed.y += energy * 0.05 * abs(sin(t * 5.0));
          ${seated ? "" : "if (action > 3.5) transformed.y += energy * 0.35 * max(0.0, sin(t * 6.0));"}

          vCrowdColor = part < 0.5 ? aPants : part < 1.5 ? aShirt : part < 2.5 ? aSkin : part < 4.5 ? aShirt : aHair;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCrowdColor;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = vCrowdColor;");
  };
  m.customProgramCacheKey = () => `crowd-${seated ? "seated" : "standing"}`;
  return m;
}

function CrowdGroup({ people, seated, uniforms }: { people: Person[]; seated: boolean; uniforms: Parameters<typeof makeMaterial>[1] }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => {
    const g = personGeometry(seated);
    const rand = mulberry32(hashString(seated ? "seated" : "standing"));
    const color = new THREE.Color();
    const attr = (palette: string[]) => {
      const arr = new Float32Array(people.length * 3);
      people.forEach((_, i) => {
        color.set(palette[Math.floor(rand() * palette.length)]);
        arr.set([color.r, color.g, color.b], i * 3);
      });
      return new THREE.InstancedBufferAttribute(arr, 3);
    };
    g.setAttribute("aShirt", attr(SHIRTS));
    g.setAttribute("aPants", attr(PANTS));
    g.setAttribute("aSkin", attr(SKIN));
    g.setAttribute("aHair", attr(HAIRS));
    g.setAttribute("aAnim", new THREE.InstancedBufferAttribute(new Float32Array(people.flatMap((p) => [rand(), p.action, p.mood])), 3));
    return g;
  }, [people, seated]);
  const material = useMemo(() => makeMaterial(seated, uniforms), [seated, uniforms]);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    people.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rot);
      mat.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale));
      m.setMatrixAt(i, mat);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [people]);

  if (people.length === 0) return null;
  return <instancedMesh ref={mesh} args={[geometry, material, people.length]} receiveShadow />;
}

type CrowdUniforms = Parameters<typeof makeMaterial>[1];

function updateUniforms(u: CrowdUniforms, time: number, x: number, z: number) {
  u.uTime.value = time;
  u.uCar.value.set(x, 0, z);
}

export function Crowd({ people, engine }: { people: Person[]; engine: Engine }) {
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uCar: { value: new THREE.Vector3() } }), []);
  const seated = useMemo(() => people.filter((p) => p.seated), [people]);
  const standing = useMemo(() => people.filter((p) => !p.seated), [people]);
  useFrame(({ clock }) => {
    const p = engine.pose();
    updateUniforms(uniforms, clock.elapsedTime, p.x, p.z);
  });
  return (
    <group>
      <CrowdGroup people={seated} seated uniforms={uniforms} />
      <CrowdGroup people={standing} seated={false} uniforms={uniforms} />
    </group>
  );
}
