import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { assertSourcePreserved } from '../repair-ground-creature-gaits.js';
import { contactAt, createSkinReader, type ContactFoot } from '../lib/ground-gait.js';
import { applyClip, duration, restorePose, storedPose } from './pose.js';

const out = 'art/rebuild/candidates/finish-motion/legacy-canines';
describe('wolf and bear serialized physical paws', () => {
  for (const id of ['animal_coyote', 'animal_bear']) {
    it(`${id} retains original source and original native gait speeds`, async () => {
      const report = JSON.parse(await readFile(`${out}/${id}.json`, 'utf8'));
      const bytes = await readFile(`${out}/${id}.glb`), source = await readFile(`game/public/assets/models/animal/${id}.glb`);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(report.sha256);
      expect(() => assertSourcePreserved(source, bytes)).not.toThrow();
      expect(report.offlinePassed).toBe(true);
      const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8')).assets.find((a: any) => a.id === id);
      expect(report.audits.map((a: any) => a.nativeMps)).toEqual([manifest.impliedWalkMps, manifest.impliedRunMps]);
    });
    it(`${id} keeps original weighted soles planted across serialized stance`, async () => {
      const report = JSON.parse(await readFile(`${out}/${id}.json`, 'utf8'));
      const doc = await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).read(`${out}/${id}.glb`), rest = storedPose(doc);
      const skin = createSkinReader(doc, id === 'animal_coyote' ? 'Wolf_Mesh' : 'brown_bea4');
      for (const audit of report.audits) {
        const clip = doc.getRoot().listAnimations().find(c => c.getName() === audit.name)!, seconds = duration(clip), step = 1 / 7680;
        const feet: ContactFoot[] = audit.feet;
        for (let i = 1; i < 96; i++) {
          const phase = i / 96, active = feet.filter(f => contactAt(f, phase - step / 2) && contactAt(f, phase + step / 2));
          restorePose(rest); applyClip(clip, (phase - step / 2) * seconds); const before = active.map(f => skin.points(f.vertices));
          restorePose(rest); applyClip(clip, (phase + step / 2) * seconds);
          active.forEach((f, j) => skin.points(f.vertices).forEach((p, k) => {
            const prev = before[j]![k]!, primary = f.primaryVertices.includes(f.vertices[k]!);
            expect(p.y).toBeGreaterThanOrEqual(audit.floorY - .001);
            if (primary) {
              expect(p.y).toBeLessThanOrEqual(audit.floorY + .006);
              expect(prev.y).toBeLessThanOrEqual(audit.floorY + .006);
              expect(prev.y).toBeGreaterThanOrEqual(audit.floorY - .00025);
              expect(p.y).toBeGreaterThanOrEqual(audit.floorY - .00025);
            }
            if (!primary && Math.max(p.y, prev.y) > audit.floorY + .002) return;
            const slip = p.clone().sub(prev).multiplyScalar(1 / (step * seconds)).add(new Vector3(0, 0, audit.nativeMps)).length();
            expect(slip, `${id}/${audit.name}/${f.name}/${phase}`).toBeLessThan(primary ? .008 : .012);
          }));
        }
      }
    });
  }
});
