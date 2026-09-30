"use client";

import { useGLTF } from "@react-three/drei";
import { forwardRef, useMemo } from "react";
import * as THREE from "three";

// Kenney Car Kit (CC0) — see CREDITS.md. Models face +z, which matches sim heading 0.
export const PLAYER_MODEL = "sedan-sports";
export const BOT_MODELS = ["hatchback-sports", "race-future", "race", "sedan"];
const url = (model: string) => `/models/${model}.glb`;

/** Kenney cars are ~2.5 units long; scale to the ~3.8 m footprint the sim's collision circles assume. */
export const CAR_SCALE = 1.5;
/** Wheel radius in world units (model wheel radius 0.3). */
export const WHEEL_RADIUS = 0.3 * CAR_SCALE;
const FRONT_WHEELS = ["wheel-front-left", "wheel-front-right"];
const ALL_WHEELS = [...FRONT_WHEELS, "wheel-back-left", "wheel-back-right"];

export const Car = forwardRef<THREE.Group, { model: string }>(function Car({ model }, ref) {
  const { scene } = useGLTF(url(model));
  const root = useMemo(() => {
    const root = scene.clone(true);
    let body: THREE.Mesh | null = null;
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      if (o.name === "body") body = o;
      if (o.name === "body" || o.name === "spoiler") {
        // Glossy clear-coat paint that reflects the sky.
        o.material = new THREE.MeshPhysicalMaterial({
          map: (o.material as THREE.MeshStandardMaterial).map,
          metalness: 0.25,
          roughness: 0.32,
          clearcoat: 1,
          clearcoatRoughness: 0.06,
          envMapIntensity: 1.4,
        });
      }
    });
    for (const name of ALL_WHEELS) {
      const w = root.getObjectByName(name);
      if (w) w.rotation.order = "YXZ"; // steer (Y) first, then roll (X)
    }

    // Brake lights: two small emissive panels on the tail, sized from the body's bounding box.
    const brake = new THREE.MeshStandardMaterial({ color: "#5a0c0c", emissive: "#ff2a1a", emissiveIntensity: 0.15 });
    if (body) {
      const b = body as THREE.Mesh;
      b.geometry.computeBoundingBox();
      const box = b.geometry.boundingBox!;
      const w = box.max.x - box.min.x;
      const h = box.max.y - box.min.y;
      for (const s of [-1, 1]) {
        const light = new THREE.Mesh(new THREE.BoxGeometry(w * 0.2, h * 0.09, 0.03), brake);
        light.position.set(s * w * 0.3, box.min.y + h * 0.45, box.min.z - 0.005);
        b.add(light);
      }
    }
    root.userData.brake = brake;
    return root;
  }, [scene]);

  return (
    <group ref={ref}>
      <primitive object={root} scale={CAR_SCALE} />
    </group>
  );
});

/** Per-car animation memory (smoothed values between frames). */
export interface CarAnim {
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
  anim.steer += (steer * 0.4 - anim.steer) * k(12);
  for (const name of ALL_WHEELS) {
    const w = group.getObjectByName(name);
    if (!w) continue;
    w.rotation.x += (speed * delta) / WHEEL_RADIUS;
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

  let brake: THREE.MeshStandardMaterial | undefined;
  group.traverse((o) => (brake ??= o.userData.brake as THREE.MeshStandardMaterial | undefined));
  if (brake) brake.emissiveIntensity = braking ? 3.5 : 0.15;
}

useGLTF.preload(url(PLAYER_MODEL));
BOT_MODELS.forEach((m) => useGLTF.preload(url(m)));
