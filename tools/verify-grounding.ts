/** Production Chromium grounding probe. Run with --world for authored terrain integration. */
import { GameDriver } from './lib/driver.js';
import { startGameServer } from './lib/server.js';
import { mkdir, writeFile } from 'node:fs/promises';
const out='test-results/grounding'; await mkdir(out,{recursive:true});
const server=await startGameServer(); const driver=new GameDriver(server,{browserArgs:['--use-angle=d3d11','--mute-audio']});
const report:any={};
try {
 await driver.launch(); await driver.open(120000,'/index.html?mode=combat&terrain=slopes&footing=slope');
 console.log('lab ready');
 const page=driver.page!;
 await page.evaluate(async()=>{await (window as any).__featureLab.spawnTarget('creature','open_march_goats',{distance:6});});
 report.samples=[];
 for(let i=0;i<80;i++) {
  report.samples.push(await page.evaluate(()=>{
   const d=(window as any).__gameDebug;const lab=(window as any).__featureLab.getState();
   const id=lab.target?.entityId;const motion=id?d.getEntityMotion(id):null;
   const p=d.getPlayerPosition();
   return {p,playerGap:p.y-d.groundHeight(p.x,p.z),motion,semanticGap:motion?motion.semanticPosition[1]-d.groundHeight(motion.semanticPosition[0],motion.semanticPosition[2]):null,drawnGap:motion?motion.drawnPosition[1]-d.groundHeight(motion.drawnPosition[0],motion.drawnPosition[2]):null};
  }));
  await driver.wait(50);
 }
 await driver.callDebug('inspectPose',[{x:30,y:-32.966,z:-99,yaw:-1.5,pitch:0.9,distance:12}]);
 await driver.screenshot(out,'lab-goat-slope');
 await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
 report.walks=[];
 for(const key of ['w','s','a','d']) {const before=await driver.callDebug('getPlayerPosition');await driver.press(key,600);const after=await driver.callDebug('getPlayerPosition');report.walks.push({key,before,after});}
 report.maxPlayerGap=Math.max(...report.samples.map((r:any)=>Math.abs(r.playerGap)));
 if(report.maxPlayerGap>0.02) throw new Error('Player spawn is above terrain');
 report.maxSemanticGap=Math.max(...report.samples.map((r:any)=>Math.abs(r.semanticGap??0)));
 report.maxDrawnGap=Math.max(...report.samples.map((r:any)=>Math.abs(r.drawnGap??0)));
 const first=report.samples[0].motion.semanticPosition,last=report.samples.at(-1).motion.semanticPosition;
 report.animalTravel=Math.hypot(last[0]-first[0],last[2]-first[2]);
 if(report.maxSemanticGap>0.02||report.maxDrawnGap>0.02||report.animalTravel<2) throw new Error('Actor grounding or travel failed');
 if(!report.walks.some((r:any)=>Math.hypot(r.after.x-r.before.x,r.after.z-r.before.z)>0.5)) throw new Error('Keyboard travel failed');
 if (process.argv.includes('--world')) {
   await driver.open(120000, '/');
   report.world=[];
   for (const [name,x,z,distance] of [
     ['southwest-foothill',0,-242,65], ['south-spur',48,-290,55],
     ['ember-foothills',210,268,55], ['highlands',250,-96,55],
     ['woodland-seam',80,220,45], ['marchfield',-250,30,25],
   ] as const) {
     const y=await driver.callDebug('groundHeight',[x,z]) as number;
     await driver.callDebug('teleport',[[x,y,z]]); await driver.wait(400);
     const before=await driver.callDebug('getPlayerPosition');
     await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
     await driver.press('w',500);
     const after=await driver.callDebug('getPlayerPosition');
     const sample=await driver.callDebug('sampleWorld',[x,z]);
     await driver.callDebug('inspectPose',[{x,y,z,yaw:1.2,pitch:0.6,distance}]);
     await driver.wait(250);await driver.screenshot(out,name);
     const a=after as {x:number;y:number;z:number}, b=before as {x:number;y:number;z:number};
     const ground=await driver.callDebug('groundHeight',[a.x,a.z]) as number;
     if(Math.hypot(a.x-b.x,a.z-b.z)<0.4 || Math.abs(a.y-ground)>0.02) {
       throw new Error(`${name}: world movement or grounding failed`);
     }
     report.world.push({name,sample,before,after,groundGap:a.y-ground});
   }
   report.water=await driver.callDebug('getWaterBodies');
   report.scatter=await driver.callDebug('getScatterStats');
 }
 report.errors=[...driver.consoleErrors,...driver.pageErrors];
 if(report.errors.length) throw new Error('Browser reported runtime errors');
 report.passed=true;
 console.log(JSON.stringify({walks:report.walks,animalTravel:report.animalTravel,maxSemanticGap:report.maxSemanticGap,maxDrawnGap:report.maxDrawnGap,errors:report.errors,world:report.world},null,2));
} finally {await writeFile(out+(process.argv.includes('--world')?'/world-actors.json':'/lab-actors.json'),JSON.stringify(report,null,2));await driver.close();await server.close();}
