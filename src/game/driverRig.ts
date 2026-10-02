// The race driver: "race driver" by BELAZ (CC-BY 4.0, see CREDITS.md), a rigged figure in a race suit and helmet.
// This file poses the skeleton directly: sat in the seat, arms reaching for whatever the hands should hold
// (two-bone IK), fingers curled into a grip. Everything works from bone positions, not the rig's own axes.
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

export const DRIVER_URL = "/models/driver.glb";
/** The model is 1.87 m tall; the cars are slightly smaller than real ones, so the driver is too. */
export const DRIVER_SCALE = 0.86;

export type Side = "Left" | "Right";
type Dir = [number, number, number];

interface HandRest {
  /** In the model's own space, as loaded: which way the fingers point, which way the palm faces, the hand's rotation. */
  fingers: THREE.Vector3;
  palm: THREE.Vector3;
  quat: THREE.Quaternion;
  upper: number;
  fore: number;
}

export interface DriverRig {
  /** Add this to the scene. */
  root: THREE.Object3D;
  bones: Map<string, THREE.Bone>;
  hands: Record<Side, HandRest>;
}

const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();
const Q = new THREE.Quaternion();
const WQ = new THREE.Quaternion();
const PQ = new THREE.Quaternion();
const M0 = new THREE.Matrix4();
const M1 = new THREE.Matrix4();

/** Turn `bone` so that the line from it to `child` points along `dir` (world space). */
function aim(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3) {
  if (!bone.parent) return;
  bone.getWorldPosition(A);
  child.getWorldPosition(B);
  Q.setFromUnitVectors(B.sub(A).normalize(), C.copy(dir).normalize());
  bone.getWorldQuaternion(WQ);
  bone.parent.getWorldQuaternion(PQ);
  bone.quaternion.copy(PQ.invert().multiply(Q.multiply(WQ)));
  bone.updateMatrixWorld(true);
}

/** Rotation taking the frame (x0, y0) onto (x1, y1); the y vectors need not be exactly square to the x ones. */
function frameToFrame(x0: THREE.Vector3, y0: THREE.Vector3, x1: THREE.Vector3, y1: THREE.Vector3, out: THREE.Quaternion) {
  const basis = (x: THREE.Vector3, y: THREE.Vector3, m: THREE.Matrix4) => {
    const ex = x.clone().normalize();
    const ez = new THREE.Vector3().crossVectors(ex, y).normalize();
    return m.makeBasis(ex, new THREE.Vector3().crossVectors(ez, ex), ez);
  };
  return out.setFromRotationMatrix(basis(x1, y1, M1).multiply(basis(x0, y0, M0).transpose()));
}

// Racing seat: torso reclined, legs stretched to the pedals. Character space: +x left, +y up, +z forward.
const SEATED: [bone: string, child: string, dir: Dir][] = [
  ["Hips", "Spine", [0, 1, -0.3]],
  ["Spine", "Spine1", [0, 1, -0.3]],
  ["Spine1", "Spine2", [0, 1, -0.24]],
  ["Spine2", "Neck", [0, 1, -0.1]],
  ["Neck", "Head", [0, 1, 0.02]],
  ["Head", "HeadTop_End", [0, 1, 0.04]],
  ...(["Left", "Right"] as const).flatMap((side): [string, string, Dir][] => {
    const s = side === "Left" ? 1 : -1;
    return [
      [`${side}UpLeg`, `${side}Leg`, [s * 0.14, 0.14, 1]],
      [`${side}Leg`, `${side}Foot`, [0, -0.45, 1]],
      [`${side}Foot`, `${side}ToeBase`, [0, 0.6, 1]],
    ];
  }),
];

const FINGERS = ["Index", "Middle", "Ring", "Pinky"];

const dressed = new Map<string, THREE.Material>();

/**
 * Clothes: the model's bare hands become black racing gloves, the suit can be tinted per driver, and for the
 * view from the driver's own eyes the head and helmet are left out (the camera is inside them).
 */
function dress(model: THREE.Object3D, { suit, firstPerson }: { suit?: string; firstPerson?: boolean }) {
  model.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    const source = o.material as THREE.MeshStandardMaterial;
    const part = source.name.replace("Wolf3D_", "");
    if (firstPerson && /Eye|Skin|Teeth|Headwear/.test(part)) o.visible = false;
    o.castShadow = !firstPerson;
    const tint = part === "Body" ? "glove" : suit && /Outfit_(Top|Bottom)/.test(part) ? suit : null;
    if (!tint) return;
    const key = `${part}:${tint}`;
    let material = dressed.get(key);
    if (!material) {
      const m = source.clone();
      if (tint === "glove") {
        m.map = null;
        m.color.set("#16171a");
        m.roughness = 0.7;
      } else m.color.set(tint);
      dressed.set(key, (material = m));
    }
    o.material = material;
  });
}

/**
 * A fresh, independent copy of the driver, sat in the driving position with both hands curled into a grip.
 * `scene` is the loaded glTF scene. The copy's origin is the seat: the hips sit just above it.
 */
