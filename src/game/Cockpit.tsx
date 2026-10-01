"use client";

// The moving parts of the cockpit view. The cabin itself (dash, doors, pillars, roof, bonnet) is the car model's
// own interior; this adds what has to animate: a steering wheel that follows your input, gloved hands and arms,
// a live gauge display on the wheel hub, and an H-pattern shifter the right hand reaches for on every gear change.
// Positions are in the car's local frame (metres): +z forward, +x left, y up, and were measured from the
// Azura model: its steering wheel is centred at (0.30, 0.81, 0.27), cabin roof at ~1.12, left-hand drive.
import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import * as THREE from "three";

/** Driver's eye: low enough that the roof and screen header stay out of the way, just ahead of the headrest. */
export const EYE = new THREE.Vector3(0.31, 0.99, -0.22);
/** Sits a touch nearer the driver than the model's static wheel, so this one is what you see. */
const WHEEL_POS = new THREE.Vector3(0.3, 0.79, 0.25);
/** Raked well back like a sports car's, so the top of the rim stays below the view of the road. */
const WHEEL_TILT = 0.9;
const RIM = 0.15;
/** Shifter between the seats; its knob sits at the bottom edge of the view. */
const LEVER_PIVOT = new THREE.Vector3(0.02, 0.6, 0.16);
const LEVER_LEN = 0.16;
const SHOULDER_L = new THREE.Vector3(0.5, 0.82, -0.28);
const SHOULDER_R = new THREE.Vector3(0.13, 0.82, -0.28);
/** How long the hand spends reaching for the lever and back (seconds). */
const SHIFT_TIME = 0.65;
const SUIT = "#b3261e";
const GLOVE = "#c8322b"; // bright racing gloves read clearly against the dark cabin

export interface CockpitHandle {
  update(frame: { steer: number; gear: number; speedKmh: number; rpm: number; delta: number }): void;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Stretch a unit-length, y-aligned mesh between two points. */
function span(obj: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  obj.position.copy(a).add(b).multiplyScalar(0.5);
  const dir = new THREE.Vector3().subVectors(b, a);
  obj.scale.set(1, dir.length(), 1);
  obj.quaternion.setFromUnitVectors(UP, dir.normalize());
}

/** Elbow sits below and outboard of the shoulder-hand midpoint. */
function elbow(shoulder: THREE.Vector3, hand: THREE.Vector3, out: number, target: THREE.Vector3) {
  return target.lerpVectors(shoulder, hand, 0.5).add(new THREE.Vector3(out * 0.07, -0.13, -0.02));
}

function dashTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 112;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { canvas: c, texture: t };
}

function drawDash(canvas: HTMLCanvasElement, texture: THREE.Texture, gear: number, speedKmh: number, rpm: number) {
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
  texture.needsUpdate = true;
}

/** H-pattern: 1/3/5 forward, 2/4/6 back; left/centre/right gates. */
function leverAngles(gear: number): [number, number] {
  if (gear <= 0) return [0, 0];
  const fwd = gear % 2 === 1 ? 0.32 : -0.32;
  const gate = gear <= 2 ? 0.16 : gear <= 4 ? 0 : -0.16;
  return [fwd, gate];
}

/** A gloved fist gripping a bar that runs along local y: curled fingers wrap it, thumb on top, cuff behind. */
function Fist() {
  return (
    <group>
      {/* Curled fingers wrapping around the grip */}
      <mesh rotation={[Math.PI / 2, 0, Math.PI * 0.15]}>
        <torusGeometry args={[0.032, 0.019, 8, 14, Math.PI * 1.45]} />
        <meshStandardMaterial color={GLOVE} roughness={0.55} />
      </mesh>
      {/* Back of the hand / palm */}
      <mesh position={[0, 0, -0.04]} rotation={[Math.PI / 2, 0, 0]} scale={[1.15, 1, 0.8]}>
        <capsuleGeometry args={[0.03, 0.05, 6, 12]} />
        <meshStandardMaterial color={GLOVE} roughness={0.55} />
      </mesh>
      {/* Thumb resting over the top */}
      <mesh position={[0, 0.03, -0.012]} rotation={[0.9, 0, 0]}>
        <capsuleGeometry args={[0.012, 0.035, 4, 8]} />
        <meshStandardMaterial color={GLOVE} roughness={0.55} />
      </mesh>
      {/* Cuff */}
      <mesh position={[0, 0, -0.09]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.036, 0.034, 0.05, 14]} />
        <meshStandardMaterial color="#f2f2f2" roughness={0.6} />
      </mesh>
    </group>
  );
}

