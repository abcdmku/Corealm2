import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { FOREST_CREATURE_REDESIGNS } from '../game/src/content/forestCreatureRedesigns.js';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const stagedPath = 'test-results/biome-creatures/forest/catalog.json';
const staged = existsSync(stagedPath) ? JSON.parse(await readFile(stagedPath, 'utf8')) : null;

describe('forest creature bodies', () => {
  it.each(FOREST_CREATURE_REDESIGNS)('$id has a complete weighted body and action set', async species => {
    const shipped = manifest.assets.find((a: any) => a.id === species.assetId);
    const asset = shipped ?? staged?.assets.find((a: any) => a.id === species.assetId);
    expect(asset, 'Generate staged forest creatures or promote their accepted GLBs').toBeTruthy();
    const file = shipped ? `game/public/assets/${asset.file}` : `test-results/biome-creatures/forest/${staged.files[species.assetId]}`;
    const bytes = await readFile(file);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
    const doc = await io.read(file), root = doc.getRoot();
    expect(root.listMaterials().every(material => /^(animal|boss)_/.test(material.getName()))).toBe(true);
    const clips = new Map(root.listAnimations().map(clip => [clip.getName(), clip]));
    for (const name of ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death']) {
      const clip = clips.get(name);
      expect(clip, name).toBeTruthy();
      expect(clip!.listChannels().length).toBeGreaterThan(5);
      expect(clip!.listChannels().some(c => c.getTargetNode()?.getName() === `${species.id}_ground_contact`)).toBe(true);
      for (const sampler of clip!.listSamplers()) {
        const times = sampler.getInput()!.getArray()!;
        for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]!);
      }
    }
    let surfaceVertices = 0;
    for (const node of root.listNodes()) {
      const skin = node.getSkin(), mesh = node.getMesh();
      if (!skin || !mesh) continue;
      const jointCount = skin.listJoints().length;
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION')!, joints = primitive.getAttribute('JOINTS_0')!, weights = primitive.getAttribute('WEIGHTS_0')!;
        expect(joints.getCount()).toBe(position.getCount());
        expect(weights.getCount()).toBe(position.getCount());
        surfaceVertices += position.getCount();
        const indices = primitive.getIndices()?.getArray() ?? Array.from({ length: position.getCount() }, (_, i) => i);
        for (const index of indices) expect(index).toBeLessThan(position.getCount());
        for (let i = 0; i < position.getCount(); i++) {
          const p = position.getElement(i, []), j = joints.getElement(i, []), w = weights.getElement(i, []);
          expect(p.every(Number.isFinite)).toBe(true);
          expect(w.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 4);
          for (let k = 0; k < 4; k++) if (w[k]! > 0) expect(j[k]).toBeLessThan(jointCount);
        }
      }
    }
    expect(surfaceVertices).toBeGreaterThan(1000);
    expect(asset.metadata.redesign.createdParts.length).toBeGreaterThan(1);
    expect(asset.metadata.redesign.removedTriangles).toBeGreaterThan(100);
    expect(asset.size.x).toBeLessThan(3.5);
    expect(asset.size.z).toBeLessThan(3.5);
    expect(asset.attackSeconds).toBeGreaterThan(.3);
    expect(asset.contactNormalized).toBeGreaterThan(0);
    expect(asset.contactNormalized).toBeLessThan(1);
    expect(species.stats.family).toBe(species.id);
  });

  it('gives the wetland mimic six visible articulated legs', async () => {
    const assetId = 'creature_reed_strider', shipped = manifest.assets.find((a: any) => a.id === assetId);
    const file = shipped ? `game/public/assets/${shipped.file}` : `test-results/biome-creatures/forest/${staged.files[assetId]}`;
    const root = (await io.read(file)).getRoot();
    const weightedLegs = new Set<string>();
    let blendedLimbVertices = 0;
    for (const node of root.listNodes()) {
      const skin = node.getSkin();
      if (!skin || !node.getMesh()) continue;
      for (const primitive of node.getMesh()!.listPrimitives()) {
        const j = primitive.getAttribute('JOINTS_0')!, w = primitive.getAttribute('WEIGHTS_0')!;
        for (let i = 0; i < j.getCount(); i++) {
          const ji = j.getElement(i, []), wi = w.getElement(i, []);
          if (wi.filter(value => value > .001).length > 1) blendedLimbVertices++;
          for (let k = 0; k < 4; k++) if (wi[k]! > 0) {
            const name = skin.listJoints()[ji[k]!]!.getName();
            if (name.includes('Leg')) weightedLegs.add(name);
          }
        }
      }
    }
    expect(weightedLegs.size).toBe(18);
    expect(blendedLimbVertices).toBeGreaterThan(1000);
    expect([...weightedLegs].some(name => name.includes('MidBack'))).toBe(false);
    expect(root.listMeshes().length).toBe(1);
    expect(root.listMeshes().some(mesh => mesh.getName() === 'Cube')).toBe(false);
    expect(root.listNodes().find(node => node.getName() === 'MidBackLegL')?.getSkin()).toBeNull();
  });

  it('keeps the Heath Jack knife in its authored hand grip after refitting', async () => {
    const assetId = 'creature_heath_jack', shipped = manifest.assets.find((a: any) => a.id === assetId);
    const file = shipped ? `game/public/assets/${shipped.file}` : `test-results/biome-creatures/forest/${staged.files[assetId]}`;
    const root = (await io.read(file)).getRoot(), grip = root.listNodes().find(node => node.getName() === 'goblinKnifeGrip')!;
    const gripWorld = grip.getWorldMatrix().slice(12, 15);
    let minDistance = Infinity;
    for (const node of root.listNodes()) {
      if (node.getSkin() || !node.getMesh()) continue;
      const m = node.getWorldMatrix();
      for (const primitive of node.getMesh()!.listPrimitives()) {
        const p = primitive.getAttribute('POSITION')!;
        for (let i = 0; i < p.getCount(); i++) {
          const [x, y, z] = p.getElement(i, [] as number[]);
          const world = [m[0]! * x! + m[4]! * y! + m[8]! * z! + m[12]!, m[1]! * x! + m[5]! * y! + m[9]! * z! + m[13]!, m[2]! * x! + m[6]! * y! + m[10]! * z! + m[14]!];
          minDistance = Math.min(minDistance, Math.hypot(...world.map((v, k) => v - gripWorld[k]!)));
        }
      }
    }
    expect(minDistance).toBeLessThan(.06);
  });
});
