import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { WILDERNESS_LOOT_ITEMS } from '../game/src/content/wildernessLoot.js';
import { ALL_ITEMS } from '../game/src/content/items.js';
import { gatheringToolAppearance, gearAppearanceParts } from '../game/src/render/equipmentVisuals.js';
import {
  ITEM_ICON_APPEARANCE_IDS, itemIconAppearance, type ItemIconAssetPart,
} from '../game/src/render/itemIconAppearances.js';
import { buildItemIconPrimitive, fitItemIconCamera } from '../game/src/render/itemIconRenderer.js';
import { AssetRegistry } from '../game/src/render/assets.js';
import { isProceduralGearAsset, registerProceduralGear } from '../game/src/render/proceduralGear.js';

// Exercise the candidate catalogue through the production appearance table before world promotion.
// Deduplication also keeps this fixture valid after the root registers the accepted items.
vi.mock('../game/src/content/items.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../game/src/content/items.js')>();
  const { WILDERNESS_LOOT_ITEMS: candidates } = await import('../game/src/content/wildernessLoot.js');
  return { ...actual, ALL_ITEMS: [...new Map([...actual.ALL_ITEMS, ...candidates].map(item => [item.id, item])).values()] };
});

const manifest = JSON.parse(readFileSync(new URL('../game/public/assets/manifest.json', import.meta.url), 'utf8')) as {
  assets: { id: string; file: string; materials: string[] }[];
};
const assets = new Map(manifest.assets.map(asset => [asset.id, asset]));

function assetParts(itemId: string): readonly ItemIconAssetPart[] {
  const parts = itemIconAppearance(itemId).parts;
  expect(parts.every(part => part.kind === 'asset'), itemId).toBe(true);
  return parts as readonly ItemIconAssetPart[];
}

function dispose(object: THREE.Object3D): void {
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
  });
}