function Limb({ limbRef, radius }: { limbRef: React.RefObject<THREE.Mesh | null>; radius: number }) {
  return (
    <mesh ref={limbRef}>
      <capsuleGeometry args={[radius, 1, 6, 12]} />
      <meshStandardMaterial color={SUIT} roughness={0.75} />
    </mesh>
  );
}

export const Cockpit = forwardRef<CockpitHandle>(function Cockpit(_, ref) {
  const wheelSpin = useRef<THREE.Group>(null);
  const lever = useRef<THREE.Group>(null);
  const handR = useRef<THREE.Group>(null);
  const upperL = useRef<THREE.Mesh>(null);
  const lowerL = useRef<THREE.Mesh>(null);
  const upperR = useRef<THREE.Mesh>(null);
  const lowerR = useRef<THREE.Mesh>(null);
  const anchorL = useRef<THREE.Object3D>(null);
  const anchorR = useRef<THREE.Object3D>(null);
  const root = useRef<THREE.Group>(null);
  const dash = useMemo(() => dashTexture(), []);
  const state = useRef({ gear: 1, steer: 0, shiftT: 1, lastDash: "", leverFrom: [0, 0] as [number, number] });
  const tmp = useMemo(
    () => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), knob: new THREE.Vector3(), el: new THREE.Vector3(), q: new THREE.Quaternion() }),
    [],
  );

  useImperativeHandle(ref, () => ({
    update({ steer, gear, speedKmh, rpm, delta }) {
      const s = state.current;
      const r = root.current;
      if (!r || !wheelSpin.current || !lever.current || !handR.current || !anchorL.current || !anchorR.current) return;
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

      // Right hand: blend from its grip on the rim to the lever knob, keeping the rim's orientation while on it.
      r.updateMatrixWorld();
      anchorR.current.getWorldPosition(tmp.a);
      r.worldToLocal(tmp.a);
      lever.current.localToWorld(tmp.knob.set(0, LEVER_LEN + 0.01, 0));
      r.worldToLocal(tmp.knob);
      const e = THREE.MathUtils.smootherstep(reach, 0, 1);
      handR.current.position.lerpVectors(tmp.a, tmp.knob, e);
      anchorR.current.getWorldQuaternion(tmp.q);
      handR.current.quaternion.copy(r.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(tmp.q));
      handR.current.quaternion.slerp(new THREE.Quaternion(), e);

      // Arms: shoulder -> elbow -> hand.
      anchorL.current.getWorldPosition(tmp.b);
      r.worldToLocal(tmp.b);
      elbow(SHOULDER_L, tmp.b, 1, tmp.el);
      span(upperL.current!, SHOULDER_L, tmp.el);
      span(lowerL.current!, tmp.el, tmp.b);
      elbow(SHOULDER_R, handR.current.position, -1, tmp.el);
      span(upperR.current!, SHOULDER_R, tmp.el);
      span(lowerR.current!, tmp.el, handR.current.position);

      const key = `${gear}|${Math.round(speedKmh)}|${Math.round(rpm / 300)}`;
      if (key !== s.lastDash) {
        drawDash(dash.canvas, dash.texture, gear, speedKmh, rpm);
        s.lastDash = key;
      }
    },
  }));

  const trim = <meshStandardMaterial color="#1b1d21" roughness={0.8} />;
  return (
    <group ref={root}>
      {/* The cabin gets no direct sun; a soft light keeps the wheel and hands readable. */}
      <pointLight position={[0.2, 1.0, 0.0]} intensity={0.5} distance={1.4} decay={1.5} color="#fff1dd" />

      {/* Steering wheel, tilted toward the driver; the left hand is fixed on the rim at 9 o'clock */}
      <group position={WHEEL_POS} rotation={[WHEEL_TILT, 0, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.13]}>
          <cylinderGeometry args={[0.03, 0.04, 0.26, 12]} />
          {trim}
        </mesh>
        {/* Race-style display on the hub (does not turn with the wheel), facing the driver */}
        <mesh position={[0, 0, -0.022]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[0.125, 0.055]} />
          <meshBasicMaterial map={dash.texture} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0, -0.012]}>
          <boxGeometry args={[0.14, 0.068, 0.014]} />
          {trim}
        </mesh>
        <group ref={wheelSpin}>
          <mesh>
            <torusGeometry args={[RIM, 0.022, 12, 48]} />
            <meshStandardMaterial color="#3a3f47" roughness={0.38} />
          </mesh>
          {/* Yellow top-centre marker */}
          <mesh position={[0, RIM, 0]}>
            <boxGeometry args={[0.018, 0.02, 0.052]} />
            <meshStandardMaterial color="#f2c230" />
          </mesh>
          {(
            [
              [0.085, 0, 0.17, 0.03],
              [-0.085, 0, 0.17, 0.03],
              [0, -0.085, 0.03, 0.17],
            ] as const
          ).map(([x, y, w, h]) => (
            <mesh key={`${x},${y}`} position={[x, y, 0]}>
              <boxGeometry args={[w, h, 0.015]} />
              <meshStandardMaterial color="#c3c9cf" metalness={0.85} roughness={0.25} />
            </mesh>
          ))}
          <object3D ref={anchorL} position={[RIM, 0, 0]} />
          <object3D ref={anchorR} position={[-RIM, 0, 0]} />
          <group position={[RIM, 0, 0]}>
            <Fist />
          </group>
        </group>
      </group>

      {/* Right hand (travels between wheel and lever) and both arms */}
      <group ref={handR}>
        <Fist />
      </group>
      <Limb limbRef={upperL} radius={0.05} />
      <Limb limbRef={lowerL} radius={0.042} />
      <Limb limbRef={upperR} radius={0.05} />
      <Limb limbRef={lowerR} radius={0.042} />

      {/* Raised shifter tower rising from the console, with the H-gate plate on top */}
      <mesh position={[LEVER_PIVOT.x, LEVER_PIVOT.y - 0.09, LEVER_PIVOT.z]}>
        <boxGeometry args={[0.14, 0.18, 0.18]} />
        {trim}
      </mesh>
      <mesh position={[LEVER_PIVOT.x, LEVER_PIVOT.y + 0.004, LEVER_PIVOT.z]}>
        <boxGeometry args={[0.12, 0.01, 0.14]} />
        <meshStandardMaterial color="#9aa3ad" metalness={0.85} roughness={0.25} />
      </mesh>
      {/* Gear lever */}
      <group ref={lever} position={LEVER_PIVOT}>
        <mesh position={[0, LEVER_LEN / 2, 0]}>
          <cylinderGeometry args={[0.011, 0.015, LEVER_LEN, 10]} />
          <meshStandardMaterial color="#b9c0c7" metalness={0.85} roughness={0.2} />
        </mesh>
        <mesh position={[0, LEVER_LEN + 0.01, 0]}>
          <sphereGeometry args={[0.03, 16, 12]} />
          <meshStandardMaterial color="#c8322b" roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.012, 0]}>
          <cylinderGeometry args={[0.035, 0.045, 0.03, 12]} />
          <meshStandardMaterial color="#0b0c0e" roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
});
