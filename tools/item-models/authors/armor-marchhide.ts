import type { ItemModelAuthor } from '../contracts.js';
import type { CoreArmorSlot } from '../core/contracts.js';
import { bodyProfile } from '../core/profile.js';
import { buildHideArmor } from '../core/hide.js';
import { coreMaterials } from '../core/materials.js';
const ids = ['marchhide_hood','marchhide_robe','marchhide_leggings','marchhide_boots','marchhide_wraps'];
const slots: CoreArmorSlot[] = ['head','body','legs','feet','hands'];
export const author: ItemModelAuthor = {ids, build(id) {
  const index=ids.indexOf(id); if(index<0)throw new Error(`Unknown Marchhide armor ${id}`);
  const g=buildHideArmor(slots[index]!,{body:bodyProfile,materials:coreMaterials('hide',0xc5a17b),detail:0});
  g.name=id; g.userData.itemModel={itemId:id,author:'armor-marchhide',reference:`art/item-icons/generated/${id}.png`,description:'Tailored cured hide armor with fine grain, narrow seams and bound edges.',wearable:true};
  return g;
}};

