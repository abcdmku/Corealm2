import * as THREE from 'three';
import { applyFabMagicSurface, preserveFabClothHighlights } from './fabMagicSurface.js';

export type MysticClothPanel = 'outer' | 'lining' | 'embroidery' | 'binding' | 'soft-leather';

/** Cloth construction has its own palette; armor engraving is not a dye mask. */
export function applyMysticClothMaterial(
  source: THREE.MeshStandardMaterial, tier: 50 | 70 | 90,
  panel: MysticClothPanel, textile: THREE.Texture,
): THREE.MeshPhysicalMaterial {
  const prepared = source.clone();
  const originalCompile = source.onBeforeCompile.bind(source);
  const originalKey = source.customProgramCacheKey();
  const colors = tier === 50
    ? { outer: 'vec3(0.025, 0.105, 0.29)', lining: 'vec3(0.02, 0.055, 0.10)', binding: 'vec3(0.43, 0.28, 0.11)' }
    : tier === 70
      ? { outer: 'vec3(0.07, 0.022, 0.17)', lining: 'vec3(0.13, 0.025, 0.065)', binding: 'vec3(0.34, 0.31, 0.39)' }
      : { outer: 'vec3(0.025, 0.14, 0.16)', lining: 'vec3(0.18, 0.07, 0.25)', binding: 'vec3(0.57, 0.50, 0.33)' };
  const dye = panel === 'lining' ? colors.lining : panel === 'binding' ? colors.binding
    : panel === 'soft-leather' ? 'vec3(0.035, 0.025, 0.032)' : colors.outer;
  const embroidery = panel === 'embroidery' ? 1 : panel === 'outer' ? 0.14 : panel === 'lining' ? 0.1 : 0;
  const repeat = panel === 'outer' ? 2.8 : 1.8;
  prepared.onBeforeCompile = (shader, renderer) => {
    originalCompile(shader, renderer);
    shader.uniforms.mysticTextile = { value: textile };
    shader.vertexShader = `varying vec2 vMysticUv;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvMysticUv = uv;');
    shader.fragmentShader = `uniform sampler2D mysticTextile;\nvarying vec2 vMysticUv;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 mysticWeave = texture2D(mysticTextile, vMysticUv * ${repeat.toFixed(1)}).rgb;
      float mysticWeaveLight = dot(mysticWeave, vec3(0.2126, 0.7152, 0.0722));
      float mysticThread = smoothstep(0.10, 0.42, mysticWeaveLight) * ${embroidery.toFixed(2)};
      diffuseColor.rgb = mix(${dye} * (0.88 + 0.3 * sqrt(mysticWeaveLight)), mysticWeave * 1.35, ${embroidery.toFixed(2)});
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
      material.roughness = clamp(mix(0.72, 0.46, mysticThread) + geometryRoughness, 0.46, 1.0);
      #ifdef USE_SHEEN
        material.sheenColor *= mix(0.75, 1.25, mysticThread);
      #endif
      if (!gl_FrontFacing) {
        material.diffuseColor *= vec3(0.55, 0.60, 0.70);
        material.diffuseContribution = material.diffuseColor;
        material.specularColor *= 0.15;
        material.specularColorBlended *= 0.15;
        #ifdef USE_SHEEN
          material.sheenColor *= 0.2;
        #endif
      }
    `);
    preserveFabClothHighlights(shader);
  };
  prepared.customProgramCacheKey = () => `${originalKey}|mystic-cloth-v1:${tier}:${panel}`;
  prepared.color.setHex(0xffffff);
  prepared.metalness = 0;
  prepared.metalnessMap = null;
  prepared.roughnessMap = null;
  prepared.roughness = 0.72;
  prepared.normalScale.multiplyScalar(0.5);
  prepared.bumpMap = null;
  prepared.displacementMap = null;
  prepared.emissiveMap = null;
  prepared.emissive.setHex(0);
  prepared.emissiveIntensity = 0;
  prepared.name = `${source.name}|mystic:${tier}:${panel}`;
  const result = applyFabMagicSurface(prepared, { tier, role: panel === 'soft-leather' ? 'leather' : 'cloth', tailored: true });
  result.specularColorMap = null;
  result.specularIntensityMap = null;
  prepared.dispose();
  return result;
}
