/** Final-world wiring and spacing after the production creature lab has accepted each asset. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { GameDriver } from '../lib/driver.js';
import { startGameServer } from '../lib/server.js';
import { installTestDeadline } from '../lib/deadline.js';
import { DEEP_WILDERNESS_PACKS } from '../../game/src/content/deepWildernessEncounters.js';
import { REGIONS } from '../../game/src/content/regions.js';
const value = (key: string) => process.argv[process.argv.indexOf(key) + 1];
const band = process.argv.includes('--band') ? value('--band') : 'acceptance';
const visits = band === 'acceptance' ? ['wilderness_furnace_grazers','wilderness_eastern_red_dragons','wilderness_eastern_gloam_conclave','nightforge_marshal']
  : band === 'legacy' ? ['wilderness_lost_procession','wilderness_west_graves','wilderness_dead_boughs']
  : band === 'keepers' ? ['ashseal_warden','furnace_regent','nightforge_marshal']
  : band === 'spectral' ? ['chainbound_archon','hollow_star','population_abbey_east_lanterns']
  : band === 'shallow' ? ['wilderness_cinderback_scree','wilderness_furnace_grazers','wilderness_basalt_maw_hollow']
  : ['wilderness_central_purple_dragons','wilderness_eastern_red_dragons','wilderness_eastern_gloam_conclave'];
const output = `test-results/wilderness-creatures/world-${band}`;
await mkdir(output, {recursive:true});
const end = installTestDeadline('Wilderness creature integration',120000);
const server = await startGameServer({hmr:false});
const driver = new GameDriver(server,{viewport:{width:1440,height:900},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const report: any = {passed:false,band,census:[],visits:[]};
const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
try {
  await driver.launch(); const page = driver.page!;
  await page.addInitScript('globalThis.__name = (target, name) => Object.defineProperty(target, "name", {value:name, configurable:true});');
  await driver.open(60000,'/index.html');
  const actors = await page.evaluate(() => {
    const d = window.__gameDebug as any;
    return d.getEntities().filter((e:any)=>e.archetype==='enemy'||e.archetype==='boss').map((e:any)=>d.getEntity(e.id));
  });
  const expectedAssets=[...new Set(REGIONS.find(region=>region.id==='wilderness')!.enemyGroups.map(group=>group.assetId))];
  report.assetCensus=expectedAssets.map(assetId=>({assetId,count:actors.filter((actor:any)=>actor.regionId==='wilderness'&&(actor.view?.assetId??actor.assetId)===assetId).length}));
  assert(report.assetCensus.every((row:any)=>row.count>0),'A Wilderness creature family is missing from the live world');
  for(const pack of DEEP_WILDERNESS_PACKS) {
    const rows = actors.filter((e:any)=>e.meta?.groupId===pack.id);
    assert.equal(rows.length,pack.count,`${pack.id} population`);
    assert(rows.every((e:any)=>(e.view?.assetId??e.assetId)===`creature_${pack.speciesId}`),`${pack.id} wrong asset`);
    let separation=Infinity;
    for(let i=0;i<rows.length;i++) for(let j=i+1;j<rows.length;j++) {
      const a=rows[i],b=rows[j];
      separation=Math.min(separation,Math.hypot(a.meta.spawnX-b.meta.spawnX,a.meta.spawnZ-b.meta.spawnZ));
    }
    const minimum=pack.siteId?6:pack.speciesId.endsWith('_wilderness_dragon')||pack.speciesId==='amethyst_dragon'?24:14;
    assert(separation>=minimum-.01,`${pack.id}: ${separation}m < ${minimum}m`);
    report.census.push({id:pack.id,count:rows.length,assetId:rows[0].view?.assetId??rows[0].assetId,separation});
  }
  await driver.callDebug('setSkillLevel',['melee',99]);
  await driver.callDebug('setSkillLevel',['magic',99]);
  await driver.callDebug('setHealth',[317]);
  for(const groupId of visits) {
    const actor=actors.filter((e:any)=>e.meta?.groupId===groupId).sort((a:any,b:any)=>b.position[2]-a.position[2])[0];
    assert(actor,`Missing ${groupId}`);
    report.active = {groupId,actor};
    await page.evaluate((a:any)=>{
      const d=window.__gameDebug as any;
      const x=a.position[0],z=a.position[2]+Math.max(9,(a.combat?.bodyRadius??2)+5);
      const floor=d.getNavPoint([x,d.groundHeight(x,z),z]);
      if(!floor)throw new Error('No walkable inspection approach');
      d.inspectPose({x:floor.x,z:floor.z,y:d.groundHeight(floor.x,floor.z),
        yaw:Math.atan2(floor.x-a.position[0],floor.z-a.position[2]),pitch:.34,distance:11});
    },actor);
    await page.waitForFunction(id=>{
      const d=window.__gameDebug as any;
      return d.getDrawnBounds(id)?.meshes>0 && d.getEntityMotion(id)?.clip;
    },actor.id,{timeout:14000});
    // The world streams hundreds of unrelated meshes. Require this actor's actual
    // mapped colour submissions instead of waiting for the entire world queue.
    const asset=manifest.assets.find((row:any)=>row.id===(actor.view?.assetId??actor.assetId));
    const source=await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(`game/public/assets/${asset.file}`);
    const prefixes=[...new Set(source.getRoot().listNodes().filter(node=>node.getMesh()).map(node=>node.getName().replace(/[\s.:[\]]/g,'_').split('_').slice(0,3).join('_')).filter(Boolean))];
    const profile=await page.evaluate(prefixes=>{
      const d=window.__gameDebug as any;
      return prefixes.flatMap(prefix=>d.getRenderProfile(prefix).draws);
    },prefixes);
    const materials=new Set<string>(asset.materials);
    assert(profile.some((draw:any)=>draw.pass.startsWith('colour')&&draw.materials.some((m:any)=>m.mapUuid&&(materials.has(m.name)||materials.has(m.name.split('@art:')[0])))),`${groupId} missing mapped colour draw`);
    const observe=()=>page.evaluate(id=>{
      const d=window.__gameDebug as any;
      return {actor:d.getEntity(id),motion:d.getEntityMotion(id),bounds:d.getDrawnBounds(id),player:d.getPlayerPosition(),camera:d.getCamera()};
    },actor.id);
    const before=await observe();
    const inputs:string[]=[];
    for(const key of ['s','a','d','w']) {
      await page.keyboard.down(key);await page.waitForTimeout(450);await page.keyboard.up(key);
      inputs.push(key);
      const current=await driver.callDebug('getPlayerPosition') as any;
      if(Math.hypot(current.x-before.player.x,current.z-before.player.z)>.5)break;
    }
    await page.waitForFunction(()=>{
      const d=window.__gameDebug as any,p=d.getPlayerPosition(),c=d.getCamera();
      return Math.hypot(c.target.x-p.x,c.target.z-p.z)<.15;
    },undefined,{timeout:2000});
    const after=await observe();
    assert(Math.hypot(after.player.x-before.player.x,after.player.z-before.player.z)>.5,`${groupId} input did not move`);
    assert.equal(after.camera.freeMove,false);
    assert(after.camera.requestedDistance>=6&&after.camera.requestedDistance<=11);
    assert(Math.hypot(after.camera.target.x-after.player.x,after.camera.target.z-after.player.z)<.15);
    await page.screenshot({path:`${output}/${groupId}.png`});
    report.visits.push({groupId,sha256:asset.sha256,profile,inputs,before,after});
  }
  assert.deepEqual(driver.pageErrors,[]);assert.deepEqual(driver.consoleErrors,[]);
  assert.deepEqual(await driver.callDebug('getErrors'),[]);
  report.passed=true;
} catch(error) {
  report.error=String(error);
  if(driver.page&&!driver.page.isClosed()) {
    report.failureState=await driver.page.evaluate(id=>{
      const d=window.__gameDebug as any;
      return {player:d.getPlayerPosition(),camera:d.getCamera(),actor:id?d.getEntity(id):null,
        bounds:id?d.getDrawnBounds(id):null,motion:id?d.getEntityMotion(id):null,
        shaders:(window as any).__renderDistanceLab?.shaders?.()};
    },report.active?.actor.id).catch(error=>({error:String(error)}));
    await driver.page.screenshot({path:`${output}/failure.png`}).catch(()=>{});
  }
  throw error;
}
finally {await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));await driver.close();await server.close();end();}
