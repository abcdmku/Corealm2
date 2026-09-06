/** Separate source candidates; this never changes active content or public assets. */
import {exportBestiary}from'./build.mjs';
import {buildForestMonster}from'./forest-monster-source/forest-monster.mjs';
import {buildEarthElemental}from'./earth-elemental-source/earth.mjs';
import {buildBeetleGolem}from'./beetle-golem-source/beetle.mjs';
import {buildLavaGolem}from'./lava-golem-source/lava-golem.mjs';
import {buildRoach}from'./roach-source/roach.mjs';
import {buildMocapGoblin}from'./mocap-goblin-source/goblin.mjs';
import {buildTrollMauler}from'./troll-mauler-source/index.mjs';
import {buildGiantRat}from'./giant-rat-source/giant-rat.mjs';
export const buildExpansion=async id=>{
 const result=id==='mossback_sentinel'?buildForestMonster(id):id==='shale_elemental'?buildEarthElemental(id):id==='beetle_golem'?buildBeetleGolem(id):id==='lava_golem'?buildLavaGolem(id):id==='cave_roach'?buildRoach(id):id==='wild_goblin'?buildMocapGoblin(id):id==='troll_mauler'?await buildTrollMauler(id,{includeExperimentalMotions:true}):id==='giant_rat'?await buildGiantRat(id):null;
 if(!result)throw new Error(`Unknown complete source candidate ${id}`);
 const materials=new Set();result.object.traverse(node=>{if(node.isMesh)for(const material of Array.isArray(node.material)?node.material:[node.material])materials.add(material);});
 for(const material of materials)if(!material.name.startsWith('animal_'))material.name=`animal_rpg_${id}_${material.name}`;
 return result;
};
if(process.argv[1]?.replaceAll('\\','/').endsWith('/rpg-bestiary/export-expansion.mjs')){
 const args=process.argv.slice(2),outIndex=args.indexOf('--out');
 const out=outIndex<0?'art/rebuild/candidates/finish-bestiary/complete-source-round2':args.splice(outIndex,2)[1];
 if(!args.length)throw new Error('Explicit source IDs required: mossback_sentinel, shale_elemental, beetle_golem, lava_golem');
 await exportBestiary(args,out,{factory:buildExpansion});
}
