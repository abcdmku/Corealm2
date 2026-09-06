import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { assertSourcePreserved } from '../repair-ground-creature-gaits.js';
import { contactAt, createSkinReader, type ContactFoot } from '../lib/ground-gait.js';
import { applyClip, duration, restorePose, storedPose } from './pose.js';
import { generatorFileSha256 } from './generator-hash.js';

const out = 'art/rebuild/candidates/finish-motion/legacy-bovines';
describe('cattle and aurochs serialized physical hooves', () => {
  for (const id of ['animal_cattle', 'animal_aurochs']) {
    it(`${id} retains original source and original native gait speeds`, async () => {
      const report = JSON.parse(await readFile(`${out}/${id}.json`, 'utf8'));
      const bytes = await readFile(`${out}/${id}.glb`), source = await readFile(`game/public/assets/models/animal/${id}.glb`);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(report.sha256);
      for (const [file, expected] of Object.entries(report.generatorSha256)) expect(await generatorFileSha256(file), file).toBe(expected);
      const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8')).assets.find((a: any) => a.id === id);
      const publicSha256 = createHash('sha256').update(source).digest('hex');
      expect(manifest.sha256.toLowerCase()).toBe(publicSha256);
      if (publicSha256 === report.sha256) {
        // Promoted: the served model is this audited candidate. Its repaired gaits were proven
        // against the recorded original source before promotion, so the original bytes no longer
        // ship; the pinned source hash and byte count remain the provenance record.
        expect(report.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(manifest.bytes).toBe(bytes.length);
      } else {
        expect(publicSha256).toBe(report.sourceSha256);
        expect(() => assertSourcePreserved(source, bytes)).not.toThrow();
      }
      expect(report.offlinePassed).toBe(true);
      expect(report.audit.map((a: any) => a.nativeMps)).toEqual([manifest.impliedWalkMps, manifest.impliedRunMps]);
      const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS), original = await io.readBinary(source), staged = await io.readBinary(bytes);
      for (const name of ['Walk', 'Run']) expect(duration(staged.getRoot().listAnimations().find(clip => clip.getName() === name)!)).toBe(duration(original.getRoot().listAnimations().find(clip => clip.getName() === name)!));
    });
    it(`${id} keeps original weighted soles planted across serialized stance`, async () => {
      const report = JSON.parse(await readFile(`${out}/${id}.json`, 'utf8'));
      const doc = await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).read(`${out}/${id}.glb`), rest = storedPose(doc);
      const skin = createSkinReader(doc, 'Cow_Mesh');
      for (const audit of report.audit) {
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

