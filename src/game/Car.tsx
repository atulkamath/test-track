"use client";

import { useGLTF } from "@react-three/drei";
import { forwardRef, useMemo } from "react";
import * as THREE from "three";
import { NIGHT } from "./materials";
import { bonePosition, createDriver, DRIVER_SCALE, DRIVER_URL } from "./driverRig";

// Player: Generic Coupe "Azura" by mk2design. AI: Generic passenger car pack by Comrade1280. Both CC-BY 4.0,
// see CREDITS.md. scripts/convert-cars.mjs normalises them: real-world metres, origin on the ground,
// +z forward, a "body" node and four "wheel-*" pivots, wheel radius in userData.
export const PLAYER_MODEL = "azura";
export const BOT_MODELS = ["cars/coupe", "cars/sedan", "cars/hatchback", "cars/sport"];
const url = (model: string) => `/models/${model}.glb`;

const FRONT_WHEELS = ["wheel-front-left", "wheel-front-right"];
const ALL_WHEELS = [...FRONT_WHEELS, "wheel-back-left", "wheel-back-right"];

/**
 * Car surfaces that should mirror the sky: paint, chrome, glass, lights, alloys. The scenery's reflections are kept
 * low (scene.environmentIntensity), which would leave the paint looking like plastic, so these get their own,
 * stronger reflections; Game.tsx keeps them in step with the time of day. Paint is left as each model made it.
 */
export const REFLECTIVE = new Set<THREE.MeshStandardMaterial>();
const SHINY = /body|chrome|glass|optics|alloy/i;

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
      if (/^optics/i.test(mat.name)) {
        // The AI cars' lights are one textured mesh, front and back: light up only its red parts (the tail lights).
        const lens = mat.clone();
        lens.emissive = new THREE.Color("#ff2a1a");
        lens.emissiveIntensity = 0.2;
        lens.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <emissivemap_fragment>",
            "totalEmissiveRadiance *= (0.4 + diffuseColor.rgb * 6.0) * smoothstep(0.05, 0.2, diffuseColor.r - max(diffuseColor.g, diffuseColor.b));",
          );
        };
        lens.customProgramCacheKey = () => "tail-lights";
        o.material = lens;
        brake.push(lens);
      } else if (/glass_red/i.test(mat.name)) {
        const lens = mat.clone();
        lens.emissive = new THREE.Color("#ff1a0a");
        lens.emissiveIntensity = 0.2;
        o.material = lens;
        brake.push(lens);
      }
      if (SHINY.test((o.material as THREE.Material).name)) REFLECTIVE.add(o.material as THREE.MeshStandardMaterial);
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
const SEAT: Record<string, [number, number, number]> = { azura: [0.31, 0.3, -0.05], "cars/sport": [0.3, 0.3, -0.02] };
const DEFAULT_SEAT: [number, number, number] = [0.34, 0.33, -0.12];
/** Inside of the roof above the driver's head (car-local metres, measured from the model): the helmet stays under it. */
// The sport car's roof is ~0.98 at its peak but falls to ~0.9 at the edges and rear, so its helmet sits lower.
const ROOF: Record<string, number> = { azura: 1.06, "cars/sport": 0.89 };
/** Suit tint per driver (multiplies the red-and-white suit): the player's is left as made. */
const SUITS = [undefined, "#8fb0ff", "#ffe08a", "#9be0a0", "#c9c9d2"];

/** The race driver sat in the car, hands on the wheel. Named "driver" so the cockpit view can hide the player's own. */
export function DriverFigure({ model, variant = 0 }: { model: string; variant?: number }) {
  const { scene } = useGLTF(DRIVER_URL);
  const rig = useMemo(() => createDriver(scene, { suit: SUITS[variant % SUITS.length] }), [scene, variant]);
  const seat = useMemo(() => {
    const [x, y, z] = SEAT[model] ?? DEFAULT_SEAT;
    // Sink him into the seat if his helmet would come up through the roof (the helmet shell is ~4 cm above the bone).
    rig.root.updateMatrixWorld(true);
    const helmet = y + (bonePosition(rig, "HeadTop_End", new THREE.Vector3()).y + 0.04) * DRIVER_SCALE;
    return [x, y - Math.max(0, helmet - (ROOF[model] ?? Infinity)), z] as [number, number, number];
  }, [rig, model]);
  return (
    <group name="driver" position={seat} scale={DRIVER_SCALE}>
      <primitive object={rig.root} />
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
export function animateCar(group: THREE.Group, anim: CarAnim, speed: number, angle: number, steer: number, braking: boolean, delta: number, burnout = false) {
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
    // In a burnout the rear wheels spin up while the car barely moves.
    w.rotation.x += ((burnout && !FRONT_WHEELS.includes(name) ? 30 : speed) * delta) / anim.wheelRadius;
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
useGLTF.preload(DRIVER_URL);
BOT_MODELS.forEach((m) => useGLTF.preload(url(m)));
