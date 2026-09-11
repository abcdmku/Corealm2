import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WILDERNESS_CRAFTING_TIERS, WILDERNESS_LOOT_ITEMS } from '../game/src/content/wildernessLoot.js';
import {
  GEAR_APPEARANCE_IDS, VISIBLE_EQUIP_SLOTS, applyGearAppearance, gatheringToolAppearance,
  gearAppearance, gearAppearanceParts, gearAppearancePartsWithCharge, weaponAttachment,
} from '../game/src/render/equipmentVisuals.js';
import { isProceduralGearAsset } from '../game/src/render/proceduralGear.js';

interface Asset { id: string; file: string; bytes: number; size: { x: number; y: number; z: number } }
const manifest = JSON.parse(readFileSync(new URL('../game/public/assets/manifest.json', import.meta.url), 'utf8')) as
  { assets: Asset[] };
const assets = new Map(manifest.assets.map(asset => [asset.id, asset]));
const equipment = WILDERNESS_LOOT_ITEMS.filter(item => item.equip);
const visible = equipment.filter(item => VISIBLE_EQUIP_SLOTS.includes(item.equip!.slot));
const rewards = ['ashseal_guard', 'regent_staff', 'chainbound_sword', 'nightmarshal_plate', 'hollowstar_staff'];

