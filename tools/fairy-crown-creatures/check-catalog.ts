import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FAIRY_CROWN_SPECIES, FAIRY_CROWN_FORMS, FAIRY_CROWN_SOURCE_ASSETS, FAIRY_CROWN_BOSS_IDS } from '../../game/src/content/fairyCrownCreatures.js';
import { CREATURE_SPECIES } from '../../game/src/content/creatureSpecies.js';
import { enemyCombatLevel } from '../../game/src/content/index.js';
import { enemyBlockFor } from '../../game/src/content/enemies.js';
import { ALL_ITEMS } from '../../game/src/content/items.js';
import { ENCOUNTER_ASSET_RADII } from '../../game/src/content/encounterFootprints.js';
import { CREATURE_MOTION_TIMING, CREATURE_PURSUIT_CEILING_MPS } from '../../game/src/content/creatureMotionTiming.js';
import { FEATURE_LAB_CATALOG, createFeatureLabEntity, stagedCreaturePreset } from '../../game/src/featureLab/catalog.js';
import { tierSilhouetteScale } from '../../game/src/core/math.js';

const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const catalog = JSON.parse(await readFile('tools/fairy-crown-creatures/catalog.json', 'utf8'));
const assets = new Map<string, any>(manifest.assets.map((asset: any) => [asset.id, asset]));
const items = new Set(ALL_ITEMS.map(item => item.id));
const rows = [];
assert.equal(FAIRY_CROWN_SPECIES.length, 12);
assert.equal(FAIRY_CROWN_BOSS_IDS.length, 3);
for (const species of FAIRY_CROWN_SPECIES) {
  const form = FAIRY_CROWN_FORMS.find(form => form.id === species.id)!;
  assert.equal(CREATURE_SPECIES.filter(row => row.id === species.id).length, 1);
  assert.equal(enemyCombatLevel(species.stats), form.level);
  assert.equal(enemyBlockFor(`test:${species.id}`, species.stats.family, species.stats.tier)?.id, species.stats.id);
  const asset = assets.get(species.assetId), sourceId = FAIRY_CROWN_SOURCE_ASSETS[species.assetId]!;
  assert(asset, `${species.assetId} missing from registered manifest`);
  assert.deepEqual(asset, catalog.assets.find((row: any) => row.id === asset.id));
  assert.equal(asset.metadata.fairyCrownVariant.sourceAssetId, sourceId);
  assert.equal(ENCOUNTER_ASSET_RADII[species.assetId], ENCOUNTER_ASSET_RADII[sourceId]);
  assert.deepEqual(CREATURE_MOTION_TIMING[species.assetId], CREATURE_MOTION_TIMING[sourceId]);
  assert.equal(CREATURE_PURSUIT_CEILING_MPS[species.assetId], CREATURE_PURSUIT_CEILING_MPS[sourceId]);
  for (const drop of species.stats.drops) {
    assert(items.has(drop.itemId), `${species.id} drops unknown ${drop.itemId}`);
    assert(drop.quantity[0] > 0 && drop.quantity[1] >= drop.quantity[0]);
    assert(drop.chance > 0 && drop.chance <= 1);
  }
  const preset = FEATURE_LAB_CATALOG.targets.creature.find(row => row.id === `species:${species.id}`);
  const candidate = stagedCreaturePreset(`candidate:${species.id}`);
  assert(preset && candidate, `${species.id} missing live or staged lab preset`);
  for (const fixture of [preset, candidate]) {
    const entity = createFeatureLabEntity(fixture, {
      entityId: `check:${fixture.id}`, groundPosition: [0, 0, 0], baseY: asset.base.y, assetSize: asset.size,
    });
    assert.equal(entity.archetype, form.boss ? 'boss' : 'enemy');
    assert.equal(entity.meta?.rank, form.boss ? 'boss' : undefined);
    assert.equal(entity.regionId, form.regionId);
    assert.equal(entity.combat?.level, form.level);
    assert.equal(entity.combat?.health, species.stats.maxHealth);
    const nativeScale = entity.view!.scale! * tierSilhouetteScale(species.stats.tier);
    assert(Math.abs(nativeScale - form.nativeScale) < 1e-10, `${fixture.id} changed drawn scale`);
    assert(Math.abs(entity.position[1] + asset.base.y * form.nativeScale) <= .0051, `${fixture.id} incorrect floor placement`);
  }
  rows.push({ id: species.id, region: species.regionId, tier: species.stats.tier, level: form.level, boss: !!form.boss });
}
console.log(JSON.stringify({ passed: true, species: rows }, null, 2));
