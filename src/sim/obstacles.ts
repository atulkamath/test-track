import type { Track } from "./track";

/** Static round things beside the road. Cones get knocked over; tyre stacks and torii pillars are solid. */
export interface Obstacle {
  x: number;
  z: number;
  r: number;
  kind: "cone" | "tyre" | "pillar";
}

const KERB = 1.2;
/** Half the road width plus the kerb (the track's own HALF_WIDTH is 7). */
const HALF_ROAD_PLUS_KERB = 7 + KERB;
const CONE_R = 0.35;
const TYRE_R = 0.55;
/** Gravel run-off width on the outside of corners; the tyre wall sits at its far edge. */
export const GRAVEL_WIDTH = 12;
/** Max centre-to-centre gap between tyre stacks: smaller than a car (1.9 m) so nothing slips through. */
const TYRE_GAP = 1.2;

/** Per sample: +1 / -1 = outside of a corner is on the right / left, 0 = not a corner. */
export function cornerSides(track: Track): number[] {
  const { tangents } = track;
  const n = tangents.length;
  return tangents.map((_, i) => {
    const a = tangents[(i - 8 + n) % n];
    const b = tangents[(i + 8) % n];
    const turn = a.x * b.z - a.z * b.x; // < 0: left turn, so the outside is on the right
    return turn > -0.22 && turn < 0.22 ? 0 : turn < 0 ? 1 : -1;
  });
}

function nearestSq(track: Track, x: number, z: number): number {
  let best = Infinity;
  for (const p of track.points) {
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < best) best = d;
  }
  return best;
}

export function generateObstacles(track: Track): Obstacle[] {
  const { points, tangents, halfWidth: hw } = track;
  const n = points.length;
  const out: Obstacle[] = [];
  // Offset `off` to the right of sample i (negative = left).
  const side = (i: number, off: number) => ({ x: points[i].x - tangents[i].z * off, z: points[i].z + tangents[i].x * off });

  // Cones just past the kerb, alternating sides.
  for (let i = 6; i < n - 3; i += 7) {
    const s = Math.floor(i / 7) % 2 ? 1 : -1;
    out.push({ ...side(i, s * (hw + KERB + 1.5)), r: CONE_R, kind: "cone" });
  }

  // A continuous tyre wall at the back of the gravel on the outside of every corner.
  // Samples are 2 m apart on the centreline but further apart out here, so fill any gaps.
  const corners = cornerSides(track);
  const minSq = (hw + 4) * (hw + 4);
  let prev: { x: number; z: number } | null = null;
  for (let i = 0; i < n; i++) {
    const p = corners[i] === 0 ? null : side(i, corners[i] * (hw + KERB + GRAVEL_WIDTH + 0.6));
    if (!p || nearestSq(track, p.x, p.z) < minSq) {
      prev = null;
      continue;
    }
    if (prev) {
      const dx = p.x - prev.x;
      const dz = p.z - prev.z;
      const gap = Math.sqrt(dx * dx + dz * dz);
      const extra = Math.ceil(gap / TYRE_GAP) - 1;
      for (let k = 1; k <= extra && gap < 10; k++) {
        const u = k / (extra + 1);
        out.push({ x: prev.x + dx * u, z: prev.z + dz * u, r: TYRE_R, kind: "tyre" });
      }
    }
    out.push({ ...p, r: TYRE_R, kind: "tyre" });
    prev = p;
  }
  return out;
}

/** Height the street circuit's torii gates are drawn at (src/game/streetLayout.ts); their pillars below scale with it. */
export const TORII_HEIGHT = 19;
// Measured from public/models/jp/torii.glb (5.32 tall, drawn centred on its bounding box): at the ground each pillar
// is 1.35-1.79 off centre and runs from 0.41 behind the gate's spot to 0.44 in front (its front face leans back as
// it rises). A row of three overlapping circles covers that footprint to within ~0.15 m at the corners.
const TORII_SCALE = TORII_HEIGHT / 5.32;
const TORII_PILLAR_OFF = 1.57 * TORII_SCALE;
const TORII_PILLAR_R = 0.25 * TORII_SCALE;
const TORII_PILLAR_ALONG = [-0.23, 0.015, 0.26].map((a) => a * TORII_SCALE);

/** Centreline samples where the street circuit has a torii gate over the road: every ~110 m up on the shrine hill. */
export function toriiSamples(track: Track): number[] {
  const out: number[] = [];
  let last = -100;
  for (let i = 0; i < track.points.length; i += 3) {
    const p = track.points[i];
    if (p.x <= 200 && p.z > 100 && i - last > 55) {
      out.push(i);
      last = i;
    }
  }
  return out;
}

/** The torii pillars stand on the edges of the road: solid roadblocks to thread between. */
export function generatePillars(track: Track): Obstacle[] {
  const out: Obstacle[] = [];
  for (const i of toriiSamples(track)) {
    const p = track.points[i];
    const t = track.tangents[i];
    for (const s of [1, -1])
      for (const along of TORII_PILLAR_ALONG) {
        const off = s * TORII_PILLAR_OFF;
        out.push({ x: p.x - t.z * off + t.x * along, z: p.z + t.x * off + t.z * along, r: TORII_PILLAR_R, kind: "pillar" });
      }
  }
  return out;
}

/**
 * A straight piece of barrier. One-sided: `nx, nz` is the unit normal pointing back toward the track,
 * and cars are kept on that side of it.
 */
export interface Wall {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  nx: number;
  nz: number;
  /** +1 = right-hand side of the track, -1 = left. */
  side: number;
}

/** Barrier distance from the centreline on the straights and the inside of corners. */
export const WALL_OFFSET = HALF_ROAD_PLUS_KERB + 3;
/** On a street circuit: gap between the edge of the road and the wall. */
export const STREET_WALL_GAP = 0.8;
/** On the outside of a corner the barrier stands behind the gravel and the tyre wall. */
export const WALL_OFFSET_CORNER = HALF_ROAD_PLUS_KERB + GRAVEL_WIDTH + 1.9;

/** Continuous barriers down both sides of the whole lap, so a car can never leave the circuit. */
export function generateWalls(track: Track): Wall[] {
  const { points, tangents } = track;
  const n = points.length;
  const corners = cornerSides(track);
  const walls: Wall[] = [];
  for (const side of [1, -1]) {
    const at = (i: number) => {
      // A street circuit's walls stand right at the edge of the road, all the way round.
      const reach = track.kind === "street" ? track.halfWidth + STREET_WALL_GAP : corners[i] === side ? WALL_OFFSET_CORNER : WALL_OFFSET;
      const off = side * reach;
      return { x: points[i].x - tangents[i].z * off, z: points[i].z + tangents[i].x * off };
    };
    for (let i = 0; i < n; i++) {
      const a = at(i);
      const b = at((i + 1) % n);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      // Inward = toward the centreline: left of travel for the right-hand wall, right of travel for the left-hand one.
      walls.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, nx: (side * dz) / len, nz: (-side * dx) / len, side });
    }
  }
  return walls;
}
