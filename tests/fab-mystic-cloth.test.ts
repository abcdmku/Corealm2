import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MeshPhysicalNodeMaterial, type Node } from 'three/webgpu';
import { frontFacing, uniform, vec3 } from 'three/tsl';
import { applyMysticClothMaterial, type MysticClothPanel } from '../game/src/render/fabMysticCloth.js';

describe('mystic cloth material composition', () => {
  it.each([50, 70, 90] as const)('retains cloth texture and authored normal nodes through equipment cloning at T%i', tier => {
    const source = new MeshPhysicalNodeMaterial({ metalness: 1, roughness: 0.1, vertexColors: true });
    source.specularColorMap = new THREE.Texture();
    source.specularIntensityMap = new THREE.Texture();
    source.normalMap = new THREE.Texture();
    const authoredNormal = vec3(uniform(0.1), 0, 1).normalize();
    source.normalNode = authoredNormal;
    const textile = new THREE.Texture();
    const result = applyMysticClothMaterial(source, tier, 'embroidery', textile);
    for (const material of [result, result.clone()]) {
      expect(material.metalness).toBe(0);
      expect(material.vertexColors).toBe(false);
      expect(material.roughness).toBeGreaterThan(0.6);
      expect(material.specularColorMap).toBeNull();
      expect(material.specularIntensityMap).toBeNull();
      expect(material.normalMap).toBe(source.normalMap);
      expect(material.normalNode).toBe(authoredNormal);
      const nodes = new Set<Node>();
      material.colorNode?.traverse(node => nodes.add(node));
      expect(nodes.has(frontFacing)).toBe(true);
      expect([...nodes].some(node => (node as Node & { isVertexColorNode?: boolean }).isVertexColorNode)).toBe(true);
      expect([...nodes].some(node => (node as Node & { value?: unknown }).value === textile)).toBe(true);
      expect(material.userData.preserveFabClothHighlights).toBe(true);
      expect(material.sheenNode).not.toBeNull();
      expect(material.roughnessNode).not.toBeNull();
      expect(material.onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile);
    }
    expect(source.metalness).toBe(1);
    expect(source.specularColorMap).not.toBeNull();
  });
  it('keeps the shader variants distinct for separate garment panels', () => {
    const source = new THREE.MeshStandardMaterial();
    const texture = new THREE.Texture();
    const panels: MysticClothPanel[] = ['outer', 'lining', 'embroidery', 'binding', 'soft-leather'];
    const keys = panels.map(panel => applyMysticClothMaterial(source, 90, panel, texture).customProgramCacheKey());
    expect(new Set(keys).size).toBe(panels.length);
  });
});
