/** Separate source candidates; this never changes active content or public assets. */
import {exportBestiary}from'./build.mjs';
const sources={earth_elemental_source:['./earth-elemental-source/earth.mjs','buildEarthElemental'],beetle_golem_source:['./beetle-golem-source/beetle.mjs','buildBeetleGolem'],
 kiln_marrow:['./lava-golem-source/lava-golem.mjs','buildLavaGolem'],cave_roach:['./roach-source/roach.mjs','buildRoach'],
 wild_goblin:['./mocap-goblin-source/goblin.mjs','buildMocapGoblin'],troll_mauler:['./troll-mauler-source/index.mjs','buildTrollMauler'],
 giant_rat:['./giant-rat-source/giant-rat.mjs','buildGiantRat']};
export const buildExpansion=async id=>{
 const spec=sources[id];if(!spec)throw new Error(`Unknown complete source candidate ${id}`);
 // Source modules may prepare textures at import time. Load only the selected source,
 // so exporting one creature does not require every unrelated original archive.
 const factory=(await import(spec[0]))[spec[1]];
 const result=await factory(id);
 if(id.endsWith('_source'))result.meta.sourceDestination={kind:'donor-only',activeReplacement:false,
  note:'Raw archived source for motion reuse; retained active descendants have separate authored designs.'};
 const materials=new Set();result.object.traverse(node=>{if(node.isMesh)for(const material of Array.isArray(node.material)?node.material:[node.material])materials.add(material);});
 for(const material of materials)if(!material.name.startsWith('animal_'))material.name=`animal_rpg_${id}_${material.name}`;
 return result;
};
if(process.argv[1]?.replaceAll('\\','/').endsWith('/rpg-bestiary/export-expansion.mjs')){
 const args=process.argv.slice(2),outIndex=args.indexOf('--out');
 const out=outIndex<0?'art/rebuild/candidates/finish-bestiary/complete-source-round2':args.splice(outIndex,2)[1];
 if(!args.length)throw new Error(`Explicit source IDs required: ${Object.keys(sources).join(', ')}`);
 await exportBestiary(args,out,{factory:buildExpansion});
}
