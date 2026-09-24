import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { REGIONAL_BOSS_BODIES, REGIONAL_BOSS_SPECIES } from '../game/src/content/regionalBossBodies.js';
import { REGIONAL_BOSS_LEVELS } from '../game/src/content/encounterBalance.js';
import { enemyCombatLevel } from '../game/src/content/index.js';
import { auditBossHitMask } from '../tools/regional-bosses/hit-inspect.js';

const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
beforeAll(async () => {
  await MeshoptDecoder.ready;
  io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
});

describe('authored regional boss bodies', () => {
  it.each(['tempest_roc', 'tideworn'])('keeps %s claws clear through every shipped additive Hit and every base cycle', async id => {
    const entry = manifest.assets.find((asset: any) => asset.id === `creature_boss_${id}`);
    // Directional reactions are optional; the game falls back to Hit when an asset has none.
    const reactions = ['Hit', 'HitLeft', 'HitRight'].filter(name => entry.animations.includes(name));
    expect(reactions).toContain('Hit');
    for (const reaction of reactions) {
      const rows = await auditBossHitMask(id, `game/public/assets/${entry.file}`, reaction);
      expect(rows.map(row => row.name)).toEqual(['Idle', 'Walk', 'Run', 'Attack']);
      for (const row of rows) expect(row.minimum.y, `${row.name} / ${reaction} worst pose`).toBeGreaterThan(-.04);
    }
  });
  it('keeps seven independent hero assets and the existing regional strength policy', () => {
    expect(Object.keys(REGIONAL_BOSS_BODIES).sort()).toEqual(['cinderwake', 'galeskin', 'mossbound', 'ordrun', 'rootheart', 'tempest_roc', 'tideworn']);
    expect(new Set(REGIONAL_BOSS_SPECIES.map(s => s.assetId)).size).toBe(7);
    for (const s of REGIONAL_BOSS_SPECIES) {
      const id = s.id.replace('boss_', '') as keyof typeof REGIONAL_BOSS_LEVELS;
      const balance = REGIONAL_BOSS_LEVELS[id];
      expect(enemyCombatLevel(s.stats)).toBe(balance.tier * balance.multiplier);
      expect(s.assetId).toBe(`creature_${s.id}`);
      expect(REGIONAL_BOSS_BODIES[id].assetId).toBe(s.assetId);
    }
  });

  it('loads complete, hash-matched hero skins with finite animation, mapped surfaces and legal weights', async () => {
    for (const s of REGIONAL_BOSS_SPECIES) {
      const entry = manifest.assets.find((a: any) => a.id === s.assetId);
      expect(entry, s.assetId).toBeDefined();
      const bytes = await readFile(`game/public/assets/${entry.file}`);
      expect(createHash('sha256').update(bytes).digest('hex'), s.id).toBe(entry.sha256);
      const root = (await io.readBinary(bytes)).getRoot();
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
    }
  });
});
