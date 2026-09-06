import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { assertSourcePreserved, readRawGlb } from '../repair-ground-creature-gaits.js';
import { contactAt, createSkinReader, type ContactFoot } from '../lib/ground-gait.js';
import { applyClip, duration, restorePose, storedPose } from './pose.js';

const directory = 'art/rebuild/candidates/finish-motion/scorpion-ground-gait';

describe('staged scorpion physical contacts', () => {
  it('holds serialized toe and near-floor heel vertices under translation, including the former bad front-leg phase', async () => {
    const bytes = await readFile(`${directory}/animal_scorpion.glb`);
    const source = await readFile('game/public/assets/models/animal/animal_scorpion.glb');
    expect(() => assertSourcePreserved(source, bytes)).not.toThrow();
    const before = readRawGlb(source), after = readRawGlb(bytes);
    expect(after.json.animations.filter((clip: any) => clip.name !== 'Run')).toEqual(before.json.animations.filter((clip: any) => clip.name !== 'Run'));
    const report = JSON.parse(await readFile(`${directory}/report.json`, 'utf8'));
    const doc = await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).readBinary(bytes);
    const skin = createSkinReader(doc, 'Scorpion_Mesh'), pose = storedPose(doc);
    const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Run')!;
    const seconds = duration(clip), step = 1 / 3840;
    const feet: ContactFoot[] = report.audit.feet.map((foot: ContactFoot) => ({ ...foot, clearance: .0005 }));
    // Every leg gets dense local stance probes. This is a quick regression;
    // the generator remains responsible for all 7,681 whole-mesh samples.
    const phases = [...Array.from({ length: 97 }, (_, i) => i / 96), .6186197916666665];
    for (const phase of phases) {
      const active = feet.filter(foot => contactAt(foot, phase - step / 2) && contactAt(foot, phase + step / 2));
      if (!active.length || phase <= step || phase >= 1 - step) continue;
      restorePose(pose); applyClip(clip, (phase - step / 2) * seconds);
      const beforePoints = active.map(foot => skin.points(foot.vertices));
      restorePose(pose); applyClip(clip, (phase + step / 2) * seconds);
      active.forEach((foot, footIndex) => skin.points(foot.vertices).forEach((point, index) => {
        const previous = beforePoints[footIndex]![index]!;
        const primary = foot.primaryVertices.includes(foot.vertices[index]!);
        const grounded = Math.max(point.y, previous.y) <= report.audit.floorY + .002;
        if (!primary && !grounded) return;
        const slip = point.clone().sub(previous).multiplyScalar(1 / (step * seconds)).add(new Vector3(0, 0, .31)).length();
        expect(slip, `${foot.name} vertex ${foot.vertices[index]} phase ${phase}`).toBeLessThan(primary ? .008 : .012);
      }));
    }
  });
});
