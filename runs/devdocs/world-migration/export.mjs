import { writeFileSync } from 'node:fs';
import { build } from 'esbuild';
const result = await build({stdin:{contents:`import { REGIONS } from './game/src/content/regions.ts'; import { habitatForGroup } from './game/src/content/worldHabitats.ts'; import { enemyBlockFor } from './game/src/content/enemies.ts'; import { encounterBodyRadius } from './game/src/content/encounterPlacement.ts'; export default {regions:REGIONS,groups:REGIONS.flatMap(r=>[r,...(r.dungeon?[r.dungeon]:[])]).flatMap(r=>r.enemyGroups.map(g=>({regionId:r.id,group:g,habitat:habitatForGroup(g.id),enemyId:enemyBlockFor(g.id,g.family,g.tier)?.id,bodyRadius:encounterBodyRadius(g)})))};`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
writeFileSync('runs/devdocs/world-migration/current.mjs', result.outputFiles[0].text);
const { default: snapshot } = await import('./current.mjs');
writeFileSync('runs/devdocs/world-migration/snapshot.json', JSON.stringify(snapshot,null,2)+'\n');
console.log(`Captured ${snapshot.regions.length} regions, ${snapshot.groups.length} placements as conversion inputs.`);
