import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { WILDERNESS_CREATURE_SPECIES } from '../game/src/content/wildernessCreatureSpecies.js';
import { WILDERNESS_RUNE_KEEPERS } from '../game/src/content/wildernessDepth.js';
import { enemyCombatLevel } from '../game/src/content/index.js';
import { tierSilhouetteScale } from '../game/src/core/math.js';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const requiredClips = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'HitLeft', 'HitRight', 'Death'];

describe('Wilderness creature candidates', () => {
  it('gives six regional bodies and five keepers independent combat identities', () => {
    expect(WILDERNESS_CREATURE_SPECIES).toHaveLength(11);
    expect(new Set(WILDERNESS_CREATURE_SPECIES.map(row => row.id)).size).toBe(11);
    for (const row of WILDERNESS_CREATURE_SPECIES) {
      expect(row.assetId).toBe(`creature_${row.id}`);
      expect(row.stats.family).toBe(row.id);
      expect(row.regionId).toBe('wilderness');
      expect(row.scale * tierSilhouetteScale(row.stats.tier)).toBeCloseTo(1, 6);
      const keeper = WILDERNESS_RUNE_KEEPERS.find(keeper => keeper.id === row.id);
      const level = enemyCombatLevel(row.stats);
      if (keeper) expect(level).toBe(keeper.tier * keeper.multiplier);
      else {
        expect(level).toBeGreaterThanOrEqual(row.stats.tier - 2);
        expect(level).toBeLessThanOrEqual(row.stats.tier + 7);
      }
    }
  });

  it('exports complete animated bodies with mapped surfaces and valid material response', async () => {
    const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
    let staged: any;
    for (const species of WILDERNESS_CREATURE_SPECIES) {
      let entry = manifest.assets.find((entry: any) => entry.id === species.assetId);
      let file = entry ? `game/public/assets/${entry.file}` : '';
      if (!entry) {
        staged ??= JSON.parse(await readFile('test-results/wilderness-creatures/catalog.json', 'utf8'));
        entry = staged.assets.find((entry: any) => entry.id === species.assetId);
        expect(entry, species.id).toBeTruthy();
        file = `test-results/wilderness-creatures/${staged.files[species.assetId]}`;
      }
      const bytes = await readFile(file);
      expect(bytes.length).toBe(entry.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
      const root = (await io.readBinary(bytes)).getRoot();
      expect(root.listSkins().length, species.id).toBeGreaterThan(0);
      if (!WILDERNESS_RUNE_KEEPERS.some(keeper => keeper.id === species.id)) {
        // Production charges two draws per glTF primitive (colour and shadow). An ordinary
        // actor must fit the 38-draw non-NPC pool or it remains in its static fallback pose.
        const meshes = root.listNodes().reduce((count, node) => count + (node.getMesh()?.listPrimitives().length ?? 0), 0);
        expect(meshes, `${species.id} fits the ordinary live-animation draw pool`).toBeLessThanOrEqual(19);
      }
      expect(new Set(root.listAnimations().map(clip => clip.getName()))).toEqual(new Set(requiredClips));
      for (const clip of root.listAnimations()) {
        expect(clip.listChannels().length, `${species.id}:${clip.getName()}`).toBeGreaterThan(0);
        expect(clip.listChannels().some(channel => {
          const data = channel.getSampler()!.getOutput()!;
          const array = data.getArray()!, size = data.getElementSize();
          return array.some((value, i) => i >= size && Math.abs(value - array[i % size]!) > .0001);
        }), `${species.id}:${clip.getName()} has actual motion`).toBe(true);
      }
      const materials = root.listMaterials();
      // Emission belongs to the furnace and crawler seams. Bone, hide and cloth
      // retain their native diffuse materials; a glow is not required for readability.
      if (['cinderback_crag', 'rift_carapace', 'furnace_regent'].includes(species.id)) {
        expect(materials.some(material => Math.max(...material.getEmissiveFactor()) > .01), species.id).toBe(true);
      }
      expect(materials.some(material => material.getBaseColorTexture()), species.id).toBe(true);
      for (const material of materials) {
        // glTF defaults to fully metallic. Natural basalt and shroud must explicitly opt out,
        // otherwise their diffuse detail disappears in the accepted Wilderness night lighting.
        if (species.id === 'nightforge_marshal' || material.getMetallicRoughnessTexture()) {
          // Native armour and scales carry authored metal/roughness texels;
          // their factor multiplies that map rather than replacing it.
          expect(material.getMetallicFactor()).toBeGreaterThanOrEqual(0);
          expect(material.getMetallicFactor()).toBeLessThanOrEqual(1);
        } else if (['hollow_star', 'ashseal_warden'].includes(species.id) || /forged_structural_iron|bronze_structural_braces/.test(material.getName())) {
          expect(material.getMetallicFactor()).toBeGreaterThanOrEqual(0);
          expect(material.getMetallicFactor()).toBeLessThanOrEqual(.5);
        } else expect(material.getMetallicFactor(), `${species.id}:${material.getName()} natural surface`).toBe(0);
        if (Math.max(...material.getEmissiveFactor()) > .01 && !/eyes/i.test(material.getName())) {
          expect(material.getEmissiveTexture(), `${species.id} textured core emission`).toBeTruthy();
        }
        for (const map of [material.getNormalTexture(), material.getMetallicRoughnessTexture(), material.getEmissiveTexture()]) {
          if (map) expect(map.getImage()!.byteLength, `${species.id} embedded PBR texture`).toBeGreaterThan(100);
        }
      }
      let texturedTriangles = 0, totalTriangles = 0;
      for (const mesh of root.listMeshes()) for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION')!;
        expect(position.getArray()!.every(Number.isFinite), `${species.id}:${mesh.getName()}`).toBe(true);
        const count = (primitive.getIndices()?.getCount() ?? position.getCount()) / 3;
        totalTriangles += count;
        if (primitive.getMaterial()?.getBaseColorTexture()) {
          expect.soft(primitive.getAttribute('TEXCOORD_0'), `${species.id} mapped body`).toBeTruthy();
          texturedTriangles += count;
        }
        const material = primitive.getMaterial();
        for (const info of [material?.getNormalTexture() ? material.getNormalTextureInfo() : null,
          material?.getMetallicRoughnessTexture() ? material.getMetallicRoughnessTextureInfo() : null,
          material?.getEmissiveTexture() ? material.getEmissiveTextureInfo() : null]) {
          if (info) expect(primitive.getAttribute(`TEXCOORD_${info.getTexCoord()}`), `${species.id} mapped PBR surface`).toBeTruthy();
        }
        const weights = primitive.getAttribute('WEIGHTS_0');
        if (weights) for (let i = 0; i < weights.getCount(); i++) {
          const values = weights.getElement(i, []);
          expect(values.every(value => value >= 0), species.id).toBe(true);
          expect(values.reduce((sum, weight) => sum + weight, 0), species.id).toBeCloseTo(1, 4);
        }
      }
      expect(totalTriangles, species.id).toBeGreaterThan(1000);
      expect(texturedTriangles / totalTriangles, `${species.id} authored mapped body fraction`).toBeGreaterThan(.5);
      expect(entry.size.x).toBeGreaterThan(.5);
      expect(entry.size.y).toBeGreaterThan(.5);
      expect(entry.size.z).toBeGreaterThan(.5);
      expect(entry.contactNormalized).toBeGreaterThan(0);
      expect(entry.contactNormalized).toBeLessThan(1);
    }
  }, 20000);
});
