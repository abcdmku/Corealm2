import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile,access} from 'node:fs/promises';
import {GameDriver} from './lib/driver.js';
import {startGameServer} from './lib/server.js';
import {JEWELRY_RECIPES,CRAFTED_JEWELRY} from '../game/src/content/jewelry.js';
import {MINIBOSS_JEWELLERY} from '../game/src/content/universalMinibossLoot.js';
import type {GameState} from '../game/src/state/store.js';
const world=process.argv.includes('--world');
const out=path.resolve('test-results/jewelry-browser'+(world?'-world':''));await mkdir(out,{recursive:true});
const server=await startGameServer();const driver=new GameDriver(server,{viewport:{width:1440,height:1000},browserArgs:['--enable-gpu','--ignore-gpu-blocklist','--mute-audio','--use-angle=d3d11']});
const report:Record<string,unknown>={};
try{
 await driver.launch();await driver.open(120000,world?'/':'/index.html?mode=combat&creatureLoot=1');const page=driver.page!;
 if(!world) await page.route('**/assets/icons/items/48/*.png',async route=>{const file=path.resolve('test-results/jewelry-icons/48',path.basename(new URL(route.request().url()).pathname));if(await access(file).then(()=>true).catch(()=>false))await route.fulfill({path:file,contentType:'image/png'});else await route.continue()});
 const start=page.locator('.title__action.btn--primary');if(await start.isVisible())await start.click();
 await page.locator('.dock__btn[data-panel="inventory"]').waitFor();
 if(!world){
  await page.evaluate(()=>{window.__featureLab!.setLevel('melee',99);window.__featureLab!.setLevel('magic',99);window.__featureLab!.setLevel('crafting',99);});
  for(const slot of ['accessory1','accessory2','ring2','earring2'] as const)await page.evaluate(async slot=>{await window.__featureLab!.equipPlayer(slot,null)},slot);
 }
 const save=async()=>JSON.parse(await driver.callDebug('getSaveBlob') as string) as GameState;
 const count=(s:GameState,id:string)=>s.inventory.slots.reduce((n,slot)=>n+(slot?.itemId===id?slot.quantity:0),0);
 await driver.callDebug('clearInventory');
 if(!world){
  const fixture=await page.evaluate(async()=>await (window as any).__creatureLootFixture.prepare());assert(fixture.ready);
  const station=await driver.callDebug('getEntity',[fixture.stationId]) as any;
  await driver.callDebug('teleport',[station.interactionPosition]);
  const recipes=[JEWELRY_RECIPES[0]!,JEWELRY_RECIPES.at(-1)!];
  const crafts=[];
  for(const recipe of recipes){
   for(const input of recipe.inputs)await driver.callDebug('giveItem',[input.itemId,input.quantity,'inventory']);
   const before=await save();
   const result=await driver.callDebug('callTool',['corealm_produce',{recipeId:recipe.id,stationId:fixture.stationId,quantity:1}]);
   await page.waitForFunction(id=>{const s=JSON.parse((window.__gameDebug as any).getSaveBlob());return s.inventory.slots.some((i:any)=>i?.itemId===id)},recipe.output.itemId,{timeout:12000});
   const after=await save();assert.equal(count(after,recipe.output.itemId)-count(before,recipe.output.itemId),1);
   for(const input of recipe.inputs)assert.equal(count(before,input.itemId)-count(after,input.itemId),input.quantity);
   crafts.push({recipe:recipe.id,before:before.inventory.slots,after:after.inventory.slots,result});
  }
  report.crafts=crafts;
 }
 await driver.callDebug('clearInventory');
 for(const [id,qty]of [['crafted_ring_t10',2],['crafted_earring_t40',1],['crafted_earring_t70',1]] as const)await driver.callDebug('giveItem',[id,qty,'inventory']);
 const lab=page.locator('#panel-feature-lab');if(await lab.isVisible())await lab.locator('.panel__close').click();
 if(!await page.locator('#panel-inventory').isVisible())await page.locator('.dock__btn[data-panel="inventory"]').click();
 if(world){
  const prepared=await save();
  for(const skill of ['melee','magic','crafting'] as const){prepared.skills[skill].level=99;prepared.skills[skill].xp=13034431;}
  await driver.callDebug('loadSaveBlob',[JSON.stringify(prepared)]);
 }
 const beforeEquip=await save();
 {
  for(const id of ['crafted_ring_t10','crafted_ring_t10','crafted_earring_t40','crafted_earring_t70']){
   await page.locator(`#panel-inventory .slot[data-item="${id}"]`).first().click();
  }
  await page.waitForFunction(()=>{const e=JSON.parse((window.__gameDebug as any).getSaveBlob()).equipment;return e.accessory1?.itemId==='crafted_ring_t10'&&e.ring2?.itemId==='crafted_ring_t10'&&e.accessory2?.itemId==='crafted_earring_t40'&&e.earring2?.itemId==='crafted_earring_t70'},undefined,{timeout:5000});
  report.equipment={before:beforeEquip.equipment,after:(await save()).equipment};
  await page.locator('.dock__btn[data-panel="equipment"]').click();
  await page.locator('#panel-equipment .panel__close').focus();
  await page.mouse.move(0,0);
  await page.waitForTimeout(250);
  await page.screenshot({path:path.join(out,'equipment.png')});
  await page.locator('#panel-equipment .panel__close').click();
 }
 if(!await page.locator('#panel-inventory').isVisible())await page.locator('.dock__btn[data-panel="inventory"]').click();
 // Every surviving icon must load through the production inventory raster path.
 const items=[...CRAFTED_JEWELRY,...MINIBOSS_JEWELLERY];
 for(let i=0;i<items.length;i+=24){
  await driver.callDebug('clearInventory');const batch=items.slice(i,i+24);
  for(const item of batch)await driver.callDebug('giveItem',[item.id,1,'inventory']);
  await page.waitForFunction(ids=>{const images=[...document.querySelectorAll<HTMLImageElement>('#panel-inventory .item-icon__raster')];return images.length===ids.length&&images.every(img=>img.complete&&img.naturalWidth===48)},batch.map(item=>item.id),{timeout:15000}).catch(async error=>{await writeFile(path.join(out,"failure.json"),JSON.stringify({batch:batch.map(i=>i.id),save:await save(),images:await page.locator("#panel-inventory .item-icon__raster").evaluateAll(imgs=>imgs.map(i=>({src:(i as HTMLImageElement).src,width:(i as HTMLImageElement).naturalWidth}))),errors:driver.consoleErrors}));throw error});
  if(i===0){await page.locator('#panel-inventory .slot').first().hover();await page.screenshot({path:path.join(out,'inventory.png'),timeout:5000});}
 }
 if(!world){
  for(const slot of ['accessory1','accessory2','ring2','earring2'] as const)await page.evaluate(async slot=>{await window.__featureLab!.equipPlayer(slot,null)},slot);
  const baseline=await page.evaluate(()=>window.__featureLab!.getState().equipmentTotals);
  const bonuses=[];
  for(const item of MINIBOSS_JEWELLERY){
   await driver.callDebug('clearInventory');await driver.callDebug('giveItem',[item.id,1,'inventory']);
   await page.locator(`#panel-inventory .slot[data-item="${item.id}"]`).first().click();
   const after=await page.evaluate(()=>window.__featureLab!.getState().equipmentTotals);
   for(const [stat,value] of Object.entries(item.equip!.bonuses))assert.equal(after[stat as keyof typeof after]-baseline[stat as keyof typeof baseline],value ? 2 : 0,`${item.id} ${stat}`);
   bonuses.push({id:item.id,before:baseline,after});
   await page.evaluate(async slot=>{await window.__featureLab!.equipPlayer(slot,null)},item.equip!.slot);
  }
  report.rareBonuses=bonuses;
 }
 report.icons=items.length;report.errors=driver.pageErrors;report.console=driver.consoleErrors;
 assert.deepEqual(driver.pageErrors,[]);assert.deepEqual(driver.consoleErrors,[]);
 await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log({passed:true,world,icons:items.length,out});
}finally{await driver.close();await server.close()}
