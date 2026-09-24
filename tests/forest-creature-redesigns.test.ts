import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { FOREST_CREATURE_REDESIGNS } from '../game/src/content/forestCreatureRedesigns.js';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
beforeAll(async () => {
  await MeshoptDecoder.ready;
  io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
});

describe('forest creature bodies', () => {
  it.each(FOREST_CREATURE_REDESIGNS)('$id has a complete weighted body and action set', async species => {
    const asset = manifest.assets.find((a: any) => a.id === species.assetId);
    expect(asset, species.assetId).toBeTruthy();
    const file = `game/public/assets/${asset.file}`;
    const bytes = await readFile(file);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
    const doc = await io.read(file), root = doc.getRoot();
    const clips = new Map(root.listAnimations().map(clip => [clip.getName(), clip]));
    for (const name of ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death']) {
      const clip = clips.get(name);
      expect(clip, name).toBeTruthy();
      expect(clip!.listChannels().length, name).toBeGreaterThan(0);
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
        expect(primitive.getAttribute('TEXCOORD_0'), 'mapped surface').toBeTruthy();
        expect(primitive.getMaterial()?.getBaseColorTexture(), 'mapped surface').toBeTruthy();
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
    expect(asset.size.x).toBeLessThan(3.5);
    expect(asset.size.z).toBeLessThan(3.5);
    expect(species.stats.family).toBe(species.id);
  });
});
