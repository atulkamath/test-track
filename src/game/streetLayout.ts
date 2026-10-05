// "Sakura Street": what stands where around the street circuit. Rendering only.
// The lap is dressed in zones so each stretch feels different, with everything hard up against the walls:
//   straight - main straight: covered grandstands on the inside, a canal with a cherry-lined bank outside
//   east     - green woodland either side of the tunnel, the odd cherry
//   tunnel   - roofed over, with a hill on top
//   north    - shrine hill: torii gates over the road, stone lanterns, dense cherry trees, a pagoda
//   west     - park: cherry trees, fans on grass banks
//   town     - old town: wooden townhouses, lantern strings across the street, fans on the pavement
import { STREET_WALL_GAP, TORII_HEIGHT, toriiSamples, type Track } from "@/sim";
import { at, clearance, createBuilder, frame, type Box, type Layout, type ModelSpot, type Spot, type TreeSpot } from "./layout";

type Zone = "straight" | "east" | "tunnel" | "north" | "west" | "town";

function zoneAt(x: number, z: number): Zone {
  if (z < -125) return "straight";
  if (x > 235 && z > -75 && z < 60) return "tunnel";
  if (x > 200) return "east";
  if (z > 100) return "north";
  if (x < -185 && z > -60) return "west";
  return "town";
}

/** Ground-floor fronts for the townhouses (Quaternius modular walls). */
const FRONTS = ["shojiwall", "normalwall", "redwoodwall", "jdoor", "shojiwall", "normalwall"];
const BAY = 3; // metres of street per house-front module
const FRONT_HEIGHT = 3.9;

