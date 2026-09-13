import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { ASH_CREATURE_REDESIGNS } from '../game/src/content/ashCreatureRedesigns.js';
import MANIFEST from '../game/public/assets/manifest.json' with { type: 'json' };

type Candidate = { id: string; sha256: string; bytes: number; contactNormalized: number; attackSeconds: number; size: Record<string, number>; metadata: { redesign: { sourceAssetId: string; sourceSha256: string; anatomyAtlas: { path: string; sha256: string; embeddedJpegSha256: string }; deformedVertices: number; removedTriangles: number; addedTriangles: number; addedSurfaces: string[]; animationEdits: string[]; measurements: { minFloor: number; clips: { clip: string; samples: number; bounds: { min: number[]; max: number[] } }[] } } } };
const REQUIRED_SURFACES: Record<string, string[]> = {
  kiln_marrow: ['fused_dorsal_mantle', 'hollow_furnace_back', 'furnace_marrow', 'sunken_crater_collar'],
  slag_crawler: ['soft_under_shell', 'overlapping_slag_plate_0', 'overlapping_slag_plate_5', 'shovel_jaw', 'folded_mandible_-1', 'folded_mandible_1'],
  cinder_penitent: ['sealed_iron_face', 'blind_face_seam', 'burnt_high_collar'],
  grave_lantern: ['skull_inner_void', 'corpse_light_organ', 'skull_cage_septum_0', 'skull_cage_septum_8', 'exposed_rib_0_-1', 'exposed_rib_3_1'],
  veil_reaper: ['torn_arm_membrane_-1', 'torn_arm_membrane_1', 'hooked_digit_-1_0', 'hooked_digit_1_2'],
};
let assets: Candidate[];

beforeAll(() => {
  execFileSync(process.execPath, ['tools/biome-creatures/ash/build.mjs'], { stdio: 'pipe', timeout: 25_000 });
  assets = JSON.parse(readFileSync('test-results/biome-creatures/ash/catalog.json', 'utf8')).assets;
}, 30_000);

