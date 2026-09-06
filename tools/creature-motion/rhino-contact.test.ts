import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { describe, expect, it } from 'vitest';
import { readRawGlb } from '../repair-ground-creature-gaits.js';
import { auditRhinoRecoil, measureRhinoAttackContact } from './rhino-contact.js';

describe('rhino staged recoil and impact', () => {
  it.each(['air', 'earth', 'water'])('%s keeps geometry and all source movement while planting actual recoil soles', async variant => {
    const staged = 'art/rebuild/candidates/finish-motion';
    const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    const served = await readFile(`game/public/assets/models/boss/boss_rhino_${variant}.glb`);
    const candidate = await readFile(`${staged}/rhino-contact/boss_rhino_${variant}.glb`);
    const report = JSON.parse(await readFile(`${staged}/rhino-contact/boss_rhino_${variant}.json`, 'utf8'));
    expect(sha(candidate)).toBe(report.sha256);
    if (sha(served) === report.sourceSha256) {
      // Unpromoted: the served model is still this candidate's own recorded source, so the
      // preservation is checkable byte for byte.
      const before = readRawGlb(served), after = readRawGlb(candidate);
      expect(after.bin.subarray(0, before.bin.length).equals(before.bin)).toBe(true);
      for (const key of ['nodes', 'meshes', 'skins', 'materials', 'textures', 'images']) expect(after.json[key]).toEqual(before.json[key]);
      for (const clip of before.json.animations) {
        if (/^Hit/.test(clip.name)) continue;
        const result = after.json.animations.find((row: any) => row.name === clip.name);
        expect(result.channels).toEqual(clip.channels); expect(result.samplers).toEqual(clip.samplers);
      }
    } else {
      // Promoted past this stage. The recoil candidate is no longer the end of the chain: the
      // Attack repair was staged FROM it and is what now ships, so the original bytes this
      // candidate preserved are gone from the tree and its pinned source hash is the record.
      // What stays checkable is that the chain is unbroken - the shipped model is the audited
      // Attack repair, and that repair's recorded source is exactly these bytes. The geometry
      // preservation itself is re-proven on the live half of the chain by `rhino-attack.test.ts`.
      const attack = JSON.parse(await readFile(`${staged}/rhino-attack/boss_rhino_${variant}.json`, 'utf8'));
      expect(report.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(attack.sourceSha256).toBe(report.sha256);
      expect(sha(served)).toBe(attack.sha256);
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
