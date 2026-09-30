"use client";

// Car interior for the cockpit view: dash with live digital gauges, a steering wheel that turns with your
// input, gloved hands, and an H-pattern lever your right hand reaches for on every gear change.
// Coordinates are in the car's local frame (metres): +z forward, +x left, y up. Driver sits on the left.
import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import * as THREE from "three";

export const EYE = new THREE.Vector3(0.38, 1.22, -0.22);
const WHEEL_POS = new THREE.Vector3(0.38, 0.98, 0.18);
const LEVER_PIVOT = new THREE.Vector3(-0.02, 0.74, 0.02);
const SHOULDER_L = new THREE.Vector3(0.6, 1.02, -0.32);
const SHOULDER_R = new THREE.Vector3(0.16, 1.02, -0.32);
/** How long the hand spends reaching for the lever and back (seconds). */
const SHIFT_TIME = 0.45;

export interface CockpitHandle {
  update(frame: { steer: number; gear: number; speedKmh: number; rpm: number; delta: number }): void;
}

/** Stretch a unit-height cylinder between two points (for forearms and pillars). */
function span(obj: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  obj.position.copy(a).add(b).multiplyScalar(0.5);
  const dir = new THREE.Vector3().subVectors(b, a);
  obj.scale.set(1, dir.length(), 1);
  obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
}

function dashTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 112;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { canvas: c, texture: t };
}

function drawDash(canvas: HTMLCanvasElement, gear: number, speedKmh: number, rpm: number) {
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#07090d";
  ctx.fillRect(0, 0, 256, 112);
  // Shift-light bar across the top.
  const lit = Math.round((Math.min(rpm, 9000) / 9000) * 16);
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = i < lit ? (i < 9 ? "#35d05a" : i < 13 ? "#f2c230" : "#ff3b30") : "#1a1f27";
    ctx.fillRect(8 + i * 15, 6, 12, 10);
  }
  ctx.fillStyle = "#f2c230";
  ctx.font = "italic bold 64px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(gear === 0 ? "N" : String(gear), 128, 86);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px monospace";
  ctx.textAlign = "left";
  ctx.fillText(String(Math.round(speedKmh)).padStart(3, " "), 10, 70);
  ctx.font = "12px monospace";
  ctx.fillStyle = "#9fb4c8";
  ctx.fillText("KM/H", 12, 88);
  ctx.textAlign = "right";
  ctx.font = "bold 22px monospace";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(String(Math.round(rpm / 100) * 100), 246, 70);
  ctx.font = "12px monospace";
  ctx.fillStyle = "#9fb4c8";
  ctx.fillText("RPM", 246, 88);
}

/** H-pattern: 1/3/5 forward, 2/4/6 back; left/centre/right gates. */
function leverAngles(gear: number): [number, number] {
  if (gear <= 0) return [0, 0];
  const fwd = gear % 2 === 1 ? 0.32 : -0.32;
  const gate = gear <= 2 ? 0.16 : gear <= 4 ? 0 : -0.16;
  return [fwd, gate];
}

