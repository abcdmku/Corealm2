import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {GameDriver} from './lib/driver.js';
import {startGameServer} from './lib/server.js';
import {installTestDeadline} from './lib/deadline.js';
const clear=installTestDeadline('Rune cost icons',60000);
const server=await startGameServer();
const driver=new GameDriver(server,{viewport:{width:1100,height:800},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const out='test-results/rune-costs';
/** The drawn icon of one slot: the audited 48px artwork every rune now uses, asserted loaded rather than merely requested.
 * Runes used to draw the carved `runeIcons.ts` SVG here, and this gate compared that markup and asserted no <img> at all.
 * `ui/itemIcons.ts: createItemIcon` ships raster artwork for every item, runes included, so the comparison is the source. */
const drawnIcon=async (scope:import('playwright').Locator)=>{
 const image=scope.locator('.item-icon__raster');await image.waitFor();
 const {src,ready}=await image.evaluate(node=>({src:(node as HTMLImageElement).getAttribute('src')??'',ready:node.parentElement?.classList.contains('is-raster-ready')===true&&!(node as HTMLImageElement).hidden}));
 assert(ready,`rune artwork never loaded: ${src}`);return src;
};
const ids=['air_essence','water_essence','earth_essence','fire_essence','mind_rune','chaos_rune','death_rune','blood_rune','wrath_rune','cosmic_rune'];
try {
 await mkdir(out,{recursive:true});await driver.launch();await driver.open(30000,'/index.html?mode=combat');const p=driver.page!;
 await p.evaluate(()=>window.__featureLab!.perform('open-bank'));
 await p.locator('#panel-bank').getByRole('button',{name:'Deposit all',exact:true}).click();
 await p.locator('#panel-bank .panel__close').click();
 await p.evaluate(async (ids)=>{const debug=window.__gameDebug as unknown as {giveItem(id:string,n:number,to:string):void};for(const id of ids){await debug.giveItem(id,32,'inventory');await debug.giveItem(id,20,'bank');}},ids);
 if(!await p.locator('#panel-inventory').isVisible()) await p.locator('.dock__btn[data-panel="inventory"]').click();
 const icons:Record<string,string>={};
 for(const id of ids){icons[id]=await drawnIcon(p.locator(`#panel-inventory [data-item="${id}"]`));assert.match(icons[id]!,new RegExp(`/icons/items/48/${id}\.png$`));}
 await p.mouse.move(500,250);await p.screenshot({path:`${out}/inventory.png`});
 await p.locator('.dock__btn[data-panel="spellbook"]').click();
 await p.waitForSelector('.spellbook__cell[data-spell]');
 const basics=await p.locator('.spellbook__cell[data-spell]').evaluateAll(cells=>cells.slice(0,4).map(c=>c.getAttribute('data-spell')!));
 for(let i=0;i<4;i++){
  await p.locator(`.spellbook__cell[data-spell="${basics[i]}"]`).hover();
  const cost=p.locator(`.tooltip:not([hidden]) .tooltip__rune-cost[data-rune="${ids[i]}"]`);await cost.waitFor();
  assert.equal(await drawnIcon(cost),icons[ids[i]!]);assert.match(await cost.textContent()??'',/1 .*Essence/);
 }
 await p.screenshot({path:`${out}/basic-hover.png`});
 const basic=p.locator(`.spellbook__cell[data-spell="${basics[3]}"]`);await basic.click();await p.waitForFunction(id=>document.querySelector(`.spellbook__cell[data-spell="${id}"]`)?.getAttribute('aria-pressed')==='true',basics[3]);
 await p.locator('.spellbook__cell[data-spell="deluge"]').hover();
 await p.waitForSelector('.tooltip:not([hidden]) [data-rune="cosmic_rune"]');assert.equal(await p.locator('.tooltip__rune-cost').count(),3);
 for(const id of ['water_essence','wrath_rune','cosmic_rune'])assert.equal(await drawnIcon(p.locator(`.tooltip__rune-cost[data-rune="${id}"]`)),icons[id]);
 await p.screenshot({path:`${out}/invocation-hover.png`});
 await p.evaluate(()=>window.__featureLab!.perform('open-bank'));
 await p.waitForSelector('#panel-bank:not([hidden])');
 for(const id of ids){const slots=p.locator(`#panel-bank [data-item="${id}"]`);assert.equal(await slots.count(),2);for(let slot=0;slot<2;slot++)assert.equal(await drawnIcon(slots.nth(slot)),icons[id]);}
 await p.mouse.move(500,740);await p.screenshot({path:`${out}/bank.png`});
 assert.deepEqual([...driver.pageErrors,...driver.consoleErrors],[]);
 await writeFile(`${out}/report.json`,JSON.stringify({passed:true,basicCosts:4,matchingInventoryAndBankIcons:ids,errors:[]},null,2));console.log(JSON.stringify({passed:true,out}));
}catch(error){await driver.page?.screenshot({path:`${out}/failure.png`});throw error;}finally{await driver.close();await server.close();clear();}
