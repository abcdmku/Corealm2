import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {GameDriver} from './lib/driver.js';import {startGameServer} from './lib/server.js';
const out='test-results/wilderness-foliage';await mkdir(out,{recursive:true});
const server=await startGameServer(),driver=new GameDriver(server,{viewport:{width:1440,height:900},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
try{await driver.launch();await driver.open(60000,'/index.html?mode=combat&environment=1&atmosphere=1');const page=driver.page!;
 await page.getByRole('button',{name:'Close Feature lab',exact:true}).click();await page.getByLabel('Biome atmosphere',{exact:true}).selectOption('wilderness');
 await page.evaluate(async()=>{await (window as any).__environmentLab.showFoliage('corealm_deadwood_1',{layout:'grid',count:12,span:32,variants:['corealm_deadwood_1','corealm_deadwood_2']});(window.__gameDebug as any).inspectPose({x:0,y:2,z:25,yaw:.25,pitch:.17,distance:30,detached:true});});
 await page.waitForTimeout(1500);const state=await page.evaluate(()=>(window as any).__environmentLab.getState());assert(state.ready&&state.foliage.count===12);
 await page.screenshot({path:`${out}/deadwood-night.png`});await writeFile(`${out}/state.json`,JSON.stringify(state,null,2));
 assert.deepEqual(driver.consoleErrors,[]);assert.deepEqual(driver.pageErrors,[]);
}finally{await driver.close();await server.close();}
