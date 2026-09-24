import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { describe, expect, it } from 'vitest';
import { ASH_CREATURE_REDESIGNS } from '../game/src/content/ashCreatureRedesigns.js';
import manifest from '../game/public/assets/manifest.json' with { type: 'json' };

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const requiredClips = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];

describe('ash and northern creature production bodies', () => {
  it('keeps five independent combat identities', () => {
    expect(new Set(ASH_CREATURE_REDESIGNS.map(species => species.id)).size).toBe(5);
    for (const species of ASH_CREATURE_REDESIGNS) {
      expect(species.assetId).toBe(`creature_${species.id}`);
      expect(species.stats.family).toBe(species.id);
      expect(species.stats.maxHealth).toBeGreaterThan(0);
      expect(species.scale).toBeGreaterThan(0);
    }
  });

  it.each(ASH_CREATURE_REDESIGNS)('$id ships a textured, animated body', async species => {
    const entry = manifest.assets.find(asset => asset.id === species.assetId);
    expect(entry, species.id).toBeDefined();
    const bytes = await readFile(`game/public/assets/${entry!.file}`);
    expect(bytes.length).toBe(entry!.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry!.sha256);

    const root = (await io.readBinary(bytes)).getRoot();
    const primitives = root.listNodes().flatMap(node => node.getMesh()?.listPrimitives() ?? []);
    expect(primitives.length, `${species.id} geometry`).toBeGreaterThan(0);
    expect(root.listSkins().length, `${species.id} rig`).toBeGreaterThan(0);
    expect(root.listMaterials().some(material => material.getBaseColorTexture()), `${species.id} painted surface`).toBe(true);
    expect(root.listAnimations().map(clip => clip.getName()), `${species.id} actions`)
      .toEqual(expect.arrayContaining(requiredClips));

    for (const clip of root.listAnimations()) {
      expect(clip.listChannels().length, `${species.id}:${clip.getName()} channels`).toBeGreaterThan(0);
      for (const sampler of clip.listSamplers()) {
        expect(sampler.getInput()!.getArray()!.every(Number.isFinite), `${species.id}:${clip.getName()} time`).toBe(true);
        expect(sampler.getOutput()!.getArray()!.every(Number.isFinite), `${species.id}:${clip.getName()} motion`).toBe(true);
      }
    }
    for (const primitive of primitives) {
      const position = primitive.getAttribute('POSITION');
      expect(position, `${species.id} vertices`).toBeTruthy();
      expect(position!.getArray()!.every(Number.isFinite), `${species.id} finite vertices`).toBe(true);
      if (primitive.getMaterial()?.getBaseColorTexture()) {
        expect(primitive.getAttribute('TEXCOORD_0'), `${species.id} mapped surface`).toBeTruthy();
      }
    }
  }, 15000);
});
