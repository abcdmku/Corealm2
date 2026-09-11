import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { REGIONAL_BOSS_BODIES, REGIONAL_BOSS_SPECIES } from '../game/src/content/regionalBossBodies.js';
import { REGIONAL_BOSS_LEVELS } from '../game/src/content/encounterBalance.js';
import { enemyCombatLevel } from '../game/src/content/index.js';
import { tierSilhouetteScale } from '../game/src/core/math.js';
import { auditBossHitMask } from '../tools/regional-bosses/hit-inspect.js';

describe('authored regional boss bodies', () => {
  it.each(['tempest_roc', 'tideworn'])('keeps %s claws clear through front/left/right additive Hit and every base cycle', async id => {
    const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
    const entry = manifest.assets.find((asset: any) => asset.id === `creature_boss_${id}`);
    for (const reaction of ['Hit', 'HitLeft', 'HitRight']) {
      const rows = await auditBossHitMask(id, entry ? `game/public/assets/${entry.file}` : undefined, reaction);
      expect(rows.map(row => row.name)).toEqual(['Idle', 'Walk', 'Run', 'Attack']);
      for (const row of rows) expect(row.minimum.y, `${row.name} / ${reaction} worst pose`).toBeGreaterThan(-.04);
    }
  }, 15000);
  it('keeps seven independent hero assets and the existing regional strength policy', () => {
    expect(Object.keys(REGIONAL_BOSS_BODIES).sort()).toEqual(['cinderwake', 'galeskin', 'mossbound', 'ordrun', 'rootheart', 'tempest_roc', 'tideworn']);
    expect(new Set(REGIONAL_BOSS_SPECIES.map(s => s.assetId)).size).toBe(7);
    for (const s of REGIONAL_BOSS_SPECIES) {
      const id = s.id.replace('boss_', '') as keyof typeof REGIONAL_BOSS_LEVELS;
      const balance = REGIONAL_BOSS_LEVELS[id];
      expect(enemyCombatLevel(s.stats)).toBe(balance.tier * balance.multiplier);
      expect(s.assetId).toBe(`creature_${s.id}`);
      // The lab species must draw at the authored body scale once tier silhouette is divided back
      // out, which is what fantasyEncounter hands the world. This used to pin the product to 1,
      // which silently meant "every boss is authored at 1" — it stopped holding when Galeskin and
      // Rootheart were drawn larger to get their briar_harrow stride under the cadence ceiling.
      expect(s.scale * tierSilhouetteScale(s.stats.tier)).toBeCloseTo(REGIONAL_BOSS_BODIES[id].scale, 8);
    }
  });

  it('loads complete, hash-matched hero skins with finite animation, mapped surfaces and legal weights', async () => {
    const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
    const calibration = JSON.parse(await readFile('assets/art/regional-bosses/gait-calibration.json', 'utf8'));
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    let staged: any;
    for (const s of REGIONAL_BOSS_SPECIES) {
      let entry = manifest.assets.find((a: any) => a.id === s.assetId), file = entry ? `game/public/assets/${entry.file}` : '';
      if (!entry) {
        staged ??= JSON.parse(await readFile('test-results/regional-bosses/catalog.json', 'utf8'));
        entry = staged.assets.find((a: any) => a.id === s.assetId);
        file = `test-results/regional-bosses/${staged.files[s.assetId]}`;
      }
      const bytes = await readFile(file);
      expect(createHash('sha256').update(bytes).digest('hex'), s.id).toBe(entry.sha256);
      const gait = calibration.assets.find((a: any) => a.id === s.assetId);
      expect(gait.sha256, `${s.id} final-byte gait calibration`).toBe(entry.sha256);
      for (const measured of [gait.walk, gait.run]) {
        expect(measured.impliedMps, `${s.id} positive sole velocity`).toBeGreaterThan(.25);
        expect(measured.contacts.every((foot: any) => foot.coreSamples >= 12), `${s.id} both feet have sustained stance`).toBe(true);
      }
      const root = (await io.readBinary(bytes)).getRoot();
      if (s.id === 'boss_tideworn' || s.id === 'boss_tempest_roc') {
        expect(entry.metadata.stoneTextureSource.assetId).toBe('creature_vault_custodian');
        expect(new Set(entry.metadata.textureBindings.map((t: any) => t.sha256))).toEqual(new Set([entry.metadata.stoneTextureSource.textureSha256]));
        const body = root.listNodes().find(n => n.getName() === 'beetle_golem_original_body')!;
        const head = body.getSkin()!.listJoints().findIndex(j => j.getName() === 'beetle_5_Bone_004');
        for (const p of body.getMesh()!.listPrimitives()) {
          const indices = Array.from(p.getIndices()!.getArray()!), weights = p.getAttribute('WEIGHTS_0')!, joints = p.getAttribute('JOINTS_0')!;
          let detachedSourceHeadTriangles = 0;
          for (let i = 0; i < indices.length; i += 3) {
            if (indices.slice(i, i + 3).every(vertex => {
              const w = weights.getElement(vertex, []), j = joints.getElement(vertex, []);
              return w.reduce((sum, value, k) => sum + (j[k] === head ? value : 0), 0) > .5;
            })) detachedSourceHeadTriangles++;
          }
          expect(detachedSourceHeadTriangles, `${s.id} removed source head includes both thin side plates`).toBe(0);
        }
      }
      expect(root.listAnimations().map(a => a.getName())).toEqual(expect.arrayContaining(['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death']));
      for (const a of root.listAnimations()) for (const sampler of a.listSamplers()) {
        expect(sampler.getInput()!.getArray()!.every(Number.isFinite), `${s.id} ${a.getName()} times`).toBe(true);
        expect(sampler.getOutput()!.getArray()!.every(Number.isFinite), `${s.id} ${a.getName()} transform`).toBe(true);
      }
      for (const node of root.listNodes()) for (const p of node.getMesh()?.listPrimitives() ?? []) {
        expect(node.getSkin(), `${s.id} unbound body part`).toBeTruthy();
        const joints = p.getAttribute('JOINTS_0')!, weights = p.getAttribute('WEIGHTS_0')!, jointCount = node.getSkin()!.listJoints().length;
        if (p.getMaterial()?.getBaseColorTexture()) expect(p.getAttribute('TEXCOORD_0'), `${s.id} textured surface UVs`).toBeTruthy();
        expect(p.getAttribute('POSITION')!.getArray()!.every(Number.isFinite), `${s.id} vertices`).toBe(true);
        let badWeights = 0, badJoints = 0;
        for (let i = 0; i < weights.getCount(); i++) {
          const w = weights.getElement(i, []), j = joints.getElement(i, []);
          if (Math.abs(w.reduce((sum, value) => sum + value, 0) - 1) > .0001) badWeights++;
          if (j.some((index, k) => w[k]! > 0 && (index < 0 || index >= jointCount))) badJoints++;
        }
        expect(badWeights, `${s.id} non-normalized weights`).toBe(0);
        expect(badJoints, `${s.id} missing bones`).toBe(0);
      }
      const redesign = entry.metadata.redesign;
      expect(redesign.deformedVertices, `${s.id} source anatomy refit`).toBeGreaterThan(200);
      expect(redesign.removedTriangles, `${s.id} replaced anatomy`).toBeGreaterThan(25);
      expect(redesign.addedTriangles, `${s.id} new anatomy`).toBeGreaterThan(1500);
      expect(redesign.motionEdits.some((m: any) => m.clip === 'Attack')).toBe(true);
      expect(entry.size.y).toBeGreaterThan(2);
      expect(entry.size.y).toBeLessThan(4);
      for (const clip of redesign.measurement.clips) {
        expect(clip.min.every(Number.isFinite) && clip.max.every(Number.isFinite), `${s.id} ${clip.name} bounds`).toBe(true);
        expect(clip.min[1]).toBeCloseTo(.003, 4);
      }
    }
  }, 10000);
});
