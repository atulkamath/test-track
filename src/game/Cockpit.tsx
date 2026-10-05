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
import { NIGHT } from "./materials";
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
const DOWN = new THREE.Vector3(0, -1, 0);
const PALM = 0.03;
const WRIST = 0.085;

export interface CockpitHandle {
  update(frame: { steer: number; gear: number; speedKmh: number; rpm: number; delta: number }): void;
  /** Fire the airbag (a big crash). */
  airbag(): void;
  /** Put the airbag away (race restarted). */
  reset(): void;
}

/**
 * The airbag's fabric, wrapped once round the bag: off-white woven cloth, a stitched circular seam with
 * radial seams running out from it, and the maker's words printed across the face the driver sees.
 * (On the sphere that face is at 3/4 of the way round, half-way up.)
 */
function airbagFabric() {
  const { canvas, texture } = canvasTexture(1024, 512);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#e9e6dd";
  ctx.fillRect(0, 0, 1024, 512);
  // Weave: fine speckle, fixed pattern.
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,0.35)" : "rgba(120,112,95,0.12)";
    ctx.fillRect(rnd() * 1024, rnd() * 512, 2, 1);
  }
  const cx = 768;
  const cy = 256;
  // Seams: a stitched ring round the face, and seams running out from it.
  ctx.strokeStyle = "rgba(95, 88, 72, 0.55)";
  ctx.lineWidth = 3;
  ctx.setLineDash([9, 7]);
  ctx.beginPath();
  ctx.ellipse(cx, cy, 190, 205, 0, 0, Math.PI * 2);
  ctx.stroke();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 190, cy + Math.sin(a) * 205);
    ctx.lineTo(cx + Math.cos(a) * 330, cy + Math.sin(a) * 330);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // Soft shading so the face reads as a rounded cushion.
  const shade = ctx.createRadialGradient(cx - 40, cy - 60, 20, cx, cy, 300);
  shade.addColorStop(0, "rgba(255,255,255,0.45)");
  shade.addColorStop(1, "rgba(110,100,80,0.22)");
  ctx.fillStyle = shade;
  ctx.fillRect(512, 0, 512, 512);
  ctx.fillStyle = "#0c0d10";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "italic bold 27px sans-serif";
  ctx.fillText("Airbag designed by", cx, cy - 30);
  ctx.font = "bold 38px sans-serif";
  ctx.fillText("Richard Hammond", cx, cy + 12);
  texture.needsUpdate = true;
  return texture;
}

/** Seconds: bang out of the wheel, stay up, then sag away. */
const BAG_OUT = 0.08;
const BAG_HOLD = 6;
const BAG_GONE = 8.5;
/** Fully out, the bag sits between the wheel and the driver's face and fills most of the view. */
const BAG_AT = new THREE.Vector3(0.305, 0.91, 0.265);
const BAG_RADIUS = 0.135;

