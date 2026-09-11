/** Focused authored grove proof. Runtime errors remain failures, including unrelated shaders. */
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {GameDriver} from '../lib/driver.js';
import {startGameServer} from '../lib/server.js';
import {installTestDeadline} from '../lib/deadline.js';
import {WILDERNESS_RESOURCE_SITES} from '../../game/src/content/wildernessResources.js';
const out = 'test-results/wilderness-trees/world';
await mkdir(out,{recursive:true});
const deadline=installTestDeadline('Wilderness tree world proof',120000);
const server=await startGameServer(), driver=new GameDriver(server,{viewport:{width:1440,height:900},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const report:any={passed:false,treeAssertionsPassed:false,samples:[]};
try {
 await driver.launch(); const page=driver.page!;
 await page.addInitScript('globalThis.__name = (target, name) => Object.defineProperty(target, "name", { value: name, configurable: true });');
 await driver.open(65000,'/index.html');
 for(const site of WILDERNESS_RESOURCE_SITES.filter(s=>s.kind==='grove')) {
  const x=site.centre[0], z=site.centre[1]+10;
  await page.evaluate(({x,z})=>{const d=window.__gameDebug as any; d.inspectPose({x,z,y:d.groundHeight(x,z),yaw:0,pitch:.34,distance:11});},{x,z});
  await page.waitForFunction(()=>{const r=(window.__gameDebug as any).getEntityViewStats().residency;return !r.pending&&!r.failed&&!r.missing;},undefined,{timeout:14000});
  await page.waitForTimeout(350);
  const before:any=await driver.callDebug('getPlayerPosition');
  await page.keyboard.down('w'); await page.waitForTimeout(450); await page.keyboard.up('w');
  const after:any=await driver.callDebug('getPlayerPosition');
  assert(Math.hypot(after.x-before.x,after.z-before.z)>.3,`${site.id}: walking through grove aisle`);
  await page.waitForTimeout(1800);
  const trees=await page.evaluate(id=>{const d=window.__gameDebug as any;return d.getEntities().filter((e:any)=>e.archetype==='tree').map((e:any)=>d.getEntity(e.id)).filter((e:any)=>e.meta?.locationId===id).map((e:any)=>({entity:e,bounds:d.getDrawnBounds(e.id)}));},site.id);
  assert.equal(trees.length,9,`${site.id}: authored trees`);
  report.samples.push({site:site.id,before,after,trees,camera:await driver.callDebug('getCamera')});
  await page.screenshot({path:`${out}/${site.id}.png`,timeout:5000});
  assert(trees.some((row:any)=>row.bounds?.meshes>0), `${site.id}: visible tree geometry`);
  for(const row of trees){ assert.equal(row.entity.name,row.entity.tier===50?'Veinwood':'Magic Tree'); }
 }
 report.treeAssertionsPassed=true;
 report.scatter=await driver.callDebug('getScatterStats');
 report.errors=await driver.callDebug('getErrors');
 assert.deepEqual(report.errors,[]); assert.deepEqual(driver.consoleErrors,[]); assert.deepEqual(driver.pageErrors,[]);
 report.passed=true;
} catch(error){report.failure=String(error);process.exitCode=1;}
finally {report.consoleErrors=driver.consoleErrors;report.pageErrors=driver.pageErrors;await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await driver.close();await server.close();deadline();}
console.log(JSON.stringify({passed:report.passed,treeAssertionsPassed:report.treeAssertionsPassed,failure:report.failure}));
