#!/usr/bin/env python3
"""One-off asset step: pack the downloaded Sketchfab "race driver" glTF (scene.gltf + scene.bin + textures/)
into a single GLB the game loads. Usage: python3 scripts/convert-driver.py <unzipped dir> <out.glb> [--no-textures]
Normal maps are dropped (the driver is small on screen); --no-textures writes a geometry-only copy for tooling."""
import json, struct, sys, os

src, out = sys.argv[1], sys.argv[2]
bare = "--no-textures" in sys.argv
g = json.load(open(os.path.join(src, "scene.gltf")))
blob = bytearray(open(os.path.join(src, g["buffers"][0]["uri"]), "rb").read())

keep = set()
for m in g["materials"]:
    m.pop("normalTexture", None)
    # The file uses the old specular-glossiness material extension, which three.js no longer reads:
    # rewrite each material as plain metal/roughness.
    sg = m.pop("extensions", {}).get("KHR_materials_pbrSpecularGlossiness")
    if sg:
        m["pbrMetallicRoughness"] = {
            "baseColorFactor": sg.get("diffuseFactor", [1, 1, 1, 1]),
            "metallicFactor": 0,
            "roughnessFactor": max(0.3, 1 - sg.get("glossinessFactor", 0)),
        }
        if "diffuseTexture" in sg: m["pbrMetallicRoughness"]["baseColorTexture"] = sg["diffuseTexture"]
    pbr = m.get("pbrMetallicRoughness", {})
    if bare:
        pbr.pop("baseColorTexture", None)
        pbr.pop("metallicRoughnessTexture", None)
        m.pop("emissiveTexture", None)
        m.pop("occlusionTexture", None)
    for t in [pbr.get("baseColorTexture"), pbr.get("metallicRoughnessTexture"), m.get("emissiveTexture"), m.get("occlusionTexture")]:
        if t: keep.add(t["index"])
if bare:
    for k in ("textures", "images", "samplers"): g.pop(k, None)
else:
    used_images = {g["textures"][t]["source"] for t in keep}
    for i, img in enumerate(g["images"]):
        data = open(os.path.join(src, img["uri"]), "rb").read() if i in used_images else b""
        if not data:
            # Unused image: keep the slot (indices stay valid) with a 1-byte placeholder view.
            data = b"\0"
        while len(blob) % 4: blob.append(0)
        g["bufferViews"].append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)})
        blob += data
        mime = "image/png" if img["uri"].lower().endswith(".png") else "image/jpeg"
        g["images"][i] = {"bufferView": len(g["bufferViews"]) - 1, "mimeType": mime, "name": os.path.basename(img["uri"])}
while len(blob) % 4: blob.append(0)
g["buffers"] = [{"byteLength": len(blob)}]
g.pop("extensionsUsed", None)
g.pop("extensionsRequired", None)
js = json.dumps(g, separators=(",", ":")).encode()
js += b" " * (-len(js) % 4)
with open(out, "wb") as f:
    f.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + 8 + len(blob)))
    f.write(struct.pack("<I4s", len(js), b"JSON")); f.write(js)
    f.write(struct.pack("<I4s", len(blob), b"BIN\0")); f.write(blob)
print("wrote", out, os.path.getsize(out) // 1024, "KB")
