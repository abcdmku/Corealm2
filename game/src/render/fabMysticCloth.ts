import * as THREE from 'three';
import { MaterialNode, type MeshPhysicalNodeMaterial, type MeshStandardNodeMaterial, type Node } from 'three/webgpu';
import { float, frontFacing, mix, texture, uv, vec3, vec4, vertexColor } from 'three/tsl';
import { cloneNodeMaterial, composeSurface, sourceMaterialNode, surfaceColorNode } from './nodeMaterials.js';
import { applyFabMagicSurface, preserveFabClothHighlights } from './fabMagicSurface.js';

export type MysticClothPanel = 'outer' | 'lining' | 'embroidery' | 'binding' | 'soft-leather';

/** Cloth construction has its own palette; armor engraving is not a dye mask. */
export function applyMysticClothMaterial(
  source: THREE.MeshStandardMaterial | MeshStandardNodeMaterial, tier: 50 | 70 | 90,
  panel: MysticClothPanel, textile: THREE.Texture,
): MeshPhysicalNodeMaterial {
  const prepared = cloneNodeMaterial(source) as MeshStandardNodeMaterial;
  const colors = tier === 50
    ? { outer: vec3(0.025, 0.105, 0.29), lining: vec3(0.02, 0.055, 0.10), binding: vec3(0.43, 0.28, 0.11) }
    : tier === 70
      ? { outer: vec3(0.07, 0.022, 0.17), lining: vec3(0.13, 0.025, 0.065), binding: vec3(0.34, 0.31, 0.39) }
      : { outer: vec3(0.025, 0.14, 0.16), lining: vec3(0.18, 0.07, 0.25), binding: vec3(0.57, 0.50, 0.33) };
  const dye = panel === 'lining' ? colors.lining : panel === 'binding' ? colors.binding
    : panel === 'soft-leather' ? vec3(0.035, 0.025, 0.032) : colors.outer;
  const embroidery = panel === 'embroidery' ? 1 : panel === 'outer' ? 0.14 : panel === 'lining' ? 0.1 : 0;
  const repeat = panel === 'outer' ? 2.8 : 1.8;
  const weave = texture(textile, uv(0).mul(repeat)).rgb;
  const weaveLight = weave.dot(vec3(0.2126, 0.7152, 0.0722));
  const thread = weaveLight.smoothstep(0.10, 0.42).mul(embroidery);
  const color = mix(dye.mul(weaveLight.sqrt().mul(0.3).add(0.88)), weave.mul(1.35), embroidery);
  // Textile replaces the old RGB after vertex tint, retaining its coverage.
  const alpha = surfaceColorNode(prepared).a
    .mul(prepared.vertexColors ? vertexColor().a : float(1));
  prepared.vertexColors = false;
  prepared.colorNode = vec4(color.mul(frontFacing.select(vec3(1), vec3(0.55, 0.60, 0.70))), alpha);
  composeSurface(prepared, { roughness: () => float(0.72).mix(0.46, thread) });
  prepared.color.setHex(0xffffff);
  prepared.metalness = 0;
  prepared.metalnessMap = null;
  prepared.metalnessNode = null;
  prepared.roughnessMap = null;
  prepared.roughness = 0.72;
  prepared.normalScale.multiplyScalar(0.5);
  prepared.bumpMap = null;
  prepared.displacementMap = null;
  prepared.emissiveMap = null;
  prepared.emissive.setHex(0);
  prepared.emissiveIntensity = 0;
  prepared.emissiveNode = null;
  prepared.name = `${source.name}|mystic:${tier}:${panel}`;
  const result = applyFabMagicSurface(prepared, { tier, role: panel === 'soft-leather' ? 'leather' : 'cloth', tailored: true });
  result.sheenNode = vec3((result.sheenNode ?? sourceMaterialNode<'vec3'>(result, MaterialNode.SHEEN)) as Node<'vec3'>)
    .mul(float(0.75).mix(1.25, thread)).mul(frontFacing.select(1, 0.2));
  result.specularIntensityNode = float((result.specularIntensityNode ?? sourceMaterialNode<'float'>(result, MaterialNode.SPECULAR_INTENSITY)) as Node<'float'>)
    .mul(frontFacing.select(1, 0.15));
  preserveFabClothHighlights(result);
  result.specularColorMap = null;
  result.specularIntensityMap = null;
  prepared.dispose();
  return result;
}
