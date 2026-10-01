// Rolling terrain around the circuit. Visual only: the track, run-off and every building stay at y = 0;
// the ground rises into gentle hills beyond them so the world isn't a perfectly flat plane.
import type { Track } from "@/sim";
import type { Layout } from "./layout";

export type HeightFn = (x: number, z: number) => number;

const CELL = 10;
/** Ground is dead flat within this distance of the track centreline... */
const FLAT = 48;
/** ...and reaches full hill height this far out. */
const FULL = 150;

function smooth(t: number) {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
}

/** Smooth hills: a few overlapping sine waves, larger the further you get from the circuit. */
function hills(x: number, z: number, distFromCentre: number) {
  const near = 5 * Math.sin(x * 0.011 + 1.3) * Math.sin(z * 0.013 + 0.4) + 3 * Math.sin((x + z) * 0.019 + 2) + 4;
  const far = smooth((distFromCentre - 450) / 900) * (22 + 16 * Math.sin(x * 0.0043 + 0.7) * Math.cos(z * 0.0037 + 1.9));
  return near + far;
}

export function makeHeight(track: Track, layout: Layout): HeightFn {
  let cx = 0;
  let cz = 0;
  for (const p of track.points) {
    cx += p.x;
    cz += p.z;
  }
  cx /= track.points.length;
  cz /= track.points.length;
  let radius = 0;
  for (const p of track.points) radius = Math.max(radius, Math.hypot(p.x - cx, p.z - cz));
  // Everything built by the layout lives within this radius; outside it the mask is simply 1.
  const reach = radius + FULL + 140;
  const n = Math.ceil((reach * 2) / CELL) + 1;
  const mask = new Float32Array(n * n);
  const x0 = cx - reach;
  const z0 = cz - reach;

  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = x0 + i * CELL;
      const z = z0 + j * CELL;
      let dSq = Infinity;
      for (const p of track.points) {
        const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (d < dSq) dSq = d;
      }
      let m = smooth((Math.sqrt(dSq) - FLAT) / (FULL - FLAT));
      // Keep the ground flat under and around grandstands, pits, car parks, the lake, the Ferris wheel...
      if (m > 0)
        for (const r of layout.reserved) {
          const d = Math.hypot(r.x - x, r.z - z) - r.r;
          if (d < 40) m = Math.min(m, smooth((d - 8) / 32));
          if (m === 0) break;
        }
      mask[j * n + i] = m;
    }

  return (x, z) => {
    const fx = (x - x0) / CELL;
    const fz = (z - z0) / CELL;
    let m = 1;
    if (fx >= 0 && fz >= 0 && fx < n - 1 && fz < n - 1) {
      const i = Math.floor(fx);
      const j = Math.floor(fz);
      const u = fx - i;
      const v = fz - j;
      const a = mask[j * n + i];
      const b = mask[j * n + i + 1];
      const c = mask[(j + 1) * n + i];
      const d = mask[(j + 1) * n + i + 1];
      m = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    return m === 0 ? 0 : m * hills(x, z, Math.hypot(x - cx, z - cz));
  };
}
