import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ALL_ITEMS } from '../game/src/content/items.js';
import { MINIBOSS_JEWELLERY } from '../game/src/content/universalMinibossLoot.js';
import { UNIVERSAL_MINIBOSS_ROSTER } from '../game/src/content/universalMinibosses.js';
import { GEAR_APPEARANCE_IDS, gearAppearanceParts } from '../game/src/render/equipmentVisuals.js';
import { ITEM_ICON_APPEARANCE_IDS, itemIconAppearance, type ItemIconPrimitivePart } from '../game/src/render/itemIconAppearances.js';
import { buildItemIconPrimitive, fitItemIconCamera } from '../game/src/render/itemIconRenderer.js';
import { paletteForTier } from '../game/src/render/materials.js';

function jewelleryPart(itemId: string): ItemIconPrimitivePart {
  const parts = itemIconAppearance(itemId).parts;
  expect(parts, itemId).toHaveLength(1);
  expect(parts[0]!.kind, itemId).toBe('primitive');
  return parts[0] as ItemIconPrimitivePart;
}

describe('universal miniboss jewellery presentation', () => {
  it('loads the whole icon catalogue and covers every reward through the existing accessory path', () => {
    expect(MINIBOSS_JEWELLERY).toHaveLength(144);
    expect([...ITEM_ICON_APPEARANCE_IDS].sort()).toEqual(ALL_ITEMS.map(item => item.id).sort());
    for (const item of MINIBOSS_JEWELLERY) {
      expect(GEAR_APPEARANCE_IDS, item.id).toContain(item.id);
      expect(ITEM_ICON_APPEARANCE_IDS, item.id).toContain(item.id);
      for (const body of ['male', 'female'] as const) expect(gearAppearanceParts(item.id, body), item.id).toEqual([]);
      expect(jewelleryPart(item.id).primitive, item.id).toBe(item.equip!.slot === 'accessory1' ? 'ring' : 'amulet');
    }
  });

  it('keeps tier metal and makes each named reward distinct from its standard drop', () => {
    const tiers = [...new Set(MINIBOSS_JEWELLERY.map(item => item.tier))];
    for (const tier of tiers) {
      const uniqueSignatures = new Set<string>();
      for (const boss of UNIVERSAL_MINIBOSS_ROSTER) {
        const standard = jewelleryPart(`warden_jewellery_${boss.number}_t${tier}`);
        const unique = jewelleryPart(`unique_jewellery_${boss.number}_t${tier}`);
        expect(standard.colour).toBe(paletteForTier(tier).metal);
        expect(unique.colour).toBe(standard.colour);
        expect(unique.accent).not.toBe(standard.accent);
        expect(unique.primitive).toBe(boss.style === 'magic' ? 'amulet' : 'ring');
        expect(unique).not.toEqual(standard);
        uniqueSignatures.add(JSON.stringify(unique));
      }
      expect(uniqueSignatures.size).toBe(UNIVERSAL_MINIBOSS_ROSTER.length);
    }
    expect(new Set(tiers.map(tier => jewelleryPart(`unique_jewellery_01_t${tier}`).colour)).size).toBe(tiers.length);
  });

  it('builds every real ring and pendant recipe with finite geometry and usable icon camera bounds', () => {
    for (const item of MINIBOSS_JEWELLERY) {
      const appearance = itemIconAppearance(item.id);
      const object = buildItemIconPrimitive(jewelleryPart(item.id));
      const bounds = new THREE.Box3().setFromObject(object);
      expect(bounds.isEmpty(), item.id).toBe(false);
      expect(bounds.getSize(new THREE.Vector3()).toArray().every(value => Number.isFinite(value) && value > 0), item.id).toBe(true);
      const camera = new THREE.OrthographicCamera();
      fitItemIconCamera(object, camera, appearance);
      expect(Number.isFinite(camera.right - camera.left), item.id).toBe(true);
      expect(camera.right - camera.left, item.id).toBeGreaterThan(0);
      object.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        child.geometry.dispose();
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
      });
    }
  });
});
