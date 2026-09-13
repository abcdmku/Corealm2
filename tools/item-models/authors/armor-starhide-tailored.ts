import type { ItemModelAuthor } from '../contracts.js';
import { createStarhideMaterials } from '../starhide/materials.js';
import { buildRobe } from '../starhide/robe.js';
import { buildHood } from '../starhide/hood.js';
import { buildLeggings } from '../starhide/leggings.js';
import { buildBoots } from '../starhide/boots.js';
import { buildWraps } from '../starhide/wraps.js';

const builders = {
  starhide_hood: buildHood,
  starhide_robe: buildRobe,
  starhide_leggings: buildLeggings,
  starhide_boots: buildBoots,
  starhide_wraps: buildWraps,
} as const;

export const author: ItemModelAuthor = {
  ids: Object.keys(builders),
  build(itemId) {
    const build = builders[itemId as keyof typeof builders];
    if (!build) throw new Error(`Unsupported tailored Starhide item: ${itemId}`);
    const group = build(createStarhideMaterials());
    group.name = itemId;
    group.userData.itemModel = {
      itemId, author: 'armor-starhide-tailored', wearable: true,
      reference: `art/item-icons/generated/${itemId}.png`,
      description: 'Reference-tailored midnight indigo Starhide, fine satin grain, teal and violet overlapping scale insets, thin silver ribbon borders and star filigree. Original native character fit and skeleton.',
      ...(itemId === 'starhide_robe' ? {bodyCoverage:[{region:'torso',minY:1.035,maxY:1.38}]} : {}),
    };
    return group;
  },
};