/** Maker's badge for the dashboard: pale lettering, like a plate fixed to the passenger side. */
function badgeTexture() {
  const { canvas, texture } = canvasTexture(512, 96);
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 512, 96);
  ctx.strokeStyle = "rgba(225, 228, 232, 0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, 500, 84);
  ctx.fillStyle = "rgba(235, 238, 242, 0.9)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "italic bold 44px sans-serif";
  ctx.fillText("GAME BY ATUL K", 256, 50);
  texture.needsUpdate = true;
  return texture;
}



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
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 120, 0.015, 12, true);
  }, []);
  const state = useRef({ gear: 1, steer: 0, shiftT: 1, lastDash: "", leverFrom: [0, 0] as [number, number] });
  const badge = useMemo(() => badgeTexture(), []);
  const bag = useRef<THREE.Mesh>(null);
  const fabric = useMemo(() => airbagFabric(), []);
  const bagT = useRef(-1);
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

      // Airbag: bursts from the wheel hub toward the driver in a blink, wobbles, holds, then sags down and shrinks.
      if (bag.current) {
        if (bagT.current >= 0) bagT.current += delta;
        if (bagT.current > BAG_GONE) bagT.current = -1;
        const t = bagT.current;
        const out = t < 0 ? 0 : Math.min(t / BAG_OUT, 1);
        const sag = t < BAG_HOLD ? 0 : THREE.MathUtils.smoothstep(t, BAG_HOLD, BAG_GONE);
        bag.current.visible = t >= 0;
        // Dimmer after dark, so it doesn't glow like a lamp.
        (bag.current.material as THREE.MeshBasicMaterial).color.setScalar(0.7 - 0.42 * NIGHT.value);
        bag.current.position.lerpVectors(WHEEL_POS, BAG_AT, out).addScaledVector(DOWN, sag * 0.16);
        const wobble = 1 + 0.07 * Math.sin(t * 38) * Math.exp(-t * 5);
        const full = Math.max(out, 0.02) * wobble;
        // Deflating, it loses height faster than width, like a bag going slack.
        bag.current.scale.set(full * (1 - 0.45 * sag), full * (1 - 0.8 * sag), full * 0.55 * (1 - 0.6 * sag));
      }

      const key = `${gear}|${Math.round(speedKmh / 2)}|${Math.round(rpm / 100)}`;
      if (key !== s.lastDash) {
        drawCluster(cluster.canvas, cluster.texture, gear, speedKmh, rpm);
        s.lastDash = key;
      }
    },
    airbag() {
      if (bagT.current < 0) bagT.current = 0;
    },
    reset() {
      bagT.current = -1;
      if (bag.current) bag.current.visible = false;
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
          {/* Plain and slim: a thin dark rim, three narrow spokes, a small round hub. */}
          <mesh geometry={rimGeometry}>
            <meshStandardMaterial color="#1c1d20" roughness={0.9} />
          </mesh>
          {(
            [
              [0.075, 0, 0, 0.125],
              [-0.075, 0, 0, 0.125],
              [0, -0.062, Math.PI / 2, 0.1],
            ] as const
          ).map(([x, y, rz, len]) => (
            <mesh key={`${x},${y}`} position={[x, y, 0.004]} rotation={[0, 0, rz]}>
              <boxGeometry args={[len, 0.016, 0.008]} />
              <meshStandardMaterial color="#2a2c30" metalness={0.7} roughness={0.35} />
            </mesh>
          ))}
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.004]}>
            <cylinderGeometry args={[0.034, 0.036, 0.024, 28]} />
            {leather}
          </mesh>
          {/* Grip points at 10 and 2 o'clock, turned so a fist's grip axis follows the rim */}
          <object3D ref={anchorL} position={[RIM * Math.cos(GRIP_ANGLE), RIM * Math.sin(GRIP_ANGLE), 0]} rotation={[0, 0, GRIP_ANGLE]} />
          <object3D ref={anchorR} position={[-RIM * Math.cos(GRIP_ANGLE), RIM * Math.sin(GRIP_ANGLE), 0]} rotation={[0, 0, -GRIP_ANGLE]} />
        </group>
      </group>

      {/* Airbag (hidden until a big crash) */}
      <mesh ref={bag} visible={false}>
        <sphereGeometry args={[BAG_RADIUS, 40, 28]} />
        {/* Unlit and held below white: lit by the sun and the cabin lamp at arm's length it burnt out and hid the print. */}
        <meshBasicMaterial map={fabric} color="#b4b2ac" />
      </mesh>

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
        <mesh key={x} position={[x, 0.66, 0.438]}>
          <torusGeometry args={[0.03, 0.006, 8, 24]} />
          {chrome}
        </mesh>
      ))}
      {/* Maker's badge on the passenger side, above the aluminium strip: clear of the hands and the gear knob */}
      <mesh position={[-0.3, 0.771, 0.4365]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.13, 0.0244]} />
        <meshBasicMaterial map={badge} transparent opacity={0.8} toneMapped={false} />
      </mesh>
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
