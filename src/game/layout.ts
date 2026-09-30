// Where the circuit set pieces go. Rendering only: nothing here touches the sim.
import { cornerSides, type Track } from "@/sim";
import { hashString, mulberry32 } from "@/sim/rng";

export const KERB = 1.2;

export type BoxKind =
  | "crowd"
  | "concrete"
  | "roof"
  | "steel"
  | "glass"
  | "garage"
  | "fence"
  | "asphalt"
  | "seat"
  | `ad${number}`;

/** An axis-aligned box in a frame rotated to follow the track. sx = across track, sz = along track. */
export interface Box {
  x: number;
  y: number;
  z: number;
  rot: number;
  sx: number;
  sy: number;
  sz: number;
  kind: BoxKind;
}

export interface Spot {
  x: number;
  z: number;
  rot: number;
}

/** One spectator. Faces local +z (rot turns them toward the track). action: 0 idle, 1 clap, 2 wave, 3 cheer, 4 jump. */
export interface Person {
  x: number;
  y: number;
  z: number;
  rot: number;
  seated: boolean;
  action: number;
  /** 0..1 baseline excitement; everyone gets louder as the car passes. */
  mood: number;
  scale: number;
}

export interface Layout {
  boxes: Box[];
  people: Person[];
  flags: Spot[];
  tower: Spot | null;
  wheel: Spot | null;
  /** Per track sample: +1 / -1 = outside of a corner is on the right / left, 0 = no corner. */
  cornerSide: number[];
  /** Keep trees out of these circles. */
  reserved: { x: number; z: number; r: number }[];
}

interface Frame {
  x: number;
  z: number;
  tx: number;
  tz: number;
  rot: number;
}

function frame(track: Track, i: number): Frame {
  const n = track.points.length;
  const k = ((i % n) + n) % n;
  const p = track.points[k];
  const t = track.tangents[k];
  return { x: p.x, z: p.z, tx: t.x, tz: t.z, rot: Math.atan2(t.x, t.z) };
}

/** Point `off` to the right of the centreline (negative = left), `along` metres down the track. */
function at(f: Frame, off: number, along = 0) {
  return { x: f.x - f.tz * off + f.tx * along, z: f.z + f.tx * off + f.tz * along };
}

