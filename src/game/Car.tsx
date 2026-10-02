"use client";

import { useGLTF } from "@react-three/drei";
import { forwardRef, useMemo } from "react";
import * as THREE from "three";
import { NIGHT } from "./materials";
import { getPoses, MAN_URL, PART } from "./people";

// Player: Generic Coupe "Azura" by mk2design. AI: Generic passenger car pack by Comrade1280. Both CC-BY 4.0,
// see CREDITS.md. scripts/convert-cars.mjs normalises them: real-world metres, origin on the ground,
// +z forward, a "body" node and four "wheel-*" pivots, wheel radius in userData.
export const PLAYER_MODEL = "azura";
export const BOT_MODELS = ["cars/coupe", "cars/sedan", "cars/hatchback", "cars/sport"];
const url = (model: string) => `/models/${model}.glb`;

const FRONT_WHEELS = ["wheel-front-left", "wheel-front-right"];
const ALL_WHEELS = [...FRONT_WHEELS, "wheel-back-left", "wheel-back-right"];

export const Car = forwardRef<THREE.Group, { model: string; variant?: number }>(function Car({ model, variant = 0 }, ref) {
  const { scene } = useGLTF(url(model));
  const root = useMemo(() => {
    const root = scene.clone(true);
    // Tail-light lenses glow when braking. Clone them so each car instance lights independently.
    const brake: THREE.MeshStandardMaterial[] = [];
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const mat = o.material as THREE.MeshStandardMaterial;
      // Sharpest filtering for surfaces seen at shallow angles (bonnet, flanks, wheels).
      for (const map of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap]) if (map) map.anisotropy = 16;
      if (/glass_red/i.test(mat.name)) {
        const lens = mat.clone();
        lens.emissive = new THREE.Color("#ff1a0a");
        lens.emissiveIntensity = 0.2;
        o.material = lens;
        brake.push(lens);
      }
    });
    for (const name of ALL_WHEELS) {
      const w = root.getObjectByName(name);
      if (w) w.rotation.order = "YXZ"; // steer (Y) first, then roll (X)
    }
    root.userData.brake = brake;
    root.userData.wheelRadius = (root.children[0]?.userData.wheelRadius as number | undefined) ?? 0.3;
    return root;
  }, [scene]);

  return (
    <group ref={ref}>
      <primitive object={root} />
      <DriverFigure model={model} variant={variant} />
    </group>
  );
});

/** Where the driver's seat is in each car (car-local metres): x left, y seat height, z forward. Left-hand drive. */
const SEAT: Record<string, [number, number, number]> = { azura: [0.31, 0.3, -0.05] };
const DEFAULT_SEAT: [number, number, number] = [0.34, 0.33, -0.12];
/** Drivers are scaled down a little: the cars are slightly smaller than real ones. */
const DRIVER_SCALE = 0.82;
const SUITS = ["#c8322b", "#1d3f7a", "#e9ecef", "#1d1f24", "#e0701e"];
const HELMETS = ["#f2c230", "#e9ecef", "#c8322b", "#2f6fd6", "#1d1f24"];

