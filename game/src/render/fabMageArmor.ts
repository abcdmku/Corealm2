import * as THREE from 'three';
import { applyFabMagicSurface, preserveFabClothHighlights } from './fabMagicSurface.js';

type Tier = 50 | 70 | 90;
type Role = 'cloth' | 'leather' | 'trim';

/** Authored UV0 carries seams and relief. Textile detail uses that same continuous
 * unwrap, independently of the source atlas crop. Never sample projected UV1. */
export function applyRareMageMaterial(
  source: THREE.MeshStandardMaterial, tier: Tier, role: Role, textile?: THREE.Texture,
): THREE.MeshPhysicalMaterial {
  const prepared = source.clone();
  const originalCompile = source.onBeforeCompile.bind(source);
  const originalKey = source.customProgramCacheKey();
  // The Frostwalker hanging cloth was tagged as leather during conversion.
  const hangingCloth = /LowerClothes|WaistCloth/.test(source.name);
  const auroraMantle = tier === 90 && /Torso/.test(source.name);
  const cloth = role === 'cloth' || hangingCloth || auroraMantle || /Silk/i.test(source.name);
  const embroidered = hangingCloth || /Silk/i.test(source.name);
  const palette = auroraMantle ? 'vec3(0.24, 0.14, 0.32)' : tier === 50
    ? (cloth ? 'vec3(0.025, 0.13, 0.32)' : 'vec3(0.025, 0.08, 0.14)')
    : tier === 70
      ? (cloth ? 'vec3(0.065, 0.02, 0.14)' : 'vec3(0.065, 0.019, 0.044)')
      : (cloth ? 'vec3(0.025, 0.14, 0.15)' : 'vec3(0.023, 0.085, 0.085)');
  const threadColor = auroraMantle ? 'vec3(0.68, 0.60, 0.47)' : tier === 50 ? 'vec3(0.42, 0.29, 0.14)'
    : tier === 70 ? 'vec3(0.43, 0.37, 0.32)' : 'vec3(0.57, 0.62, 0.55)';
  const woven = cloth && textile !== undefined;
  prepared.onBeforeCompile = (shader, renderer) => {
    originalCompile(shader, renderer);
    if (woven) {
      shader.uniforms.mageTextile = { value: textile };
      shader.vertexShader = `varying vec2 vMageWeaveUv;\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>',
        '#include <uv_vertex>\nvMageWeaveUv = uv;');
      shader.fragmentShader = `uniform sampler2D mageTextile;\nvarying vec2 vMageWeaveUv;\n${shader.fragmentShader}`;
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 mageSource = diffuseColor.rgb;
      float mageLight = dot(mageSource, vec3(0.2126, 0.7152, 0.0722));
      float mageEdge = smoothstep(0.15, 0.47, mageLight);
      vec3 magePanel = ${palette} * pow(max(mageLight, 0.0), 0.48) * 1.9;
      vec3 mageTrim = ${threadColor} * pow(max(mageLight, 0.0), 0.35);
      float mageThread = 0.0;
      ${woven ? `
        vec3 mageWeave = texture2D(mageTextile, vMageWeaveUv * ${tier === 90 ? '1.6' : '2.4'}).rgb;
        float mageWeaveLight = dot(mageWeave, vec3(0.2126, 0.7152, 0.0722));
        mageThread = smoothstep(0.11, 0.42, mageWeaveLight) * ${embroidered ? '1.0' : auroraMantle ? '0.55' : '0.18'};
        // Frostwalker RGB contains chainmail/rust, not cloth. Its native normal
        // and AO retain folds; the new weave supplies clean textile color.
        magePanel = mix(magePanel, mageWeave * ${tier === 90 ? '1.25' : '(1.05 + 0.35 * sqrt(max(mageLight, 0.0)))'}, ${embroidered ? '1.0' : auroraMantle ? '0.36' : '0.12'});
      ` : ''}
      diffuseColor.rgb = mix(magePanel, mageTrim, mageEdge * ${embroidered ? (tier === 90 ? '0.0' : '0.08') : '0.88'});
    `);
    if (cloth) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
      // Raised thread catches a narrower light lobe than the soft cloth beneath it.
      material.roughness = clamp(mix(0.68, 0.43, mageThread) + geometryRoughness, 0.43, 1.0);
      #ifdef USE_SHEEN
        material.sheenColor *= mix(0.72, 1.25, mageThread);
      #endif
      // The moving tail reveals its reverse face. Keep the lining matte and
      // blue-gray instead of letting a pale sheen turn it into a flashing tip.
      if (!gl_FrontFacing) {
        material.diffuseColor *= vec3(0.45, 0.55, 0.62);
        material.diffuseContribution = material.diffuseColor * (1.0 - metalnessFactor);
        material.specularColor *= 0.15;
        material.specularColorBlended *= 0.15;
        #ifdef USE_SHEEN
          material.sheenColor *= 0.15;
        #endif
        #ifdef USE_IRIDESCENCE
          material.iridescence *= 0.25;
        #endif
      }
    `);
    if (cloth) preserveFabClothHighlights(shader);
  };
  prepared.customProgramCacheKey = () => `${originalKey}|rare-mage-textile-v4:${tier}:${role}:${hangingCloth}:${woven}:${embroidered}:${auroraMantle}`;
  prepared.metalness = 0;
  prepared.metalnessMap = null;
  prepared.roughnessMap = null;
  prepared.roughness = cloth ? 0.68 : 0.73;
  // Preserve folds and embossing at a fabric/leather depth rather than cast-metal relief.
  prepared.normalScale.multiplyScalar(cloth ? 0.65 : 0.48);
  prepared.bumpMap = null;
  prepared.displacementMap = null;
  prepared.emissiveMap = null;
  prepared.emissive.setHex(0);
  prepared.emissiveIntensity = 0;
  prepared.name = `${source.name}|tailored:${tier}`;
  const result = applyFabMagicSurface(prepared, { tier, role: cloth ? 'cloth' : role, tailored: true });
  result.specularColorMap = null;
  result.specularIntensityMap = null;
  if (hangingCloth) {
    result.specularIntensity = 0.18;
  }
  prepared.dispose();
  return result;
}
