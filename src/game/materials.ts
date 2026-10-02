// Photo-scanned PBR surfaces (Poly Haven / ambientCG, CC0 — see CREDITS.md) and the shader tweaks that use them.
import * as THREE from "three";

const loader = new THREE.TextureLoader();

// Sky: "Kloofendal 48d Partly Cloudy (Pure Sky)" from Poly Haven (CC0). It is both the visible sky and the
// light source; this direction was measured from the HDR file so shadows and backlighting match it.
/** Direction to the sun in the sky image (48° up); the shadow-casting light shines from here. */
export const SUN_DIR = new THREE.Vector3(0.554, 0.742, 0.378).normalize();

function tex(file: string, repeat: number, srgb: boolean) {
  const t = loader.load(`/textures/${file}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 16;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Time of day, shared with every shader that needs it: 0 = bright evening (race start) .. 1 = night.
 * Set once a frame by the day cycle in Game.tsx.
 */
export const NIGHT = { value: 0 };
export function setNight(v: number) {
  NIGHT.value = v;
}

export type Surface = "asphalt" | "grass" | "gravel" | "concrete";

/** Colour + normal + roughness maps for a surface. `repeat` = tiles per UV unit. */
export function pbr(name: Surface, repeat = 1) {
  return {
    map: tex(`${name}_diff.jpg`, repeat, true),
    normalMap: tex(`${name}_nor.jpg`, repeat, false),
    roughnessMap: tex(`${name}_rough.jpg`, repeat, false),
  };
}

/**
 * Make a material sample its maps by world position instead of the mesh's UVs, picking the plane by which
 * way the face points. Our buildings are stretched unit boxes, so their own UVs would smear the texture;
 * this keeps every surface at the same real-world texture scale (`tile` metres per repeat).
 */
export function worldMapped<T extends THREE.MeshStandardMaterial>(material: T, tile: number, key: string): T {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;")
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 wp4 = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          vWNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        #else
          vec4 wp4 = modelMatrix * vec4(transformed, 1.0);
          vWNrm = normalize(mat3(modelMatrix) * normal);
        #endif
        vWPos = wp4.xyz;`,
      );
    const pick = /* glsl */ `
      vec3 an = abs(vWNrm);
      vec2 wuv = (an.y > an.x && an.y > an.z ? vWPos.xz : (an.x > an.z ? vWPos.zy : vWPos.xy)) / ${tile.toFixed(2)};`;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;")
      .replace("#include <map_fragment>", /* glsl */ `${pick}\n#ifdef USE_MAP\n diffuseColor *= texture2D(map, wuv);\n#endif`)
      .replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `float roughnessFactor = roughness;\n#ifdef USE_ROUGHNESSMAP\n roughnessFactor *= texture2D(roughnessMap, wuv).g;\n#endif`,
      );
  };
  material.customProgramCacheKey = () => `world-${key}-${tile}`;
  return material;
}

/**
 * Grass ground: scanned lawn texture plus mowed stripes and broad colour variation computed from world
 * position in the shader, so the tiling never shows and the stripes stay crisp at any distance.
 */