describe('authored ash and northern creature bodies', () => {
  it('exports five distinct body candidates and production species with matching combat families', () => {
    expect(assets).toHaveLength(5);
    expect(new Set(assets.map(row => row.sha256)).size).toBe(5);
    for (const species of ASH_CREATURE_REDESIGNS) {
      const candidate = assets.find(row => row.id === species.assetId)!;
      expect(candidate, species.id).toBeDefined();
      expect(species.stats.family).toBe(species.id);
      expect(species.stats.attackStyle).toBe('melee');
      expect(species.stats.attackRangeM).toBeGreaterThan(1);
      // The current Banshee source already has an authored shroud. Its remaining
      // cowl deformation touches fewer vertices than the older wizard body did.
      expect(candidate.metadata.redesign.deformedVertices, species.id).toBeGreaterThan(species.id === 'veil_reaper' ? 1000 : 2000);
      expect(candidate.metadata.redesign.removedTriangles).toBeGreaterThan(100);
      expect(candidate.metadata.redesign.addedTriangles).toBeGreaterThan(600);
      expect(candidate.metadata.redesign.addedSurfaces, species.id).toEqual(expect.arrayContaining(REQUIRED_SURFACES[species.id]!));
      expect(candidate.metadata.redesign.animationEdits.length).toBeGreaterThan(4);
    }
  });

  it('has finite sampled bodies, safe floor clearance and a bounded moving footprint', () => {
    for (const species of ASH_CREATURE_REDESIGNS) {
      const candidate = assets.find(row => row.id === species.assetId)!;
      const proof = candidate.metadata.redesign.measurements;
      expect(proof.minFloor, species.id).toBeGreaterThanOrEqual(.0029);
      expect(candidate.contactNormalized).toBeGreaterThan(.2);
      expect(candidate.contactNormalized).toBeLessThan(.7);
      expect(candidate.attackSeconds).toBeGreaterThan(.5);
      const clips = new Set(proof.clips.map(row => row.clip));
      for (const clip of ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'HitLeft', 'HitRight', 'Death']) expect(clips.has(clip), species.id).toBe(true);
      for (const clip of proof.clips) {
        expect(clip.samples).toBeGreaterThanOrEqual(49);
        expect([...clip.bounds.min, ...clip.bounds.max].every(Number.isFinite)).toBe(true);
        if (['Idle', 'Walk', 'Run'].includes(clip.clip)) {
          const x = Math.max(Math.abs(clip.bounds.min[0]!), Math.abs(clip.bounds.max[0]!));
          const z = Math.max(Math.abs(clip.bounds.min[2]!), Math.abs(clip.bounds.max[2]!));
          expect(Math.hypot(x, z) * species.scale, `${species.id} ${clip.clip}`).toBeLessThan(3.5);
        }
      }
    }
  });

  it('exports hash-matched GLBs with source materials, generated anatomy textures and complete native rigs', async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    for (const candidate of assets) {
      const file = `test-results/biome-creatures/ash/${candidate.id}.glb`;
      const bytes = readFileSync(file);
      expect(bytes.length).toBe(candidate.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(candidate.sha256);
      const doc = await io.read(file);
      const redesign = candidate.metadata.redesign;
      const source = MANIFEST.assets.find(asset => asset.id === redesign.sourceAssetId)!;
      const sourceFile = `game/public/assets/${source.file}`;
      expect(createHash('sha256').update(readFileSync(sourceFile)).digest('hex'), candidate.id).toBe(redesign.sourceSha256);
      const sourceDoc = await io.read(sourceFile);
      const speciesId = candidate.id.replace(/^creature_/, '');
      const sourceId = redesign.sourceAssetId.replace(/^creature_/, '');
      const retainedMaterials = new Set(sourceDoc.getRoot().listMaterials().map(material => material.getName().replaceAll(sourceId, speciesId)));
      for (const material of doc.getRoot().listMaterials()) {
        expect(retainedMaterials.has(material.getName()) || material.getName().startsWith(`animal_rpg_${speciesId}_`), material.getName()).toBe(true);
      }
      const atlas = doc.getRoot().listTextures().find(texture => texture.getName() === 'ash_authored_anatomy_atlas');
      expect(atlas, candidate.id).toBeDefined();
      expect(createHash('sha256').update(atlas!.getImage()!).digest('hex')).toBe(redesign.anatomyAtlas.embeddedJpegSha256);
      expect(createHash('sha256').update(readFileSync(redesign.anatomyAtlas.path)).digest('hex')).toBe(redesign.anatomyAtlas.sha256);
      expect(doc.getRoot().listMaterials().some(material => material.getBaseColorTexture() === atlas), candidate.id).toBe(true);
      expect(Math.max(...doc.getRoot().listSkins().map(skin => skin.listJoints().length))).toBeGreaterThanOrEqual(39);
      for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
        if (primitive.getMaterial()?.getNormalTextureInfo()?.getTexCoord() === 1) expect(primitive.getAttribute('TEXCOORD_1'), candidate.id).toBeDefined();
      }
      const membranes = doc.getRoot().listNodes().filter(node => node.getName().includes('torn_arm_membrane'));
      expect(membranes, candidate.id).toHaveLength(speciesId === 'veil_reaper' ? 2 : 0);
      for (const node of membranes) {
        expect(node.getSkin()?.listJoints()).toHaveLength(4);
        const primitive = node.getMesh()!.listPrimitives()[0]!;
        const weights = primitive.getAttribute('WEIGHTS_0')!;
        for (let i = 0; i < weights.getCount(); i++) {
          const row = weights.getElement(i, []);
          expect(row.every(value => value >= -1e-7)).toBe(true);
          expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
        }
      }
    }
  });
});


