import type { Track } from "./track";

/** Static round things beside the road. Cones get knocked over; tyre stacks are solid. */
export interface Obstacle {
  x: number;
  z: number;
  r: number;
  kind: "cone" | "tyre";
}

const KERB = 1.2;
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
