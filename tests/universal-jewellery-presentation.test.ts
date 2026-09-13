import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MINIBOSS_JEWELLERY } from '../game/src/content/universalMinibossLoot.js';
import { CRAFTED_JEWELRY } from '../game/src/content/jewelry.js';
import { gearAppearanceParts } from '../game/src/render/equipmentVisuals.js';
import { ITEM_ICON_APPEARANCE_IDS } from '../game/src/render/itemIconAppearances.js';
const registry = JSON.parse(readFileSync('art/item-icons/generated/registry.json','utf8')).items;
describe('prompted jewelry artwork', () => {
 it('ships accepted source artwork for every consolidated item without a 3D model', () => {
  expect(MINIBOSS_JEWELLERY).toHaveLength(14);
  expect(CRAFTED_JEWELRY).toHaveLength(14);
  const sources = new Set<string>();
  for (const item of [...CRAFTED_JEWELRY, ...MINIBOSS_JEWELLERY]) {
   const entry = registry[item.id];
   expect(entry.status, item.id).toBe('accepted');
   expect(entry.generator).toBe('built-in image_gen');
   expect(entry.prompt.length).toBeGreaterThan(100);
   const bytes = readFileSync('art/item-icons/generated/'+entry.source);
   expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
   sources.add(entry.source);
   expect(ITEM_ICON_APPEARANCE_IDS).not.toContain(item.id);
   for (const body of ['male','female'] as const) expect(gearAppearanceParts(item.id,body)).toEqual([]);
  }
  expect(sources.size).toBe(28);
 });
});
