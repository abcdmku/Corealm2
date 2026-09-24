import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Vector3 } from 'three';
import { STONE_CREATURE_REDESIGNS } from '../game/src/content/stoneCreatureRedesigns.js';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
beforeAll(async () => {
  await MeshoptDecoder.ready;
  io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
});

describe('stone creature production assets', () => {
  it('keeps independent combat identities for the authored species', () => {
    expect(new Set(STONE_CREATURE_REDESIGNS.map(s => s.id)).size).toBe(5);
    for (const species of STONE_CREATURE_REDESIGNS) {
      expect(species.assetId).toBe(`creature_${species.id}`);
      expect(species.stats.family).toBe(species.id);
      expect(species.stats.maxHealth).toBeGreaterThan(0);
      expect(species.scale).toBeGreaterThan(0);
      expect(species.scale).toBeLessThanOrEqual(1);
    }
  });

  it('ships complete rigs with mapped materials and normalized skin weights', async () => {
    const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
    for (const species of STONE_CREATURE_REDESIGNS) {
      const entry = manifest.assets.find((a: any) => a.id === species.assetId);
      expect(entry, species.assetId).toBeDefined();
      const bytes = await readFile(`game/public/assets/${entry.file}`);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
      const root = (await io.readBinary(bytes)).getRoot();
      expect(root.listAnimations().map(a => a.getName()), species.id).toEqual(expect.arrayContaining(['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death']));
      for (const material of root.listMaterials()) {
        expect(material.getBaseColorTexture()).toBeTruthy();
        expect(material.getEmissiveFactor()).toEqual([0, 0, 0]);
      }
      for (const mesh of root.listMeshes()) for (const primitive of mesh.listPrimitives()) {
        const weights = primitive.getAttribute('WEIGHTS_0')!;
        expect(primitive.getAttribute('TEXCOORD_0')).toBeTruthy();
        expect(primitive.getAttribute('POSITION')!.getArray()!.every(Number.isFinite)).toBe(true);
        for (let i = 0; i < weights.getCount(); i++) expect(weights.getElement(i, []).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
        if (species.id === 'scree_watcher') {
          // Every replacement body segment is closed. A negative volume means inside-out faces.
          const pos = primitive.getAttribute('POSITION')!, indices = primitive.getIndices()?.getArray() ?? Array.from({ length: pos.getCount() }, (_, i) => i);
          let volume = 0;
          for (let i = 0; i < indices.length; i += 3) {
            const a = new Vector3().fromArray(pos.getElement(indices[i]!, [])), b = new Vector3().fromArray(pos.getElement(indices[i + 1]!, [])), c = new Vector3().fromArray(pos.getElement(indices[i + 2]!, []));
            volume += a.dot(b.cross(c)) / 6;
          }
          expect(volume, `${mesh.getName()} winding`).toBeGreaterThan(0);
        }
      }
    }
  }, 15000);
});
