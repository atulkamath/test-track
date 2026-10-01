// One-off asset pipeline: turns the downloaded Sketchfab glTF zips into game-ready GLBs.
//   - one file per car, origin on the ground under the car's centre, +z forward, +x left
//   - a "body" node plus "wheel-front-left" etc. pivots at each wheel centre (what src/game/Car.tsx animates)
//   - textures resized and converted to WebP
// Run from a folder that has @gltf-transform/{core,extensions,functions} and sharp installed:
//   node convert-cars.mjs <azura-dir> <pack-dir> <out-dir>
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds, prune, dedup, textureCompress } from "@gltf-transform/functions";
import sharp from "sharp";

const [azuraDir, packDir, outDir] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// --- tiny column-major 4x4 helpers (glTF convention) ---
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const translate = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const rotY = (a) => [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1];
const scale = (s) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
const centre = (n) => {
  const b = getBounds(n);
  return { c: b.min.map((v, i) => (v + b.max[i]) / 2), size: b.min.map((v, i) => b.max[i] - v), min: b.min, max: b.max };
};
const meshNodes = (n, out = []) => {
  if (n.getMesh()) out.push(n);
  n.listChildren().forEach((ch) => meshNodes(ch, out));
  return out;
};

/**
 * Rebuild one car into a clean hierarchy.
 * bodyParts: nodes forming the body; wheels: 4 wheel nodes; frame: world->car matrix; skip: mesh-node name filter.
 */
async function build(doc, name, bodyParts, wheels, frame, out, texSize, afterBuild) {
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const car = doc.createNode(name);
  const body = doc.createNode("body");
  car.addChild(body);
  for (const part of bodyParts)
    for (const mn of meshNodes(part)) {
      body.addChild(doc.createNode(mn.getName()).setMesh(mn.getMesh()).setMatrix(mul(frame, mn.getWorldMatrix())));
    }
  let radius = 0;
  for (const w of wheels) {
    const b = centre(w.node);
    // Wheel centre in car space.
    const p = mul(frame, translate(...b.c)).slice(12, 15);
    const pivot = doc.createNode(w.name).setTranslation(p);
    for (const mn of meshNodes(w.node)) {
      pivot.addChild(doc.createNode(mn.getName()).setMesh(mn.getMesh()).setMatrix(mul(translate(-p[0], -p[1], -p[2]), mul(frame, mn.getWorldMatrix()))));
    }
    car.addChild(pivot);
    radius = Math.max(radius, b.size[1] / 2);
  }
  car.setExtras({ wheelRadius: radius * Math.hypot(frame[0], frame[1], frame[2]) });
  // Drop the old hierarchy; prune() then removes everything unreferenced (other cars' meshes and textures).
  for (const ch of scene.listChildren()) ch.dispose();
  for (const n of root.listNodes()) if (n !== car && !isUnder(n, car)) n.dispose();
  scene.addChild(car);
  afterBuild?.(doc);
  await doc.transform(prune(), dedup(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [texSize, texSize], quality: 92 }));
  await io.write(out, doc);
  const b = centre(car);
  console.log(`${name.padEnd(10)} -> ${out.split("/").pop().padEnd(16)} size ${b.size.map((v) => v.toFixed(2)).join(" x ")}  ground y ${b.min[1].toFixed(2)}  wheel r ${car.getExtras().wheelRadius.toFixed(2)}`);
}
function isUnder(n, top) {
  for (let p = n; p; p = p.getParentNode?.()) if (p === top) return true;
  return false;
}

/**
 * Delete one connected piece ("island") of a mesh: the one whose bounding-box centre, in world space, is within
 * `tol` of `centre`. Used to take the static steering wheel out of the Azura's one-piece interior so the game
 * can put an animated one in its place.
 */
