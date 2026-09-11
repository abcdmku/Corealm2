import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { ASH_CREATURE_REDESIGNS } from '../game/src/content/ashCreatureRedesigns.js';

type Candidate = { id: string; sha256: string; bytes: number; contactNormalized: number; attackSeconds: number; size: Record<string, number>; metadata: { redesign: { deformedVertices: number; removedTriangles: number; addedTriangles: number; animationEdits: string[]; measurements: { minFloor: number; clips: { clip: string; samples: number; bounds: { min: number[]; max: number[] } }[] } } } };
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
      expect(candidate.metadata.redesign.deformedVertices).toBeGreaterThan(2000);
      expect(candidate.metadata.redesign.removedTriangles).toBeGreaterThan(100);
      expect(candidate.metadata.redesign.addedTriangles).toBeGreaterThan(600);
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

  it('ships hash-matched GLBs with complete native rigs and normalized membrane skin weights', async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    for (const candidate of assets) {
      const file = `test-results/biome-creatures/ash/${candidate.id}.glb`;
      const bytes = readFileSync(file);
      expect(bytes.length).toBe(candidate.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(candidate.sha256);
      const doc = await io.read(file);
      expect(doc.getRoot().listMaterials().every(material => /^animal_rpg_/.test(material.getName())), candidate.id).toBe(true);
      expect(Math.max(...doc.getRoot().listSkins().map(skin => skin.listJoints().length))).toBeGreaterThanOrEqual(39);
      for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
        if (primitive.getMaterial()?.getNormalTextureInfo()?.getTexCoord() === 1) expect(primitive.getAttribute('TEXCOORD_1'), candidate.id).toBeDefined();
      }
      for (const node of doc.getRoot().listNodes().filter(node => node.getName().includes('torn_arm_membrane'))) {
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


