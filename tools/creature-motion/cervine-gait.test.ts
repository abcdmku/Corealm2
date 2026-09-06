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

const out = 'art/rebuild/candidates/finish-motion/legacy-cervines';
describe('deer serialized physical hooves', () => {
  for (const id of ['animal_deer']) {
    it(`${id} retains original source and original native gait speeds`, async () => {
      const report = JSON.parse(await readFile(`${out}/${id}.json`, 'utf8'));
      const bytes = await readFile(`${out}/${id}.glb`), source = await readFile(`game/public/assets/models/animal/${id}.glb`);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(report.sha256);
      expect(() => assertSourcePreserved(source, bytes)).not.toThrow();
      expect(report.offlinePassed).toBe(true);
      const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8')).assets.find((a: any) => a.id === id);
      expect(report.audit.map((a: any) => a.nativeMps)).toEqual([manifest.impliedWalkMps, manifest.impliedRunMps]);
      expect(report.audit.map((a: any) => a.seconds)).toEqual([manifest.walkClipSeconds, manifest.runClipSeconds]);
      for (const [file, digest] of Object.entries(report.generatorSha256)) expect(await generatorFileSha256(file), file).toBe(digest);
      expect(report.audit.every((a: any) => a.samplesPerCycle === 7680 && a.cycles === 2)).toBe(true);
    });
    it(`${id} never stretches the original joint translations or scales`, async () => {
      const doc = await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).read(`${out}/${id}.glb`);
      const rest = storedPose(doc), nodes = doc.getRoot().listNodes();
      const initial = nodes.map(node => ({ translation: node.getTranslation(), scale: node.getScale() }));
      for (const clip of doc.getRoot().listAnimations().filter(c => ['Walk', 'Run'].includes(c.getName()))) {
        for (let i = 0; i <= 32; i++) {
          restorePose(rest); applyClip(clip, duration(clip) * i / 32);
          nodes.forEach((node, j) => {
            node.getScale().forEach((value, k) => expect(value).toBeCloseTo(initial[j]!.scale[k]!, 5));
            if (node.getName() !== 'Deer_ROOTSHJnt') node.getTranslation().forEach((value, k) => expect(value).toBeCloseTo(initial[j]!.translation[k]!, 5));
          });
        }
      }
    });
    it(`${id} keeps original weighted soles planted across serialized stance`, async () => {
      const report = JSON.parse(await readFile(`${out}/${id}.json`, 'utf8'));
      const doc = await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).read(`${out}/${id}.glb`), rest = storedPose(doc);
      const skin = createSkinReader(doc, 'deer_body');
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


