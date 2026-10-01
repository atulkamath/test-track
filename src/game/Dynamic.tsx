"use client";

// Things that move: AI cars, knocked cones, skid marks. Positions come from the sim; the flair is visual only.
import { useFrame } from "@react-three/fiber";
import { forwardRef, Suspense, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { COS, SIN, type CarState } from "@/sim";
import { animateCar, BOT_MODELS, Car, newCarAnim } from "./Car";
import type { Engine } from "./engine";

export function Traffic({ engine, skids }: { engine: Engine; skids: React.RefObject<SkidHandle | null> }) {
  const count = engine.sim.state.bots.length;
  const refs = useRef<(THREE.Group | null)[]>([]);
  const anims = useMemo(() => Array.from({ length: count }, newCarAnim), [count]);
  useFrame((_, delta) => {
    for (let k = 0; k < count; k++) {
      const g = refs.current[k];
      if (!g) continue;
      const p = engine.botPose(k);
      const bot = engine.sim.state.bots[k];
      g.position.set(p.x, 0, p.z);
      g.rotation.set(0, p.angle, 0);
      const a = anims[k];
      let dA = p.angle - a.lastAngle;
      if (dA > Math.PI) dA -= Math.PI * 2;
      if (dA < -Math.PI) dA += Math.PI * 2;
      const steer = Math.max(-1, Math.min(1, (dA / Math.max(delta, 1e-3)) * 1.5));
      const braking = bot.speed < a.lastSpeed - 0.2;
      animateCar(g, a, bot.speed, p.angle, steer, braking, delta);
      skids.current?.track(`bot${k}`, bot, p.x, p.z, p.angle, braking);
    }
  });
  return (
    <Suspense fallback={null}>
      {Array.from({ length: count }, (_, k) => (
        <Car key={k} model={BOT_MODELS[k % BOT_MODELS.length]} variant={k + 1} ref={(g) => void (refs.current[k] = g)} />
      ))}
    </Suspense>
  );
}

/** Cones and tyre stacks, straight from the sim's obstacle list. Knocked cones tumble away. */
export function Obstacles({ engine }: { engine: Engine }) {
  const obstacles = engine.sim.track.obstacles;
  const cones = useMemo(() => obstacles.map((o, i) => ({ o, i })).filter(({ o }) => o.kind === "cone"), [obstacles]);
  const tyres = useMemo(() => obstacles.filter((o) => o.kind === "tyre"), [obstacles]);
  const coneRefs = useRef<(THREE.Group | null)[]>([]);
  const knockedAt = useRef(new Map<number, number>());
  const tyreMesh = useRef<THREE.InstancedMesh>(null);

  // New engine (restart) = fresh cones.
  useLayoutEffect(() => {
    knockedAt.current.clear();
    cones.forEach(({ o }, j) => {
      const g = coneRefs.current[j];
      g?.position.set(o.x, 0, o.z);
      g?.rotation.set(0, 0, 0);
    });
  }, [engine, cones]);

  useLayoutEffect(() => {
    const mesh = tyreMesh.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const black = new THREE.Color("#1b1b1b");
    const red = new THREE.Color("#c8322b");
    const white = new THREE.Color("#eeeeee");
    tyres.forEach((t, k) => {
      for (let j = 0; j < 3; j++) {
        m.makeTranslation(t.x, 0.18 + j * 0.36, t.z);
        mesh.setMatrixAt(k * 3 + j, m);
        mesh.setColorAt(k * 3 + j, j === 2 ? (k % 2 ? red : white) : black);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [tyres]);

  const axis = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }) => {
    const knocked = engine.sim.state.knocked;
    cones.forEach(({ o, i }, j) => {
      const k = knocked[i];
      const g = coneRefs.current[j];
      if (!k || !g) return;
      if (!knockedAt.current.has(i)) knockedAt.current.set(i, clock.elapsedTime);
      const t = clock.elapsedTime - knockedAt.current.get(i)!;
      const slide = 0.22 * (1 - Math.exp(-3 * t));
      const hop = Math.max(0, 6 * t - 15 * t * t);
      g.position.set(o.x + k.vx * slide, hop, o.z + k.vz * slide);
      const len = Math.hypot(k.vx, k.vz) || 1;
      axis.set(k.vz / len, 0, -k.vx / len);
      g.quaternion.setFromAxisAngle(axis, -Math.min(Math.PI / 2, t * 7));
      g.rotateY(t < 0.6 ? t * 12 : 7.2);
    });
  });

  return (
    <group>
      {cones.map(({ o }, j) => (
        <group key={j} position={[o.x, 0, o.z]} ref={(g) => void (coneRefs.current[j] = g)}>
          <mesh position={[0, 0.45, 0]} castShadow>
            <coneGeometry args={[0.35, 0.9, 16]} />
            <meshStandardMaterial color="#ff7a1a" roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.62, 0]}>
            <cylinderGeometry args={[0.13, 0.19, 0.14, 16, 1, true]} />
            <meshStandardMaterial color="#f4f4f4" roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.03, 0]}>
            <boxGeometry args={[0.8, 0.06, 0.8]} />
            <meshStandardMaterial color="#222" />
          </mesh>
        </group>
      ))}
      {tyres.length > 0 && (
        <instancedMesh ref={tyreMesh} args={[undefined, undefined, tyres.length * 3]} castShadow receiveShadow>
          <cylinderGeometry args={[0.55, 0.55, 0.34, 16]} />
          <meshStandardMaterial roughness={0.9} />
        </instancedMesh>
      )}
    </group>
  );
}

