import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { applyFabMagicSurface, fabMagicShimmerPhase, getFabMagicSurfaceState, setFabMagicSampleTime } from '../game/src/render/fabMagicSurface.js';

import { MeshStandardNodeMaterial, NodeMaterial, type MaterialReferenceNode, type MeshPhysicalNodeMaterial, type Node } from 'three/webgpu';
import { materialColor, uniform } from 'three/tsl';

function contains(root: Node | null, child: Node): boolean {
  let found = false;
  root?.traverse(node => { if (node === child) found = true; });
  return found;
}

function animation(material: MeshPhysicalNodeMaterial) {
  return material as MeshPhysicalNodeMaterial & { _fabMagicShimmer: number; _fabMagicTintStrength: number };
}

describe('Fab magic woven iridescence', () => {
  it('composes authored nodes with shimmer and retains both through cloning', () => {
    const source = new MeshStandardNodeMaterial();
    const authoredWeave = uniform(0.7);
    source.colorNode = materialColor.mul(authoredWeave);
    source.userData.revision = 'woven-v4';
    const original = applyFabMagicSurface(source, { tier: 70, role: 'cloth' });
    for (const material of [original, original.clone()]) {
      expect(contains(material.colorNode, authoredWeave)).toBe(true);
      expect(material.iridescenceThicknessNode).not.toBeNull();
      expect(material.userData.revision).toBe('woven-v4');
      expect(material.onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile);
    }
    expect(source.colorNode).not.toBe(original.colorNode);
  });

  it('replaces imported sheen maps without changing authored base or normal maps', () => {
    const source = new THREE.MeshPhysicalMaterial({ sheen: 1, sheenRoughness: 1, transmission: 0.4, dispersion: 0.05, alphaTest: 0.1 });
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
    for (const copy of [material, material.clone()]) {
      expect(copy.transmission).toBe(0.4);
      expect(copy.dispersion).toBe(0.05);
      expect(copy.alphaTest).toBe(0.1);
      expect(copy.iridescence).toBe(material.iridescence);
      expect(copy.sheen).toBe(material.sheen);
    }
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

  it('retains independent material animation values after equipment cloning', () => {
    const original = applyFabMagicSurface(new THREE.MeshStandardMaterial(), { tier: 90, role: 'cloth' });
    const cloned = original.clone();
    const key = cloned.customProgramCacheKey();
    expect(cloned.iridescenceThicknessNode).toBe(original.iridescenceThicknessNode);
    expect(cloned.userData.magicSurface).not.toBe(original.userData.magicSurface);
    const now = vi.spyOn(performance, 'now');
    try {
      now.mockReturnValue(0);
      cloned.onBeforeRender(...([] as unknown as Parameters<typeof cloned.onBeforeRender>));
      now.mockReturnValue(4000);
      cloned.onBeforeRender(...([] as unknown as Parameters<typeof cloned.onBeforeRender>));
      expect(animation(cloned)._fabMagicShimmer).toBeCloseTo(fabMagicShimmerPhase(4) * 36);
      expect(animation(original)._fabMagicShimmer).toBe(0);
      expect(original.userData.magicSurface.phase).toBe(0);
      expect(cloned.customProgramCacheKey()).toBe(key);
      expect(cloned.customProgramCacheKey()).toBe(original.customProgramCacheKey());
      const references: MaterialReferenceNode[] = [];
      cloned.iridescenceThicknessNode!.traverse(node => {
        const reference = node as unknown as MaterialReferenceNode;
        if (reference.property === '_fabMagicShimmer') references.push(reference);
      });
      expect(references.length).toBeGreaterThan(0);
      for (const reference of references) {
        type Frame = Parameters<typeof reference.updateReference>[0];
        expect(reference.updateReference({ material: cloned } as unknown as Frame)).toBe(cloned);
        expect(reference.updateReference({ material: new NodeMaterial(),
          renderer: { _currentSourceMaterial: cloned } } as unknown as Frame)).toBe(cloned);
      }
    } finally {
      now.mockRestore();
    }
  });

  it('freezes the production phase and exposes it for screenshot state comparisons', () => {
    const material = applyFabMagicSurface(new THREE.MeshStandardMaterial(), { tier: 90, role: 'cloth' }).clone();
    try {
      setFabMagicSampleTime(4);
      material.onBeforeRender(...([] as unknown as Parameters<typeof material.onBeforeRender>));
      const first = animation(material)._fabMagicShimmer;
      expect(material.userData.magicSurface).toEqual({ tier: 90, role: 'cloth', phase: fabMagicShimmerPhase(4), sampleTime: 4 });
      material.onBeforeRender(...([] as unknown as Parameters<typeof material.onBeforeRender>));
      expect(animation(material)._fabMagicShimmer).toBe(first);
      setFabMagicSampleTime(12);
      material.onBeforeRender(...([] as unknown as Parameters<typeof material.onBeforeRender>));
      expect(animation(material)._fabMagicShimmer).not.toBe(first);
      expect(animation(material)._fabMagicTintStrength).toBeCloseTo(0.62);
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
