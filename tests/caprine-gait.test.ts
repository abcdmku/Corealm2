import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { Vector3 } from 'three';
import { applyClip, restorePose, storedPose } from '../tools/creature-motion/pose.js';
import { createSkinReader } from '../tools/lib/ground-gait.js';
import { authorCaprineGait } from '../tools/creature-motion/caprine-gait.js';
import { assertSourcePreserved, readRawGlb } from '../tools/repair-ground-creature-gaits.js';

describe('caprine gait staging', () => {
  it('rejects an unreviewed rig before authoring', () => {
    expect(() => authorCaprineGait(new Document(), 'animal_cattle', 'Walk', 1, 0)).toThrow('Only reviewed caprine rigs');
  });
  for (const id of ['animal_goat', 'animal_ibex']) it(`${id} preserves original source bytes and all nonlocomotion`, async () => {
    const source = await readFile(`game/public/assets/models/animal/${id}.glb`);
    const candidate = await readFile(`art/rebuild/candidates/finish-motion/legacy-caprines/${id}.glb`);
    expect(() => assertSourcePreserved(source, candidate)).not.toThrow();
    const a = readRawGlb(source), b = readRawGlb(candidate);
    for (const name of ['Walk', 'Run']) {
      const before = a.json.animations.find((clip: any) => clip.name === name);
      const after = b.json.animations.find((clip: any) => clip.name === name);
      const end = (j: any, clip: any) => Math.max(...clip.samplers.map((s: any) => j.accessors[s.input].max[0]));
      expect(end(b.json, after)).toBe(end(a.json, before));
      for (const channel of after.channels.filter((c: any) => c.target.path === 'translation')) {
        const node = b.json.nodes[channel.target.node];
        if (node.name.endsWith('_ROOTSHJnt')) continue;
        const accessor = b.json.accessors[after.samplers[channel.sampler].output];
        expect(accessor.count).toBe(2);
        const view = b.json.bufferViews[accessor.bufferView], offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
        const expected = a.json.nodes[channel.target.node].translation ?? [0, 0, 0];
        for (let component = 0; component < 6; component++) {
          const actual = b.bin.readFloatLE(offset + component * 4), sourceValue = expected[component % 3];
          expect(Math.abs(actual - sourceValue)).toBeLessThanOrEqual(Math.max(1, Math.abs(sourceValue)) * 1e-6);
        }
      }
    }
  });
  for (const id of ['animal_goat', 'animal_ibex']) it(`${id} physically plants each hoof through stance`, async () => {
    const report = JSON.parse(await readFile(`art/rebuild/candidates/finish-motion/legacy-caprines/${id}.json`, 'utf8'));
    const doc = await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).read(report.stagedFile);
    const skin = createSkinReader(doc, id === 'animal_goat' ? 'goat_mesh' : 'buk26'), rest = storedPose(doc);
    for (const gait of report.audit) {
      const clip = doc.getRoot().listAnimations().find(c => c.getName() === gait.name)!;
      for (const foot of gait.feet) {
        const time = ((foot.phaseOffset + foot.duty * .4) % 1) * gait.seconds, dt = .0001;
        restorePose(rest); applyClip(clip, time); const before = skin.points(foot.primaryVertices);
        restorePose(rest); applyClip(clip, time + dt); const after = skin.points(foot.primaryVertices);
        after.forEach((point, i) => {
          expect(point.y - gait.floorY).toBeGreaterThanOrEqual(-.00025);
          expect(point.y - gait.floorY).toBeLessThan(.001);
          expect(point.clone().sub(before[i]!).multiplyScalar(1 / dt).add(new Vector3(0, 0, gait.nativeMps)).length()).toBeLessThan(.008);
        });
      }
    }
  });
});
