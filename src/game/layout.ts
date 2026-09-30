// Where the circuit set pieces go. Rendering only: nothing here touches the sim.
import { cornerSides, GRAVEL_WIDTH, type Track } from "@/sim";
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
  | "berm"
  | "marshal"
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
  /** Roll about the along-track axis (for sloped grass banks). */
  tilt?: number;
}

export interface Spot {
  x: number;
  z: number;
  rot: number;
  y?: number;
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
  /** Trackside TV camera positions (top of each camera tower). */
  tvSpots: { x: number; y: number; z: number }[];
  /** White hospitality marquees. */
  tents: Spot[];
  /** Parked cars; `y` holds a colour index. */
  parked: Spot[];
  /** Team transporters in the paddock; `y` holds a colour index. */
  trucks: Spot[];
  /** Infield lake, if there's room. */
  lake: { x: number; z: number; r: number } | null;
  /** Big video screen on the pit roof, facing the main grandstand. */
  screen: Spot | null;
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
  const add = (f: Frame, off: number, y: number, sx: number, sy: number, sz: number, kind: BoxKind, along = 0, tilt = 0) => {
    const p = at(f, off, along);
    boxes.push({ x: p.x, y, z: p.z, rot: f.rot, sx, sy, sz, kind, tilt });
  };
  const tvSpots: Layout["tvSpots"] = [];
  const tents: Spot[] = [];
  const parked: Spot[] = [];
  const trucks: Spot[] = [];

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

