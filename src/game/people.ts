// Human figures for the crowd and the drivers, baked from one rigged model:
// Quaternius "Animated Human" (CC0, see CREDITS.md), simplified by scripts/convert-person.mjs.
// The rig is posed by aiming bones at world directions, so it doesn't depend on the rig's local axes,
// then the skinned vertices are baked into plain geometry that can be instanced thousands of times.
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

export const MAN_URL = "/models/people/man.glb";
/** Standing height in metres after normalising. */
export const PERSON_HEIGHT = 1.75;

// Body-part codes stored per vertex (the crowd shader colours and animates by these).
export const PART = { pants: 0, shirt: 1, skin: 2, head: 3, hair: 5, shoes: 6 } as const;

type Dir = [number, number, number];
/** Aim the segment bone->child along a direction (character space: +x left, +y up, +z forward). */
type Aim = [bone: string, child: string, dir: Dir];

const side = (s: 1 | -1, name: string) => (s === 1 ? "Left" : "Right") + name;
const both = (f: (s: 1 | -1) => Aim[]): Aim[] => [...f(1), ...f(-1)];

const ARMS_UP = both((s) => [
  [side(s, "Arm"), side(s, "ForeArm"), [s * 0.45, 0.9, 0.05]],
  [side(s, "ForeArm"), side(s, "Hand"), [s * 0.12, 1, 0.12]],
]);
const ARMS_RELAXED = both((s) => [
  [side(s, "Arm"), side(s, "ForeArm"), [s * 0.16, -1, 0.06]],
  [side(s, "ForeArm"), side(s, "Hand"), [s * 0.05, -1, 0.18]],
]);
const LEGS_STRAIGHT = both((s) => [
  [side(s, "UpLeg"), side(s, "Leg"), [s * 0.04, -1, 0.02]],
  [side(s, "Leg"), side(s, "Foot"), [0, -1, -0.03]],
  [side(s, "Foot"), side(s, "ToeBase"), [s * 0.12, -0.45, 1]],
]);
const LEGS_SEATED = both((s) => [
  [side(s, "UpLeg"), side(s, "Leg"), [s * 0.18, -0.08, 1]],
  [side(s, "Leg"), side(s, "Foot"), [0, -1, 0.1]],
  [side(s, "Foot"), side(s, "ToeBase"), [s * 0.1, -0.35, 1]],
]);
const HANDS_ON_KNEES = both((s) => [
  [side(s, "Arm"), side(s, "ForeArm"), [s * 0.2, -0.85, 0.45]],
  [side(s, "ForeArm"), side(s, "Hand"), [-s * 0.12, -0.35, 1]],
]);
const UPRIGHT: Aim[] = [
  ["Hips", "Spine", [0, 1, 0]],
  ["Spine", "Spine1", [0, 1, 0]],
  ["Spine1", "Spine2", [0, 1, 0.02]],
  ["Spine2", "Neck", [0, 1, 0.04]],
  ["Neck", "Head", [0, 1, 0.05]],
  ["Head", "HeadTop_End", [0, 1, 0.04]],
];

export const POSES = {
  stand: [...UPRIGHT, ...LEGS_STRAIGHT, ...ARMS_RELAXED],
  standCheer: [...UPRIGHT, ...LEGS_STRAIGHT, ...ARMS_UP],
  sit: [...UPRIGHT, ...LEGS_SEATED, ...HANDS_ON_KNEES],
  sitCheer: [...UPRIGHT, ...LEGS_SEATED, ...ARMS_UP],
  // Racing seat: torso reclined, legs stretched to the pedals, hands out to the wheel.
  drive: [
    ["Hips", "Spine", [0, 1, -0.32]],
    ["Spine", "Spine1", [0, 1, -0.32]],
    ["Spine1", "Spine2", [0, 1, -0.28]],
    ["Spine2", "Neck", [0, 1, -0.15]],
    ["Neck", "Head", [0, 1, 0]],
    ["Head", "HeadTop_End", [0, 1, 0.05]],
    ...both((s): Aim[] => [
      [side(s, "UpLeg"), side(s, "Leg"), [s * 0.12, 0.12, 1]],
      [side(s, "Leg"), side(s, "Foot"), [0, -0.45, 1]],
      [side(s, "Foot"), side(s, "ToeBase"), [0, 0.6, 1]],
      [side(s, "Arm"), side(s, "ForeArm"), [s * 0.1, -0.45, 1]],
      [side(s, "ForeArm"), side(s, "Hand"), [-s * 0.18, 0.28, 1]],
    ]),
  ] as Aim[],
} satisfies Record<string, Aim[]>;

export type PoseName = keyof typeof POSES;

export interface Baked {
  /** Indexed geometry with `position`, `normal` and a per-vertex `part` code. */
  geometry: THREE.BufferGeometry;
  /** Where the neck is, for turning the head. */
  neck: THREE.Vector3;
}

