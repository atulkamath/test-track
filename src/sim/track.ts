import { generateObstacles, generateWalls, type Obstacle, type Wall } from "./obstacles";
import { hashString, mulberry32 } from "./rng";
import { dcos, dsin } from "./trig";

export interface Vec2 {
  x: number;
  z: number;
}

/** A line across the road. Crossed when the car's per-tick movement intersects a->b moving along t. */
export interface Gate {
  a: Vec2;
  b: Vec2;
  t: Vec2;
}

/** "circuit": wide road with kerbs, gravel run-off and tyre walls. "street": narrow road with walls at the kerb. */
export type TrackKind = "circuit" | "street";

export interface Track {
  seed: string;
  kind: TrackKind;
  /** Centreline, closed loop, evenly spaced (points[0] is the finish line). */
  points: Vec2[];
  /** Unit tangent at each point. */
  tangents: Vec2[];
  halfWidth: number;
  /** gates[0] is start/finish; a lap = gates 1..n-1 in order, then gate 0. */
  gates: Gate[];
  obstacles: Obstacle[];
  /** Barriers down both sides of the lap. */
  walls: Wall[];
  length: number;
}

export const HALF_WIDTH = 7;

/** Map id of the fixed street circuit. */
export const STREET_SEED = "sakura";
/** A street is narrower than a race circuit: 11 m of road between the walls' kerbs. */
const STREET_HALF_WIDTH = 5.5;
/**
 * "Sakura Street": a hand-drawn lap of about 1.9 km (x east, z north, metres). Anticlockwise from the start
 * line on the long south straight: up the east side along the canal, west through the esses, down the west
 * side, then an old-town loop that doubles back through a hairpin before rejoining the main straight.
 */
const STREET_POINTS: Vec2[] = [
  [-120, -140], [60, -140], [190, -140], // main straight, heading east
  [240, -110], [255, -50], [250, 40], // east side, heading north (tunnel)
  [225, 110], [160, 140], // north-east corner
  [80, 125], [30, 150], [-30, 125], [-90, 150], // esses, heading west
  [-160, 130], [-215, 80], [-200, 20], // west side, heading south
  [-140, 0], [-60, 10], [0, -10], // into the old town, heading east
  [40, -50], [0, -85], // hairpin
  [-80, -75], [-160, -70], // back west through the old town
  [-225, -90], [-240, -125], [-200, -142], // round onto the main straight
].map(([x, z]) => ({ x, z }));
const BASE_RADIUS = 150;
const SPACING = 2;
const GATE_COUNT = 8;
const GATE_HALF_LENGTH = HALF_WIDTH * 2.5;
/** Non-neighbouring parts of the track must be at least this far apart (no overlaps, no tight hairpins). */
const MIN_SEPARATION = 40;
const MAX_ATTEMPTS = 100;

/** The seed doubles as the map id: the street circuit has a fixed name, anything else seeds a random circuit. */
export function generateTrack(seed: string): Track {
  if (seed === STREET_SEED) return build(seed, resample(catmullRom(STREET_POINTS), SPACING), "street", STREET_HALF_WIDTH);
  const rand = mulberry32(hashString(seed));
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const points = resample(catmullRom(controlPoints(rand)), SPACING);
    if (isClean(points)) return build(seed, points, "circuit", HALF_WIDTH);
  }
  throw new Error(`no valid track for seed ${seed}`);
}

function controlPoints(rand: () => number): Vec2[] {
  const n = 9 + Math.floor(rand() * 5);
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * (i + (rand() - 0.5) * 0.5)) / n;
    const r = BASE_RADIUS * (0.6 + rand() * 0.6);
    pts.push({ x: r * dcos(angle), z: r * dsin(angle) });
  }
  return pts;
}

/** Closed uniform Catmull-Rom, densely sampled. */
function catmullRom(ctrl: Vec2[], perSegment = 24): Vec2[] {
  const n = ctrl.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n];
    const p1 = ctrl[i];
    const p2 = ctrl[(i + 1) % n];
    const p3 = ctrl[(i + 2) % n];
    for (let s = 0; s < perSegment; s++) {
      const t = s / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  return out;
}

