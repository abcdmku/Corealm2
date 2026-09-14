import {writeFileSync} from 'node:fs'; import {build} from 'esbuild';
const result=await build({stdin:{contents:`export { ENEMIES as default } from './.baseline/game/src/content/enemies.ts';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
writeFileSync('runs/devdocs/world-migration/baseline-loot.mjs',result.outputFiles[0].text);
const {default:enemies}=await import('./baseline-loot.mjs');
writeFileSync('runs/devdocs/world-migration/baseline-loot.json',JSON.stringify(enemies,null,2)+'\n');
console.log('Recovered baseline combat/drop definitions for '+enemies.length+' identities.');
