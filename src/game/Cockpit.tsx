"use client";

// Everything you look at from the driver's seat. The Azura model's own interior is only a shell (roof lining
// and pillars; Game.tsx removes its flat lid at dash height), so the cabin below the windows is built here: dash,
// door panels, centre console, an instrument cluster with analog dials seen through the wheel, a steering wheel
// that follows your input, gloved hands and arms, and an H-pattern shifter the right hand reaches for on every
// gear change.
// Positions are in the car's local frame (metres): +z forward, +x left, y up. Left-hand drive. The model's own
// fixed steering wheel is removed by scripts/convert-cars.mjs. Layout was tuned against a screenshot: the eye is
// well forward of the headrest so the low roof stays out of shot, and the wheel is small and low enough that
// the dials show between its hub and rim.
import { useGLTF } from "@react-three/drei";
import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import * as THREE from "three";
import { bonePosition, createDriver, DRIVER_SCALE, DRIVER_URL, reach, type DriverRig } from "./driverRig";

export const EYE = new THREE.Vector3(0.31, 0.98, -0.05);
/** Close enough to the driver that the dials can sit just behind it and still be in front of the model's dash. */
const WHEEL_POS = new THREE.Vector3(0.3, 0.73, 0.29);
const WHEEL_TILT = 0.5;
const RIM = 0.14;
/** Hands hold the rim just above 9 and 3 o'clock: this far round from them (radians). */
const GRIP_ANGLE = 0.28;
/** Shifter on the centre console, far enough forward to be in shot. */
const LEVER_LEN = 0.16;
const LEVER_PIVOT = new THREE.Vector3(0.06, 0.66, 0.36);
/** How long the hand spends reaching for the lever and back (seconds). */
const SHIFT_TIME = 0.65;
/** How far the palm sits off the rim or knob, and how far the wrist is behind the palm. */
const PALM = 0.03;
const WRIST = 0.085;

export interface CockpitHandle {
  update(frame: { steer: number; gear: number; speedKmh: number; rpm: number; delta: number }): void;
  /** Fire the airbag (a big crash). Returns false if it is already out. */
  airbag(): boolean;
}

/** What the airbag says when it goes off. */
function airbagTexture() {
  const { canvas, texture } = canvasTexture(512, 256);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#eeece6";
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = "rgba(60, 60, 70, 0.35)";
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 3;
  ctx.strokeRect(14, 14, 484, 228);
  ctx.fillStyle = "#2a2c33";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "italic 34px sans-serif";
  ctx.fillText("Engineered by", 256, 92);
  ctx.font = "bold 54px sans-serif";
  ctx.fillText("Richard Hammond", 256, 152);
  texture.needsUpdate = true;
  return texture;
}

/** Seconds: bang out, hang there, sag away. */
const BAG_OUT = 0.07;
const BAG_HOLD = 3;
const BAG_GONE = 5;


/** Body (not head) of the driver, sized and placed so his eyes are where the camera is. */
function seatDriver(rig: DriverRig) {
  rig.root.scale.setScalar(DRIVER_SCALE);
  rig.root.position.set(0, 0, 0);
  rig.root.updateMatrixWorld(true);
  const head = bonePosition(rig, "Head", new THREE.Vector3());
  // The eyes are a little above and in front of the head joint.
  rig.root.position.copy(EYE).sub(head).add(new THREE.Vector3(0, -0.07, -0.09));
  return rig;
}

function canvasTexture(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return { canvas: c, texture: t };
}

