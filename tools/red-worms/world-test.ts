import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { GameDriver } from '../lib/driver.js';
import { startGameServer } from '../lib/server.js';
import { installTestDeadline } from '../lib/deadline.js';

const clear=installTestDeadline('Red worm world integration',120000);
const server=await startGameServer({hmr:false});
const driver=new GameDriver(server,{headless:true,viewport:{width:1440,height:900},
  browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const out='test-results/red-worms/world';
await mkdir(out,{recursive:true});
try {
  await driver.launch();
  try { await driver.open(60000,'/index.html'); }
  catch(error) {
    console.error(JSON.stringify({console:driver.consoleErrors,page:driver.pageErrors,body:await driver.page!.locator('body').innerText()}));
    await driver.page!.screenshot({path:`${out}/boot.png`});throw error;
  }
  const page=driver.page!;
  const before=await page.evaluate(()=>{
    const debug=window.__gameDebug as any;
    const actors=debug.getEntities().filter((e:any)=>e.id.startsWith('coldbrace_red_worms_')).map((e:any)=>debug.getEntity(e.id));
    debug.inspectPose({x:-155,y:debug.groundHeight(-155,-129),z:-129,yaw:Math.PI,pitch:.32,distance:14});
    return actors;
  });
  assert.equal(before.length,8);
  await page.waitForTimeout(700);
  await page.screenshot({path:`${out}/worms-south-wall.png`});
  await page.mouse.click(950,650,{button:'right'});
  const positionBefore=await page.evaluate(()=>(window.__gameDebug as any).getPlayerPosition());
  await driver.press('w',600);
  const after=await page.evaluate(()=>{
    const debug=window.__gameDebug as any;
    const actors=debug.getEntities().filter((e:any)=>e.id.startsWith('coldbrace_red_worms_')).map((e:any)=>debug.getEntity(e.id));
    return {player:debug.getPlayerPosition(),camera:debug.getCamera(),actors:actors.map((a:any)=>({entity:a,
      bounds:debug.getDrawnBounds(a.id),motion:debug.getEntityMotion?.(a.id),
      ground:debug.groundHeight(a.position[0],a.position[2]),sample:debug.sampleWorld(a.position[0],a.position[2])})),errors:debug.getErrors()};
  });
  await writeFile(`${out}/report.json`,JSON.stringify({before,positionBefore,after},null,2));
  console.log(JSON.stringify({drawn:after.actors.map((a:any)=>({id:a.entity.id,bounds:a.bounds}))}));
  assert(Math.hypot(after.player.x-positionBefore.x,after.player.z-positionBefore.z)>.5);
  for(const {entity,ground,bounds} of after.actors) {
    assert.equal(entity.view.assetId,'creature_red_worm');
    assert.equal(entity.view.scale,9.6);
    assert(entity.position[2]<-111 && entity.position[2]>-130,'On the south-wall verge');
    assert(entity.position[0]>-154,'Clear of the gate approach');
    assert(Math.abs(entity.position[1]-ground)<.1,'Grounded actor');
    assert(bounds && bounds.height>.15 && bounds.height<.9,'Visible small worm');
  }
  assert.deepEqual(after.errors,[]);assert.deepEqual(driver.pageErrors,[]);assert.deepEqual(driver.consoleErrors,[]);
  await page.screenshot({path:`${out}/worms-after-walking.png`});
  console.log(JSON.stringify({passed:true,actors:after.actors.length,playerBefore:positionBefore,playerAfter:after.player}));
} finally {await driver.close();await server.close();clear();}
