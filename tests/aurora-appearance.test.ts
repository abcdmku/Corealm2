import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CharacterRig, type GearAppearanceLike } from '../game/src/render/characterRig.js';
import { gearAppearanceParts } from '../game/src/render/equipmentVisuals.js';

const approved = 'aurora-tailored-approved';
const pieces = [
  ['frostweave_hood', 'head'], ['frostweave_robe', 'body'], ['frostweave_leggings', 'legs'],
  ['frostweave_wraps', 'hands'], ['frostweave_boots', 'feet'],
] as const;
type Entry = { id: string; tags: string[]; itemModel?: { itemId: string; wearable: boolean } };
const entry = (itemId: string, tag = approved): Entry => ({
  id: `corealm_item_${itemId}`, tags: [tag], itemModel: { itemId, wearable: true },
});
function resolve(itemId: string, candidate: Entry | undefined, body = 'base_male') {
  const assets = { entry: (id: string) => id === candidate?.id ? candidate : undefined };
  const rig = new CharacterRig(assets as never) as any;
  rig.bodyAssetId = body;
  const fallback = gearAppearanceParts(itemId, body === 'base_female' ? 'female' : 'male');
  try { return { fallback, selected: rig.authoredItemParts(itemId, fallback) as readonly GearAppearanceLike[] }; }
  finally { rig.dispose(); }
}
beforeEach(() => { vi.stubEnv('DEV', false); vi.stubGlobal('location', { search: '' }); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Aurora appearance selection', () => {
  it.each(pieces)('selects approved native male %s without imported tint', (id, slot) => {
    const { selected } = resolve(id, entry(id));
    expect(selected).toEqual([{ assetId: `corealm_item_${id}`, slot, attach: 'skin' }]);
  });

  it('keeps the fitted appearances for female and unsupported bodies', () => {
    for (const body of ['base_female', 'base_male_custom', 'alternate_humanoid']) {
      for (const [id] of pieces) {
        const { selected, fallback } = resolve(id, entry(id), body);
        expect(fallback.length, `${body}: ${id}`).toBeGreaterThan(0);
        expect(selected, `${body}: ${id}`).toBe(fallback);
      }
    }
  });

  it('resolves the new hood to a shipped fitted head for each fallback body', () => {
    const manifest = JSON.parse(readFileSync(new URL('../game/public/assets/manifest.json', import.meta.url), 'utf8'));
    const shipped = new Set(manifest.assets.map((asset: { id: string }) => asset.id));
    for (const body of ['male', 'female'] as const) {
      const parts = gearAppearanceParts('frostweave_hood', body);
      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({ assetId: `fab_${body}_mage_head`, slot: 'head', attach: 'skin' });
      expect(shipped.has(parts[0]!.assetId)).toBe(true);
    }
  });

  it('requires an exact approval tag and matching wearable metadata', () => {
    const id = 'frostweave_robe';
    const candidates: (Entry | undefined)[] = [undefined,
      ...['tier50-70-tailored-approved', 'starhide-tailored-approved', 'reference-tailored-candidate',
        'temporary-asset-review', `${approved}-pending`].map(tag => entry(id, tag)),
      { id: `corealm_item_${id}`, tags: [approved] },
      { ...entry(id), itemModel: { itemId: 'frostweave_hood', wearable: true } },
      { ...entry(id), itemModel: { itemId: id, wearable: false } },
    ];
    for (const candidate of candidates) {
      const { selected, fallback } = resolve(id, candidate);
      expect(selected, JSON.stringify(candidate)).toBe(fallback);
    }
    for (const other of ['frostweave_robe_old', 'frostguard_plate', 'starhide_robe']) {
      const { selected, fallback } = resolve(other, entry(other));
      expect(selected, other).toBe(fallback);
    }
  });

  it('previews unapproved Aurora only through the marked development combat lab', () => {
    const id = 'frostweave_robe';
    for (const [dev, search, tag, permitted] of [
      [true, '?mode=combat&reviewStaged=1', 'temporary-asset-review', true],
      [false, '?mode=combat&reviewStaged=1', 'temporary-asset-review', false],
      [true, '?reviewStaged=1', 'temporary-asset-review', false],
      [true, '?mode=combat', 'temporary-asset-review', false],
      [true, '?mode=combat&reviewStaged=1', 'reference-tailored-candidate', false],
    ] as const) {
      vi.stubEnv('DEV', dev); vi.stubGlobal('location', { search });
      const { selected, fallback } = resolve(id, entry(id, tag));
      if (permitted) expect(selected).toEqual([{ assetId: `corealm_item_${id}`, slot: 'body', attach: 'skin' }]);
      else expect(selected).toBe(fallback);
    }
  });
});

