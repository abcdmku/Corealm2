/** Compact read-only receipts; passing assertions do not confer visual acceptance. */
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.argv[2]??'test-results/bestiary-retained-lifecycle';
const rows=[];
for(const item of await fs.readdir(root,{withFileTypes:true})){
 if(!item.isDirectory())continue;
 const file=path.join(root,item.name,'report.json');
 let r;try{r=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
 const before=r.beforeKill?.game,dead=r.dead?.game;
 rows.push({directory:item.name,species:r.species,assertionsPassed:r.passed,visualAccepted:r.visualAccepted??false,catalogueSha256:r.catalogueSha256,renderer:r.renderer,coverage:r.coverage,
  xp:before&&dead?dead.skills.melee.xp-before.skills.melee.xp:null,marks:before&&dead?dead.currency-before.currency:null,
  loot:r.reward?.expected??null,noItemDrop:r.noItemDrop,respawnSeconds:r.respawn&&r.dead?(r.respawn.at-r.dead.at)/1000:null,
  respawnHealth:r.respawn?.lab.target.health,respawnMaxHealth:r.respawn?.lab.target.maxHealth,
  settledCorpse:r.settledCorpse?{time:r.settledCorpse.motion.time,duration:r.settledCorpse.motion.duration}:null,
  captures:r.captures,captureStates:r.captureStates?.map(c=>({label:c.label,file:c.file,matched:c.matched,before:c.before.motion,after:c.after.motion})),error:r.error??null});
}
await fs.writeFile(path.join(root,'summary.json'),JSON.stringify({note:'Read-only summary of exact reports. Art and final-motion acceptance remains separate.',rows},null,2));
console.log(JSON.stringify({root,reports:rows.length,passed:rows.filter(r=>r.assertionsPassed).length}));