  /** A grandstand segment: stepped tiers packed with seated fans, back wall, optional roof with banner fascia. */
  const grandstand = (f: Frame, s: number, base: number, tiers: number, len: number, idx: number, roofed: boolean) => {
    const rise = 0.85;
    const depth = 1.35;
    add(f, s * (base - 3.5), 1.9, 0.06, 3.8, len, "fence");
    add(f, s * (base - 3.5), 1.9, 0.18, 3.8, 0.18, "steel", len / 2);
    add(f, s * (base - 0.3), 0.6, 0.3, 1.2, len, `ad${idx % 5}`);
    for (let k = 0; k < tiers; k++) {
      const h = (k + 1) * rise + 1.2;
      add(f, s * (base + k * depth + depth / 2), h / 2, depth, h, len, "crowd");
      // Seated spectators along the front edge of each tier (legs hang over the step).
      for (let a = -len / 2 + 0.35; a < len / 2; a += 0.62) if (rand() < 0.9) person(f, s, base + k * depth + 0.4, a, h, true);
    }
    // Aisle stairs every few segments.
    if (idx % 3 === 0)
      for (let k = 0; k < tiers; k++) add(f, s * (base + k * depth + depth / 2), (k + 1) * rise + 1.22, depth, 0.06, 0.9, "concrete", len / 2 - 0.45);
    const back = base + tiers * depth + 0.25;
    const top = tiers * rise + 1.2;
    add(f, s * back, (top + 5) / 2, 0.5, top + 5, len, "concrete");
    if (roofed) {
      const roofY = top + 5;
      add(f, s * (base + (tiers * depth) / 2), roofY, tiers * depth + 3, 0.35, len + 0.1, "roof");
      add(f, s * (base - 1.5), roofY - 0.8, 0.3, 1.8, len + 0.1, `ad${(idx + 2) % 5}`); // banner along the roof edge
      if (idx % 2 === 0) add(f, s * (back - 0.5), roofY / 2, 0.35, roofY, 0.35, "steel");
      if (idx % 2 === 0) flags.push({ ...at(f, s * (base - 1.2), 0), rot: f.rot, y: roofY });
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
  const MAIN_TIERS = 14;
  const gFar = gBase + MAIN_TIERS * 1.35 + 4;
  const gSide = countFits(1, gFar) >= countFits(-1, gFar) ? 1 : -1;
  const pSide = -gSide;

  let seg = 0;
  for (let i = -39; i <= 12; i += SEG) {
    const f = frame(track, i);
    if (fits(f, gSide * (hw + KERB + 3), gSide * gFar)) grandstand(f, gSide, gBase, MAIN_TIERS, segLen, seg, true);
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
    add(f, pSide * (hw + KERB + 10.6), 8.1, 0.3, 1.4, segLen + 0.1, `ad${Math.abs(i) % 5}`); // pit roof banner
    reserved.push({ ...at(f, pSide * (hw + KERB + 16)), r: 10 });
    if (i === 6) tower = { ...at(f, pSide * (hw + KERB + 7)), rot: f.rot };
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

  // --- More grandstands: sharpest corners first, then straights, wherever there's room. ---
  const candidates = cornerSide
    .map((cs, i) => ({ cs, i, sharp: Math.abs(turnAt(track, i)) }))
    .filter(({ i }) => i % 3 === 0 && Math.min(i, n - i) > 50)
    .sort((a, b) => (b.cs !== 0 ? 1 : 0) - (a.cs !== 0 ? 1 : 0) || b.sharp - a.sharp);
  const used: number[] = [];
  let standIdx = 0;
  for (const { cs, i } of candidates) {
    if (used.length >= 9 || used.some((u) => Math.min(Math.abs(u - i), n - Math.abs(u - i)) < 36)) continue;
    const onCorner = cs !== 0;
    const sides = onCorner ? [cs] : rand() < 0.5 ? [1, -1] : [-1, 1];
    const tiers = onCorner ? 9 : 7;
    const half = onCorner ? 9 : 6;
    for (const s of sides) {
      const base = onCorner ? hw + KERB + GRAVEL_WIDTH + 6 : hw + KERB + 10;
      const idxs: number[] = [];
      for (let d = -half; d <= half; d += SEG) idxs.push(i + d);
      const ok = idxs.every((k) => {
        const f = frame(track, k);
        const far = at(f, s * (base + tiers * 1.35 + 3));
        return fits(f, s * (base - 4), s * (base + tiers * 1.35 + 3)) && !isReserved(far.x, far.z, 4);
      });
      if (!ok) continue;
      const roofed = !onCorner && rand() < 0.6;
      idxs.forEach((k, j) => grandstand(frame(track, k), s, base, tiers, segLen, standIdx + j, roofed));
      standIdx += idxs.length;
      used.push(i);
      break;
    }
  }

  // --- Catch fences behind the tyre walls (at the back of the gravel) on every corner. ---
  for (let i = 0; i < n; i += SEG) {
    const s = cornerSide[i];
    if (s === 0) continue;
    const f = frame(track, i);
    const off = hw + KERB + GRAVEL_WIDTH + 1.8;
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

  // --- Straights: continuous banner walls topped with debris fence; fans and floodlights behind. ---
  let wallIdx = 0;
  for (let i = 0; i < n; i += SEG) {
    if (i > n - 45 || i < 36) continue; // start straight has the grandstand and pits
    if ([-3, 0, 3].some((d) => cornerSide[(i + d + n) % n] !== 0)) continue;
    const f = frame(track, i);
    for (const s of [1, -1]) {
      const off = hw + KERB + 4.5;
      const a = at(f, s * off);
      if (clearance(track, a.x, a.z) < hw + 4 || isReserved(a.x, a.z, 1)) continue;
      add(f, s * off, 0.55, 0.3, 1.1, segLen, `ad${wallIdx++ % 5}`);
      add(f, s * off, 2.6, 0.06, 3, segLen, "fence");
      add(f, s * off, 2.6, 0.14, 3, 0.14, "steel", segLen / 2);
      const b = at(f, s * (off + 11));
      if (clearance(track, b.x, b.z) < hw + 12 || isReserved(b.x, b.z, 3)) continue;
      if (rand() < 0.7) {
        // Grass spectator bank rising away from the track, fans sitting and standing on the slope.
        const BERM = 10;
        const RISE = 2.8;
        const slope = Math.atan2(RISE, BERM);
        add(f, s * (off + 1.2 + BERM / 2), RISE / 2 - 0.3, BERM / Math.cos(slope), 0.6, segLen + 0.05, "berm", 0, -s * slope);
        for (let k = 0; k < 16; k++) {
          const d = 0.8 + rand() * (BERM - 1.2);
          person(f, s, off + 1.2 + d, (rand() - 0.5) * segLen, (d / BERM) * RISE, rand() < 0.45);
        }
        if (rand() < 0.35) flags.push({ ...at(f, s * (off + 1.2 + BERM * 0.6), (rand() - 0.5) * segLen), rot: f.rot, y: RISE * 0.6 });
      } else if (rand() < 0.6) standingCrowd(f, s, off + 1, 3.5, segLen, 6 + Math.floor(rand() * 6));
      if (wallIdx % 7 === 0) {
        add(f, s * (off + 5), 7, 0.3, 14, 0.3, "steel"); // floodlight pole
        add(f, s * (off + 4.6), 14.2, 0.9, 0.6, 2.2, "roof");
      }
      reserved.push({ ...at(f, s * (off + 6)), r: 8 });
    }
  }

  // --- Ad bridges spanning the track on the straights. ---
  for (const frac of [0.3, 0.55, 0.8]) {
    for (let d = 0; d < 30; d += SEG) {
      const i = Math.round(n * frac) + d;
      if ([-6, -3, 0, 3, 6].some((k) => cornerSide[(i + k + n) % n] !== 0)) continue;
      const f = frame(track, i);
      const span = hw + KERB + 3.5;
      const l = at(f, -span);
      const r = at(f, span);
      if (clearance(track, l.x, l.z) < span - 0.5 || clearance(track, r.x, r.z) < span - 0.5) continue;
      for (const s of [1, -1]) add(f, s * span, 4.5, 1.2, 9, 1.2, "concrete");
      add(f, 0, 7.6, span * 2 + 1.2, 2.4, 0.5, `ad${Math.round(frac * 10) % 5}`);
      add(f, 0, 9, span * 2 + 1.2, 0.4, 1.4, "steel");
      break;
    }
  }

  // --- Marshal posts and TV camera towers every so often behind the barriers. ---
  let post = 0;
  for (let i = 20; i < n - 10; i += 21) {
    const corner = cornerSide[i] !== 0;
    const s = corner ? cornerSide[i] : i % 2 ? 1 : -1;
    const f = frame(track, i);
    // On corners: behind the tyre wall. On straights: between the run-off and the banner wall.
    const off = corner ? hw + KERB + GRAVEL_WIDTH + 3.5 : hw + KERB + 2.9;
    const p = at(f, s * off);
    if (clearance(track, p.x, p.z) < off - 1) continue;
    if (corner && isReserved(p.x, p.z, -2)) continue;
    if (post++ % 3 === 0) {
      // Scaffold camera tower with an operator on top.
      for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) add(f, s * (off + dx), 3, 0.15, 6, 0.15, "steel", dz);
      add(f, s * off, 6.05, 2.4, 0.15, 2.4, "steel");
      person(f, s, off, 0, 6.1, false);
      const top = at(f, s * off);
      tvSpots.push({ x: top.x, y: 7.6, z: top.z });
    } else {
      add(f, s * off, 1.2, 1.8, 2.4, 1.8, "marshal");
      add(f, s * off, 2.5, 2.2, 0.15, 2.2, "roof");
    }
    reserved.push({ ...p, r: 3 });
  }


  // --- Hospitality marquees behind the pits, car parks beyond. ---
  for (let i = -24; i <= 24; i += 6) {
    const f = frame(track, i);
    for (const [off, kind] of [
      [hw + KERB + 32, "tent"],
      [hw + KERB + 44, "tent"],
      [hw + KERB + 60, "cars"],
      [hw + KERB + 70, "cars"],
      [hw + KERB + 80, "cars"],
    ] as const) {
      const p = at(f, pSide * off);
      if (clearance(track, p.x, p.z) < off - 4 || isReserved(p.x, p.z, 4)) continue;
      if (kind === "tent") tents.push({ ...p, rot: f.rot });
      else for (let a = -5; a <= 5; a += 2.6) parked.push({ ...at(f, pSide * off, a), rot: f.rot + Math.PI / 2, y: Math.floor(rand() * 8) });
    }
  }
  if (tower) {
    reserved.push({ x: tower.x, z: tower.z, r: 6 });
    tvSpots.push({ x: tower.x, y: 26, z: tower.z }); // high shot over the main straight
  }

  // --- Team transporters parked in the paddock behind the garages. ---
  let screen: Spot | null = null;
  for (let i = -27; i <= 27; i += 7) {
    const f = frame(track, i);
    const p = at(f, pSide * (hw + KERB + 27));
    if (clearance(track, p.x, p.z) < hw + KERB + 23 || isReserved(p.x, p.z, -6)) continue;
    trucks.push({ ...p, rot: f.rot, y: Math.floor(rand() * 6) });
    if (!screen && i >= -6) screen = { ...at(f, pSide * (hw + KERB + 17)), rot: f.rot, y: 13 };
  }

  // --- A lake in the infield, wherever there's the most open space. ---
  let lake: Layout["lake"] = null;
  {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    let best = { x: 0, z: 0, c: 0 };
    for (let gx = minX; gx <= maxX; gx += 12)
      for (let gz = minZ; gz <= maxZ; gz += 12) {
        const c = clearance(track, gx, gz);
        if (c > best.c && !isReserved(gx, gz, 10)) best = { x: gx, z: gz, c };
      }
    if (best.c > 50) {
      lake = { x: best.x, z: best.z, r: Math.min(best.c - 32, 85) };
      reserved.push({ x: lake.x, z: lake.z, r: lake.r + 6 });
    }
  }

  // --- Sponsor covers on the tyre walls (the conveyor-belt skins real circuits use). ---
  const tyres = track.obstacles.filter((o) => o.kind === "tyre");
  for (let k = 0; k < tyres.length - 1; k++) {
    const a = tyres[k];
    const b = tyres[k + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len > 1.6) continue;
    // Push the cover to the track-facing side of the stacks.
    let nx = 0, nz = 0, bestSq = Infinity;
    for (const p of track.points) {
      const d = (p.x - a.x) ** 2 + (p.z - a.z) ** 2;
      if (d < bestSq) {
        bestSq = d;
        nx = p.x - a.x;
        nz = p.z - a.z;
      }
    }
    const nl = Math.hypot(nx, nz) || 1;
    boxes.push({
      x: (a.x + b.x) / 2 + (nx / nl) * 0.6,
      y: 0.55,
      z: (a.z + b.z) / 2 + (nz / nl) * 0.6,
      rot: Math.atan2(dx, dz),
      sx: 0.06,
      sy: 1.1,
      sz: len + 0.06,
      kind: `ad${Math.floor(k / 6) % 5}`,
    });
  }

  return { boxes, people, tvSpots, tents, parked, trucks, lake, screen, flags, tower, wheel, cornerSide, reserved };
}
