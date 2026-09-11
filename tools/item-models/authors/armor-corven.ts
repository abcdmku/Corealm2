import type { ItemModelAuthor } from '../contracts.js';
import type { CoreArmorSlot } from '../core/contracts.js';
import { bodyProfile } from '../core/profile.js';
import { buildPlateArmor } from '../core/plate.js';
import { coreMaterials } from '../core/materials.js';
const ids = ['corven_helm','corven_plate','corven_greaves','corven_boots','corven_gauntlets'];
const slots: CoreArmorSlot[] = ['head','body','legs','feet','hands'];
export const author: ItemModelAuthor = { ids, build(id) {
  const index = ids.indexOf(id); if (index < 0) throw new Error(`Unknown Corven armor ${id}`);
  const g = buildPlateArmor(slots[index]!, {body: bodyProfile, materials: coreMaterials('plate',0xc3c7ca,0x817566),detail:0});
  g.name=id; g.userData.itemModel={itemId:id,author:'armor-corven',reference:`art/item-icons/generated/${id}.png`,description:'Fitted worked-iron armor with thin articulated plates and finished edges.',wearable:true,bodyCoverage:g.userData.coreCoverage ?? []};
  return g;
}};

