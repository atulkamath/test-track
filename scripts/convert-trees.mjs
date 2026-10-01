// One-off: prepare the Quaternius "Maple Trees" (CC0) for instancing by the thousand.
// Simplifies the meshes, shrinks the textures to WebP, and writes a green copy of the (autumn) leaf texture.
//   node convert-trees.mjs <maple-trees.glb> <out.glb> <green-leaves.webp>
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { weld, simplify, prune, dedup, textureCompress } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const [src, out, greenOut] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const tris = () => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((s, p) => s + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3, 0);
const before = tris();

// Summer foliage: rotate the leaf texture's hue from orange to green, keep its alpha.
const leaves = doc.getRoot().listTextures().find((t) => /Leaves/i.test(t.getName()));
await sharp(Buffer.from(leaves.getImage())).resize(1024, 1024).modulate({ hue: 78, saturation: 0.85, brightness: 0.95 }).webp({ quality: 90 }).toFile(greenOut);

await MeshoptSimplifier.ready;
await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.45, error: 0.02 }), prune(), dedup(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 88 }));
await io.write(out, doc);
console.log(`triangles ${before} -> ${tris()} across ${doc.getRoot().listNodes().filter((n) => n.getMesh()).length} trees`);