/** Walk the closed polyline and emit points at equal arc-length spacing. */
function resample(poly: Vec2[], spacing: number): Vec2[] {
  const n = poly.length;
  const segLen: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const l = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
    segLen.push(l);
    total += l;
  }
  const count = Math.round(total / spacing);
  const step = total / count;
  const out: Vec2[] = [];
  let seg = 0;
  let segStart = 0;
  for (let k = 0; k < count; k++) {
    const s = k * step;
    while (segStart + segLen[seg] < s) {
      segStart += segLen[seg];
      seg++;
    }
    const a = poly[seg];
    const b = poly[(seg + 1) % n];
    const u = segLen[seg] === 0 ? 0 : (s - segStart) / segLen[seg];
    out.push({ x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u });
  }
  return out;
}

function isClean(points: Vec2[]): boolean {
  const n = points.length;
  // Points closer than this along the track are allowed to be near each other.
  const skip = Math.ceil((MIN_SEPARATION * Math.PI) / 2 / SPACING);
  const minSq = MIN_SEPARATION * MIN_SEPARATION;
  for (let i = 0; i < n; i++) {
    for (let j = i + skip; j < n; j++) {
      if (n - (j - i) < skip) continue;
      const dx = points[i].x - points[j].x;
      const dz = points[i].z - points[j].z;
      if (dx * dx + dz * dz < minSq) return false;
    }
  }
  return true;
}

function build(seed: string, points: Vec2[], kind: TrackKind, halfWidth: number): Track {
  const n = points.length;
  const tangents = points.map((_, i) => {
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const l = Math.sqrt(dx * dx + dz * dz);
    return { x: dx / l, z: dz / l };
  });
  const gates: Gate[] = [];
  for (let k = 0; k < GATE_COUNT; k++) {
    const i = Math.round((k * n) / GATE_COUNT) % n;
    const p = points[i];
    const t = tangents[i];
    const nx = -t.z * GATE_HALF_LENGTH;
    const nz = t.x * GATE_HALF_LENGTH;
    gates.push({ a: { x: p.x - nx, z: p.z - nz }, b: { x: p.x + nx, z: p.z + nz }, t });
  }
  const track: Track = { seed, kind, points, tangents, halfWidth, gates, obstacles: [], walls: [], length: n * SPACING };
  // A street circuit has no run-off, so nothing to put in it: no cones, no tyre walls.
  if (kind === "circuit") track.obstacles = generateObstacles(track);
  track.walls = generateWalls(track);
  return track;
}

/** Distance from (x, z) to the centreline. Full scan: ~500 points, cheap and order-independent. */
export function distanceToCentre(track: Track, x: number, z: number): number {
  const pts = track.points;
  const n = pts.length;
  let best = 0;
  let bestSq = Infinity;
  for (let i = 0; i < n; i++) {
    const dx = pts[i].x - x;
    const dz = pts[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestSq) {
      bestSq = d;
      best = i;
    }
  }
  const p = pts[best];
  return Math.min(
    segmentDistance(pts[(best - 1 + n) % n], p, x, z),
    segmentDistance(p, pts[(best + 1) % n], x, z),
  );
}

function segmentDistance(a: Vec2, b: Vec2, x: number, z: number): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lenSq = abx * abx + abz * abz;
  let u = lenSq === 0 ? 0 : ((x - a.x) * abx + (z - a.z) * abz) / lenSq;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  const dx = a.x + abx * u - x;
  const dz = a.z + abz * u - z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Did the move (x0,z0)->(x1,z1) cross the gate in the forward direction? */
export function crossesGate(g: Gate, x0: number, z0: number, x1: number, z1: number): boolean {
  if ((x1 - x0) * g.t.x + (z1 - z0) * g.t.z <= 0) return false;
  const cross = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) =>
    (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d1 = cross(g.a.x, g.a.z, g.b.x, g.b.z, x0, z0);
  const d2 = cross(g.a.x, g.a.z, g.b.x, g.b.z, x1, z1);
  const d3 = cross(x0, z0, x1, z1, g.a.x, g.a.z);
  const d4 = cross(x0, z0, x1, z1, g.b.x, g.b.z);
  return d1 * d2 <= 0 && d1 !== d2 && d3 * d4 < 0;
}