export function buildStreetLayout(track: Track): Layout {
  const b = createBuilder(track);
  const { hw, n, boxes, people, rand, flags, reserved, tvSpots, add, person, standingCrowd, grandstand, SEG, segLen } = b;
  const models: ModelSpot[] = [];
  const trees: TreeSpot[] = [];
  const tunnels: { from: number; to: number }[] = [];
  const lamps: { x: number; y: number; z: number }[] = [];
  const wall = hw + STREET_WALL_GAP;

  let cx = 0;
  let cz = 0;
  for (const p of track.points) {
    cx += p.x;
    cz += p.z;
  }
  cx /= n;
  cz /= n;
  /** Which side of the track at sample i faces the middle of the lap: +1 = right, -1 = left. */
  const innerSide = (i: number) => {
    const f = frame(track, i);
    return (cx - f.x) * -f.tz + (cz - f.z) * f.tx > 0 ? 1 : -1;
  };
  const model = (name: string, f: ReturnType<typeof frame>, off: number, along: number, y: number, rot: number, height: number, tint?: string) => {
    const p = at(f, off, along);
    models.push({ model: name, x: p.x, y, z: p.z, rot, height, tint });
  };
  const tree = (f: ReturnType<typeof frame>, off: number, along: number, height: number, kind: TreeSpot["kind"] = "sakura") => {
    const p = at(f, off, along);
    // Never plant one in the road of another part of the lap.
    if (clearance(track, p.x, p.z) < wall + 0.8) return;
    trees.push({ x: p.x, z: p.z, height, kind });
  };
  const keepClear = (f: ReturnType<typeof frame>, off: number, r: number) => reserved.push({ ...at(f, off), r });

  // --- The walls themselves (solid in the sim): low concrete with sponsor boards, debris fence on top. ---
  track.walls.forEach((w, k) => {
    const dx = w.bx - w.ax;
    const dz = w.bz - w.az;
    const mid = { x: (w.ax + w.bx) / 2, z: (w.az + w.bz) / 2 };
    const inTunnel = zoneAt(mid.x, mid.z) === "tunnel";
    const common = { rot: Math.atan2(dx, dz), sz: Math.hypot(dx, dz) + 0.06 };
    boxes.push({
      ...common,
      x: mid.x - w.nx * 0.2,
      y: 0.5,
      z: mid.z - w.nz * 0.2,
      sx: 0.4,
      sy: 1,
      kind: inTunnel ? "concrete" : Math.floor(k / 3) % 2 ? `ad${Math.floor(k / 6) % 5}` : "concrete",
    } as Box);
    if (!inTunnel) boxes.push({ ...common, x: mid.x - w.nx * 0.25, y: 2.1, z: mid.z - w.nz * 0.25, sx: 0.05, sy: 2.2, kind: "fence" } as Box);
  });

  /** A wooden townhouse front one segment long: two bays of ground floor, maybe an upper storey, tiled roof. */
  const house = (f: ReturnType<typeof frame>, s: number, i: number) => {
    const front = wall + 2.6;
    const depth = 7.5;
    const block = Math.floor(i / (SEG * 4));
    const storeys = (block * 7 + (s > 0 ? 3 : 0)) % 3 === 0 ? 1 : 2;
    const p = at(f, s * (front + depth / 2));
    if (clearance(track, p.x, p.z) < front) return;
    // Ground-floor modules face the street.
    const facing = Math.atan2(-f.tz, f.tx) + (s > 0 ? Math.PI : 0);
    for (const along of [-BAY / 2, BAY / 2]) {
      const k = Math.floor(rand() * FRONTS.length);
      model(FRONTS[k], f, s * front, along, 0, facing, FRONT_HEIGHT);
    }
    // Timber body behind the front, plaster upper storey with dark beams.
    add(f, s * (front + 0.3 + depth / 2), FRONT_HEIGHT / 2, depth, FRONT_HEIGHT, segLen, "wood");
    let eave = FRONT_HEIGHT;
    if (storeys === 2) {
      add(f, s * (front + 0.6 + (depth - 0.6) / 2), FRONT_HEIGHT + 1.35, depth - 0.6, 2.7, segLen, "plaster");
      add(f, s * (front + 0.55), FRONT_HEIGHT + 0.12, 0.14, 0.24, segLen, "wood");
      add(f, s * (front + 0.55), FRONT_HEIGHT + 2.58, 0.14, 0.24, segLen, "wood");
      for (const along of [-segLen / 2 + 0.1, 0, segLen / 2 - 0.1]) add(f, s * (front + 0.55), FRONT_HEIGHT + 1.35, 0.14, 2.7, 0.2, "wood", along);
      // Lean-to roof over the shop front.
      add(f, s * (front - 0.35), FRONT_HEIGHT + 0.2, 1.7, 0.14, segLen + 0.1, "tile", 0, -s * 0.32);
      eave += 2.7;
    }
    // Gabled tile roof, ridge running along the street, eaves overhanging the pavement.
    const slope = 0.44;
    const half = depth / 2 + 0.9;
    const run = half / Math.cos(slope);
    const rise = half * Math.tan(slope);
    const mid = front + 0.3 + depth / 2;
    add(f, s * (mid - half / 2), eave + rise / 2, run, 0.18, segLen + 0.12, "tile", 0, -s * slope);
    add(f, s * (mid + half / 2), eave + rise / 2, run, 0.18, segLen + 0.12, "tile", 0, s * slope);
    add(f, s * mid, eave + rise + 0.06, 0.5, 0.26, segLen + 0.12, "tile");
    keepClear(f, s * mid, depth / 2 + 5);
  };

  /** Red paper lanterns on a wire across the street. */
  const lanternString = (f: ReturnType<typeof frame>) => {
    const reach = wall + 2.2;
    add(f, 0, 6.35, reach * 2, 0.03, 0.03, "steel");
    for (let off = -reach + 1.2; off <= reach - 1.2; off += 1.9) model("redlantern", f, off, 0, 5.55, 0, 0.8);
  };

  const sushiTrucks = new Set<number>();
  let tunnelFrom = -1;
  // The sim decides where the gates stand: their pillars are solid.
  const torii = new Set(toriiSamples(track));
  let seg = 0;

  for (let i = 0; i < n; i += SEG, seg++) {
    const f = frame(track, i);
    const zone = zoneAt(f.x, f.z);
    const inner = innerSide(i);
    const outer = -inner;
    if (torii.has(i)) {
      // Vermilion gate spanning the road, its pillars on the road's edge: solid in the sim, a roadblock to thread.
      model("torii", f, 0, 0, 0, Math.atan2(f.tx, f.tz), TORII_HEIGHT, "#e2401f");
    }

    // Track where the tunnel starts and stops.
    if (zone === "tunnel" && tunnelFrom < 0) tunnelFrom = i;
    if (zone !== "tunnel" && tunnelFrom >= 0) {
      tunnels.push({ from: tunnelFrom, to: i });
      tunnelFrom = -1;
    }

    // Street lamps everywhere but the tunnel: a post behind the wall, alternating sides, its arm reaching out over the road.
    if (zone !== "tunnel" && seg % 3 === 0) {
      const lampSide = (seg / 3) % 2 ? 1 : -1;
      add(f, lampSide * (wall + 0.6), 3.3, 0.14, 6.6, 0.14, "steel");
      add(f, lampSide * (wall - 0.5), 6.55, 2.3, 0.09, 0.09, "steel");
      add(f, lampSide * (wall - 1.5), 6.45, 0.75, 0.12, 0.32, "streetlamp");
      lamps.push({ ...at(f, lampSide * (wall - 1.5)), y: 6.35 });
    }

    if (zone === "straight") {
      // Inside: covered grandstands along the whole straight.
      if (b.fits(f, inner * (hw + 3.2), inner * (wall + 20)) && f.x > -215 && f.x < 175) grandstand(f, inner, wall + 5.5, 9, segLen, seg, true);
      // Outside: a promenade with cherry trees and lanterns, then the canal, then more blossom on the far bank.
      if (seg % 2 === 0) tree(f, outer * (wall + 1.7), 0, 8 + rand() * 3);
      if (seg % 2 === 1) model("stonelamp", f, outer * (wall + 1.5), 0, 0, 0, 2.3);
      standingCrowd(f, outer, wall + 0.7, 1.6, segLen, 4);
      tree(f, outer * (wall + 22 + rand() * 3), (rand() - 0.5) * 4, 9 + rand() * 4);
      if (seg % 2 === 0) tree(f, outer * (wall + 30 + rand() * 6), 0, 10 + rand() * 4);
      keepClear(f, outer * (wall + 12), 14);
    } else if (zone === "tunnel") {
      // Walls, roof slab, a strip light, and the hill over the top.
      for (const s of [1, -1]) {
        add(f, s * (wall + 0.35), 2.9, 0.7, 5.8, segLen + 0.05, "concrete");
        add(f, s * (wall + 6.5), 3.6, 11.5, 7.2, segLen + 0.05, "berm");
        if (seg % 2 === 0) tree(f, s * (wall + 6 + rand() * 4), 0, 7 + rand() * 3);
      }
      add(f, 0, 6.05, (wall + 0.7) * 2, 0.5, segLen + 0.05, "concrete");
      add(f, 0, 5.74, 0.5, 0.1, 2.4, "lamp");
      for (const s of [1, -1]) {
        // Lined like a real road tunnel: pale panels on the lower wall under a dark band, a raised kerb,
        // a row of wall lights, and a cable tray up under the roof.
        add(f, s * (wall - 0.02), 1.25, 0.06, 2.1, segLen + 0.05, "plaster");
        add(f, s * (wall - 0.03), 2.42, 0.07, 0.22, segLen + 0.05, "wood");
        add(f, s * (wall - 0.1), 0.1, 0.2, 0.2, segLen + 0.05, "asphalt");
        add(f, s * (wall - 0.08), 3.5, 0.1, 0.16, 1.5, "lamp");
        add(f, s * (wall - 0.25), 5.3, 0.4, 0.08, segLen + 0.05, "steel");
      }
      // Portal at each end: a heavy concrete frame standing proud of the hillside.
      const prevZone = zoneAt(frame(track, (i - SEG + n) % n).x, frame(track, (i - SEG + n) % n).z);
      const nextZone = zoneAt(frame(track, (i + SEG) % n).x, frame(track, (i + SEG) % n).z);
      if (prevZone !== "tunnel" || nextZone !== "tunnel") {
        const along = (prevZone !== "tunnel" ? -1 : 1) * (segLen / 2 - 0.4);
        add(f, 0, 7.2, (wall + 2.4) * 2, 2.4, 1.4, "concrete", along);
        for (const s of [1, -1]) add(f, s * (wall + 1.5), 3.2, 1.9, 6.4, 1.4, "concrete", along);
        add(f, 0, 5.98, (wall + 0.6) * 2, 0.14, 1.46, "steel", along);
      }
      add(f, 0, 7.1, (wall + 1) * 2, 1.4, segLen + 0.05, "berm");
      keepClear(f, 0, 22);
    } else if (zone === "east") {
      // Green woodland crowding in on both sides, with the odd cherry tree.
      for (const s of [1, -1]) {
        for (let k = 0; k < 2; k++) tree(f, s * (wall + 5 + rand() * 6), (rand() - 0.5) * segLen, 8 + rand() * 4, "green");
        if (seg % 3 === 0) tree(f, s * (wall + 8 + rand() * 4), 0, 9 + rand() * 3);
        if (seg % 4 === 0) standingCrowd(f, s, wall + 0.7, 1.4, segLen, 3);
      }
    } else if (zone === "north") {
      // Shrine hill: blossom overhead, stone lanterns, and torii gates spanning the road.
      for (const s of [1, -1]) {
        tree(f, s * (wall + 2 + rand() * 1.2), (rand() - 0.5) * 2, 8 + rand() * 3);
        if (seg % 2 === 0) tree(f, s * (wall + 9 + rand() * 4), 0, 10 + rand() * 4);
        if (seg % 2 === 0) model("stonelamp", f, s * (wall + 1.1), 0, 0, 0, 2.3);
        if (seg % 3 === 0) standingCrowd(f, s, wall + 0.7, 1.8, segLen, 4);
      }
    } else if (zone === "west") {
      // Park: cherry trees both sides, fans on a grass bank on the outside.
      for (const s of [1, -1]) {
        if (seg % 2 === (s > 0 ? 0 : 1)) tree(f, s * (wall + 2.2), 0, 8 + rand() * 3);
        tree(f, s * (wall + 13 + rand() * 6), (rand() - 0.5) * 4, 9 + rand() * 4);
      }
      const BERM = 9;
      const RISE = 2.6;
      const slope = Math.atan2(RISE, BERM);
      add(f, outer * (wall + 1 + BERM / 2), RISE / 2 - 0.3, BERM / Math.cos(slope), 0.6, segLen + 0.05, "berm", 0, -outer * slope);
      for (let k = 0; k < 12; k++) {
        const d = 0.8 + rand() * (BERM - 1.6);
        person(f, outer, wall + 1 + d, (rand() - 0.5) * segLen, (d / BERM) * RISE, rand() < 0.5);
      }
      standingCrowd(f, inner, wall + 0.7, 1.8, segLen, 3);
      keepClear(f, outer * (wall + 6), 9);
    } else {
      // Old town: townhouses tight to the pavement on both sides, fans along it, lanterns overhead.
      for (const s of [1, -1]) {
        if ((seg * 5 + (s > 0 ? 0 : 2)) % 23 === 0 && sushiTrucks.size < 3) {
          sushiTrucks.add(i);
          model("sushitruck", f, s * (wall + 4.2), 0, 0, Math.atan2(f.tx, f.tz) + (s > 0 ? Math.PI / 2 : -Math.PI / 2), 3.3);
          keepClear(f, s * (wall + 5), 7);
        } else house(f, s, i);
        standingCrowd(f, s, wall + 0.6, 1.5, segLen, 4);
      }
      if (seg % 3 === 0) lanternString(f);
    }
  }
  if (tunnelFrom >= 0) tunnels.push({ from: tunnelFrom, to: n });

  // --- The canal beside the main straight, on the outside. ---
  const straight = Array.from({ length: n }, (_, i) => i).filter((i) => zoneAt(track.points[i].x, track.points[i].z) === "straight");
  const canals: Layout["canals"] = [];
  if (straight.length > 0) {
    // The straight wraps past the start line: split it into runs of consecutive samples.
    let run: number[] = [];
    const flush = () => {
      if (run.length > 4) {
        const side = -innerSide(run[Math.floor(run.length / 2)]);
        const pts = (off: number) => run.map((i) => at(frame(track, i), side * off));
        canals.push({ near: pts(wall + 4.2), far: pts(wall + 19) });
      }
      run = [];
    };
    for (const i of straight) {
      if (run.length > 0 && i !== run[run.length - 1] + 1) flush();
      run.push(i);
    }
    flush();
  }

  // --- Landmarks. ---
  // A five-storey pagoda on the infield hill above the esses, visible from half the lap.
  const hill = { x: 120, z: 55 };
  if (clearance(track, hill.x, hill.z) > 40) {
    models.push({ model: "pagoda", x: hill.x, y: 0, z: hill.z, rot: 0.4, height: 34 });
    reserved.push({ ...hill, r: 16 });
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      trees.push({ x: hill.x + Math.cos(a) * (19 + (k % 3) * 4), z: hill.z + Math.sin(a) * (19 + (k % 3) * 4), height: 9 + (k % 4), kind: "sakura" });
    }
  }

  // Timing tower and big screen near the start line, on the outside of the main straight.
  const start = frame(track, 4);
  const out = -innerSide(4);
  const tower: Spot = { ...at(start, out * (wall + 2.6), 10), rot: start.rot };
  const screen: Spot = { ...at(start, out * (wall + 3), -24), rot: start.rot, y: 7.5 };
  reserved.push({ x: tower.x, z: tower.z, r: 5 });

  // Trackside cameras for the TV view: one every 100 m or so, just behind the wall on the inside of the lap and
  // above the catch fence, so the car is never far from one. In the tunnel it hangs under the roof.
  for (let i = 10; i < n; i += 50) {
    const f = frame(track, i);
    if (zoneAt(f.x, f.z) === "tunnel") tvSpots.push({ x: f.x, y: 5.2, z: f.z });
    else {
      const p = at(f, innerSide(i) * (wall + 1.4));
      tvSpots.push({ x: p.x, y: 4.8, z: p.z });
    }
  }


  return {
    boxes,
    people,
    models,
    trees,
    tunnels,
    lamps,
    canals,
    tvSpots,
    tents: [],
    parked: [],
    trucks: [],
    lake: null,
    screen,
    flags,
    tower,
    wheel: null,
    cornerSide: track.points.map(() => 0),
    reserved,
  };
}
