import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { applyFabMagicSurface, fabMagicShimmerPhase, getFabMagicSurfaceState, setFabMagicSampleTime } from '../game/src/render/fabMagicSurface.js';

function compile(material: THREE.MeshPhysicalMaterial) {
  const shader = {
    uniforms: {},
    vertexShader: '',
    fragmentShader: '#include <lights_physical_fragment>',
  } as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

describe('Fab magic woven iridescence', () => {
  it('composes authored shader hooks with shimmer and retains both through cloning', () => {
    const source = new THREE.MeshStandardMaterial();
    source.userData.revision = 'woven-v4';
    source.onBeforeCompile = function (shader) {
      shader.uniforms.authoredWeave = { value: this.userData.revision };
      shader.fragmentShader += '\n// authored-weave';
    };
    source.customProgramCacheKey = function () { return this.userData.revision; };
    const original = applyFabMagicSurface(source, { tier: 70, role: 'cloth' });
    for (const material of [original, original.clone()]) {
      const shader = compile(material);
      expect(shader.uniforms.authoredWeave!.value).toBe('woven-v4');
      expect(shader.fragmentShader).toContain('// authored-weave');
      expect(shader.fragmentShader).toContain('material.iridescenceThickness + fabMagicShimmer');
      expect(material.customProgramCacheKey()).toContain('woven-v4|fab-magic-surface');
    }
    expect(source.customProgramCacheKey()).toBe('woven-v4');
  });

  it('replaces imported sheen maps without changing authored base or normal maps', () => {
    const source = new THREE.MeshPhysicalMaterial({ sheen: 1, sheenRoughness: 1 });
    const oldSheenColor = new THREE.Texture();
    // Imported Paragon alpha=0 would reduce sheen roughness to zero in the shader.
    const oldSheenRoughness = new THREE.DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1);
    source.sheenColorMap = oldSheenColor;
    source.sheenRoughnessMap = oldSheenRoughness;
    source.map = new THREE.Texture();
    source.normalMap = new THREE.Texture();
    const material = applyFabMagicSurface(source, { tier: 50, role: 'leather' });
    expect(material.sheenColorMap).toBeNull();
    expect(material.sheenRoughnessMap).toBeNull();
    expect(material.sheenRoughness).toBeGreaterThan(0);
    expect(material.map).toBe(source.map);
    expect(material.normalMap).toBe(source.normalMap);
    expect(source.sheenColorMap).toBe(oldSheenColor);
    expect(source.sheenRoughnessMap).toBe(oldSheenRoughness);
    expect(source.sheenRoughness).toBe(1);
  });

  it('preserves authored maps and color while using a separate scale mask on its configured UV channel', () => {
    const source = new THREE.MeshStandardMaterial({ color: 0x34697f, metalness: 1, roughness: 0.3 });
    source.map = new THREE.Texture();
    source.normalMap = new THREE.Texture();
    source.roughnessMap = new THREE.Texture();
    source.normalScale.set(0.4, 0.7);
    const detail = new THREE.Texture();
    detail.channel = 1;
    detail.repeat.set(6, 6);
    const material = applyFabMagicSurface(source, { tier: 50, role: 'leather', detailTexture: detail });
    expect(material.map).toBe(source.map);
    expect(material.normalMap).toBe(source.normalMap);
    expect(material.roughnessMap).toBe(source.roughnessMap);
    expect(material.normalScale.equals(source.normalScale)).toBe(true);
    expect(material.color.equals(source.color)).toBe(true);
    expect(material.iridescenceThicknessMap).toBe(detail);
    expect(detail.channel).toBe(1);
    expect(detail.repeat.toArray()).toEqual([6, 6]);
    expect(material.metalness).toBe(0);
    expect(source.metalness).toBe(1);
    expect(material.roughness).toBeGreaterThanOrEqual(0.6);
    expect(material.emissive.getHex()).toBe(0);
  });

  it('increases color range and sheen through the armor tiers', () => {
    const materials = [1, 50, 70, 90].map(tier => applyFabMagicSurface(
      new THREE.MeshStandardMaterial(), { tier, role: 'cloth' },
    ));
    for (let i = 1; i < materials.length; i++) {
      expect(materials[i]!.iridescence).toBeGreaterThan(materials[i - 1]!.iridescence);
      expect(materials[i]!.sheen).toBeGreaterThan(materials[i - 1]!.sheen);
      expect(materials[i]!.iridescenceThicknessRange[1]).toBeGreaterThan(materials[i - 1]!.iridescenceThicknessRange[1]!);
    }
  });

  it('retains an independently animated shader uniform after the rig clones materials', () => {
    const original = applyFabMagicSurface(new THREE.MeshStandardMaterial(), { tier: 90, role: 'cloth' });
    const cloned = original.clone();
    const originalShader = compile(original);
    const shader = compile(cloned);
    expect(shader.fragmentShader).toContain('material.iridescenceThickness + fabMagicShimmer');
    expect(shader.uniforms.fabMagicShimmer).not.toBe(originalShader.uniforms.fabMagicShimmer);
    const now = vi.spyOn(performance, 'now');
    try {
      now.mockReturnValue(0);
      cloned.onBeforeRender(...([] as unknown as Parameters<typeof cloned.onBeforeRender>));
      const before = shader.uniforms.fabMagicShimmer!.value;
      now.mockReturnValue(4000);
      cloned.onBeforeRender(...([] as unknown as Parameters<typeof cloned.onBeforeRender>));
      expect(shader.uniforms.fabMagicShimmer!.value).not.toBe(before);
      expect(shader.uniforms.fabMagicShimmer!.value).toBeCloseTo(fabMagicShimmerPhase(4) * 36);
      expect(cloned.customProgramCacheKey()).toBe(original.customProgramCacheKey());
    } finally {
      now.mockRestore();
    }
  });

  it('freezes the production phase and exposes it for screenshot state comparisons', () => {
    const material = applyFabMagicSurface(new THREE.MeshStandardMaterial(), { tier: 90, role: 'cloth' }).clone();
    const shader = compile(material);
    try {
      setFabMagicSampleTime(4);
      material.onBeforeRender(...([] as unknown as Parameters<typeof material.onBeforeRender>));
      const first = shader.uniforms.fabMagicShimmer!.value;
      expect(material.userData.magicSurface).toEqual({ tier: 90, role: 'cloth', phase: fabMagicShimmerPhase(4), sampleTime: 4 });
      material.onBeforeRender(...([] as unknown as Parameters<typeof material.onBeforeRender>));
      expect(shader.uniforms.fabMagicShimmer!.value).toBe(first);
      setFabMagicSampleTime(12);
      material.onBeforeRender(...([] as unknown as Parameters<typeof material.onBeforeRender>));
      expect(shader.uniforms.fabMagicShimmer!.value).not.toBe(first);
      expect(shader.uniforms.fabMagicTintStrength!.value).toBeCloseTo(0.62);
      expect(shader.fragmentShader).toContain('magicTint /= dot(magicTint, magicLumaWeights)');
    } finally {
      setFabMagicSampleTime(null);
    }
  });

  it('reports detached current render diagnostics and expires inactive materials', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(100000);
    try {
      getFabMagicSurfaceState();
      const detail = new THREE.Texture();
      detail.channel = 1;
      const material = applyFabMagicSurface(new THREE.MeshStandardMaterial({ name: 'test-current' }), {
        tier: 70, role: 'leather', detailTexture: detail,
      });
      setFabMagicSampleTime(12);
      expect(getFabMagicSurfaceState()).toEqual([]);
      material.onBeforeRender(...([] as unknown as Parameters<typeof material.onBeforeRender>));
      const state = getFabMagicSurfaceState();
      expect(state).toEqual([{
        name: material.name, tier: 70, role: 'leather', phase: fabMagicShimmerPhase(12),
        sampleTime: 12, iridescence: material.iridescence, detailChannel: 1, lastRenderedMs: 100000,
      }]);
      state[0]!.phase = -100;
      expect(getFabMagicSurfaceState()[0]!.phase).toBe(fabMagicShimmerPhase(12));
      now.mockReturnValue(101001);
      expect(getFabMagicSurfaceState()).toEqual([]);
    } finally {
      setFabMagicSampleTime(null);
      now.mockRestore();
    }
  });
});
