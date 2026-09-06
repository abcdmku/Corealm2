import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { Vector3 } from 'three';
import { expect, it } from 'vitest';
import { createSkinReader } from '../lib/ground-gait.js';
import { applyClip, restorePose, storedPose } from './pose.js';

const directory = 'art/rebuild/candidates/finish-motion/legacy-canines';
for (const id of ['animal_coyote', 'animal_bear']) it(`${id} all mesh vertices at physical plane retain contact velocity`, async () => {
  const report = JSON.parse(await readFile(`${directory}/${id}.json`, 'utf8')), bytes = await readFile(`${directory}/${id}.glb`);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(report.sha256);
  const doc = await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).readBinary(bytes), rest = storedPose(doc);
  const skin = createSkinReader(doc, id === 'animal_coyote' ? 'Wolf_Mesh' : 'brown_bea4'), indices = Array.from({ length: skin.count }, (_, i) => i), results = [];
  for (const audit of report.audits) {
    const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === audit.name)!;
    const samples = 7680, dt = audit.seconds / samples, selected = new Set<number>(audit.feet.flatMap((foot: any) => foot.vertices));
    let previous: Vector3[] = [], contacts = 0, unselectedContacts = 0, maximumSlip = 0, minimumY = Infinity;
    let worst = { vertex: -1, phase: 0, selected: false, y: 0, previousY: 0 };
    const unselectedVertices = new Set<number>();
    for (let i = 0; i <= samples * 2; i++) {
      const phase = i > 0 && i % samples === 0 ? 1 : i % samples / samples;
      restorePose(rest); applyClip(clip, audit.seconds * phase);
      const actual = skin.points(indices);
      actual.forEach((point, index) => {
        minimumY = Math.min(minimumY, point.y);
        const before = previous[index];
        if (!before || Math.max(before.y, point.y) > audit.floorY + .000501) return;
        contacts++;
        if (!selected.has(index)) { unselectedContacts++; unselectedVertices.add(index); }
        const slip = point.clone().sub(before).multiplyScalar(1 / dt).add(new Vector3(0, 0, audit.nativeMps)).length();
        if (slip > maximumSlip) { maximumSlip = slip; worst = { vertex: index, phase: (i - .5) / samples, selected: selected.has(index), y: point.y, previousY: before.y }; }
      });
      previous = actual;
    }
    results.push({ name: audit.name, samplesPerCycle: samples, cycles: 2, contacts, unselectedContacts, unselectedVertices: [...unselectedVertices], maximumSlipMps: maximumSlip, minimumY, worst });
  }
  await writeFile(`${directory}/${id}-whole-mesh-contact.json`, JSON.stringify({ id, sha256: report.sha256, method: 'Every original weighted mesh vertex, no foot selection and no schedule, signed native+Z velocity, physical plane floorY+0.0005m+1um. Two cycles at twice authored sample density.', results }, null, 2));
  for (const result of results) {
    expect(result.contacts).toBeGreaterThan(0);
    expect(result.maximumSlipMps, JSON.stringify(result)).toBeLessThanOrEqual(.012);
  }
}, 120_000);
