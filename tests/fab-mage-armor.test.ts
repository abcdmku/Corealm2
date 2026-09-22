import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { type Node } from 'three/webgpu';
import { frontFacing, normalViewGeometry } from 'three/tsl';
import { applyRareMageMaterial } from '../game/src/render/fabMageArmor.js';

describe('rare mage native material mapping', () => {
  it.each(['LowerClothes_Zombie', 'WaistCloth_SilverGhost'])('treats the hanging %s as fabric despite its old leather tag', name => {
    const source = new THREE.MeshPhysicalMaterial({ name: `M_Kwang_${name}__fab_leather` });
    source.specularColorMap = new THREE.Texture();
    source.specularIntensityMap = new THREE.Texture();
    const tail = applyRareMageMaterial(source, 90, 'leather');
    const panel = applyRareMageMaterial(new THREE.MeshStandardMaterial(), 90, 'leather');
    expect(tail.userData.magicSurface.role).toBe('cloth');
    expect(tail.specularColorMap).toBeNull();
    expect(tail.specularIntensityMap).toBeNull();
    expect(tail.specularIntensity).toBeLessThan(0.2);
    expect(tail.customProgramCacheKey()).not.toBe(panel.customProgramCacheKey());
  });
  it.each([50, 70, 90] as const)('keeps aligned native maps and removes unstable overlays at %i', tier => {
    const source = new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0.4, vertexColors: true });
    source.map = new THREE.Texture();
    source.map.offset.set(0.1, 0.2);
    source.normalMap = new THREE.Texture();
    source.aoMap = new THREE.Texture();
    source.roughnessMap = new THREE.Texture();
    source.iridescenceThicknessMap = new THREE.Texture();
    source.iridescenceThicknessMap.channel = 1;
    const textile = new THREE.Texture();
    const result = applyRareMageMaterial(source, tier, 'cloth', textile);
    for (const material of [result, result.clone()]) {
      expect(material.map).toBe(source.map);
      expect(material.map!.offset.toArray()).toEqual([0.1, 0.2]);
      expect(material.map!.channel).toBe(0);
      expect(material.normalMap).toBe(source.normalMap);
      expect(material.aoMap).toBe(source.aoMap);
      expect(material.vertexColors).toBe(false);
      expect(material.roughnessMap).toBeNull();
      expect(material.bumpMap).toBeNull();
      expect(material.iridescenceThicknessMap).toBeNull();
      expect(material.roughness).toBeGreaterThanOrEqual(0.6);
      expect(material.metalness).toBe(0);
      const nodes = new Set<Node>();
      material.colorNode?.traverse(node => nodes.add(node));
      material.sheenNode?.traverse(node => nodes.add(node));
      expect(nodes.has(frontFacing)).toBe(true);
      expect([...nodes].some(node => (node as Node & { isVertexColorNode?: boolean }).isVertexColorNode)).toBe(true);
      expect(nodes.has(normalViewGeometry)).toBe(true);
      expect([...nodes].some(node => (node as Node & { value?: unknown }).value === textile)).toBe(true);
      expect(material.userData.preserveFabClothHighlights).toBe(true);
      expect(material.roughnessNode).not.toBeNull();
      expect(material.specularIntensityNode).not.toBeNull();
      expect(material.iridescenceNode).not.toBeNull();
      expect(material.onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile);
      expect(material.sheen).toBeGreaterThan(0.7);
      expect(material.anisotropy).toBeGreaterThan(0);
    }
    expect(source.roughnessMap).not.toBeNull();
    expect(source.iridescenceThicknessMap!.channel).toBe(1);
    expect(source.normalScale.toArray()).toEqual([1, 1]);
  });
});
