import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { describe, expect, it } from 'vitest';
import { readRawGlb } from '../repair-ground-creature-gaits.js';
import { auditRhinoRecoil, measureRhinoAttackContact } from './rhino-contact.js';

describe('rhino staged recoil and impact', () => {
  it.each(['air', 'earth', 'water'])('%s keeps geometry and all source movement while planting actual recoil soles', async variant => {
    const source = await readFile(`game/public/assets/models/boss/boss_rhino_${variant}.glb`);
    const candidate = await readFile(`art/rebuild/candidates/finish-motion/rhino-contact/boss_rhino_${variant}.glb`);
    const before = readRawGlb(source), after = readRawGlb(candidate);
    expect(after.bin.subarray(0, before.bin.length).equals(before.bin)).toBe(true);
    for (const key of ['nodes', 'meshes', 'skins', 'materials', 'textures', 'images']) expect(after.json[key]).toEqual(before.json[key]);
    for (const clip of before.json.animations) {
      if (/^Hit/.test(clip.name)) continue;
      const result = after.json.animations.find((row: any) => row.name === clip.name);
      expect(result.channels).toEqual(clip.channels); expect(result.samplers).toEqual(clip.samplers);
    }
    const doc = await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).readBinary(candidate);
    const audit = auditRhinoRecoil(doc);
    expect(audit.passed).toBe(true);
    for (const clip of audit.clips) {
      expect(clip.maximumSoleDisplacementM).toBeLessThan(.002);
      expect(clip.minimumSoleY).toBeGreaterThanOrEqual(-.002);
      expect(clip.maximumWholeMeshRecoveryErrorM).toBeLessThan(.00001);
    }
    const contact = measureRhinoAttackContact(doc);
    const attack = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Attack')!;
    expect(attack.getExtras().contactNormalized).toBe(contact.contactNormalized);
    expect(contact.anticipationNormalized).toBeLessThan(contact.contactNormalized);
    expect(contact.contactNormalized).toBeGreaterThan(.3); expect(contact.contactNormalized).toBeLessThan(.4);
  });
});
