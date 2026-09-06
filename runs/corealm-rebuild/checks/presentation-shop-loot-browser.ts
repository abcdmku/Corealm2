import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameDriver } from "../../../tools/lib/driver.js";
import { installTestDeadline } from "../../../tools/lib/deadline.js";
import { assertGameplayHardware, GAMEPLAY_HARDWARE_ARGS } from "./finish-gameplay-renderer.js";

// Root schedules GPU access. Saved pile contents are declared setup; transfer and feedback
// must come from real loot-grid clicks. Natural boss generation is separately covered by QA.
const out = `test-results/presentation-shop-loot/${Date.now()}`;
await mkdir(out, {recursive:true});
const finish = installTestDeadline("Presentation shop and loot",59000);
const driver = new GameDriver({url:process.env.COREALM_URL ?? "http://127.0.0.1:4175",close:async()=>{}},
  {headless:true,browserArgs:GAMEPLAY_HARDWARE_ARGS});
const report:Record<string,unknown>={passed:false,setup:"Authored shop approach; imported five-stack boss receipt fixture; real production loot-grid clicks."};
try {
  await driver.launch();
  await driver.open(24000,"/index.html?mode=combat&shop=1");
  const page=driver.page!;page.setDefaultTimeout(4000);
  report.renderer=await assertGameplayHardware(page);
  await page.locator("#panel-feature-lab .panel__close").click();
  for(const [width,height] of [[1280,720],[800,600]]) {
    await page.setViewportSize({width:width!,height:height!});
    await page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    await page.evaluate("if(!window.__gameDebug.teleport(window.__shopLab.interactionPosition)) throw new Error('Shop approach failed');window.__gameDebug.openShop(window.__shopLab.shopId)");
    const shop=page.locator("#panel-shop");await shop.waitFor({state:"visible"});
    await shop.locator(".shop-row").first().waitFor({state:"visible"});
    assert(!/out of range|too far away/i.test(await shop.innerText()));
    assert(await shop.getByRole("button",{name:"Buy",exact:true}).count()>0);
    await page.screenshot({path:`${out}/shop-${width}x${height}.png`});
    await page.keyboard.press("Escape");
    await page.keyboard.press("b");
    await page.locator("#panel-spellbook").waitFor({state:"visible"});
    await page.screenshot({path:`${out}/spellbook-${width}x${height}.png`});
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({width:1280,height:720});
  await page.evaluate(`(() => {
    const debug=window.__gameDebug; const state=JSON.parse(debug.getSaveBlob());
    state.inventory.slots=state.inventory.slots.map(()=>null);
    const p=state.player.position;
    state.world.lootPiles.presentation_receipt_fixture={position:[p[0],p[1],p[2]],
      items:[{itemId:'water_orb',quantity:1},{itemId:'kaldite_sword',quantity:1},
        {itemId:'kaldite_bar',quantity:6},{itemId:'cairn_garnet',quantity:3},{itemId:'cairn_pelt',quantity:2}],
      expiresAtMs:1e12,ownerOnly:true};
    debug.loadSaveBlob(JSON.stringify(state));
  })()`);
  report.interaction=await driver.callDebug("callTool",["corealm_interact",{entityId:"presentation_receipt_fixture",interaction:"loot"}]);
  const cells=page.locator(".loot-reveal:not([hidden]) .loot-reveal__slot");
  await cells.first().waitFor({state:"visible"});
  for(let i=0;i<5;i++) await cells.first().click();
  report.inventory=await page.evaluate("JSON.parse(window.__gameDebug.getSaveBlob()).inventory");
  report.remainingPile=await page.evaluate("JSON.parse(window.__gameDebug.getSaveBlob()).world.lootPiles.presentation_receipt_fixture ?? null");
  // Transfers happen in the click handler; their events flush at the next simulation tick.
  // Two animation frames alone do not guarantee a published receipt.
  await page.waitForFunction("Array.from(document.querySelectorAll('.vfx-xp')).some(element=>element.textContent==='+2 Fur Pelt')",undefined,{timeout:1000});
  await page.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const receipts=await page.locator(".vfx-xp:visible").evaluateAll(elements=>elements.map(element=>{
    const r=element.getBoundingClientRect();return {text:element.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom};
  }));
  report.receipts=receipts;
  assert(receipts.some(r=>r.text==="+1 Cobalt Sword"));assert(receipts.some(r=>r.text==="+3 Garnet"));
  assert(receipts.some(r=>r.text==="+2 Fur Pelt"),"Final stack remains visible after its pile is removed");
  assert(!receipts.some(r=>/Kaldite|Cairn garnet/.test(r.text??"")));
  assert.equal(receipts.length,5);
  for(let i=0;i<receipts.length;i++) for(let j=i+1;j<receipts.length;j++) {
    const a=receipts[i]!,b=receipts[j]!;
    assert(!(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top),`Receipt overlap ${a.text}/${b.text}`);
  }
  await page.screenshot({path:`${out}/production-loot-receipts.png`});
  assert.equal(report.remainingPile,null);
  const slots=(report.inventory as {slots:Array<{itemId:string;quantity:number}|null>}).slots;
  for(const [id,quantity] of [["water_orb",1],["kaldite_sword",1],["kaldite_bar",6],["cairn_garnet",3],["cairn_pelt",2]] as const) {
    assert.equal(slots.reduce((sum,slot)=>sum+(slot?.itemId===id?slot.quantity:0),0),quantity);
  }
  await page.waitForFunction("document.querySelectorAll('.vfx-xp').length===0");
  assert.deepEqual(driver.pageErrors,[]);assert.deepEqual(driver.consoleErrors,[]);
  report.passed=true;
} catch(error) {
  report.error=String(error);
  report.events=await driver.page?.evaluate("window.__gameDebug.getEvents(0)");
  report.allReceipts=await driver.page?.locator(".vfx-xp").evaluateAll(elements=>elements.map(e=>({text:e.textContent,style:e.getAttribute('style')})));
  await driver.page?.screenshot({path:`${out}/failure.png`});throw error;
} finally {
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await driver.close();finish();
}