/** One analog dial: ticks and numbers round a 240° sweep, a red zone, and a needle at `value`. */
function drawDial(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, value: number, max: number, step: number, redFrom: number, unit: string) {
  const angle = (v: number) => ((-120 + (Math.min(v, max) / max) * 240 - 90) * Math.PI) / 180;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#0a0c10";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#8f98a3";
  ctx.stroke();
  if (redFrom < max) {
    ctx.beginPath();
    ctx.arc(cx, cy, r - 8, angle(redFrom), angle(max));
    ctx.lineWidth = 7;
    ctx.strokeStyle = "#e0302a";
    ctx.stroke();
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${Math.round(r * 0.19)}px sans-serif`;
  for (let k = 0; k * (step / 2) <= max; k++) {
    const v = k * (step / 2);
    const a = angle(v);
    const major = k % 2 === 0;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
    ctx.lineTo(cx + Math.cos(a) * (r - (major ? 17 : 10)), cy + Math.sin(a) * (r - (major ? 17 : 10)));
    ctx.lineWidth = major ? 3 : 1.5;
    ctx.strokeStyle = "#f2f2f2";
    ctx.stroke();
    if (major) {
      ctx.fillStyle = v >= redFrom ? "#ff6a5f" : "#f2f2f2";
      ctx.fillText(String(v), cx + Math.cos(a) * (r - 31), cy + Math.sin(a) * (r - 31));
    }
  }
  ctx.fillStyle = "#9fb4c8";
  ctx.font = `${Math.round(r * 0.14)}px sans-serif`;
  ctx.fillText(unit, cx, cy + r * 0.45);
  const a = angle(value);
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(a) * 12, cy - Math.sin(a) * 12);
  ctx.lineTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14));
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#ff3b30";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fillStyle = "#1a1d22";
  ctx.fill();
}

/** Instrument cluster: rev counter on the left, speedometer on the right, gear in the middle. */
function drawCluster(canvas: HTMLCanvasElement, texture: THREE.Texture, gear: number, speedKmh: number, rpm: number) {
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#050608";
  ctx.fillRect(0, 0, 512, 200);
  drawDial(ctx, 126, 104, 92, rpm / 1000, 9, 1, 7.5, "x1000 rpm");
  drawDial(ctx, 386, 104, 92, speedKmh, 260, 40, 999, "km/h");
  ctx.fillStyle = "#f2c230";
  ctx.font = "italic bold 62px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(gear === 0 ? "N" : String(gear), 256, 104);
  texture.needsUpdate = true;
}

/** The shift pattern printed on top of the gear knob. */
function knobTexture() {
  const { canvas, texture } = canvasTexture(128, 128);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#101216";
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = "#e8e8e8";
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (const x of [34, 64, 94]) {
    ctx.moveTo(x, 34);
    ctx.lineTo(x, 94);
  }
  ctx.moveTo(34, 64);
  ctx.lineTo(94, 64);
  ctx.stroke();
  ctx.fillStyle = "#e8e8e8";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";
  const labels: [string, number, number][] = [
    ["1", 34, 26],
    ["3", 64, 26],
    ["5", 94, 26],
    ["2", 34, 114],
    ["4", 64, 114],
    ["6", 94, 114],
  ];
  for (const [t, x, y] of labels) ctx.fillText(t, x, y);
  texture.needsUpdate = true;
  return texture;
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
  const { scene: driverScene } = useGLTF(DRIVER_URL);
  const driver = useMemo(() => seatDriver(createDriver(driverScene, { firstPerson: true })), [driverScene]);
  const anchorL = useRef<THREE.Object3D>(null);
  const anchorR = useRef<THREE.Object3D>(null);
  const root = useRef<THREE.Group>(null);
  const cluster = useMemo(() => canvasTexture(512, 200), []);
  const knob = useMemo(() => knobTexture(), []);
  // Flat-bottomed rim, like a modern sports wheel.
  const rimGeometry = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push(new THREE.Vector3(RIM * Math.cos(a), Math.max(RIM * Math.sin(a), -RIM * 0.78), 0));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 120, 0.021, 12, true);
  }, []);
  const state = useRef({ gear: 1, steer: 0, shiftT: 1, lastDash: "", leverFrom: [0, 0] as [number, number], bagT: -1 });
  const bag = useRef<THREE.Group>(null);
  const bagLabel = useMemo(() => airbagTexture(), []);
  const tmp = useMemo(
    () => ({
      pos: new THREE.Vector3(),
      radial: new THREE.Vector3(),
      tangent: new THREE.Vector3(),
      axis: new THREE.Vector3(),
      wrist: new THREE.Vector3(),
      palm: new THREE.Vector3(),
      knob: new THREE.Vector3(),
      knobWrist: new THREE.Vector3(),
      knobFingers: new THREE.Vector3(),
      down: new THREE.Vector3(),
      q: new THREE.Quaternion(),
    }),
    [],
  );

  useImperativeHandle(ref, () => ({
    update({ steer, gear, speedKmh, rpm, delta }) {
      const s = state.current;
      const r = root.current;
      if (!r || !wheelSpin.current || !lever.current || !anchorL.current || !anchorR.current) return;
      s.steer += (steer - s.steer) * (1 - Math.exp(-delta * 10));
      wheelSpin.current.rotation.z = -s.steer * 1.6; // left input turns the top of the wheel left (+x)

      if (gear !== s.gear) {
        s.leverFrom = leverAngles(s.gear);
        s.gear = gear;
        s.shiftT = 0;
      }
      s.shiftT = Math.min(1, s.shiftT + delta / SHIFT_TIME);
      // Hand out (0..0.35), lever moves (0.35..0.65), hand back (0.65..1).
      const reach01 = s.shiftT < 0.35 ? s.shiftT / 0.35 : s.shiftT < 0.65 ? 1 : 1 - (s.shiftT - 0.65) / 0.35;
      const move = THREE.MathUtils.smoothstep(s.shiftT, 0.35, 0.65);
      const to = leverAngles(gear);
      lever.current.rotation.set(s.leverFrom[0] + (to[0] - s.leverFrom[0]) * move, 0, s.leverFrom[1] + (to[1] - s.leverFrom[1]) * move);

      // Hands. On the wheel a hand wraps the rim from outside: palm against it facing the hub, fingers pointing
      // away from the driver and curling round. The right hand leaves for the gear knob on every change,
      // palm down on top of it, and comes back. The arms follow by themselves.
      r.updateMatrixWorld();
      const e = THREE.MathUtils.smootherstep(reach01, 0, 1);
      for (const side of ["Left", "Right"] as const) {
        const anchor = side === "Left" ? anchorL.current : anchorR.current;
        anchor.getWorldPosition(tmp.pos);
        anchor.getWorldQuaternion(tmp.q);
        // The anchor's x axis runs along the wheel's radius (outward on the left, inward on the right), z along the column.
        tmp.radial.set(side === "Left" ? 1 : -1, 0, 0).applyQuaternion(tmp.q);
        tmp.axis.set(0, 0, 1).applyQuaternion(tmp.q);
        tmp.tangent.set(0, 1, 0).applyQuaternion(tmp.q);
        // A relaxed grip, not a clamp: the fingers angle in over the rim and slightly upward, the palm turns
        // a little toward the driver, and the wrist drops below the rim rather than sitting square behind it.
        tmp.palm.copy(tmp.radial).multiplyScalar(-0.85).addScaledVector(tmp.axis, -0.3).normalize();
        tmp.axis.multiplyScalar(0.85).addScaledVector(tmp.radial, -0.3).addScaledVector(tmp.tangent, 0.3).normalize();
        tmp.wrist.copy(tmp.pos).addScaledVector(tmp.radial, PALM).addScaledVector(tmp.axis, -WRIST);
        if (side === "Right" && e > 0) {
          r.getWorldQuaternion(tmp.q);
          lever.current.localToWorld(tmp.knob.set(0, LEVER_LEN + 0.01, 0));
          tmp.knobFingers.set(0.2, 0, 1).normalize().applyQuaternion(tmp.q);
          tmp.down.set(0, -1, 0).applyQuaternion(tmp.q);
          tmp.knobWrist.copy(tmp.knob).addScaledVector(tmp.down, -PALM).addScaledVector(tmp.knobFingers, -WRIST);
          tmp.wrist.lerp(tmp.knobWrist, e);
          tmp.axis.lerp(tmp.knobFingers, e).normalize();
          tmp.palm.lerp(tmp.down, e).normalize();
        }
        reach(driver, side, tmp.wrist, tmp.axis, tmp.palm);
      }

      // Airbag: out in an instant, then slowly deflating.
      if (bag.current) {
        if (s.bagT >= 0) s.bagT += delta;
        if (s.bagT > BAG_GONE) s.bagT = -1;
        const size = s.bagT < 0 ? 0 : s.bagT < BAG_OUT ? s.bagT / BAG_OUT : s.bagT < BAG_HOLD ? 1 : 1 - (s.bagT - BAG_HOLD) / (BAG_GONE - BAG_HOLD);
        bag.current.visible = size > 0;
        // A touch of wobble just after it fires.
        bag.current.scale.setScalar(Math.max(size, 0.001) * (1 + 0.06 * Math.sin(s.bagT * 40) * Math.exp(-s.bagT * 6)));
      }

      const key = `${gear}|${Math.round(speedKmh / 2)}|${Math.round(rpm / 100)}`;
      if (key !== s.lastDash) {
        drawCluster(cluster.canvas, cluster.texture, gear, speedKmh, rpm);
        s.lastDash = key;
      }
    },
    airbag() {
      if (state.current.bagT >= 0) return false;
      state.current.bagT = 0;
      return true;
    },
  }));

  const trim = <meshStandardMaterial color="#1b1d21" roughness={0.8} />;
  const leather = <meshStandardMaterial color="#2a2d33" roughness={0.55} />;
  const chrome = <meshStandardMaterial color="#c3c9cf" metalness={0.9} roughness={0.2} />;
  return (
    <group ref={root}>
      {/* The cabin gets no direct sun; a soft light keeps the wheel, dials and hands readable. */}
      <pointLight position={[0.2, 0.95, 0.12]} intensity={0.9} distance={1.6} decay={1.5} color="#fff1dd" />

      {/* Steering wheel, tilted toward the driver; the left hand stays on the rim at 10 o'clock */}
      <group position={WHEEL_POS} rotation={[WHEEL_TILT, 0, 0]}>
        {/* Column */}
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.13]}>
          <cylinderGeometry args={[0.03, 0.04, 0.26, 12]} />
          {trim}
        </mesh>
        {/* Dials: mounted on the column 3 cm behind the wheel and in line with it, so they show through the top
            half of the wheel and nothing in the car model can cover them. They don't turn with the wheel. */}
        <group position={[0, 0.082, 0.03]}>
          <mesh rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[0.2, 0.078]} />
            <meshBasicMaterial map={cluster.texture} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0, 0.012]}>
            <boxGeometry args={[0.215, 0.092, 0.02]} />
            {trim}
          </mesh>
        </group>
        <group ref={wheelSpin}>
          <mesh geometry={rimGeometry}>
            <meshStandardMaterial color="#1c1d20" roughness={0.95} />
          </mesh>
          {/* Red top-centre marker */}
          <mesh position={[0, RIM, 0]}>
            <boxGeometry args={[0.014, 0.046, 0.046]} />
            <meshStandardMaterial color="#d8322b" roughness={0.6} />
          </mesh>
          {/* Three satin-black spokes with an aluminium inlay: left, right, bottom */}
          {(
            [
              [0.078, 0, 0, 0.13],
              [-0.078, 0, 0, 0.13],
              [0, -0.062, Math.PI / 2, 0.1],
            ] as const
          ).map(([x, y, rz, len]) => (
            <group key={`${x},${y}`} position={[x, y, 0.004]} rotation={[0, 0, rz]}>
              <mesh>
                <boxGeometry args={[len, 0.034, 0.012]} />
                <meshStandardMaterial color="#111215" metalness={0.6} roughness={0.4} />
              </mesh>
              <mesh position={[0, 0, -0.0065]}>
                <boxGeometry args={[len * 0.8, 0.006, 0.002]} />
                {chrome}
              </mesh>
            </group>
          ))}
          {/* Thumb buttons */}
          {(
            [
              [0.062, 0.011, "#e0302a"],
              [0.09, 0.011, "#f2c230"],
              [-0.062, 0.011, "#2f8fe0"],
              [-0.09, 0.011, "#3cc46a"],
            ] as const
          ).map(([x, y, color]) => (
            <mesh key={x} position={[x, y, -0.004]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.007, 0.007, 0.006, 14]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} roughness={0.4} />
            </mesh>
          ))}
          {/* Shift paddles behind the spokes */}
          {[0.105, -0.105].map((x) => (
            <mesh key={x} position={[x, 0.03, 0.022]}>
              <boxGeometry args={[0.05, 0.075, 0.005]} />
              {chrome}
            </mesh>
          ))}
          {/* Centre pad */}
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.006]}>
            <cylinderGeometry args={[0.046, 0.054, 0.035, 28]} />
            {leather}
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.026]}>
            <torusGeometry args={[0.02, 0.003, 8, 24]} />
            {chrome}
          </mesh>
          {/* Grip points at 10 and 2 o'clock, turned so a fist's grip axis follows the rim */}
          <object3D ref={anchorL} position={[RIM * Math.cos(GRIP_ANGLE), RIM * Math.sin(GRIP_ANGLE), 0]} rotation={[0, 0, GRIP_ANGLE]} />
          <object3D ref={anchorR} position={[-RIM * Math.cos(GRIP_ANGLE), RIM * Math.sin(GRIP_ANGLE), 0]} rotation={[0, 0, -GRIP_ANGLE]} />
        </group>
      </group>

      {/* Airbag: a pillow bursting out of the wheel hub, with a few words on it */}
      <group ref={bag} position={[WHEEL_POS.x, WHEEL_POS.y + 0.09, WHEEL_POS.z - 0.07]} visible={false}>
        <mesh scale={[1, 0.85, 0.5]}>
          <sphereGeometry args={[0.25, 24, 18]} />
          <meshStandardMaterial color="#eeece6" roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.02, -0.128]} rotation={[0.3, Math.PI, 0]}>
          <planeGeometry args={[0.24, 0.12]} />
          <meshBasicMaterial map={bagLabel} />
        </mesh>
      </group>

      {/* The driver's own body: suited arms and gloved hands (head left out, the camera is inside it) */}
      <primitive object={driver.root} />

      {/* Lower cabin. Sizes come from the model: windscreen base and window sills at 0.79 m, body 1.36 m wide inside. */}
      {/* Dash, with an aluminium strip and two vents on its face */}
      <mesh position={[0, 0.54, 0.66]}>
        <boxGeometry args={[1.44, 0.49, 0.44]} />
        <meshStandardMaterial color="#17191c" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.755, 0.438]}>
        <boxGeometry args={[1.3, 0.012, 0.006]} />
        {chrome}
      </mesh>
      {[0.1, -0.08].map((x) => (
        <mesh key={x} position={[x, 0.7, 0.438]}>
          <torusGeometry args={[0.03, 0.006, 8, 24]} />
          {chrome}
        </mesh>
      ))}
      {/* Door panels */}
      {[0.67, -0.67].map((x) => (
        <mesh key={x} position={[x, 0.5, 0.1]}>
          <boxGeometry args={[0.06, 0.6, 1.4]} />
          {trim}
        </mesh>
      ))}
      {/* Floor, centre console, passenger seat cushion */}
      <mesh position={[0, 0.2, 0.1]}>
        <boxGeometry args={[1.34, 0.02, 1.4]} />
        <meshStandardMaterial color="#0c0d0f" roughness={1} />
      </mesh>
      <mesh position={[0, 0.4, -0.08]}>
        <boxGeometry args={[0.2, 0.4, 1.04]} />
        {leather}
      </mesh>
      <mesh position={[-0.31, 0.32, 0.05]}>
        <boxGeometry args={[0.36, 0.22, 0.4]} />
        {leather}
      </mesh>

      {/* Shifter tower rising from the console, so the lever sits up near the wheel */}
      <mesh position={[LEVER_PIVOT.x, (LEVER_PIVOT.y + 0.2) / 2, LEVER_PIVOT.z]}>
        <boxGeometry args={[0.16, LEVER_PIVOT.y - 0.2, 0.2]} />
        {leather}
      </mesh>

      {/* Gear shifter: chrome gate ring, leather boot, chrome shaft, knob with the shift pattern */}
      <mesh position={[LEVER_PIVOT.x, LEVER_PIVOT.y + 0.003, LEVER_PIVOT.z]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.046, 0.005, 8, 28]} />
        {chrome}
      </mesh>
      <group ref={lever} position={LEVER_PIVOT}>
        <mesh position={[0, 0.04, 0]}>
          <cylinderGeometry args={[0.014, 0.042, 0.08, 16]} />
          <meshStandardMaterial color="#17191d" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.04 + LEVER_LEN / 2, 0]}>
          <cylinderGeometry args={[0.007, 0.009, LEVER_LEN - 0.05, 12]} />
          {chrome}
        </mesh>
        <mesh position={[0, LEVER_LEN + 0.01, 0]} scale={[1, 0.92, 1]}>
          <sphereGeometry args={[0.025, 20, 16]} />
          <meshStandardMaterial color="#14161a" roughness={0.35} />
        </mesh>
        <mesh position={[0, LEVER_LEN + 0.033, 0]} rotation={[-Math.PI / 2, 0, Math.PI]}>
          <circleGeometry args={[0.015, 24]} />
          <meshStandardMaterial map={knob} roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
});
