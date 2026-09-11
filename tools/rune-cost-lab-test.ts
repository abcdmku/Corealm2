import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {GameDriver} from './lib/driver.js';
import {startGameServer} from './lib/server.js';
import {installTestDeadline} from './lib/deadline.js';
const clear=installTestDeadline('Rune cost icons',60000);
const server=await startGameServer();
const driver=new GameDriver(server,{viewport:{width:1100,height:800},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const out='test-results/rune-costs';
const ids=['air_essence','water_essence','earth_essence','fire_essence','mind_rune','chaos_rune','death_rune','blood_rune','wrath_rune','cosmic_rune'];
try {
 await mkdir(out,{recursive:true});await driver.launch();await driver.open(30000,'/index.html?mode=combat');const p=driver.page!;
 await p.evaluate(()=>window.__featureLab!.perform('open-bank'));
 await p.locator('#panel-bank').getByRole('button',{name:'Deposit all',exact:true}).click();
 await p.locator('#panel-bank .panel__close').click();
 await p.evaluate((ids)=>{const debug=window.__gameDebug as unknown as {giveItem(id:string,n:number,to:string):void};for(const id of ids){debug.giveItem(id,32,'inventory');debug.giveItem(id,20,'bank');}},ids);
 if(!await p.locator('#panel-inventory').isVisible()) await p.locator('.dock__btn[data-panel="inventory"]').click();
 const icons:Record<string,string>={};
 for(const id of ids){const icon=p.locator(`#panel-inventory [data-item="${id}"] .rune-icon`);await icon.waitFor();icons[id]=await icon.innerHTML();assert.equal(await p.locator(`#panel-inventory [data-item="${id}"] img`).count(),0);}
 await p.mouse.move(500,250);await p.screenshot({path:`${out}/inventory.png`});
 await p.locator('.dock__btn[data-panel="spellbook"]').click();
 await p.waitForSelector('.spellbook__cell[data-spell]');
 const basics=await p.locator('.spellbook__cell[data-spell]').evaluateAll(cells=>cells.slice(0,4).map(c=>c.getAttribute('data-spell')!));
 for(let i=0;i<4;i++){
  await p.locator(`.spellbook__cell[data-spell="${basics[i]}"]`).hover();
  const cost=p.locator(`.tooltip:not([hidden]) .tooltip__rune-cost[data-rune="${ids[i]}"]`);await cost.waitFor();
  assert.equal(await cost.locator('.rune-icon').innerHTML(),icons[ids[i]!]);assert.match(await cost.textContent()??'',/1 .*Essence/);
 }
 await p.screenshot({path:`${out}/basic-hover.png`});
 const basic=p.locator(`.spellbook__cell[data-spell="${basics[3]}"]`);await basic.click();await p.waitForFunction(id=>document.querySelector(`.spellbook__cell[data-spell="${id}"]`)?.getAttribute('aria-pressed')==='true',basics[3]);
 await p.locator('.spellbook__cell[data-spell="deluge"]').hover();
 await p.waitForSelector('.tooltip:not([hidden]) [data-rune="cosmic_rune"]');assert.equal(await p.locator('.tooltip__rune-cost').count(),3);
 for(const id of ['water_essence','wrath_rune','cosmic_rune'])assert.equal(await p.locator(`.tooltip__rune-cost[data-rune="${id}"] .rune-icon`).innerHTML(),icons[id]);
 await p.screenshot({path:`${out}/invocation-hover.png`});
 await p.evaluate(()=>window.__featureLab!.perform('open-bank'));
 await p.waitForSelector('#panel-bank:not([hidden])');
 for(const id of ids){const iconsInBank=p.locator(`#panel-bank [data-item="${id}"] .rune-icon`);assert.equal(await iconsInBank.count(),2);for(const icon of await iconsInBank.all())assert.equal(await icon.innerHTML(),icons[id]);}
 await p.mouse.move(500,740);await p.screenshot({path:`${out}/bank.png`});
 assert.deepEqual([...driver.pageErrors,...driver.consoleErrors],[]);
 await writeFile(`${out}/report.json`,JSON.stringify({passed:true,basicCosts:4,matchingInventoryAndBankIcons:ids,errors:[]},null,2));console.log(JSON.stringify({passed:true,out}));
}catch(error){await driver.page?.screenshot({path:`${out}/failure.png`});throw error;}finally{await driver.close();await server.close();clear();}
