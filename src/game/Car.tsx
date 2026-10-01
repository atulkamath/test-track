"use client";

import { useGLTF } from "@react-three/drei";
import { forwardRef, useMemo } from "react";
import * as THREE from "three";

// Player: Generic Coupe "Azura" by mk2design. AI: Generic passenger car pack by Comrade1280. Both CC-BY 4.0,
// see CREDITS.md. scripts/convert-cars.mjs normalises them: real-world metres, origin on the ground,
// +z forward, a "body" node and four "wheel-*" pivots, wheel radius in userData.
export const PLAYER_MODEL = "azura";
export const BOT_MODELS = ["cars/coupe", "cars/sedan", "cars/hatchback", "cars/sport"];
const url = (model: string) => `/models/${model}.glb`;

const FRONT_WHEELS = ["wheel-front-left", "wheel-front-right"];
const ALL_WHEELS = [...FRONT_WHEELS, "wheel-back-left", "wheel-back-right"];

export const Car = forwardRef<THREE.Group, { model: string }>(function Car({ model }, ref) {
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
    </group>
  );
});

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

  for (const lens of anim.brake ?? []) lens.emissiveIntensity = braking ? 4 : 0.2;
}

useGLTF.preload(url(PLAYER_MODEL));
BOT_MODELS.forEach((m) => useGLTF.preload(url(m)));
