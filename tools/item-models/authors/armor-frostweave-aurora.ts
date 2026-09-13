import type {ItemModelAuthor} from '../contracts.js';
import {buildAuroraPiece,type AuroraPiece} from '../aurora/geometry.js';
import {createAuroraMaterials} from '../aurora/materials.js';

const parts: readonly AuroraPiece[]=['hood','robe','leggings','boots','wraps'];
export const author: ItemModelAuthor={
  ids:parts.map(part=>`frostweave_${part}`),
  build(itemId) {
    const part=itemId.slice('frostweave_'.length) as AuroraPiece;
    if(!itemId.startsWith('frostweave_')||!parts.includes(part))throw new Error(`Unknown Aurora piece ${itemId}`);
    const group=buildAuroraPiece(part,createAuroraMaterials());
    group.name=itemId;
    group.userData.itemModel={
      itemId,author:'armor-frostweave-aurora',wearable:true,
      reference:'art/aurora/references/aurora-approved.png',
      description:'T90 Aurora Frostweave: ivory celestial cloth, warm gold borders, three swept shoulder plates and staggered opalescent hip panels above long scaled robe tails. Fitted to the native male rig from the approved T70 pattern, with the owner supplied Aurora reference guiding the silhouette and ornament.',
      ...(part==='robe'?{bodyCoverage:[{region:'torso',minY:1.02,maxY:1.48}]}:{}),
    };
    return group;
  },
};
