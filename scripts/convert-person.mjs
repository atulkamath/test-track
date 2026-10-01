// One-off: shrink the Quaternius "Animated Human" (CC0) for use as crowd and driver.
// Welds and simplifies the mesh (skin weights are kept) and drops the animations we don't use.
//   node convert-person.mjs <man.glb> <out.glb>
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { weld, simplify, prune, dedup } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

const [src, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const tris = () => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((s, p) => s + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3, 0);
const before = tris();
for (const a of doc.getRoot().listAnimations()) if (!/Idle$/.test(a.getName())) a.dispose();
// The source is flat-shaded (every triangle has its own vertices). Drop normals and UVs so identical
// positions can be welded; the game recomputes normals after posing, and the model has no textures.
for (const prim of doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())) {
  prim.setAttribute("NORMAL", null);
  prim.setAttribute("TEXCOORD_0", null);
}
await MeshoptSimplifier.ready;
await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.42, error: 0.01 }), prune(), dedup());
await io.write(out, doc);
console.log(`triangles ${before} -> ${tris()}, animations: ${doc.getRoot().listAnimations().map((a) => a.getName()).join(", ")}`);