export function createDriver(scene: THREE.Object3D, look: { suit?: string; firstPerson?: boolean } = {}): DriverRig {
  const model = cloneSkinned(scene);
  dress(model, look);
  const bones = new Map<string, THREE.Bone>();
  model.traverse((o) => {
    // Sketchfab's exporter numbers every bone ("LeftArm_011"); drop the number.
    if ((o as THREE.Bone).isBone) bones.set(o.name.replace(/_\d+$/, ""), o as THREE.Bone);
    // Skinned meshes are culled by their rest-pose bounds, which a posed figure can be well outside.
    if (o instanceof THREE.SkinnedMesh) o.frustumCulled = false;
  });
  model.updateMatrixWorld(true);
  const pos = (name: string) => bones.get(name)!.getWorldPosition(new THREE.Vector3());

  // Measure each hand as loaded (arms out to the side, palms toward the ground or the thighs).
  const hands = {} as Record<Side, HandRest>;
  for (const side of ["Left", "Right"] as const) {
    const wrist = pos(`${side}Hand`);
    const fingers = pos(`${side}HandMiddle1`).sub(wrist).normalize();
    const palm = new THREE.Vector3().crossVectors(pos(`${side}HandIndex1`).sub(wrist), pos(`${side}HandPinky1`).sub(wrist)).normalize();
    const inward = new THREE.Vector3(side === "Left" ? -1 : 1, -0.5, 0);
    if (palm.dot(inward) < 0) palm.negate();
    hands[side] = {
      fingers,
      palm,
      quat: bones.get(`${side}Hand`)!.getWorldQuaternion(new THREE.Quaternion()),
      upper: pos(`${side}ForeArm`).distanceTo(pos(`${side}Arm`)),
      fore: wrist.distanceTo(pos(`${side}ForeArm`)),
    };
    // Curl the fingers toward the palm, a bit more at each joint, so the hand is closed round a rim or a knob.
    const hinge = new THREE.Vector3().crossVectors(fingers, palm).normalize();
    for (const finger of FINGERS)
      [0.75, 1.05, 0.7].forEach((angle, joint) => {
        const bone = bones.get(`${side}Hand${finger}${joint + 1}`);
        if (!bone) return;
        const local = hinge.clone().applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert());
        bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(local, angle));
      });
    // Thumb: folded across in front of the fingers.
    [0.35, 0.3].forEach((angle, joint) => {
      const bone = bones.get(`${side}HandThumb${joint + 1}`);
      if (!bone) return;
      const local = hinge.clone().applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert());
      bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(local, angle));
    });
  }

  for (const [bone, child, dir] of SEATED) {
    const b = bones.get(bone);
    const c = bones.get(child);
    if (b && c) aim(b, c, A.clone().set(...dir));
  }
  model.updateMatrixWorld(true);

  // Seat at the origin: hips above it, feet out in front.
  const hips = pos("Hips");
  model.position.set(-hips.x, 0.1 - hips.y, -hips.z);
  const root = new THREE.Group();
  root.add(model);
  const rig = { root, bones, hands };
  // Until told otherwise, hands rest where a steering wheel would be.
  root.updateMatrixWorld(true);
  for (const side of ["Left", "Right"] as const) {
    const s = side === "Left" ? 1 : -1;
    reach(rig, side, new THREE.Vector3(s * 0.17, 0.42, 0.36), new THREE.Vector3(-s * 0.3, 0.5, 1), new THREE.Vector3(-s, 0, 0.2));
  }
  return rig;
}

/** World position of a bone (after the rig has been placed in the scene). */
export function bonePosition(rig: DriverRig, name: string, out: THREE.Vector3) {
  return rig.bones.get(name)!.getWorldPosition(out);
}

const S = new THREE.Vector3();
const E = new THREE.Vector3();
const D = new THREE.Vector3();
const POLE = new THREE.Vector3();
const F0 = new THREE.Vector3();
const P0 = new THREE.Vector3();
const RQ = new THREE.Quaternion();
const HQ = new THREE.Quaternion();
const ROOTQ = new THREE.Quaternion();

/**
 * Put a hand somewhere. `wrist` is where the wrist goes, `fingers` the way the fingers point from there and
 * `palm` the way the palm faces, all in world space. The elbow drops down and out to the side.
 * If the wrist is out of reach the arm straightens toward it.
 */
export function reach(rig: DriverRig, side: Side, wrist: THREE.Vector3, fingers: THREE.Vector3, palm: THREE.Vector3) {
  const upperArm = rig.bones.get(`${side}Arm`)!;
  const foreArm = rig.bones.get(`${side}ForeArm`)!;
  const hand = rig.bones.get(`${side}Hand`)!;
  const rest = rig.hands[side];
  rig.root.updateWorldMatrix(true, false);
  rig.root.getWorldQuaternion(ROOTQ);
  const scale = rig.root.getWorldScale(D).x;
  const upper = rest.upper * scale;
  const fore = rest.fore * scale;

  // Elbow: on the circle where the two arm segments can meet, at the point furthest down-and-out.
  upperArm.getWorldPosition(S);
  D.copy(wrist).sub(S);
  const dist = Math.min(Math.max(D.length(), Math.abs(upper - fore) + 0.005), upper + fore - 0.005);
  D.normalize();
  const along = (upper * upper - fore * fore + dist * dist) / (2 * dist);
  const out = Math.sqrt(Math.max(upper * upper - along * along, 0));
  POLE.set(side === "Left" ? 0.55 : -0.55, -1, -0.25).applyQuaternion(ROOTQ);
  POLE.addScaledVector(D, -POLE.dot(D)).normalize();
  E.copy(S).addScaledVector(D, along).addScaledVector(POLE, out);
  aim(upperArm, foreArm, A.clone().copy(E).sub(S));
  foreArm.getWorldPosition(E);
  aim(foreArm, hand, A.clone().copy(S).addScaledVector(D, dist).sub(E));

  // Turn the hand so its fingers and palm face the way asked.
  F0.copy(rest.fingers).applyQuaternion(ROOTQ);
  P0.copy(rest.palm).applyQuaternion(ROOTQ);
  frameToFrame(F0, P0, fingers, palm, RQ);
  HQ.copy(ROOTQ).multiply(rest.quat).premultiply(RQ);
  hand.parent!.getWorldQuaternion(PQ);
  hand.quaternion.copy(PQ.invert().multiply(HQ));
  hand.updateMatrixWorld(true);
}