function removeIsland(doc, nodeFilter, centre, tol) {
  const apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
  let removed = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || !nodeFilter.test(node.getName())) continue;
    const W = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      const idx = prim.getIndices();
      if (!idx) continue;
      const n = pos.getCount();
      // Weld by position, then union-find over triangles.
      const seen = new Map();
      const rep = new Int32Array(n);
      const P = [];
      for (let i = 0; i < n; i++) {
        P.push(apply(W, pos.getElement(i, [])));
        const key = P[i].map((v) => Math.round(v * 2000)).join(",");
        if (!seen.has(key)) seen.set(key, i);
        rep[i] = seen.get(key);
      }
      const parent = Int32Array.from({ length: n }, (_, i) => i);
      const find = (a) => {
        while (parent[a] !== a) a = parent[a] = parent[parent[a]];
        return a;
      };
      const tris = idx.getCount();
      for (let t = 0; t < tris; t += 3) {
        const a = find(rep[idx.getScalar(t)]);
        parent[find(rep[idx.getScalar(t + 1)])] = a;
        parent[find(rep[idx.getScalar(t + 2)])] = a;
      }
      const box = new Map();
      for (let i = 0; i < n; i++) {
        const r = find(rep[i]);
        const b = box.get(r) ?? box.set(r, { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }).get(r);
        for (let k = 0; k < 3; k++) {
          b.min[k] = Math.min(b.min[k], P[i][k]);
          b.max[k] = Math.max(b.max[k], P[i][k]);
        }
      }
      const doomed = new Set([...box].filter(([, b]) => b.min.every((v, k) => Math.abs((v + b.max[k]) / 2 - centre[k]) < tol)).map(([r]) => r));
      if (doomed.size === 0) continue;
      const keep = [];
      for (let t = 0; t < tris; t += 3) {
        if (doomed.has(find(rep[idx.getScalar(t)]))) removed++;
        else keep.push(idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2));
      }
      prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(keep)).setBuffer(doc.getRoot().listBuffers()[0]));
    }
  }
  return removed;
}

// --- Azura: already +z forward / +x left; lift onto the ground, scale to the sim's 3.8 m car, drop its fake shadow.
{
  const doc = await io.read(`${azuraDir}/scene.gltf`);
  const byName = (n) => doc.getRoot().listNodes().find((x) => x.getName() === n);
  const all = centre(byName("Body"));
  const wheelBottom = centre(byName("WH_FL")).min[1];
  const s = 3.8 / all.size[2];
  const frame = mul(scale(s), translate(-all.c[0], -wheelBottom, -all.c[2]));
  await build(
    doc,
    "azura",
    ["Body", "Details", "Glass", "Interior"].map(byName),
    [
      { node: byName("WH_FL"), name: "wheel-front-left" },
      { node: byName("WH_FR"), name: "wheel-front-right" },
      { node: byName("WH_RL"), name: "wheel-back-left" },
      { node: byName("WH_RR"), name: "wheel-back-right" },
    ],
    frame,
    `${outDir}/azura.glb`,
    2048, // the player's car is seen up close: keep its textures sharp
    // Take out the model's fixed steering wheel (centred here in car space); the game adds an animated one.
    (d) => console.log(`azura: removed ${removeIsland(d, /Interior/, [0.3, 0.81, 0.27], 0.04)} steering-wheel triangles`),
  );
}

/**
 * Average "redness" of a light mesh's texture at each end of the car. `along(worldPos)` > 0 means the
 * provisional front end. Returns null if the mesh has no texture to sample.
 */
