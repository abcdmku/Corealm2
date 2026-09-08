import * as THREE from "three";

/** Shared clock, no geometry displacement: rigid bark and foliage keep their normal collision. */
export function createMagicTreeShimmer(source: THREE.Material, time: { value: number }): THREE.Material {
  if (!source.userData.corealmMagicTree || !(source as THREE.MeshStandardMaterial).isMeshStandardMaterial) return source;
  const material = (source as THREE.MeshStandardMaterial).clone();
  const inheritedCompile = source.onBeforeCompile;
  const inheritedKey = source.customProgramCacheKey.bind(source);
  material.name = `${source.name}@magic-shimmer`;
  material.onBeforeCompile = (shader, renderer) => {
    inheritedCompile.call(source, shader, renderer);
    shader.uniforms.uMagicTreeTime = time;
    shader.uniforms.uMagicTreeLeaf = { value: /Leaves/i.test(source.name) ? 1 : 0 };
    shader.vertexShader = `varying vec3 vMagicTreePosition;\nvarying vec2 vMagicTreeUV;\nvarying float vMagicTreePhase;\n${shader.vertexShader}`
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vMagicTreePosition = position;
        vMagicTreeUV = uv;
        vec4 magicOrigin = vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_BATCHING
          magicOrigin = batchingMatrix * magicOrigin;
        #endif
        #ifdef USE_INSTANCING
          magicOrigin = instanceMatrix * magicOrigin;
        #endif
        magicOrigin = modelMatrix * magicOrigin;
        vMagicTreePhase = dot(magicOrigin.xz, vec2(0.173, 0.277));
      `);
    shader.fragmentShader = `uniform float uMagicTreeTime;\nuniform float uMagicTreeLeaf;\nvarying vec3 vMagicTreePosition;\nvarying vec2 vMagicTreeUV;\nvarying float vMagicTreePhase;\n${shader.fragmentShader}`
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        float magicClock = uMagicTreeTime + vMagicTreePhase;
        vec3 magicRadiance = vec3(0.0);
        if (uMagicTreeLeaf < 0.5) {
          // UV.y is swept branch arc length: these surface particles travel from the
          // base toward the tip even on angled limbs, rather than sliding up world Y.
          for (int layer = 0; layer < 2; layer++) {
            float layerOffset = float(layer) * 0.137;
            float lane = floor((vMagicTreeUV.x + layerOffset) * 5.0);
            float laneSeed = fract(sin(lane * 127.1 + vMagicTreePhase * 31.7 + float(layer) * 87.3) * 43758.5453);
            float speed = 0.32 + laneSeed * 0.36;
            float flow = vMagicTreeUV.y - magicClock * speed;
            float cell = floor(flow / 1.8);
            float seed = fract(sin(lane * 91.7 + cell * 43.3 + float(layer) * 19.1) * 27453.271);
            float centreU = (lane + 0.25 + seed * 0.5) / 5.0 - layerOffset;
            centreU += sin(vMagicTreeUV.y * 3.4 + lane * 2.1) * 0.014;
            float du = vMagicTreeUV.x - centreU;
            float dy = mod(flow, 1.8) - (0.4 + seed * 0.8);
            float core = exp(-du * du / 0.00030 - dy * dy / 0.00075);
            float halo = exp(-du * du / 0.0020 - dy * dy / 0.0060);
            float tail = exp(-du * du / 0.00045) * exp(min(dy, 0.0) * 13.0) * step(dy, 0.0);
            float alive = smoothstep(0.18, 0.38, seed);
            vec3 moteColour = mix(vec3(0.10, 0.65, 0.90), vec3(0.55, 0.28, 1.0), laneSeed);
            magicRadiance += alive * (vec3(0.80, 0.96, 1.0) * core * 4.0
              + moteColour * (halo * 0.60 + tail * 0.75));
          }
        } else {
          float leafLight = 0.3;
          #ifdef USE_MAP
            vec4 magicLeafSample = texture2D(map, vMapUv);
            leafLight = dot(magicLeafSample.rgb / max(magicLeafSample.a, 0.001), vec3(0.2126, 0.7152, 0.0722));
          #endif
          float wave = 0.5 + 0.5 * sin(magicClock * 1.6 + vMagicTreePosition.y * 0.8
            + vMagicTreePosition.x * 0.9 + vMagicTreePosition.z * 0.65);
          float veins = smoothstep(0.13, 0.38, leafLight);
          float scintillation = pow(0.5 + 0.5 * sin(dot(vMagicTreePosition, vec3(14.1, 8.7, 19.3))
            + magicClock * 2.3), 24.0);
          vec3 sheenColour = mix(vec3(0.08, 0.52, 0.67), vec3(0.55, 0.40, 0.90), wave);
          magicRadiance = sheenColour * (0.025 + 0.16 * pow(wave, 3.0))
            + veins * (sheenColour * 0.30 * wave + vec3(0.65, 0.95, 1.0) * scintillation * 1.6);
        }
        totalEmissiveRadiance += magicRadiance;
      `);
  };
  material.customProgramCacheKey = () => `${inheritedKey()}|corealm-magic-tree-v3`;
  return material;
}
