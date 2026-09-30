"use client";

import { useGLTF } from "@react-three/drei";
import { forwardRef, useMemo } from "react";
import * as THREE from "three";

// Kenney Car Kit (CC0) — see CREDITS.md. Model faces +z, which matches sim heading 0.
const MODEL_URL = "/models/sedan-sports.glb";
/** Kenney cars are ~2.5 units long; scale to the ~3.8 unit footprint the old box car had. */
export const CAR_SCALE = 1.5;
/** Wheel radius in world units (model wheel radius 0.3). */
export const WHEEL_RADIUS = 0.3 * CAR_SCALE;
export const FRONT_WHEELS = ["wheel-front-left", "wheel-front-right"];
export const ALL_WHEELS = [...FRONT_WHEELS, "wheel-back-left", "wheel-back-right"];

export const Car = forwardRef<THREE.Group>(function Car(_, ref) {
  const { scene } = useGLTF(MODEL_URL);
  const model = useMemo(() => {
    const root = scene.clone(true);
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      const src = o.material as THREE.MeshStandardMaterial;
      if (o.name === "body" || o.name === "spoiler") {
        // The "GT showroom" look: glossy clear-coat paint that reflects the sky.
        o.material = new THREE.MeshPhysicalMaterial({
          map: src.map,
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
    return root;
  }, [scene]);

  return (
    <group ref={ref}>
      <primitive object={model} scale={CAR_SCALE} />
    </group>
  );
});

useGLTF.preload(MODEL_URL);
