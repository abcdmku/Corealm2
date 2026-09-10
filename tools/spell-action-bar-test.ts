import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {GameDriver} from "./lib/driver.js";
import {argValue,repoRoot} from "./lib/paths.js";
import {installTestDeadline} from "./lib/deadline.js";
import type {SpellRangeApi} from "../game/src/contracts.js";
declare global {interface Window {__spellRange?:SpellRangeApi}}
/**
 * The spell range's action bars: slots, keys, drag-to-bind, docking, the ground reticle for area
 * invocations, the cast lock, and persistence across a reload.
 */
const clear=installTestDeadline("Spell action bars",90000);
const server={url:argValue(process.argv,"--url")??"http://127.0.0.1:4178",close:async()=>{}};
const driver=new GameDriver(server,{viewport:{width:1440,height:1000},browserArgs:["--use-angle=d3d11","--enable-gpu","--ignore-gpu-blocklist","--mute-audio"]});
const out=path.join(repoRoot,"test-results/elemental-spells/action-bar");await mkdir(out,{recursive:true});
try{
  await driver.launch();await driver.open(30000,"/index.html?mode=combat&spells=1");const page=driver.page!;
  await page.waitForFunction(()=>!!window.__spellRange);
  const state=()=>page.evaluate(()=>window.__spellRange!.getState());
  await page.evaluate(()=>localStorage.removeItem("corealm.action-bars.lab.v2"));
  await page.reload();await page.waitForFunction(()=>!!window.__spellRange);

  // Three bars by default in the lab, eight slots each, the first docked at the bottom.
  const initial=await state();
  assert.equal(initial.actionBar!.bars,3);assert.equal(initial.actionBar!.dock,"bottom");assert.equal(initial.actionBar!.slots.length,8);
  assert.equal(initial.actionBar!.slots[0],"air-needle");
  assert.equal(await page.locator(".abar:not([hidden])").count(),3);
  assert.equal(await page.locator(".abar:not([hidden]) .abar__slot:not(.is-empty)").count(),24);
  await page.screenshot({path:path.join(out,"default-bars.png")});

  // A targeted invocation fires at once from its slot and locks the bar until it resolves.
  await page.locator("#spell-range-select").selectOption("starfall");
  const before=await state();
  await page.locator('.abar[data-bar="0"] .abar__slot[data-slot="0"]').click();
  await page.waitForFunction(()=>window.__spellRange!.getState().impacts===1);
  const hit=await state();assert.equal(hit.selected,"air-needle");assert(hit.damage>0);assert.equal(hit.castId,before.castId+1);
  assert.equal(hit.actionBar!.busy,true);
  assert(await page.locator('.abar[data-bar="0"] .abar__slot[data-slot="0"].is-casting').count()===1);
  await page.waitForFunction(()=>!window.__spellRange!.getState().casting);
  assert.equal((await state()).actionBar!.busy,false);

  // Keys: 1-8 drive bar one, Shift+digit bar two, Alt+digit bar three.
  await page.locator("#viewport").focus();await page.keyboard.press("6");
  await page.waitForFunction(()=>window.__spellRange!.getState().casting);
  assert.equal((await state()).selected,"waterjet");
  await page.locator("#spell-range-reset").click();await page.waitForFunction(()=>!window.__spellRange!.getState().casting&&!window.__spellRange!.getState().actionBar!.busy);
  await page.keyboard.press("Alt+5");
  await page.waitForFunction(()=>window.__spellRange!.getState().casting);
  assert.equal((await state()).selected,"breeze-puff","a basic slot casts its element's basic at the slot's rung");
  assert.equal((await state()).basicTier,"lash");
  await page.locator("#spell-range-reset").click();await page.waitForFunction(()=>!window.__spellRange!.getState().actionBar!.busy);

  // An area invocation opens the ground reticle instead of casting; a click on the ground places it.
  await page.keyboard.press("5");
  await page.waitForFunction(()=>window.__spellRange!.aiming()==="skybreaker");
  assert.equal((await state()).casting,false,"pressing an area slot does not cast until placed");
  const reticleShown=await page.evaluate(()=>{
    const debug=window.__gameDebug as unknown as {getScene?():{getObjectByName(name:string):{visible:boolean}|undefined}};
    return debug.getScene?.()?.getObjectByName("aim-reticle")?.visible??null;
  });
  if(reticleShown!==null)assert.equal(reticleShown,true);
  const view=(await page.locator("#viewport").boundingBox())!;
  // Near the dummies: the ring is in range and wears the element colour.
  await page.mouse.move(view.x+view.width*.5,view.y+view.height*.5,{steps:4});await page.waitForTimeout(200);
  await page.screenshot({path:path.join(out,"aiming.png")});
  // Far up the field: past 15 m the ring turns red and a click is refused, so aiming continues.
  await page.mouse.move(view.x+view.width*.62,view.y+view.height*.28,{steps:4});await page.waitForTimeout(200);
  await page.screenshot({path:path.join(out,"aiming-out-of-range.png")});
  await page.mouse.click(view.x+view.width*.62,view.y+view.height*.28);await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>window.__spellRange!.aiming()),"skybreaker","an out-of-range click keeps aiming");
  assert.equal((await state()).casting,false);
  await page.keyboard.press("Escape");
  await page.waitForFunction(()=>window.__spellRange!.aiming()===null);
  await page.keyboard.press("Shift+2");
  await page.waitForFunction(()=>window.__spellRange!.aiming()==="deluge");
  const box=(await page.locator("#viewport").boundingBox())!;
  // Click near the centre of the view, where the range's dummies stand.
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.52);await page.waitForTimeout(120);
  await page.mouse.click(box.x+box.width*.5,box.y+box.height*.52);
  await page.waitForFunction(()=>window.__spellRange!.getState().casting||window.__spellRange!.getState().castId>0,undefined,{timeout:5000});
  await page.waitForFunction(()=>window.__spellRange!.aiming()===null);
  const placed=await state();assert.equal(placed.selected,"deluge");assert(placed.casting);
  await page.screenshot({path:path.join(out,"placed-deluge.png")});
  await page.waitForFunction(()=>!window.__spellRange!.getState().casting,undefined,{timeout:12000});

  // Right-click clears a slot, and dragging a spellbook-style payload binds one.
  await page.locator('.abar[data-bar="0"] .abar__slot[data-slot="7"]').click({button:"right"});
  assert.equal((await state()).actionBar!.slots[7],null);
  await page.evaluate(()=>{
    const target=document.querySelector<HTMLElement>('.abar[data-bar="0"] .abar__slot[data-slot="7"]')!;
    const data=new DataTransfer();data.setData("text/x-corealm-spell",JSON.stringify({id:"kilnsurge"}));
    target.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:data}));
    target.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:data}));
  });
  assert.equal((await state()).actionBar!.slots[7],"kilnsurge");

  // Docking through the options menu, then free dragging by the grip, then persistence.
  await page.locator('.abar[data-bar="0"] .abar__menu').click();
  await page.getByRole("menuitem",{name:"Dock right"}).click();
  const docked=await state();assert.equal(docked.actionBar!.dock,"right");assert.equal(docked.actionBar!.vertical,true);
  await page.screenshot({path:path.join(out,"right-dock.png")});
  const grip=page.locator('.abar[data-bar="0"] .abar__grip'),rect=(await grip.boundingBox())!;
  // Away from the bottom bars and the lab panel, so the moved bar overlaps nothing.
  await page.mouse.move(rect.x+5,rect.y+5);await page.mouse.down();await page.mouse.move(900,320,{steps:12});await page.mouse.up();
  const dragged=await state();assert.equal(dragged.actionBar!.dock,"free");assert(dragged.actionBar!.x>800&&dragged.actionBar!.x<1000,`dragged x ${dragged.actionBar!.x}`);
  await page.locator('.abar[data-bar="0"] .abar__menu').click();
  await page.getByRole("menuitem",{name:"Hide bar 3"}).click().catch(()=>{});
  await page.reload();await page.waitForFunction(()=>!!window.__spellRange);
  const restored=await state();assert.equal(restored.actionBar!.dock,"free");assert(Math.abs(restored.actionBar!.x-dragged.actionBar!.x)<2);
  assert.equal(restored.actionBar!.slots[7],"kilnsurge");
  await page.setViewportSize({width:900,height:700});
  const bar=await page.locator('.abar[data-bar="0"]').boundingBox();assert(bar&&bar.x>=0&&bar.y>=0&&bar.x+bar.width<=900&&bar.y+bar.height<=700);
  await page.screenshot({path:path.join(out,"small-viewport.png")});
  assert.deepEqual([...driver.consoleErrors,...driver.pageErrors],[]);
  await writeFile(path.join(out,"report.json"),JSON.stringify({passed:true,initial,hit,placed,docked,dragged,restored,errors:[]},null,2));
  console.log(JSON.stringify({passed:true,output:out}));
}finally{await driver.close();clear();}