describe('Wilderness loot icon appearances', () => {
  it('accepts all 62 candidate items without missing rows or phantom item IDs', () => {
    expect(WILDERNESS_LOOT_ITEMS).toHaveLength(62);
    expect([...ITEM_ICON_APPEARANCE_IDS].sort()).toEqual(ALL_ITEMS.map(item => item.id).sort());
    for (const item of WILDERNESS_LOOT_ITEMS) {
      expect(itemIconAppearance(item.id).itemId).toBe(item.id);
      expect(itemIconAppearance(item.id).parts.length, item.id).toBeGreaterThan(0);
    }
  });

  it('uses the promoted ore bodies without overwriting their mineral and host colors', () => {
    for (const family of ['cindervein', 'nightglass']) {
      const parts = assetParts(`${family}_ore`);
      expect(parts).toEqual([{ kind: 'asset', assetId: `corealm_ore_${family}` }]);
      expect(assets.get(parts[0]!.assetId)!.materials).toEqual([
        'Corealm ground host stone', `Corealm exposed ${family} mineral`,
      ]);
    }
    expect(assetParts('grithe_ore')[0]!.assetId).toBe('corealm_item_grithe_ore');
    expect(assetParts('emberite_ore')[0]!.assetId).toBe('corealm_item_emberite_ore');
  });

  it('gives all 17 resources and components a distinct material appearance', () => {
    const materials = WILDERNESS_LOOT_ITEMS.filter(item => !item.equip && !item.tool);
    expect(materials).toHaveLength(17);
    const signatures = materials.map(item => JSON.stringify(itemIconAppearance(item.id).parts));
    expect(new Set(signatures).size).toBe(materials.length);
    for (const [id, shape] of [
      ['grave_thread', 'cord'], ['void_thread', 'cord'], ['dragonhide', 'hide'], ['starhide', 'hide'],
      ['cindersteel_bar', 'ingot'], ['nightglass_bar', 'ingot'], ['teak_handle', 'handle'], ['magic_handle', 'handle'],
      ['nightforge_seal', 'scute'],
    ]) {
      expect(itemIconAppearance(id!).parts[0], id).toMatchObject({ kind: 'primitive', primitive: shape });
    }
    const keeperForms = ['ashseal_iron', 'furnace_crown', 'chainbound_link', 'nightforge_seal', 'hollow_star_fragment']
      .map(id => itemIconAppearance(id).parts.map(part => part.kind === 'asset' ? part.assetId : part.primitive).join(','));
    expect(new Set(keeperForms).size).toBe(5);
    expect(assetParts('chainbound_link')[0]!.assetId).toBe('chain_coil');
    const chainTint = new THREE.Color(assetParts('chainbound_link')[0]!.colour);
    expect(chainTint.r, 'Avoid darkening the already dark chain texture at gameplay size').toBeGreaterThan(.75);
    expect(chainTint.b, 'Keep the chain blue steel').toBeGreaterThan(chainTint.r);
  });

  it('keeps every visible equipment and tool icon identical to its production appearance', () => {
    const equipment = WILDERNESS_LOOT_ITEMS.filter(item => item.equip && !item.equip.slot.startsWith('accessory'));
    const tools = WILDERNESS_LOOT_ITEMS.filter(item => item.tool);
    expect(equipment).toHaveLength(33);
    expect(tools).toHaveLength(4);
    for (const item of [...equipment, ...tools]) {
      const actual = assetParts(item.id);
      const expected = item.tool ? [gatheringToolAppearance(item.id)!] : gearAppearanceParts(item.id);
      expect(actual.map(part => part.gearAppearance), item.id).toEqual(expected);
      expect(actual.map(part => part.assetId), item.id).toEqual(expected.map(part => part.assetId));
      expect(actual.map(part => part.scale), item.id).toEqual(expected.map(part => part.scale));
      expect(itemIconAppearance(item.id).presentation, item.id)
        .toBe(item.equip?.slot === 'hands' ? 'paired-hands' : undefined);
    }
  });

  it('distinguishes forged and thread-bound opal jewellery without borrowing another tier metal', () => {
    const jewellery = WILDERNESS_LOOT_ITEMS.filter(item => item.equip?.slot.startsWith('accessory'));
    expect(jewellery).toHaveLength(8);
    expect(new Set(jewellery.map(item => JSON.stringify(itemIconAppearance(item.id).parts))).size).toBe(8);
    for (const [metal, tint] of [['cindersteel', 0x8f7867], ['nightglass', 0x697b98]] as const) {
      for (const suffix of ['ring', 'pendant']) {
        expect(itemIconAppearance(`${metal}_${suffix}`).parts[0]).toMatchObject({ colour: tint, accent: 0xdb874c });
      }
    }
    for (const id of ['emberweave_ring', 'starweave_ring']) {
      expect(itemIconAppearance(id).parts[0]).toMatchObject({ primitive: 'ring', variant: 2 });
    }
  });

  it('resolves each imported model to a real shipped GLB', () => {
    const referenced = new Set(WILDERNESS_LOOT_ITEMS.flatMap(item => assetPartsIfAny(item.id)));
    for (const id of referenced) {
      if (isProceduralGearAsset(id)) continue;
      const asset = assets.get(id);
      expect(asset, id).toBeDefined();
      const bytes = readFileSync(new URL(`../game/public/assets/${asset!.file}`, import.meta.url));
      expect(bytes.readUInt32LE(0), id).toBe(0x46546c67);
      expect(bytes.readUInt32LE(4), id).toBe(2);
      expect(bytes.readUInt32LE(8), id).toBe(bytes.length);
    }
  });

  it('builds every procedural material and jewellery form with usable production camera bounds', async () => {
    for (const item of WILDERNESS_LOOT_ITEMS) {
      const appearance = itemIconAppearance(item.id);
      for (const part of appearance.parts) {
        if (part.kind !== 'primitive') continue;
        const model = buildItemIconPrimitive(part);
        const bounds = new THREE.Box3().setFromObject(model);
        expect(bounds.isEmpty(), item.id).toBe(false);
        expect(bounds.getSize(new THREE.Vector3()).toArray().every(value => Number.isFinite(value) && value > 0), item.id).toBe(true);
        const camera = new THREE.OrthographicCamera();
        fitItemIconCamera(model, camera, appearance);
        expect(Number.isFinite(camera.right - camera.left), item.id).toBe(true);
        expect(camera.right - camera.left, item.id).toBeGreaterThan(0);
        dispose(model);
      }
    }
    const registry = new AssetRegistry();
    registerProceduralGear(registry);
    const crown = await registry.load('proc_armour_collar_20');
    expect(crown.getObjectByName('standing-fluted-collar')).toBeDefined();
    expect(new THREE.Box3().setFromObject(crown).isEmpty()).toBe(false);
    dispose(crown);
  });
});

function assetPartsIfAny(itemId: string): string[] {
  return itemIconAppearance(itemId).parts.flatMap(part => part.kind === 'asset' ? [part.assetId] : []);
}