describe('Aurora native body coverage', () => {
  it.each([approved, 'reference-tailored-candidate'])('%s preserves exposed arms and reverses robe coverage', async tag => {
    const samples = [
      ['Head', 1.7], ['neck_01', 1.5], ['upperarm_l', 1.4], ['lowerarm_r', 1.4],
      ['hand_l', 1.4], ['spine_02', 1.2], ['spine_01', 1.01], ['thigh_l', .8], ['foot_r', .1],
    ] as const;
    const positions: number[] = [], joints: number[] = [], weights: number[] = [];
    samples.forEach(([, y], joint) => {
      for (let corner = 0; corner < 3; corner++) {
        positions.push(corner === 1 ? .01 : 0, y + (corner === 2 ? .005 : 0), 0);
        joints.push(joint, 0, 0, 0); weights.push(1, 0, 0, 0);
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    geometry.setIndex(Array.from({ length: positions.length / 3 }, (_, index) => index));
    const material = new THREE.MeshBasicMaterial(), mesh = new THREE.SkinnedMesh(geometry, material);
    const body = new THREE.Group();
    const bones = samples.map(([name]) => { const bone = new THREE.Bone(); bone.name = name; return bone; });
    body.add(mesh, ...bones); mesh.bind(new THREE.Skeleton(bones));
    const entries = new Map([
      ['corealm_item_frostweave_robe', { tags: ['torso', tag], itemModel: {
        itemId: 'frostweave_robe', wearable: true, bodyCoverage: [{ region: 'torso', minY: 1.02, maxY: 1.48 }],
      } }],
      ['corealm_item_frostweave_wraps', { tags: ['arms', tag], itemModel: { itemId: 'frostweave_wraps', wearable: true } }],
    ]);
    const assets = { entry: (id: string) => entries.get(id), load: async () => new THREE.Group() };
    const rig = new CharacterRig(assets as never) as any;
    rig.root.add(body); rig.body = body; rig.bodyAssetId = 'base_male'; rig.layerTarget = body;
    rig.bodyMeshes = [mesh]; rig.bodyGeometries.set(mesh, geometry);
    const indicesWithout = (...hidden: string[]) => samples.flatMap(([name], sample) =>
      hidden.includes(name) ? [] : [sample * 3, sample * 3 + 1, sample * 3 + 2]);
    try {
      rig.gearBySlot.set('body', [{ assetId: 'corealm_item_frostweave_robe', slot: 'body', attach: 'skin' }]);
      rig.gearBySlot.set('hands', [{ assetId: 'corealm_item_frostweave_wraps', slot: 'hands', attach: 'skin' }]);
      await rig.rebuildLayersNow();
      expect(Array.from(mesh.geometry.index!.array)).toEqual(indicesWithout('spine_02', 'hand_l'));
      rig.gearBySlot.delete('body');
      await rig.rebuildLayersNow();
      expect(Array.from(mesh.geometry.index!.array)).toEqual(indicesWithout('hand_l'));
      rig.gearBySlot.clear();
      await rig.rebuildLayersNow();
      expect(mesh.geometry).toBe(geometry);
      expect(Array.from(mesh.geometry.index!.array)).toEqual(indicesWithout());
    } finally { rig.dispose(); geometry.dispose(); material.dispose(); mesh.skeleton.dispose(); }
  });
});
