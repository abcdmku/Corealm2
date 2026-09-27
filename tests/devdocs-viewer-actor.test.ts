import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SemanticEntity } from '../game/src/contracts.js';
import type { AssetRegistry } from '../game/src/render/assets.js';
import { actorSpec, crowdEntityId, crowdLayout } from '../devdocs/src/viewer/actorEntity.js';
import { ActorStage, actorModel } from '../devdocs/src/viewer/actor.js';

/** A one-mesh rig with a spine, a head and a leg, carrying exactly the named clips. */
function fixtureAssets(clipNames: readonly string[]): AssetRegistry {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const vertices = geometry.getAttribute('position').count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(vertices * 4), 4));
  const weights = new Float32Array(vertices * 4);
  for (let i = 0; i < vertices; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({ name: 'animal_fixture_mat' }));
  const spine = new THREE.Bone(); spine.name = 'Fixture_Spine';
  const head = new THREE.Bone(); head.name = 'Fixture_Head'; head.position.set(0, .6, 0);
  // A support branch the masked hit overlay leaves on the base pose.
  const leg = new THREE.Bone(); leg.name = 'Fixture_Leg'; leg.position.set(0, -.5, 0);
  spine.add(head, leg); mesh.add(spine); mesh.bind(new THREE.Skeleton([spine, head, leg]));
  const source = new THREE.Group(); source.add(mesh); source.updateMatrixWorld(true);
  const nod = new THREE.QuaternionKeyframeTrack('Fixture_Head.quaternion', [0, .25, .5],
    [0, -.4, 0].flatMap(angle => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle).toArray()));
  const clips = clipNames.map(name => new THREE.AnimationClip(name, name === 'Death' ? .5 : 1, [
    new THREE.VectorKeyframeTrack('Fixture_Spine.position', [0, .5, 1], [0, 0, 0, 0, .2, 0, 0, name === 'Death' ? -.5 : 0, 0]),
    ...(/^Hit/.test(name) ? [nod] : []),
  ]));
  return {
    entry: () => ({ id: 'fixture', animations: clips.map(clip => clip.name), size: { x: 1, y: 1, z: 1 } }),
    isLoaded: () => true, load: async () => source, instance: () => source,
    clipOf: (_asset: string, name: string) => clips.find(clip => clip.name === name),
    clip: () => undefined, clipsOf: () => clips,
  } as unknown as AssetRegistry;
}

const ENTITY: SemanticEntity = {
  id: 'fixture_actor', archetype: 'enemy', name: 'Fixture', tier: 1, regionId: 'fallowmarch', position: [0, 0, 0],
  state: 'alive', interactions: ['inspect', 'attack'], view: { assetId: 'fixture', scale: 1 },
};

async function model(clips: readonly string[]) {
  const stage = new ActorStage(fixtureAssets(clips), ENTITY);
  await stage.build();
  return { stage, model: await actorModel(stage, 'fixture_creature') };
}

const brief = (states: { name: string; clip: string | null; available: boolean; synthetic?: boolean }[]) =>
  Object.fromEntries(states.map(state => [state.name, `${state.available ? state.clip ?? '-' : 'n/a'}${state.synthetic ? '*' : ''}`]));