export function clearance(track: Track, x: number, z: number): number {
  let best = Infinity;
  for (const p of track.points) {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Signed turn at sample i: < 0 is a left turn, magnitude ~ sharpness. */
function turnAt(track: Track, i: number): number {
  const { tangents } = track;
  const n = tangents.length;
  const a = tangents[(i - 8 + n) % n];
  const b = tangents[(i + 8) % n];
  return a.x * b.z - a.z * b.x;
}

export function buildLayout(track: Track): Layout {
  const hw = track.halfWidth;
  const n = track.points.length;
  const boxes: Box[] = [];
  const people: Person[] = [];
  const rand = mulberry32(hashString(track.seed + ":crowd"));
  const flags: Spot[] = [];
  const reserved: Layout["reserved"] = [];
  const cornerSide = cornerSides(track);

  const isReserved = (x: number, z: number, pad: number) =>
    reserved.some((r) => (r.x - x) ** 2 + (r.z - z) ** 2 < (r.r + pad) ** 2);
  const fits = (f: Frame, from: number, to: number) => {
    for (let d = from; Math.abs(d) <= Math.abs(to); d += Math.sign(to) * 3) {
      const p = at(f, d);
      if (clearance(track, p.x, p.z) < hw + 3) return false;
    }
    return true;
  };
  const add = (f: Frame, off: number, y: number, sx: number, sy: number, sz: number, kind: BoxKind, along = 0) => {
    const p = at(f, off, along);
    boxes.push({ x: p.x, y, z: p.z, rot: f.rot, sx, sy, sz, kind });
  };

  /** Facing the track from side s: turn local +z toward the centreline. */
  const faceTrack = (f: Frame, s: number) => Math.atan2(s * f.tz, -s * f.tx);
  const person = (f: Frame, s: number, off: number, along: number, y: number, seated: boolean) => {
    const p = at(f, s * off, along);
    const r = rand();
    const action = r < 0.35 ? 0 : r < 0.6 ? 1 : r < 0.75 ? 2 : r < 0.9 ? 3 : seated ? 3 : 4;
    people.push({
      x: p.x,
      y,
      z: p.z,
      rot: faceTrack(f, s) + (rand() - 0.5) * 0.5,
      seated,
      action,
      mood: rand(),
      scale: 0.9 + rand() * 0.2,
    });
  };
  /** A loose standing crowd `depth` metres deep starting `off` from the centreline. */
  const standingCrowd = (f: Frame, s: number, off: number, depth: number, len: number, count: number) => {
    for (let k = 0; k < count; k++) person(f, s, off + rand() * depth, (rand() - 0.5) * len, 0, false);
  };

  /** A covered grandstand segment: stepped crowd tiers, back wall, cantilever roof, banner + catch fence in front. */
  const grandstand = (f: Frame, s: number, base: number, tiers: number, len: number, idx: number, roofed: boolean) => {
    const rise = 0.75;
    const depth = 1.6;
    add(f, s * (base - 3.5), 1.9, 0.06, 3.8, len, "fence");
    add(f, s * (base - 3.5), 1.9, 0.18, 3.8, 0.18, "steel", len / 2);
    add(f, s * (base - 0.3), 0.6, 0.3, 1.2, len, `ad${idx % 5}`);
    for (let k = 0; k < tiers; k++) {
      const h = (k + 1) * rise + 1.2;
      add(f, s * (base + k * depth + depth / 2), h / 2, depth, h, len, "crowd");
      // Seated spectators along the front edge of each tier (legs hang over the step).
      for (let a = -len / 2 + 0.35; a < len / 2; a += 0.62) if (rand() < 0.88) person(f, s, base + k * depth + 0.4, a, h, true);
    }
    const back = base + tiers * depth + 0.25;
    const top = tiers * rise + 1.2;
    add(f, s * back, (top + 5) / 2, 0.5, top + 5, len, "concrete");
    if (roofed) {
      add(f, s * (base + (tiers * depth) / 2), top + 5, tiers * depth + 3, 0.35, len + 0.1, "roof");
      if (idx % 2 === 0) add(f, s * (back - 0.5), (top + 5) / 2, 0.35, top + 5, 0.35, "steel");
      if (idx % 2 === 0) flags.push({ ...at(f, s * (base - 1.2), 0), rot: f.rot });
    }
    reserved.push({ ...at(f, s * (base + (tiers * depth) / 2)), r: tiers * depth + 6 });
  };

  // --- Start straight: main grandstand on one side, pits on the other. ---
  const SEG = 3; // samples per segment (6 m)
  const segLen = (track.length / n) * SEG + 0.15;
  const gBase = hw + KERB + 7;
  const pitFrom = hw + KERB + 1.5;
  const countFits = (s: number, far: number) => {
    let c = 0;
    for (let i = -39; i <= 12; i += SEG) if (fits(frame(track, i), s * (hw + KERB + 3), s * far)) c++;
    return c;
  };
  const gSide = countFits(1, gBase + 16) >= countFits(-1, gBase + 16) ? 1 : -1;
  const pSide = -gSide;

  let seg = 0;
  for (let i = -39; i <= 12; i += SEG) {
    const f = frame(track, i);
    if (fits(f, gSide * (hw + KERB + 3), gSide * (gBase + 16))) grandstand(f, gSide, gBase, 8, segLen, seg, true);
    seg++;
  }

  let tower: Spot | null = null;
  for (let i = -30; i <= 30; i += SEG) {
    const f = frame(track, i);
    if (!fits(f, pSide * (hw + KERB + 3), pSide * (hw + KERB + 24))) continue;
    add(f, pSide * pitFrom, 0.6, 0.6, 1.2, segLen, "concrete"); // pit wall
    add(f, pSide * pitFrom, 2.7, 0.06, 3, segLen, "fence");
    add(f, pSide * (pitFrom + 6), 0.03, 11, 0.06, segLen, "asphalt"); // pit lane
    add(f, pSide * (hw + KERB + 12.2), 2.6, 0.12, 5.2, segLen - 0.4, "garage");
    add(f, pSide * (hw + KERB + 17), 2.6, 9.4, 5.2, segLen, "concrete");
    add(f, pSide * (hw + KERB + 17.5), 6.8, 7.5, 3.2, segLen, "glass");
    add(f, pSide * (hw + KERB + 16.5), 8.6, 12, 0.4, segLen + 0.1, "roof");
    reserved.push({ ...at(f, pSide * (hw + KERB + 16)), r: 10 });
    if (i === 6) tower = { ...at(f, pSide * (hw + KERB + 7)), rot: f.rot };
  }

  // --- Corner grandstands at the two tightest corners with room. ---
  const corners = cornerSide
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => s !== 0 && Math.min(i, n - i) > 60)
    .sort((a, b) => Math.abs(turnAt(track, b.i)) - Math.abs(turnAt(track, a.i)));
  const used: number[] = [];
  for (const { s, i } of corners) {
    if (used.length >= 2 || used.some((u) => Math.abs(u - i) < 60)) continue;
    const base = hw + KERB + 16;
    const idxs = [-6, -3, 0, 3, 6].map((d) => i + d);
    if (!idxs.every((k) => fits(frame(track, k), s * (base - 4), s * (base + 9)))) continue;
    idxs.forEach((k, j) => grandstand(frame(track, k), s, base, 5, segLen, j + used.length, false));
    used.push(i);
  }

  // --- Catch fences behind the tyre walls on every corner. ---
  for (let i = 0; i < n; i += SEG) {
    const s = cornerSide[i];
    if (s === 0) continue;
    const f = frame(track, i);
    const off = hw + KERB + 7;
    const p = at(f, s * off);
    if (clearance(track, p.x, p.z) < hw + 5) continue;
    add(f, s * off, 1.9, 0.06, 3.8, segLen, "fence");
    add(f, s * off, 1.9, 0.18, 3.8, 0.18, "steel", segLen / 2);
    const back = at(f, s * (off + 5));
    if (clearance(track, back.x, back.z) >= hw + 8 && !isReserved(back.x, back.z, 2)) {
      standingCrowd(f, s, off + 1.2, 3.5, segLen, 6 + Math.floor(rand() * 4));
      reserved.push({ ...at(f, s * (off + 3)), r: 5 });
    }
  }

  // --- Spectator banks along the straights: low fence, people standing behind it. ---
  for (let i = 0; i < n; i += SEG) {
    if (i > n - 45 || i < 36) continue; // start straight has the grandstand and pits
    if ([-3, 0, 3].some((d) => cornerSide[(i + d + n) % n] !== 0)) continue;
    const f = frame(track, i);
    for (const s of [1, -1]) {
      if (rand() > 0.45) continue;
      const off = hw + KERB + 6;
      const a = at(f, s * off);
      const b = at(f, s * (off + 6));
      if (clearance(track, a.x, a.z) < hw + 4 || clearance(track, b.x, b.z) < hw + 8) continue;
      if (isReserved(b.x, b.z, 3)) continue;
      add(f, s * off, 0.55, 0.12, 1.1, segLen, "steel");
      standingCrowd(f, s, off + 0.9, 3.5, segLen, 5 + Math.floor(rand() * 5));
      reserved.push({ ...at(f, s * (off + 3)), r: 5 });
    }
  }

  // --- Ferris wheel behind the main grandstand. ---
  let wheel: Spot | null = null;
  for (const i of [-20, -35, -5, -50, 10]) {
    const f = frame(track, i);
    for (const off of [75, 95, 115]) {
      const p = at(f, gSide * (gBase + off));
      if (clearance(track, p.x, p.z) < 50) continue;
      if (reserved.some((r) => (r.x - p.x) ** 2 + (r.z - p.z) ** 2 < (r.r + 35) ** 2)) continue;
      wheel = { ...p, rot: f.rot }; // face toward cars driving down the straight
      break;
    }
    if (wheel) break;
  }
  if (wheel) reserved.push({ x: wheel.x, z: wheel.z, r: 30 });
  if (tower) reserved.push({ x: tower.x, z: tower.z, r: 6 });

  return { boxes, people, flags, tower, wheel, cornerSide, reserved };
}