export const Cockpit = forwardRef<CockpitHandle>(function Cockpit(_, ref) {
  const wheelSpin = useRef<THREE.Group>(null);
  const lever = useRef<THREE.Group>(null);
  const handR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Mesh>(null);
  const armR = useRef<THREE.Mesh>(null);
  const anchorL = useRef<THREE.Object3D>(null);
  const anchorR = useRef<THREE.Object3D>(null);
  const root = useRef<THREE.Group>(null);
  const dash = useMemo(dashTexture, []);
  const state = useRef({ gear: 1, steer: 0, shiftT: 1, lastDash: "", leverFrom: [0, 0] as [number, number] });
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), knob: new THREE.Vector3() }), []);

  useImperativeHandle(ref, () => ({
    update({ steer, gear, speedKmh, rpm, delta }) {
      const s = state.current;
      if (!root.current || !wheelSpin.current || !lever.current || !handR.current) return;
      s.steer += (steer - s.steer) * (1 - Math.exp(-delta * 10));
      wheelSpin.current.rotation.z = -s.steer * 1.6; // left input turns the top of the wheel left (+x)

      if (gear !== s.gear) {
        s.leverFrom = leverAngles(s.gear);
        s.gear = gear;
        s.shiftT = 0;
      }
      s.shiftT = Math.min(1, s.shiftT + delta / SHIFT_TIME);
      // Hand out (0..0.35), lever moves (0.35..0.65), hand back (0.65..1).
      const reach = s.shiftT < 0.35 ? s.shiftT / 0.35 : s.shiftT < 0.65 ? 1 : 1 - (s.shiftT - 0.65) / 0.35;
      const move = THREE.MathUtils.smoothstep(s.shiftT, 0.35, 0.65);
      const to = leverAngles(gear);
      lever.current.rotation.set(s.leverFrom[0] + (to[0] - s.leverFrom[0]) * move, 0, s.leverFrom[1] + (to[1] - s.leverFrom[1]) * move);

      // Right hand: blend from its spot on the wheel rim to the lever knob.
      root.current.updateMatrixWorld();
      anchorR.current!.getWorldPosition(tmp.a);
      root.current.worldToLocal(tmp.a);
      lever.current.localToWorld(tmp.knob.set(0, 0.24, 0));
      root.current.worldToLocal(tmp.knob);
      const e = THREE.MathUtils.smootherstep(reach, 0, 1);
      handR.current.position.lerpVectors(tmp.a, tmp.knob, e);
      handR.current.rotation.set(0, 0, -s.steer * 1.6 * (1 - e));

      // Forearms from shoulders to hands.
      anchorL.current!.getWorldPosition(tmp.b);
      root.current.worldToLocal(tmp.b);
      span(armL.current!, SHOULDER_L, tmp.b);
      span(armR.current!, SHOULDER_R, handR.current.position);

      const key = `${gear}|${Math.round(speedKmh)}|${Math.round(rpm / 300)}`;
      if (key !== s.lastDash) {
        drawDash(dash.canvas, gear, speedKmh, rpm);
        dash.texture.needsUpdate = true;
        s.lastDash = key;
      }
    },
  }));

  const trim = <meshStandardMaterial color="#1b1d21" roughness={0.8} />;
  const glove = <meshStandardMaterial color="#20242b" roughness={0.6} />;
  const pillar = (a: [number, number, number], b: [number, number, number]) => {
    const m = new THREE.Object3D();
    span(m, new THREE.Vector3(...a), new THREE.Vector3(...b));
    return (
      <mesh position={m.position} quaternion={m.quaternion} scale={[1, m.scale.y, 1]}>
        <cylinderGeometry args={[0.045, 0.06, 1, 8]} />
        {trim}
      </mesh>
    );
  };

  return (
    <group ref={root}>
      {/* Dashboard, gauge cowl and the live display */}
      <mesh position={[0, 0.9, 0.52]}>
        <boxGeometry args={[1.7, 0.24, 0.5]} />
        <meshStandardMaterial color="#15171b" roughness={0.9} />
      </mesh>
      <mesh position={[0.38, 1.055, 0.4]}>
        <boxGeometry args={[0.5, 0.07, 0.28]} />
        {trim}
      </mesh>
      <mesh position={[0.38, 0.985, 0.262]} rotation={[0.3, Math.PI, 0]}>
        <planeGeometry args={[0.34, 0.15]} />
        <meshBasicMaterial map={dash.texture} toneMapped={false} />
      </mesh>
      {/* Centre console, doors, header, roof lining, A-pillars, mirror */}
      <mesh position={[-0.02, 0.58, 0.05]}>
        <boxGeometry args={[0.26, 0.32, 0.8]} />
        {trim}
      </mesh>
      {[0.84, -0.84].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.78, -0.25]}>
            <boxGeometry args={[0.06, 0.5, 1.5]} />
            <meshStandardMaterial color="#26292f" roughness={0.85} />
          </mesh>
          <mesh position={[x * 0.97, 1.04, -0.25]}>
            <boxGeometry args={[0.12, 0.05, 1.5]} />
            <meshStandardMaterial color="#8a1d1d" roughness={0.6} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 1.56, 0.08]}>
        <boxGeometry args={[1.5, 0.1, 0.1]} />
        {trim}
      </mesh>
      <mesh position={[0, 1.62, -0.45]}>
        <boxGeometry args={[1.5, 0.04, 1.0]} />
        <meshStandardMaterial color="#2b2e33" roughness={0.95} />
      </mesh>
      {pillar([0.8, 0.98, 0.62], [0.66, 1.58, 0.06])}
      {pillar([-0.8, 0.98, 0.62], [-0.66, 1.58, 0.06])}
      <mesh position={[0.02, 1.47, 0.1]}>
        <boxGeometry args={[0.26, 0.07, 0.03]} />
        <meshStandardMaterial color="#9aa6b2" metalness={0.9} roughness={0.1} />
      </mesh>

      {/* Steering wheel (tilted toward the driver) with the left hand fixed on the rim */}
      <group position={WHEEL_POS} rotation={[0.35, 0, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.12]}>
          <cylinderGeometry args={[0.03, 0.04, 0.25, 10]} />
          {trim}
        </mesh>
        <group ref={wheelSpin}>
          <mesh>
            <torusGeometry args={[0.17, 0.022, 10, 36]} />
            <meshStandardMaterial color="#111316" roughness={0.5} />
          </mesh>
          {/* Three spokes: left, right, bottom */}
          {(
            [
              [0.085, 0, 0.17, 0.03],
              [-0.085, 0, 0.17, 0.03],
              [0, -0.085, 0.03, 0.17],
            ] as const
          ).map(([x, y, w, h]) => (
            <mesh key={`${x},${y}`} position={[x, y, 0]}>
              <boxGeometry args={[w, h, 0.015]} />
              <meshStandardMaterial color="#2a2d33" metalness={0.5} roughness={0.4} />
            </mesh>
          ))}
          <mesh>
            <cylinderGeometry args={[0.045, 0.045, 0.03, 16]} />
            <meshStandardMaterial color="#c8322b" roughness={0.4} />
          </mesh>
          {/* 9 o'clock (+x, driver's left) and 3 o'clock anchors */}
          <object3D ref={anchorL} position={[0.17, 0, 0]} />
          <object3D ref={anchorR} position={[-0.17, 0, 0]} />
          <mesh position={[0.17, 0, -0.01]}>
            <boxGeometry args={[0.06, 0.1, 0.07]} />
            {glove}
          </mesh>
        </group>
      </group>

      {/* Right hand (moves between wheel and lever) and forearms */}
      <group ref={handR}>
        <mesh>
          <boxGeometry args={[0.06, 0.1, 0.07]} />
          {glove}
        </mesh>
      </group>
      <mesh ref={armL}>
        <cylinderGeometry args={[0.035, 0.045, 1, 8]} />
        <meshStandardMaterial color="#c8322b" roughness={0.7} />
      </mesh>
      <mesh ref={armR}>
        <cylinderGeometry args={[0.035, 0.045, 1, 8]} />
        <meshStandardMaterial color="#c8322b" roughness={0.7} />
      </mesh>

      {/* Gear lever */}
      <group ref={lever} position={LEVER_PIVOT}>
        <mesh position={[0, 0.11, 0]}>
          <cylinderGeometry args={[0.012, 0.016, 0.22, 8]} />
          <meshStandardMaterial color="#b9c0c7" metalness={0.8} roughness={0.25} />
        </mesh>
        <mesh position={[0, 0.24, 0]}>
          <sphereGeometry args={[0.035, 16, 12]} />
          <meshStandardMaterial color="#111316" roughness={0.3} />
        </mesh>
      </group>
      <mesh position={[-0.02, 0.745, 0.02]}>
        <boxGeometry args={[0.12, 0.02, 0.14]} />
        <meshStandardMaterial color="#0b0c0e" roughness={0.9} />
      </mesh>
    </group>
  );
});
