/** Verify an explicit staged catalogue against production lab stats before GPU use. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {RPG_BESTIARY,RPG_BESTIARY_STAGED} from '../../game/src/content/rpgBestiary.js';
const file=process.argv[2];assert(file,'Catalogue path required');
const bytes=await readFile(file),catalogue=JSON.parse(bytes.toString()),rows=[];
for(const asset of catalogue.assets){
 const row=[...RPG_BESTIARY,...RPG_BESTIARY_STAGED].find(r=>r.assetId===asset.id);assert(row,`No explicit fixture stats for ${asset.id}`);
 for(let i=0;i<3;i++){
  const axis=(['x','y','z'] as const)[i]!;assert(Math.abs(row.nativeSize[i]!-asset.size[axis])<.00001,`${row.id} size ${axis}`);
  assert(Math.abs(row.nativeBase[i]!-asset.base[axis])<.00001,`${row.id} base ${axis}`);
 }
 assert(row.stats.maxHealth>0);assert(typeof row.stats.moveSpeedMps==='number'&&row.stats.moveSpeedMps>0);assert.equal(row.respawnMs,30000);
 rows.push({id:row.id,preset:`${RPG_BESTIARY_STAGED.includes(row)?'candidate':'species'}:${row.id}`,scale:row.scale,movement:row.movement,health:row.stats.maxHealth,moveSpeedMps:row.stats.moveSpeedMps,attackStyle:row.stats.attackStyle,groundY:asset.groundY,locomotionPolicy:asset.locomotionPolicy,impliedWalkMps:asset.impliedWalkMps,impliedRunMps:asset.impliedRunMps});
}
console.log(JSON.stringify({sha256:createHash('sha256').update(bytes).digest('hex'),rows},null,2));