/** A helmeted driver in a reclined driving pose. Named "driver" so the cockpit view can hide the player's own. */
export function DriverFigure({ model, variant = 0 }: { model: string; variant?: number }) {
  const gltf = useGLTF(MAN_URL);
  const { geometry, head } = useMemo(() => {
    const pose = getPoses(gltf.scene, gltf.animations[0]).drive;
    const g = pose.geometry.clone();
    // Paint by body part: race suit, dark gloves and boots.
    const part = g.getAttribute("part");
    const suit = new THREE.Color(SUITS[variant % SUITS.length]);
    const dark = new THREE.Color("#15171b");
    const colors = new Float32Array(part.count * 3);
    for (let i = 0; i < part.count; i++) {
      const p = part.getX(i);
      const c = p === PART.pants || p === PART.shirt ? suit : dark;
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return { geometry: g, head: pose.neck.clone().add(new THREE.Vector3(0, 0.13, 0.02)) };
  }, [gltf, variant]);
  const seat = SEAT[model] ?? DEFAULT_SEAT;
  return (
    <group name="driver" position={seat} scale={DRIVER_SCALE}>
      <mesh geometry={geometry} castShadow>
        <meshStandardMaterial vertexColors roughness={0.75} />
      </mesh>
      {/* Helmet with a dark visor */}
      <mesh position={head} castShadow>
        <sphereGeometry args={[0.16, 20, 16]} />
        <meshStandardMaterial color={HELMETS[variant % HELMETS.length]} roughness={0.25} metalness={0.1} />
      </mesh>
      <mesh position={[head.x, head.y + 0.01, head.z + 0.09]} scale={[1, 0.42, 0.7]}>
        <sphereGeometry args={[0.135, 16, 12]} />
        <meshStandardMaterial color="#0b0d10" roughness={0.1} metalness={0.6} />
      </mesh>
    </group>
  );
}

/** Per-car animation memory (smoothed values between frames). */
export interface CarAnim {
  /** Looked up from the model on first use. */
  wheelRadius?: number;
  brake?: THREE.MeshStandardMaterial[];
  steer: number;
  pitch: number;
  roll: number;
  lastSpeed: number;
  lastAngle: number;
}

export const newCarAnim = (): CarAnim => ({ steer: 0, pitch: 0, roll: 0, lastSpeed: 0, lastAngle: 0 });

/**
 * Visual-only life for a car: rolling wheels, front-wheel steer, suspension pitch/roll, brake lights.
 * `steer` is -1..1 (left positive), `braking` lights the tail.
 */
export function animateCar(group: THREE.Group, anim: CarAnim, speed: number, angle: number, steer: number, braking: boolean, delta: number) {
  if (delta <= 0) return;
  const k = (rate: number) => 1 - Math.exp(-delta * rate);
  if (anim.wheelRadius === undefined) {
    // The model loads asynchronously; wait until its root (with our userData) is in the group.
    let found: THREE.Object3D | undefined;
    group.traverse((o) => (found ??= o.userData.brake ? o : undefined));
    if (!found) return;
    anim.wheelRadius = found.userData.wheelRadius as number;
    anim.brake = found.userData.brake as THREE.MeshStandardMaterial[];
  }
  anim.steer += (steer * 0.4 - anim.steer) * k(12);
  for (const name of ALL_WHEELS) {
    const w = group.getObjectByName(name);
    if (!w) continue;
    w.rotation.x += (speed * delta) / anim.wheelRadius;
    if (FRONT_WHEELS.includes(name)) w.rotation.y = anim.steer;
  }

  // Suspension: nose dives under braking, squats under power; body leans out of corners.
  const accel = (speed - anim.lastSpeed) / delta;
  let dAngle = angle - anim.lastAngle;
  if (dAngle > Math.PI) dAngle -= Math.PI * 2;
  if (dAngle < -Math.PI) dAngle += Math.PI * 2;
  const yawRate = dAngle / delta;
  anim.lastSpeed = speed;
  anim.lastAngle = angle;
  const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
  anim.pitch += (clamp(-accel * 0.0022, 0.045) - anim.pitch) * k(6);
  anim.roll += (clamp(speed * yawRate * 0.0022, 0.06) - anim.roll) * k(6);
  const body = group.getObjectByName("body");
  if (body) {
    body.rotation.x = anim.pitch;
    body.rotation.z = anim.roll;
  }

  // Tail lights are on after dark, and brighter still under braking.
  for (const lens of anim.brake ?? []) lens.emissiveIntensity = braking ? 4 : 0.2 + NIGHT.value * 1.6;
}

useGLTF.preload(url(PLAYER_MODEL));
BOT_MODELS.forEach((m) => useGLTF.preload(url(m)));
useGLTF.preload(MAN_URL);
