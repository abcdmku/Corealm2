import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { describe, expect, it } from 'vitest';
import { readRawGlb } from '../repair-ground-creature-gaits.js';
import { auditRhinoAttack } from './rhino-attack.js';
import { generatorFileSha256 } from './generator-hash.js';

describe('bounded rhino attack candidate', () => {
  it.each(['air', 'earth', 'water'])('%s preserves source geometry/recoil and plants complete weighted soles', async variant => {
    const source = await readFile(`art/rebuild/candidates/finish-motion/rhino-contact/boss_rhino_${variant}.glb`);
    const candidate = await readFile(`art/rebuild/candidates/finish-motion/rhino-attack/boss_rhino_${variant}.glb`);
    const report = JSON.parse(await readFile(`art/rebuild/candidates/finish-motion/rhino-attack/boss_rhino_${variant}.json`, 'utf8'));
    const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    expect(sha(source)).toBe(report.sourceSha256); expect(sha(candidate)).toBe(report.sha256);
    expect(report.generator.map((row: any) => row.file)).toEqual(expect.arrayContaining(['tools/creature-motion/pose.ts', 'tools/lib/ground-gait.ts']));
    for (const row of report.generator) expect(await generatorFileSha256(row.file), row.file).toBe(row.sha256);
    const before = readRawGlb(source), after = readRawGlb(candidate);
    expect(after.bin.subarray(0, before.bin.length).equals(before.bin)).toBe(true);
    for (const key of ['nodes', 'meshes', 'skins', 'materials', 'textures', 'images']) expect(after.json[key]).toEqual(before.json[key]);
    for (const clip of before.json.animations.filter((clip: any) => clip.name !== 'Attack')) {
      expect(after.json.animations.find((row: any) => row.name === clip.name)).toEqual(clip);
    }
    const doc = await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).readBinary(candidate);
    const audit = auditRhinoAttack(doc);
    expect(audit.passed).toBe(true);
    expect(audit.maximumSoleDisplacementM).toBeLessThan(.002);
    expect(audit.minimumSoleY).toBeGreaterThanOrEqual(-.002);
    expect(audit.recoveryErrorM).toBeLessThan(.00001);
    expect(audit.minimumHeadReach).toBeGreaterThan(audit.idleReach - .05);
    expect(audit.maximumHeadDisplacementM).toBeLessThan(.25);
    expect(audit.initialTargetOverlap).toBe(false);
    expect(audit.contactNormalized).toBeGreaterThan(.20);
    expect(audit.contactNormalized).toBeLessThan(.43);
    const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Attack')!;
    expect(clip.getExtras().contactNormalized).toBeCloseTo(audit.contactNormalized!, 6);
    // Head/neck changes cannot hide shrinking or translating joints inside rotation-only gestures.
    for (const channel of clip.listChannels()) {
      if (channel.getTargetPath() === 'rotation' || channel.getTargetNode()!.getName() === 'CATRigHub001') continue;
      const values = channel.getSampler()!.getOutput()!.getArray()!;
      expect(Array.from(values).every((value, i) => Math.abs(value - values[i % 3]!) < 1e-6)).toBe(true);
    }
  });
});