describe('devdocs actor stage', () => {
  it('lists every creature state with the clip the game plays for it', async () => {
    const { model: full } = await model(['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'HitLeft', 'Death']);
    expect(brief(full.states!)).toEqual({ idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Attack', hit: 'Hit', hitLeft: 'HitLeft', hitRight: 'Hit*', death: 'Death' });
    expect(full.initialState).toBe('idle');
    full.dispose();
  });

  it('marks the procedural recoil, the walk-for-run fallback and a missing attack', async () => {
    const { model: sparse } = await model(['Idle', 'Walk']);
    expect(brief(sparse.states!)).toEqual({ idle: 'Idle', walk: 'Walk', run: 'Walk*', attack: 'n/a', hit: 'Hit_Fallback*', hitLeft: 'Hit_Fallback*', hitRight: 'Hit_Fallback*', death: '-*' });
    sparse.dispose();
  });

  it('replays attack after it finishes, holds death, and revives on idle', async () => {
    const { stage, model: actor } = await model(['Idle', 'Walk', 'Attack', 'Hit', 'Death']);
    expect(actor.setState!('attack')).toBe(true);
    expect(stage.snapshot()).toMatchObject({ motion: 'attack', clip: 'Attack' });
    for (let i = 0; i < 12; i++) actor.update!(.1);
    expect(stage.snapshot()?.motion).toBe('idle');
    for (let i = 0; i < 8; i++) actor.update!(.1);
    expect(stage.snapshot()).toMatchObject({ motion: 'attack', clip: 'Attack' });

    actor.setState!('death');
    for (let i = 0; i < 20; i++) actor.update!(.1);
    expect(stage.snapshot()).toMatchObject({ motion: 'death', clip: 'Death', time: .5 });
    expect(actor.playback()).toMatchObject({ clip: 'Death', time: .5, duration: .5 });

    actor.setState!('idle');
    actor.update!(.3);
    expect(stage.snapshot()).toMatchObject({ motion: 'idle', clip: 'Idle' });
    actor.dispose();
  });
});

describe('devdocs actor entity', () => {
  it('draws a placed boss from its world group at boss scale', () => {
    const { entity, rank, groupId } = actorSpec('tempest_roc');
    expect({ id: entity.id, archetype: entity.archetype, tier: entity.tier, rank, groupId }).toEqual({ id: 'tempest_roc', archetype: 'boss', tier: 13, rank: 'boss', groupId: 'tempest_roc' });
    expect(entity.view).toMatchObject({ assetId: 'creature_boss_tempest_roc', materialTier: 13 });
    expect(entity.view!.scale).toBeCloseTo(0.8692, 3);
  });

  it('seeds a pack variant with its first resident id, and an unplaced base with its own id', () => {
    expect(actorSpec('pack_fallowmarch_bracken_northeast_spiders').entity).toMatchObject({
      id: 'pack_fallowmarch_bracken_northeast_spiders_1', archetype: 'enemy', view: { assetId: 'creature_webweaver_spider', scale: .6 },
    });
    expect(actorSpec('briar_spider_t1')).toMatchObject({ groupId: null, rank: null, entity: { id: 'briar_spider_t1', archetype: 'enemy' } });
    expect(() => actorSpec('no_such_creature')).toThrow('Unknown creature no_such_creature');
  });
});

describe('devdocs actor crowd and draft', () => {
  const RANGE = { scale: [.8, 1.25], hue: 25, value: [.85, 1.1] } as const;

  it('keeps the first individual on the definition id and derives the rest from seed and index', () => {
    expect([0, 1, 2].map(index => crowdEntityId('pack_1', undefined, index))).toEqual(['pack_1', 'pack_1~s0~1', 'pack_1~s0~2']);
    expect([0, 1].map(index => crowdEntityId('pack_1', 4, index))).toEqual(['pack_1~s4~0', 'pack_1~s4~1']);
    expect(actorSpec('briar_spider_t1', { crowd: 40 }).entities).toHaveLength(12);
    expect(actorSpec('briar_spider_t1', { crowd: 0 }).entities.map(entity => entity.id)).toEqual(['briar_spider_t1']);
  });

  it('rolls every individual with the game roll, from the draft presentation', () => {
    const { entities, variation } = actorSpec('briar_spider_t1', { crowd: 3, presentation: { variation: RANGE } });
    expect(variation).toEqual(RANGE);
    expect(entities.map(entity => [entity.id, +entity.view!.scale!.toFixed(4), +entity.view!.colour!.hue.toFixed(3), +entity.view!.colour!.value.toFixed(4)])).toEqual([
      ['briar_spider_t1', .7371, -15.825, 1.0564],
      ['briar_spider_t1~s0~1', .6416, -21.031, .9022],
      ['briar_spider_t1~s0~2', .5437, -.074, .979],
    ]);
  });

  it('layers draft scale and skin over the definition, and null clears them', () => {
    expect(actorSpec('briar_spider_t1').entity.view).toMatchObject({ scale: .6 });
    expect(actorSpec('briar_spider_t1').entity.view).not.toHaveProperty('skinId');
    const drafted = actorSpec('briar_spider_t1', { presentation: { scale: 2, skinId: 'moss_back' } }).entity.view!;
    expect(drafted).toMatchObject({ scale: 2, skinId: 'moss_back' });
    expect(drafted).not.toHaveProperty('colour');
    const cleared = actorSpec('briar_spider_t1', { presentation: { skinId: null, variation: null } });
    expect(cleared.entity.view).not.toHaveProperty('skinId');
    expect(cleared.variation).toBeNull();
    // A boss keeps its rank multiplier over the drafted scale.
    expect(actorSpec('tempest_roc', { presentation: { variation: { scale: [2, 2] } } }).entity.view!.scale).toBeCloseTo(0.8692 * 2, 3);
  });

  it('lays a crowd out in centred rows facing the camera', () => {
    expect(crowdLayout(1, 2)).toEqual([[0, 0]]);
    expect(crowdLayout(3, 2)).toEqual([[-2, 0], [0, 0], [2, 0]]);
    expect(crowdLayout(5, 1)).toEqual([[-1, .5], [0, .5], [1, .5], [-.5, -.5], [.5, -.5]]);
  });

  it('draws and drives every individual of a crowd through one EntityViews', async () => {
    const crowd = [0, 1, 2].map(index => ({ ...ENTITY, id: crowdEntityId(ENTITY.id, undefined, index) }));
    const stage = new ActorStage(fixtureAssets(['Idle', 'Walk', 'Attack']), crowd);
    await stage.build();
    const actor = await actorModel(stage, 'fixture_creature');
    // A 1 m model at tier 1 (0.9 silhouette), with a fifth of its footprint between neighbours.
    expect(stage.entities.map(entity => entity.position.map(value => +value.toFixed(3)))).toEqual([[-1.08, 0, 0], [0, 0, 0], [1.08, 0, 0]]);
    actor.setState!('walk');
    expect(crowd.map(entity => stage.snapshot(entity.id)?.clip)).toEqual(['Walk', 'Walk', 'Walk']);
    actor.setState!('attack');
    expect(crowd.map(entity => stage.snapshot(entity.id)?.motion)).toEqual(['attack', 'attack', 'attack']);
    const size = actor.bounds().getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(2.5);
    actor.dispose();
  });
});