function partFor(bone: string): number {
  if (/Foot|Toe/.test(bone)) return PART.shoes;
  if (/UpLeg|Leg|Hips/.test(bone)) return PART.pants;
  if (/ForeArm|Hand/.test(bone)) return PART.skin;
  if (/Neck|Head/.test(bone)) return PART.head;
  return PART.shirt;
}

/**
 * Bake every pose. `seatedOrigin`: seated poses are moved so the seat surface is at y = 0
 * (standing poses have their feet at y = 0).
 */
export function bakePoses(scene: THREE.Object3D, idle?: THREE.AnimationClip): Record<PoseName, Baked> {
  const root = cloneSkinned(scene);
  let skinned: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) skinned = o;
  });
  if (!skinned) throw new Error("person model has no skinned mesh");
  const mesh = skinned as THREE.SkinnedMesh;
  const bones = new Map(mesh.skeleton.bones.map((b) => [b.name, b]));

  // Start from the idle animation's first frame so nothing is left in a mid-stride pose.
  if (idle) {
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(idle).play();
    mixer.setTime(0);
  }
  root.updateMatrixWorld(true);
  const rest = new Map(mesh.skeleton.bones.map((b) => [b, b.quaternion.clone()]));

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const wq = new THREE.Quaternion();
  const pq = new THREE.Quaternion();
  const aim = ([boneName, childName, dir]: Aim) => {
    const bone = bones.get(boneName);
    const child = bones.get(childName);
    if (!bone || !child || !bone.parent) return;
    bone.getWorldPosition(a);
    child.getWorldPosition(b);
    q.setFromUnitVectors(b.sub(a).normalize(), new THREE.Vector3(...dir).normalize());
    bone.getWorldQuaternion(wq);
    bone.parent.getWorldQuaternion(pq);
    bone.quaternion.copy(pq.invert().multiply(q.multiply(wq)));
    bone.updateMatrixWorld(true);
  };

  // Body-part code per vertex, from whichever bone influences it most; hair = top of the head.
  const skinIndex = mesh.geometry.getAttribute("skinIndex");
  const skinWeight = mesh.geometry.getAttribute("skinWeight");
  const count = mesh.geometry.getAttribute("position").count;
  const part = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let best = 0;
    for (let k = 1; k < 4; k++) if (skinWeight.getComponent(i, k) > skinWeight.getComponent(i, best)) best = k;
    part[i] = partFor(mesh.skeleton.bones[skinIndex.getComponent(i, best)].name);
  }

  const bake = (aims: Aim[]) => {
    for (const [bone, quat] of rest) bone.quaternion.copy(quat);
    root.updateMatrixWorld(true);
    aims.forEach(aim);
    root.updateMatrixWorld(true);
    mesh.skeleton.update();
    const out = new Float32Array(count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
      out.set([v.x, v.y, v.z], i * 3);
    }
    const at = (name: string) => bones.get(name)!.getWorldPosition(new THREE.Vector3());
    return { out, hips: at("Hips"), neck: at("Neck"), head: at("Head"), top: at("HeadTop_End") };
  };

  // Normalise against the standing pose: feet on the ground, hips over the origin, 1.75 m tall.
  const stand = bake(POSES.stand);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < stand.out.length; i += 3) {
    minY = Math.min(minY, stand.out[i]);
    maxY = Math.max(maxY, stand.out[i]);
  }
  const k = PERSON_HEIGHT / (maxY - minY);
  // Hair: head vertices in the top part of the skull (measured in the standing pose).
  const hairLine = stand.head.y + (stand.top.y - stand.head.y) * 0.62;
  for (let i = 0; i < count; i++) if (part[i] === PART.head && stand.out[i * 3 + 1] > hairLine) part[i] = PART.hair;

  const result = {} as Record<PoseName, Baked>;
  for (const name of Object.keys(POSES) as PoseName[]) {
    const p = name === "stand" ? stand : bake(POSES[name]);
    const seated = name !== "stand" && name !== "standCheer";
    // Seated: put the underside of the thighs at y = 0 (the seat). Standing: feet at y = 0.
    const baseY = seated ? p.hips.y - 0.11 / k : minY;
    const pos = new Float32Array(p.out.length);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (p.out[i * 3] - p.hips.x) * k;
      pos[i * 3 + 1] = (p.out[i * 3 + 1] - baseY) * k;
      pos[i * 3 + 2] = (p.out[i * 3 + 2] - p.hips.z) * k;
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(mesh.geometry.getIndex());
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("part", new THREE.BufferAttribute(part, 1));
    g.computeVertexNormals();
    result[name] = {
      geometry: g,
      neck: new THREE.Vector3((p.neck.x - p.hips.x) * k, (p.neck.y - baseY) * k, (p.neck.z - p.hips.z) * k),
    };
  }
  return result;
}

const cache = new WeakMap<THREE.Object3D, Record<PoseName, Baked>>();
/** Poses are baked once per loaded model and shared by the crowd and the drivers. */
export function getPoses(scene: THREE.Object3D, idle?: THREE.AnimationClip): Record<PoseName, Baked> {
  let poses = cache.get(scene);
  if (!poses) cache.set(scene, (poses = bakePoses(scene, idle)));
  return poses;
}