describe('Wilderness equipment appearance', () => {
  it('renders every visible crafting and keeper reward slot for both player bodies', () => {
    expect(equipment).toHaveLength(41);
    expect(visible).toHaveLength(33);
    for (const item of equipment) expect(GEAR_APPEARANCE_IDS, item.id).toContain(item.id);
    for (const body of ['male', 'female'] as const) {
      for (const item of visible) {
        const parts = gearAppearanceParts(item.id, body);
        expect(parts.length, `${body} ${item.id}`).toBeGreaterThan(0);
        for (const part of parts) {
          expect(part.slot, item.id).toBe(item.equip!.slot);
          expect(assets.has(part.assetId) || isProceduralGearAsset(part.assetId), part.assetId).toBe(true);
          if (part.attach === 'skin') {
            expect(part.assetId).toMatch(new RegExp(`^outfit_${body}_(knight|ranger)_`));
            expect(part.scale, `${item.id} must follow its skeleton`).toBeUndefined();
          } else expect(weaponAttachment(part), `${item.id} attachment`).not.toBeNull();
        }
      }
    }
    for (const item of equipment.filter(item => !VISIBLE_EQUIP_SLOTS.includes(item.equip!.slot))) {
      expect(gearAppearanceParts(item.id), `${item.id} is an indirect accessory`).toEqual([]);
    }
  });

  it('uses real shipped GLBs and registered production trim without inventing asset aliases', () => {
    const fileAssets = new Set<string>();
    for (const body of ['male', 'female'] as const) {
      for (const item of visible) {
        for (const part of gearAppearanceParts(item.id, body)) {
          if (!isProceduralGearAsset(part.assetId)) fileAssets.add(part.assetId);
        }
      }
    }
    for (const id of fileAssets) {
      const asset = assets.get(id)!;
      const bytes = readFileSync(new URL(`../game/public/assets/${asset.file}`, import.meta.url));
      expect(bytes.readUInt32LE(0), id).toBe(0x46546c67);
      expect(bytes.readUInt32LE(4), id).toBe(2);
      expect(bytes.readUInt32LE(8), id).toBe(bytes.length);
    }
  });

  it('retains reviewed fourth-grade hand fits at level 50 and 70', () => {
    for (const tier of WILDERNESS_CRAFTING_TIERS) {
      for (const [id, base] of [
        [`${tier.metal}_sword`, 'emberite_sword'], [`${tier.wood}_shield`, 'cinderpine_shield'],
        [`${tier.wood}_wand`, 'cinderpine_wand'], [`${tier.wood}_staff`, 'cinderpine_staff'],
      ]) {
        const part = gearAppearance(id!)!, baseline = gearAppearance(base!)!;
        expect(part.assetId, id).toBe(baseline.assetId);
        expect(part.scale, id).toBe(baseline.scale);
        expect(weaponAttachment(part), id).toEqual(weaponAttachment(baseline));
        const asset = assets.get(part.assetId)!;
        const drawnLength = Math.max(asset.size.x, asset.size.y, asset.size.z) * weaponAttachment(part)!.scale;
        expect(drawnLength, id).toBeLessThan(2);
      }
    }
  });

  it('distinguishes both material tiers and gives every named keeper reward fitted parts', () => {
    const cinder = gearAppearance('cindersteel_plate')!, night = gearAppearance('nightglass_plate')!;
    const warm = new THREE.Color(cinder.tint), cool = new THREE.Color(night.tint);
    expect(warm.r).toBeGreaterThan(warm.b);
    expect(cool.b).toBeGreaterThan(cool.r);
    expect(gearAppearance('dragonhide_robe')!.tint).not.toBe(gearAppearance('starhide_robe')!.tint);
    for (const id of rewards) {
      const item = WILDERNESS_LOOT_ITEMS.find(item => item.id === id)!;
      expect(item, id).toBeDefined();
      expect(gearAppearance(id)!.slot, id).toBe(item.equip!.slot);
      expect(gearAppearanceParts(id).length, id).toBeGreaterThan(0);
    }
    expect(gearAppearanceParts('nightmarshal_plate').map(part => part.assetId))
      .toEqual(gearAppearanceParts('nightglass_plate').map(part => part.assetId));
    expect(gearAppearance('nightmarshal_plate')!.tint).not.toBe(night.tint);
  });

  it('preserves authored grips and normal detail, with emission confined to casting gems', () => {
    const appearance = gearAppearance('hollowstar_staff')!;
    const normal = new THREE.Texture();
    for (const role of ['metal', 'wood', 'leather', 'gem']) {
      const source = new THREE.MeshStandardMaterial({ color: 0x886644, roughness: .62, normalMap: normal });
      source.userData.equipmentRole = role;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), source);
      applyGearAppearance(mesh, appearance);
      expect(mesh.material).not.toBe(source);
      expect(mesh.material.normalMap).toBe(normal);
      expect(mesh.material.roughness).toBe(.62);
      if (role === 'wood' || role === 'leather') expect(mesh.material.color.getHex()).toBe(source.color.getHex());
      if (role !== 'gem') {
        expect(mesh.material.emissive.getHex()).toBe(0);
        expect(mesh.material.emissiveIntensity).toBe(0);
      } else {
        expect(mesh.material.emissive.getHex()).toBe(appearance.accent);
        expect(mesh.material.emissiveIntensity).toBeLessThan(.2);
      }
      expect(source.emissive.getHex()).toBe(0);
      mesh.geometry.dispose(); mesh.material.dispose(); source.dispose();
    }
    for (const id of ['teak_staff', 'magic_staff', 'regent_staff', 'hollowstar_staff']) {
      expect(gearAppearancePartsWithCharge(id, { itemId: id, charged: true }).every(part => !part.orb), id).toBe(true);
    }
    normal.dispose();
  });

  it('shows all four new gathering tools with the established hand fit', () => {
    const tools = WILDERNESS_LOOT_ITEMS.filter(item => item.tool);
    expect(tools).toHaveLength(4);
    for (const item of tools) {
      const part = gatheringToolAppearance(item.id)!;
      expect(part, item.id).not.toBeNull();
      expect(part.slot).toBe('mainHand');
      expect(part.attach).toBe('bone');
      expect(assets.has(part.assetId)).toBe(true);
      const suffix = item.tool!.skill === 'mining' ? 'pickaxe' : 'hatchet';
      const baseline = gatheringToolAppearance(`emberite_${suffix}`)!;
      expect(weaponAttachment(part)).toEqual(weaponAttachment(baseline));
      expect(part.accent).toBeUndefined();
    }
  });
});
