import * as THREE from 'three';
import { type MeshPhysicalNodeMaterial, type MeshStandardNodeMaterial } from 'three/webgpu';
import { float, frontFacing, materialColor, materialIridescence, materialSheen, materialSpecularIntensity, texture, uv, vec3, vec4, vertexColor } from 'three/tsl';
import { cloneNodeMaterial, composeSurface } from './nodeMaterials.js';
import { applyFabMagicSurface, preserveFabClothHighlights } from './fabMagicSurface.js';

type Tier = 50 | 70 | 90;
type Role = 'cloth' | 'leather' | 'trim';

/** Authored UV0 carries seams and relief. Textile detail uses that same continuous
 * unwrap, independently of the source atlas crop. Never sample projected UV1. */
export function applyRareMageMaterial(
  source: THREE.MeshStandardMaterial | MeshStandardNodeMaterial, tier: Tier, role: Role, textile?: THREE.Texture,
): MeshPhysicalNodeMaterial {
  const prepared = cloneNodeMaterial(source) as MeshStandardNodeMaterial;
  // The Frostwalker hanging cloth was tagged as leather during conversion.
  const hangingCloth = /LowerClothes|WaistCloth/.test(source.name);
  const auroraMantle = tier === 90 && /Torso/.test(source.name);
  const cloth = role === 'cloth' || hangingCloth || auroraMantle || /Silk/i.test(source.name);
  const embroidered = hangingCloth || /Silk/i.test(source.name);
  const palette = auroraMantle ? vec3(0.24, 0.14, 0.32) : tier === 50
    ? (cloth ? vec3(0.025, 0.13, 0.32) : vec3(0.025, 0.08, 0.14))
    : tier === 70
      ? (cloth ? vec3(0.065, 0.02, 0.14) : vec3(0.065, 0.019, 0.044))
      : (cloth ? vec3(0.025, 0.14, 0.15) : vec3(0.023, 0.085, 0.085));
  const threadColor = auroraMantle ? vec3(0.68, 0.60, 0.47) : tier === 50 ? vec3(0.42, 0.29, 0.14)
    : tier === 70 ? vec3(0.43, 0.37, 0.32) : vec3(0.57, 0.62, 0.55);
  // The authored dye runs after vertex tint, as the original color stage did.
  const sourceColor = vec4(prepared.colorNode ?? materialColor)
    .mul(prepared.vertexColors ? vertexColor() : vec4(1));
  prepared.vertexColors = false;
  const luma = sourceColor.rgb.dot(vec3(0.2126, 0.7152, 0.0722));
  const edge = luma.smoothstep(0.15, 0.47);
  let panel = palette.mul(luma.max(0).pow(0.48)).mul(1.9);
  const trim = threadColor.mul(luma.max(0).pow(0.35));
  let thread = float(0);
  if (cloth && textile) {
    const weave = texture(textile, uv(0).mul(tier === 90 ? 1.6 : 2.4)).rgb;
    const weaveLight = weave.dot(vec3(0.2126, 0.7152, 0.0722));
    thread = weaveLight.smoothstep(0.11, 0.42).mul(embroidered ? 1 : auroraMantle ? 0.55 : 0.18);
    // Native normal/AO retain folds. The weave replaces the chainmail/rust color.
    panel = panel.mix(weave.mul(tier === 90 ? float(1.25) : luma.max(0).sqrt().mul(0.35).add(1.05)),
      embroidered ? 1 : auroraMantle ? 0.36 : 0.12);
  }
  const color = panel.mix(trim, edge.mul(embroidered ? (tier === 90 ? 0 : 0.08) : 0.88));
  prepared.colorNode = vec4(cloth ? color.mul(frontFacing.select(vec3(1), vec3(0.45, 0.55, 0.62))) : color, sourceColor.a);
  if (cloth) composeSurface(prepared, { roughness: () => float(0.68).mix(0.43, thread) });
  prepared.metalness = 0;
  prepared.metalnessMap = null;
  prepared.metalnessNode = null;
  prepared.roughnessMap = null;
  prepared.roughness = cloth ? 0.68 : 0.73;
  // Preserve folds and embossing at a fabric/leather depth rather than cast-metal relief.
  prepared.normalScale.multiplyScalar(cloth ? 0.65 : 0.48);
  prepared.bumpMap = null;
  prepared.displacementMap = null;
  prepared.emissiveMap = null;
  prepared.emissive.setHex(0);
  prepared.emissiveIntensity = 0;
  prepared.emissiveNode = null;
  prepared.name = `${source.name}|tailored:${tier}`;
  const result = applyFabMagicSurface(prepared, { tier, role: cloth ? 'cloth' : role, tailored: true });
  result.specularColorMap = null;
  result.specularIntensityMap = null;
  if (cloth) {
    result.sheenNode = vec3(result.sheenNode ?? materialSheen)
      .mul(float(0.72).mix(1.25, thread)).mul(frontFacing.select(1, 0.15));
    result.specularIntensityNode = float(result.specularIntensityNode ?? materialSpecularIntensity)
      .mul(frontFacing.select(1, 0.15));
    result.iridescenceNode = float(result.iridescenceNode ?? materialIridescence)
      .mul(frontFacing.select(1, 0.25));
    preserveFabClothHighlights(result);
  }
  if (hangingCloth) result.specularIntensity = 0.18;
  prepared.dispose();
  return result;
}
