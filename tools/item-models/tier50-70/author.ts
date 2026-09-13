import type { ItemModelAuthor } from '../contracts.js';
import type { ArmorTheme } from './contracts.js';
import { createArmorMaterials } from './materials.js';
import { buildRobe } from './robe.js';
import { buildHood } from './hood.js';
import { buildLeggings } from './leggings.js';
import { buildBoots } from './boots.js';
import { buildWraps } from './wraps.js';
import { designForTier } from './appearance.js';

const builders = {hood:buildHood,robe:buildRobe,leggings:buildLeggings,boots:buildBoots,wraps:buildWraps};
export function createAuthor(theme: ArmorTheme): ItemModelAuthor {
  return {
    ids:Object.keys(builders).map(part=>`${theme}_${part}`),
    build(itemId) {
      const part=itemId.slice(theme.length+1) as keyof typeof builders;
      if (!itemId.startsWith(`${theme}_`) || !builders[part]) throw new Error(`Unsupported ${theme} item: ${itemId}`);
      const designTheme=designForTier(theme);
      const group=builders[part](designTheme,createArmorMaterials(designTheme));
      group.name=itemId;
      group.userData.itemModel={
        itemId,author:`armor-${theme}-reference`,wearable:true,
        reference:`art/item-icons/generated/${designTheme}_${part}.png`,designTheme,
        description:`Reference-sculpted ${theme}: ${designTheme==='dragonhide'?'deep maroon cloth and antique gold':'midnight navy cloth and silver'}, physical overlapping scutes. Native male character skeleton.`,
        ...(part==='robe'?{bodyCoverage:[{region:'torso',minY:1.02,maxY:1.48}]}:{}),
      };
      return group;
    },
  };
}