export function grassMaterial() {
  const m = new THREE.MeshStandardMaterial({ ...pbr("grass", 1), roughness: 1 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
      .replace(
        "#include <map_fragment>",
        /* glsl */ `
        // Two texture scales blended so the repeat pattern is hidden.
        vec4 gA = texture2D(map, vWPos.xz / 3.0);
        vec4 gB = texture2D(map, vWPos.zx / 17.0 + 0.37);
        diffuseColor *= mix(gA, gB, 0.45);
        // Mowed stripes ~6 m wide, fading out with distance from the camera.
        float stripe = smoothstep(-0.15, 0.15, sin((vWPos.x * 0.8 + vWPos.z * 0.6) * 0.52));
        float tone = 0.5 + 0.5 * sin(vWPos.x * 0.021 + 1.3) * sin(vWPos.z * 0.017 + 0.4);
        diffuseColor.rgb *= (0.88 + 0.16 * stripe) * (0.86 + 0.22 * tone);`,
      );
  };
  m.customProgramCacheKey = () => "grass-ground";
  return m;
}

/**
 * Race-track asphalt, weathered: the scan is sun-bleached paler and greyer, with exposed stones and hairline
 * cracks. On top of that: a dark rubbered-in racing line that wanders across the
 * road, dusty lighter edges, a tar seam down the middle where two paving passes meet, darker resurfaced
 * patches, and slow tone variation so no two stretches look the same.
 * Expects road UVs: u = 0..1 across the width, v = distance along the track in road-widths.
 */
export function roadMaterial() {
  const maps = pbr("asphalt", 4);
  const m = new THREE.MeshStandardMaterial({ ...maps, roughness: 1, normalScale: new THREE.Vector2(0.9, 0.9) });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vRoadUv;\nvarying vec3 vWPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRoadUv = uv;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        varying vec2 vRoadUv;
        varying vec3 vWPos;
        float rhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float rnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(rhash(i), rhash(i + vec2(1.0, 0.0)), f.x), mix(rhash(i + vec2(0.0, 1.0)), rhash(i + vec2(1.0, 1.0)), f.x), f.y);
        }`,
      )
      .replace(
        "#include <map_fragment>",
        /* glsl */ `
        // Two scales of the scan so the tiling doesn't show.
        vec4 fine = texture2D(map, vMapUv);
        vec4 broad = texture2D(map, vMapUv * 0.23 + 0.31);
        diffuseColor *= mix(fine, broad, 0.4);
        // Weathering: years of sun bleach the tar to a paler, greyer, lower-contrast surface.
        float grey = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(grey), 0.45) * 1.5 + 0.045;
        float u = vRoadUv.x;
        float along = vRoadUv.y;
        // Slow tone drift plus darker resurfaced patches.
        float toneVar = rnoise(vWPos.xz * 0.035);
        float patchy = smoothstep(0.62, 0.7, rnoise(vec2(floor(along * 0.35), 3.0))) * step(0.5, fract(along * 0.35 + 0.2));
        diffuseColor.rgb *= 0.86 + 0.24 * toneVar - 0.1 * patchy;
        // Rubbered-in racing line: a dark band that drifts from side to side, streaky along the direction of travel.
        float centre = 0.5 + 0.2 * sin(along * 0.42) + 0.06 * sin(along * 1.3 + 1.0);
        float line = exp(-pow((u - centre) / 0.15, 2.0));
        float streak = 0.75 + 0.25 * rnoise(vec2(u * 60.0, along * 0.6));
        diffuseColor.rgb *= 1.0 - 0.24 * line * streak;
        // Dusty, sun-bleached edges where nobody drives.
        float edge = smoothstep(0.34, 0.5, abs(u - 0.5));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.22 + 0.015, edge * 0.6);
        // Old tarmac: pale exposed stones and hairline cracks.
        float speck = rnoise(vWPos.xz * 9.0);
        diffuseColor.rgb += 0.035 * smoothstep(0.72, 0.95, speck);
        float crack = 1.0 - smoothstep(0.0, 0.035, abs(rnoise(vWPos.xz * 0.55) - 0.5));
        diffuseColor.rgb *= 1.0 - 0.16 * crack * rnoise(vWPos.xz * 0.11);
        // Proper cracks: thin, dark, branching lines that come in patches, jittered so they are never smooth curves.
        vec2 cp = vWPos.xz + 0.35 * vec2(rnoise(vWPos.xz * 2.3), rnoise(vWPos.zx * 2.3 + 7.0));
        float crackArea = smoothstep(0.5, 0.66, rnoise(vWPos.xz * 0.045 + 11.0));
        float c1 = 1.0 - smoothstep(0.0, 0.012, abs(rnoise(cp * 0.33) - 0.5));
        float c2 = 1.0 - smoothstep(0.0, 0.016, abs(rnoise(cp * 0.9 + 4.0) - 0.5));
        float cracks = max(c1, c2 * 0.7) * crackArea;
        diffuseColor.rgb *= 1.0 - 0.6 * cracks;
        // Some old cracks have been sealed with tar: wider, black, wandering lines.
        float sealArea = smoothstep(0.62, 0.72, rnoise(vWPos.xz * 0.03 + 31.0));
        float tar = (1.0 - smoothstep(0.0, 0.02, abs(rnoise(cp * 0.16 + 9.0) - 0.5))) * sealArea;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035), 0.8 * tar);
        // Tar seam down the centre joint.
        float seam = 1.0 - smoothstep(0.0, 0.004, abs(u - 0.5 + 0.003 * sin(along * 9.0)));
        diffuseColor.rgb *= 1.0 - 0.35 * seam;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          roughnessFactor *= texture2D(roughnessMap, vRoughnessMapUv).g;
        #endif
        // Laid rubber is smoother and slightly shinier than the surrounding stone.
        {
          float c2 = 0.5 + 0.2 * sin(vRoadUv.y * 0.42) + 0.06 * sin(vRoadUv.y * 1.3 + 1.0);
          roughnessFactor *= 1.0 - 0.22 * exp(-pow((vRoadUv.x - c2) / 0.15, 2.0));
        }`,
      );
  };
  m.customProgramCacheKey = () => "road-asphalt";
  return m;
}
