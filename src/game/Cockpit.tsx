"use client";

// Everything you look at from the driver's seat. The Azura model's own interior is only a black shell (no
// dials, no shifter, flat mirrors), so the parts that matter are built here and laid over it:
// an instrument cluster with analog dials, a steering wheel that follows your input, gloved hands and arms,
// an H-pattern shifter the right hand reaches for on every gear change, and working mirrors.
// Positions are in the car's local frame (metres): +z forward, +x left, y up, and were measured from the
// model: steering wheel centred at (0.30, 0.81, 0.27), rear-view mirror at (0.01, 1.02, 0.18), left door
// mirror at (0.71, 0.83, 0.34), cabin roof at ~1.12, left-hand drive.
import { useFBO } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
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
/** The mirrors' camera looks straight back from just behind the rear bumper, so our own car isn't in the shot. */
const MIRROR_CAM = new THREE.Vector3(0, 1.0, -2.1);
/** Redraw the mirrors every N frames; a full extra scene render each frame isn't worth it. */
const MIRROR_EVERY = 3;

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

/** A gloved fist gripping a bar that runs along local y: curled fingers wrap it, thumb on top, cuff behind. */
function Fist() {
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, Math.PI * 0.15]}>
        <torusGeometry args={[0.032, 0.019, 8, 14, Math.PI * 1.45]} />
        <meshStandardMaterial color={GLOVE} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0, -0.04]} rotation={[Math.PI / 2, 0, 0]} scale={[1.15, 1, 0.8]}>
        <capsuleGeometry args={[0.03, 0.05, 6, 12]} />
        <meshStandardMaterial color={GLOVE} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.03, -0.012]} rotation={[0.9, 0, 0]}>
        <capsuleGeometry args={[0.012, 0.035, 4, 8]} />
        <meshStandardMaterial color={GLOVE} roughness={0.55} />
      </mesh>
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

/** Point the mirror camera straight back from behind the car and render the scene into the mirror texture. */
function renderMirror(gl: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, target: THREE.WebGLRenderTarget, car: THREE.Object3D, hide: THREE.Object3D) {
  car.updateMatrixWorld();
  cam.position.copy(car.localToWorld(MIRROR_CAM.clone()));
  cam.lookAt(car.localToWorld(new THREE.Vector3(MIRROR_CAM.x, MIRROR_CAM.y - 0.6, MIRROR_CAM.z - 30)));
  // The mirror surfaces must not be drawn while they are the render target (that's a feedback loop).
  hide.visible = false;
  const previous = gl.getRenderTarget();
  gl.setRenderTarget(target);
  gl.render(scene, cam);
  gl.setRenderTarget(previous);
  hide.visible = true;
}

/** Mirrors flip left and right. */
function flipped(texture: THREE.Texture) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.set(-1, 1);
  texture.offset.set(1, 0);
  return texture;
}

/** A mirror-glass rectangle showing only part of the shared rear view (u0..u1, v0..v1 of the image). */
function croppedPlane(w: number, h: number, u0: number, u1: number, v0: number, v1: number) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}

