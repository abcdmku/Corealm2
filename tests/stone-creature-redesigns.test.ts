import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Vector3 } from 'three';
import { STONE_CREATURE_REDESIGNS } from '../game/src/content/stoneCreatureRedesigns.js';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

describe('stone creature production assets', () => {
  it('keeps independent combat identities for the authored species', () => {
    expect(new Set(STONE_CREATURE_REDESIGNS.map(s => s.id)).size).toBe(5);
    for (const species of STONE_CREATURE_REDESIGNS) {
      expect(species.assetId).toBe(`creature_${species.id}`);
      expect(species.stats.family).toBe(species.id);
      expect(species.stats.maxHealth).toBeGreaterThan(0);
      expect(species.scale).toBe(1);
    }
  });

  it('ships the measured rigs with mapped authored materials and normalized skin weights', async () => {
    const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
    const calibration = JSON.parse(await readFile('art/biome-creatures/stone/gait-calibration.json', 'utf8'));
    for (const species of STONE_CREATURE_REDESIGNS) {
      let entry = manifest.assets.find((a: any) => a.id === species.assetId);
      let file = entry ? `game/public/assets/${entry.file}` : '';
      // Before promotion the same check can reject staged lab assets. CI uses public assets.
      if (!entry) {
        const staged = JSON.parse(await readFile('test-results/biome-creatures/stone/catalog.json', 'utf8'));
        entry = staged.assets.find((a: any) => a.id === species.assetId);
        file = `test-results/biome-creatures/stone/${staged.files[species.assetId]}`;
      }
      const bytes = await readFile(file), hash = createHash('sha256').update(bytes).digest('hex');
      expect(hash).toBe(entry.sha256);
      const measured = calibration.assets.find((a: any) => a.id === species.assetId);
      expect(measured.sha256).toBe(hash);
      for (const gait of [measured.walk, measured.run]) {
        expect(gait.impliedMps).toBeGreaterThan(0);
        expect(gait.contacts.every((foot: any) => foot.coreSamples >= 12)).toBe(true);
      }
      const root = (await io.readBinary(bytes)).getRoot();
      expect(new Set(root.listAnimations().map(a => a.getName()))).toEqual(new Set(['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'HitLeft', 'HitRight', 'Death']));
      for (const material of root.listMaterials()) {
        expect(material.getName().startsWith('animal_rpg_')).toBe(true);
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