export interface SkidHandle {
  /** Call every frame per car; lays rubber from the rear wheels while it slides or brakes hard. */
  track(key: string, car: CarState, x: number, z: number, angle: number, braking: boolean): void;
  clear(): void;
}

const SKID_CAPACITY = 2400;
const SMOKE_CAPACITY = 360;
/** Seconds a puff of tyre smoke lasts. */
const SMOKE_LIFE = 1.5;

/** Tyre smoke: soft puffs that rise, swell and fade. Each particle is a point with a birth time; the shader does the rest. */
function makeSmoke() {
  const position = new Float32Array(SMOKE_CAPACITY * 3);
  const birth = new Float32Array(SMOKE_CAPACITY).fill(-1000);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("aBirth", new THREE.BufferAttribute(birth, 1));
  const uniforms = { uTime: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float aBirth;
      varying float vFade;
      void main() {
        float age = uTime - aBirth;
        float life = ${SMOKE_LIFE.toFixed(2)};
        vFade = age < 0.0 || age > life ? 0.0 : 1.0 - age / life;
        vec3 p = position + vec3(0.0, age * 1.1, 0.0);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = vFade > 0.0 ? (0.5 + age * 2.4) * 520.0 / max(-mv.z, 0.5) : 0.0;
      }`,
    fragmentShader: /* glsl */ `
      varying float vFade;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float soft = 1.0 - smoothstep(0.2, 1.0, d);
        if (soft * vFade < 0.01) discard;
        gl_FragColor = vec4(vec3(0.86), soft * vFade * 0.32);
      }`,
  });
  let next = 0;
  return {
    geometry,
    material,
    setTime(time: number) {
      uniforms.uTime.value = time;
    },
    /** Start a puff at (x, z) on the ground. */
    emit(x: number, z: number) {
      position.set([x + (Math.random() - 0.5) * 0.3, 0.15, z + (Math.random() - 0.5) * 0.3], next * 3);
      birth[next] = uniforms.uTime.value;
      next = (next + 1) % SMOKE_CAPACITY;
      geometry.getAttribute("position").needsUpdate = true;
      geometry.getAttribute("aBirth").needsUpdate = true;
    },
  };
}

export const SkidMarks = forwardRef<SkidHandle>(function SkidMarks(_, ref) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const next = useRef(0);
  const last = useRef(new Map<string, [number, number][] | null>());
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }), []);
  const smoke = useMemo(() => makeSmoke(), []);
  const puffClock = useRef(0);
  useFrame(({ clock }) => smoke.setTime(clock.elapsedTime));

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    // Park every slot far below the ground until used.
    tmp.m.makeTranslation(0, -1000, 0);
    for (let i = 0; i < SKID_CAPACITY; i++) m.setMatrixAt(i, tmp.m);
    m.instanceMatrix.needsUpdate = true;
  }, [tmp]);

  useImperativeHandle(ref, () => ({
    track(key, car, x, z, angle, braking) {
      const m = mesh.current;
      if (!m) return;
      const side = car.vx * COS[car.heading] - car.vz * SIN[car.heading];
      const sliding = !car.offRoad && (Math.abs(side) > 3.2 || (braking && car.speed > 22));
      if (!sliding) {
        last.current.set(key, null);
        return;
      }
      const fx = Math.sin(angle);
      const fz = Math.cos(angle);
      // Rear wheels: 1 m behind centre, 0.45 m either side.
      const wheels: [number, number][] = [-1, 1].map((s) => [x - fx * 1 + fz * 0.45 * s, z - fz * 1 - fx * 0.45 * s]);
      // A puff from each rear tyre every few frames while it's sliding.
      if (puffClock.current++ % 3 === 0) for (const [wx, wz] of wheels) smoke.emit(wx, wz);
      const prev = last.current.get(key);
      if (prev) {
        wheels.forEach(([wx, wz], w) => {
          const [px, pz] = prev[w];
          const dx = wx - px;
          const dz = wz - pz;
          const len = Math.hypot(dx, dz);
          if (len < 0.05 || len > 4) return;
          tmp.p.set((wx + px) / 2, 0.035, (wz + pz) / 2);
          tmp.q.setFromAxisAngle(tmp.up, Math.atan2(dx, dz));
          tmp.s.set(0.28, 1, len + 0.05);
          tmp.m.compose(tmp.p, tmp.q, tmp.s);
          m.setMatrixAt(next.current, tmp.m);
          next.current = (next.current + 1) % SKID_CAPACITY;
        });
        m.instanceMatrix.needsUpdate = true;
      }
      last.current.set(key, wheels);
    },
    clear() {
      const m = mesh.current;
      if (!m) return;
      tmp.m.makeTranslation(0, -1000, 0);
      for (let i = 0; i < SKID_CAPACITY; i++) m.setMatrixAt(i, tmp.m);
      m.instanceMatrix.needsUpdate = true;
      last.current.clear();
    },
  }));

  return (
    <>
      <instancedMesh ref={mesh} args={[geometry, undefined, SKID_CAPACITY]} frustumCulled={false} receiveShadow>
        <meshStandardMaterial color="#141414" transparent opacity={0.45} depthWrite={false} polygonOffset polygonOffsetFactor={-2} roughness={1} />
      </instancedMesh>
      <points geometry={smoke.geometry} material={smoke.material} frustumCulled={false} />
    </>
  );
});