async function rednessByEnd(node, along) {
  const prim = node?.getMesh()?.listPrimitives()[0];
  const tex = prim?.getMaterial()?.getBaseColorTexture();
  const uv = prim?.getAttribute("TEXCOORD_0");
  if (!prim || !tex || !uv) return null;
  const { data, info } = await sharp(Buffer.from(tex.getImage())).raw().toBuffer({ resolveWithObject: true });
  const pos = prim.getAttribute("POSITION");
  const W = node.getWorldMatrix();
  const sum = { front: 0, back: 0 };
  const count = { front: 0, back: 0 };
  for (let i = 0; i < pos.getCount(); i++) {
    const p = pos.getElement(i, []);
    const t = uv.getElement(i, []);
    const world = [W[0] * p[0] + W[4] * p[1] + W[8] * p[2] + W[12], 0, W[2] * p[0] + W[6] * p[1] + W[10] * p[2] + W[14]];
    const px = Math.min(info.width - 1, Math.max(0, Math.floor((t[0] - Math.floor(t[0])) * info.width)));
    const py = Math.min(info.height - 1, Math.max(0, Math.floor((t[1] - Math.floor(t[1])) * info.height)));
    const o = (py * info.width + px) * info.channels;
    const end = along(world) > 0 ? "front" : "back";
    sum[end] += data[o] - (data[o + 1] + data[o + 2]) / 2;
    count[end]++;
  }
  return { front: sum.front / Math.max(count.front, 1), back: sum.back / Math.max(count.back, 1) };
}

// --- Pack: ten cars parked in a circle. Give each body its four nearest wheels and work out which way it faces.
{
  const probe = await io.read(`${packDir}/scene.gltf`);
  const bodies = probe.getRoot().listNodes().filter((n) => /body$/i.test(n.getName())).map((n) => n.getName());
  for (const bodyName of bodies) {
    const doc = await io.read(`${packDir}/scene.gltf`);
    const nodes = doc.getRoot().listNodes();
    const body = nodes.find((n) => n.getName() === bodyName);
    const bc = centre(body);
    const wheels = nodes
      .filter((n) => /^Wheel_[A-Z]\d*$/.test(n.getName()))
      .map((n) => ({ node: n, c: centre(n).c }))
      .sort((a, b) => Math.hypot(a.c[0] - bc.c[0], a.c[2] - bc.c[2]) - Math.hypot(b.c[0] - bc.c[0], b.c[2] - bc.c[2]))
      .slice(0, 4);
    // Long axis of the wheel rectangle = the car's length axis.
    const mid = [0, 2].map((i) => wheels.reduce((s, w) => s + w.c[i], 0) / 4);
    const far = wheels.map((w) => [w.c[0] - mid[0], w.c[2] - mid[1]]);
    // Pair each wheel with its nearest neighbour (same axle is closer than same side: track < wheelbase).
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const partner = [1, 2, 3].sort((a, b) => d(far[0], far[a]) - d(far[0], far[b]))[0];
    const axleA = [(far[0][0] + far[partner][0]) / 2, (far[0][1] + far[partner][1]) / 2];
    let fwd = [axleA[0] / Math.hypot(...axleA), axleA[1] / Math.hypot(...axleA)];
    // Which end is the front? Tail lights are red, headlights are not: compare how red the lights are at each
    // end. If the lights don't settle it, fall back on the windows sitting toward the back (the bonnet has no glass).
    const slug = bodyName.replace(/ body$/i, "").toLowerCase().replace(/\s+/g, "-");
    const along = (p) => (p[0] - mid[0]) * fwd[0] + (p[2] - mid[1]) * fwd[1];
    const lights = await rednessByEnd(meshNodes(body).find((n) => /optics/i.test(n.getName())), along);
    if (lights && Math.abs(lights.front - lights.back) > 10) {
      if (lights.front > lights.back) fwd = [-fwd[0], -fwd[1]];
    } else {
      const glass = meshNodes(body).find((n) => /glass/i.test(n.getName()));
      if (glass && along(centre(glass).c) > 0) fwd = [-fwd[0], -fwd[1]];
    }
    const heading = Math.atan2(fwd[0], fwd[1]); // rotation about y that takes +z to fwd
    const frame = mul(rotY(-heading), translate(-mid[0], -centre(wheels[0].node).min[1], -mid[1]));
    const named = wheels.map((w) => {
      const p = mul(frame, translate(...w.c)).slice(12, 15);
      return { node: w.node, name: `wheel-${p[2] > 0 ? "front" : "back"}-${p[0] > 0 ? "left" : "right"}` };
    });
    await build(doc, slug, [body], named, frame, `${outDir}/cars/${slug}.glb`, 1024);
  }
}
