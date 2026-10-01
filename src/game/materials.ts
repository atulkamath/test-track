// Photo-scanned PBR surfaces (Poly Haven / ambientCG, CC0 — see CREDITS.md) and the shader tweaks that use them.
import * as THREE from "three";

const loader = new THREE.TextureLoader();

function tex(file: string, repeat: number, srgb: boolean) {
  const t = loader.load(`/textures/${file}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 16;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
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
        float patch = 0.5 + 0.5 * sin(vWPos.x * 0.021 + 1.3) * sin(vWPos.z * 0.017 + 0.4);
        diffuseColor.rgb *= (0.88 + 0.16 * stripe) * (0.86 + 0.22 * patch);`,
      );
  };
  m.customProgramCacheKey = () => "grass-ground";
  return m;
}
