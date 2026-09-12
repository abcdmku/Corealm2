import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyMysticClothMaterial, type MysticClothPanel } from '../game/src/render/fabMysticCloth.js';

describe('mystic cloth material composition', () => {
  it.each([50, 70, 90] as const)('retains cloth texture and shader hooks through equipment cloning at T%i', tier => {
    const source = new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0.1 });
    source.specularColorMap = new THREE.Texture();
    source.specularIntensityMap = new THREE.Texture();
    source.normalMap = new THREE.Texture();
    source.onBeforeCompile = shader => { shader.uniforms.sourceHook = { value: 42 }; };
    source.customProgramCacheKey = () => 'native-cloth';
    const textile = new THREE.Texture();
    const result = applyMysticClothMaterial(source, tier, 'embroidery', textile);
    for (const material of [result, result.clone()]) {
      expect(material.metalness).toBe(0);
      expect(material.roughness).toBeGreaterThan(0.6);
      expect(material.specularColorMap).toBeNull();
      expect(material.specularIntensityMap).toBeNull();
      expect(material.normalMap).toBe(source.normalMap);
      const shader = { uniforms: {}, vertexShader: '#include <uv_vertex>',
        fragmentShader: '#include <color_fragment>\n#include <lights_physical_fragment>\n#include <aomap_fragment>' } as THREE.WebGLProgramParametersWithUniforms;
      material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      expect(shader.uniforms.sourceHook!.value).toBe(42);
      expect(shader.uniforms.mysticTextile!.value).toBe(textile);
      expect(shader.vertexShader).toContain('vMysticUv = uv');
      expect(shader.fragmentShader).not.toContain('magicTint * magicLuma');
      expect(shader.fragmentShader).toContain('mageHighlightScale');
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