// Angles that turn each mirror to face the driver's eye (a plane faces +z; rotating about y by a turns it to
// (sin a, cos a)). Interior mirror -> eye is (+0.30, -0.39); door mirror -> eye is (-0.40, -0.54).
const REAR_MIRROR_YAW = Math.atan2(0.3, -0.385);
const DOOR_MIRROR_YAW = Math.atan2(-0.4, -0.54);

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
  const mirrors = useRef<THREE.Group>(null);
  const cluster = useMemo(() => canvasTexture(512, 200), []);
  const knob = useMemo(() => knobTexture(), []);
  const state = useRef({ gear: 1, steer: 0, shiftT: 1, lastDash: "", leverFrom: [0, 0] as [number, number], frame: 0 });
  const tmp = useMemo(
    () => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), knob: new THREE.Vector3(), el: new THREE.Vector3(), q: new THREE.Quaternion() }),
    [],
  );

  // Mirrors: a low-resolution render of the view behind the car, shared by the rear-view and door mirrors.
  const mirrorTarget = useFBO(384, 192, { type: THREE.HalfFloatType });
  const mirrorCam = useMemo(() => new THREE.PerspectiveCamera(38, 2, 0.5, 1200), []);
  const mirrorMap = useMemo(() => flipped(mirrorTarget.texture), [mirrorTarget]);
  // The door mirror shows the left third of the view behind (the lane beside you).
  const doorGlass = useMemo(() => croppedPlane(0.15, 0.085, 0, 0.4, 0.15, 0.85), []);

  useFrame(({ gl, scene }) => {
    const r = root.current;
    // Only while the cockpit is actually on screen (its parent group is hidden in the other views).
    if (!r || !mirrors.current || !r.parent?.visible || !r.parent.parent) return;
    if (state.current.frame++ % MIRROR_EVERY !== 0) return;
    renderMirror(gl, scene, mirrorCam, mirrorTarget, r.parent.parent, mirrors.current);
  });

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

      const key = `${gear}|${Math.round(speedKmh / 2)}|${Math.round(rpm / 100)}`;
      if (key !== s.lastDash) {
        drawCluster(cluster.canvas, cluster.texture, gear, speedKmh, rpm);
        s.lastDash = key;
      }
    },
  }));

  const trim = <meshStandardMaterial color="#1b1d21" roughness={0.8} />;
  const leather = <meshStandardMaterial color="#2a2d33" roughness={0.55} />;
  const chrome = <meshStandardMaterial color="#c3c9cf" metalness={0.9} roughness={0.2} />;
  return (
    <group ref={root}>
      {/* The cabin gets no direct sun; a soft light keeps the wheel, dials and hands readable. */}
      <pointLight position={[0.2, 1.0, 0.0]} intensity={0.5} distance={1.4} decay={1.5} color="#fff1dd" />

      {/* Instrument cluster: a hooded binnacle behind the wheel, dials facing the driver, seen through the
          top half of the wheel (below the view of the road) */}
      <group position={[0.3, 0.836, 0.4]} rotation={[0.3, 0, 0]}>
        <mesh position={[0, 0, 0.045]}>
          <boxGeometry args={[0.26, 0.105, 0.1]} />
          {trim}
        </mesh>
        <mesh position={[0, 0.058, 0.02]}>
          <boxGeometry args={[0.28, 0.018, 0.15]} />
          {trim}
        </mesh>
        <mesh position={[0, 0, -0.008]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[0.23, 0.09]} />
          <meshBasicMaterial map={cluster.texture} toneMapped={false} />
        </mesh>
      </group>

      {/* Mirrors: the same live rear view on the interior mirror and the left door mirror */}
      <group ref={mirrors}>
        <mesh position={[0.012, 1.02, 0.166]} rotation={[0, REAR_MIRROR_YAW, 0]}>
          <planeGeometry args={[0.22, 0.062]} />
          <meshBasicMaterial map={mirrorMap} />
        </mesh>
        <mesh position={[0.706, 0.83, 0.313]} rotation={[0, DOOR_MIRROR_YAW, 0]} geometry={doorGlass}>
          <meshBasicMaterial map={mirrorMap} />
        </mesh>
      </group>
      {/* Mirror surrounds, just behind the glass */}
      <mesh position={[0.008, 1.02, 0.172]} rotation={[0, REAR_MIRROR_YAW, 0]}>
        <boxGeometry args={[0.235, 0.076, 0.012]} />
        {trim}
      </mesh>
      <mesh position={[0.712, 0.83, 0.322]} rotation={[0, DOOR_MIRROR_YAW, 0]}>
        <boxGeometry args={[0.165, 0.1, 0.014]} />
        {trim}
      </mesh>

      {/* Steering wheel, tilted toward the driver; the left hand is fixed on the rim at 9 o'clock */}
      <group position={WHEEL_POS} rotation={[WHEEL_TILT, 0, 0]}>
        {/* Column */}
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.13]}>
          <cylinderGeometry args={[0.03, 0.04, 0.26, 12]} />
          {trim}
        </mesh>
        <group ref={wheelSpin}>
          <mesh>
            <torusGeometry args={[RIM, 0.024, 14, 56]} />
            {leather}
          </mesh>
          {/* Thumb grips at 9 and 3, and a yellow top-centre marker */}
          {[-1, 1].map((sx) => (
            <mesh key={sx} position={[sx * (RIM - 0.012), 0.012, -0.004]} scale={[1, 1.5, 1]}>
              <sphereGeometry args={[0.03, 12, 10]} />
              {leather}
            </mesh>
          ))}
          <mesh position={[0, RIM, 0]}>
            <boxGeometry args={[0.018, 0.02, 0.052]} />
            <meshStandardMaterial color="#f2c230" />
          </mesh>
          {/* Three spokes in brushed metal: left, right, bottom */}
          {(
            [
              [0.085, 0, 0],
              [-0.085, 0, 0],
              [0, -0.085, Math.PI / 2],
            ] as const
          ).map(([x, y, rz]) => (
            <mesh key={`${x},${y}`} position={[x, y, 0.004]} rotation={[0, 0, rz]}>
              <boxGeometry args={[0.15, 0.034, 0.012]} />
              {chrome}
            </mesh>
          ))}
          {/* Centre pad */}
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.006]}>
            <cylinderGeometry args={[0.058, 0.064, 0.04, 28]} />
            {leather}
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.028]}>
            <cylinderGeometry args={[0.026, 0.026, 0.006, 24]} />
            {chrome}
          </mesh>
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

      {/* Gear shifter: console, chrome gate surround, leather boot, chrome shaft, knob with the shift pattern */}
      <mesh position={[LEVER_PIVOT.x, LEVER_PIVOT.y - 0.1, LEVER_PIVOT.z]}>
        <boxGeometry args={[0.2, 0.2, 0.3]} />
        {trim}
      </mesh>
      <mesh position={[LEVER_PIVOT.x, LEVER_PIVOT.y + 0.003, LEVER_PIVOT.z]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.062, 0.006, 8, 28]} />
        {chrome}
      </mesh>
      <group ref={lever} position={LEVER_PIVOT}>
        {/* Boot */}
        <mesh position={[0, 0.045, 0]}>
          <cylinderGeometry args={[0.018, 0.058, 0.09, 16]} />
          <meshStandardMaterial color="#17191d" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.045 + LEVER_LEN / 2, 0]}>
          <cylinderGeometry args={[0.009, 0.011, LEVER_LEN - 0.05, 12]} />
          {chrome}
        </mesh>
        {/* Knob: a rounded ball with the pattern on a flat top */}
        <mesh position={[0, LEVER_LEN + 0.01, 0]} scale={[1, 0.92, 1]}>
          <sphereGeometry args={[0.034, 20, 16]} />
          <meshStandardMaterial color="#14161a" roughness={0.35} />
        </mesh>
        <mesh position={[0, LEVER_LEN + 0.041, 0]} rotation={[-Math.PI / 2, 0, Math.PI]}>
          <circleGeometry args={[0.02, 24]} />
          <meshStandardMaterial map={knob} roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
});
