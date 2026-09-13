import {spawnSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
mkdirSync('test-results/aurora',{recursive:true});
const checks=[
  ['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],
  ['tests',['node_modules/vitest/vitest.mjs','run','tests/aurora-appearance.test.ts','tests/aurora-items.test.ts','tests/boss-armor.test.ts','tests/item-icons.test.ts','tests/starhide-appearance.test.ts','tests/tier50-70-coverage.test.ts','tests/tier50-70-skin.test.ts']],
  ['production-build',['--import','tsx','tools/build-game.ts']],
];
const reports=[];
for(const [name,args] of checks){const r=spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:12*1024*1024});const file=`test-results/aurora/${name}-final.log`;writeFileSync(file,(r.stdout??'')+(r.stderr??''));reports.push({name,passed:r.status===0,exitCode:r.status,file});console.log(`${name}: ${r.status}`);if(r.status!==0)process.exitCode=1;}
writeFileSync('runs/aurora/code-checks.json',JSON.stringify({passed:reports.every(r=>r.passed),reports},null,2)+'\n');
