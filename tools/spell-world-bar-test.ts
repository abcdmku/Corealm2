import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {GameDriver} from "./lib/driver.js";
import {argValue,repoRoot} from "./lib/paths.js";
import {installTestDeadline} from "./lib/deadline.js";
/**
 * The world's spellbook and action bars through production paths: the ordinary combat lab with a
 * real creature, real Essence and runes, `GameApi` casts, and the ground reticle for an area
 * invocation. Damage, cast lock and rune spend are read back from the semantic state.
 */
const clear=installTestDeadline("World spell action bar",120000);
const server={url:argValue(process.argv,"--url")??"http://127.0.0.1:4178",close:async()=>{}};
const driver=new GameDriver(server,{viewport:{width:1440,height:1000},browserArgs:["--use-angle=d3d11","--enable-gpu","--ignore-gpu-blocklist","--mute-audio"]});
const out=path.join(repoRoot,"test-results/elemental-spells/world-bar");await mkdir(out,{recursive:true});
interface Debug {giveItem(id:string,quantity:number,to?:"inventory"|"bank"):unknown;getBasicSpellState():{spellId:string;particles:number}[]}
try{
  await driver.launch();await driver.open(30000,"/index.html?mode=combat");const page=driver.page!;
  await page.waitForFunction(()=>window.__featureLab?.getState().ready);
  await page.evaluate(()=>localStorage.removeItem("corealm.action-bars.v2"));
  await page.evaluate(async()=>{
    const lab=window.__featureLab!;for(const skill of ["magic","melee"] as const)lab.setLevel(skill,99);
    await lab.equipPlayer("offHand",null);await lab.equipPlayer("mainHand","basic_wooden_staff");
    await lab.equipPlayer("body","marchhide_robe");lab.setFreeCameraEnabled(false);
    const debug=window.__gameDebug as unknown as Debug;
    for(const [id,n] of [["fire_essence",40],["air_essence",40],["water_essence",40],["mind_rune",5],["chaos_rune",5],["death_rune",5],["blood_rune",5],["wrath_rune",5],["cosmic_rune",10]] as const)debug.giveItem(id,n,"inventory");
  });
  const api=()=>page.evaluate(()=>window.__featureLab!.getState());
  // The world bar mounts with the four entry spells and answers the spellbook's rows.
  assert.equal(await page.locator(".abar:not([hidden])").count(),1);
  // Through the dock button, not the B key: in the lab the B key is the building-mode switch.
  await page.locator('.dock__btn[data-panel="spellbook"]').click();
  await page.waitForSelector("#panel-spellbook .spellbook__cell[data-spell]");
  const basicTiles=await page.locator("#panel-spellbook .spellbook__cell[data-spell]:visible").count();
  assert.equal(basicTiles,36,"the full spellbook is visible without tabs");
  assert.equal(await page.locator(".spellbook__filter").count(),0);
  assert.equal(await page.locator("#panel-spellbook .spellbook__runes").count(),0,"no redundant rune shelf");
  assert.equal(await page.locator(".spellbook__cell .rune-icon").count(),0,"costs only appear on hover");
  await page.mouse.move(700,400);
  await page.screenshot({path:path.join(out,"spellbook-all.png")});
  await page.locator('.spellbook__cell[data-spell="deluge"]').hover();
  await page.waitForSelector('.tooltip:not([hidden]) .tooltip__rune-cost');
  assert.equal(await page.locator('.tooltip__rune-cost').count(),3);
  await page.screenshot({path:path.join(out,"rune-hover.png")});

  // Drag Sunfall from the book onto slot 5, then a targeted invocation onto slot 6.
  // No inner named functions in an evaluate body: tsx's keep-names helper does not exist in the page.
  await page.evaluate(()=>{
    for(const [id,slot] of [["starfall",4],["ember-dart",5],["deluge",6]] as const){
      const target=document.querySelector<HTMLElement>(`.abar[data-bar="0"] .abar__slot[data-slot="${slot}"]`)!;
      const data=new DataTransfer();data.setData("text/x-corealm-spell",JSON.stringify({id}));
      target.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:data}));
      target.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:data}));
    }
  });
  assert.equal(await page.locator('.abar[data-bar="0"] .abar__slot[data-slot="4"][data-spell="starfall"]').count(),1);
  await page.locator('.dock__btn[data-panel="spellbook"]').click();

  // Slot 4 (Emberlash) sets the standing spell; the engagement casts it through the basics path.
  // Cattle, not the default frog: at Magic 99 a frog dies to the first Emberlash, and a dead target
  // ends the engagement before the queued invocation gets its beat.
  await page.evaluate(async()=>{const lab=window.__featureLab!;await lab.perform("reset-player");await lab.spawnTarget("creature","redsill_cattle",{distance:9});});
  await page.locator('.abar[data-bar="0"] .abar__slot[data-slot="3"]').click();
  await page.waitForFunction(()=>document.querySelector('.abar[data-bar="0"] .abar__slot[data-slot="3"].is-selected')!==null);
  const before=await api();
  await page.evaluate(()=>window.__featureLab!.perform("attack"));
  await page.waitForFunction(count=>window.__featureLab!.getState().counters.spellLaunched>count,before.counters.spellLaunched,{timeout:15000});
  assert.equal((await api()).spellId,"emberlash");

  // Slot 6 (Ember dart) is a targeted invocation: one cast, the Mind Rune spent, the lock shown.
  const launched=(await api()).counters.spellLaunched;
  await page.locator('.abar[data-bar="0"] .abar__slot[data-slot="5"]').click();
  await page.waitForFunction(count=>window.__featureLab!.getState().counters.spellLaunched>count,launched,{timeout:15000});
  await page.waitForFunction(()=>document.querySelector('.abar[data-bar="0"] .abar__slot[data-slot="5"].is-casting')!==null,undefined,{timeout:5000});
  await page.screenshot({path:path.join(out,"ember-dart-lock.png")});
  // Read live inventory amounts from each spell's hover card.
  const carried=async(id:string):Promise<number>=>{
    if(!(await page.locator("#panel-spellbook").isVisible())) await page.locator('.dock__btn[data-panel="spellbook"]').click();
    await page.locator(`.spellbook__cell[data-spell="${id === 'mind_rune' ? 'ember-dart' : 'deluge'}"]`).hover();
    await page.waitForSelector(`.tooltip:not([hidden]) .tooltip__rune-cost[data-rune="${id}"]`);
    return Number(await page.locator(`.tooltip__rune-cost[data-rune="${id}"]`).getAttribute("data-carried"));
  };
  const mindLeft=await carried("mind_rune");
  assert.equal(mindLeft,4,"one Mind Rune spent");

  // Slot 7 (Deluge) opens the ground reticle; a click on the ground casts it and spends both runes.
  await page.waitForFunction(()=>document.querySelector(".abar.is-busy")===null,undefined,{timeout:12000});
  await page.locator('.abar[data-bar="0"] .abar__slot[data-slot="6"]').click();
  await page.waitForFunction(()=>document.body.classList.contains("is-aiming"));
  const box=(await page.locator("#viewport").boundingBox())!;
  // A few metres in front of the caster, well inside the 15 m range from this camera.
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.62);await page.waitForTimeout(150);
  await page.screenshot({path:path.join(out,"deluge-aim.png")});
  const launchedArea=(await api()).counters.spellLaunched;
  await page.mouse.click(box.x+box.width*.5,box.y+box.height*.62);
  await page.waitForFunction(count=>window.__featureLab!.getState().counters.spellLaunched>count,launchedArea,{timeout:5000}).catch(async()=>{
    const log=await page.locator(".msglog").textContent();throw new Error(`Deluge did not launch from the placing click. Message log: ${log}`);
  });
  await page.waitForFunction(()=>!document.body.classList.contains("is-aiming"));
  await page.waitForTimeout(2600);
  await page.screenshot({path:path.join(out,"deluge-world.png")});
  const runes={wrath:await carried("wrath_rune"),cosmic:await carried("cosmic_rune")};
  assert.deepEqual(runes,{wrath:4,cosmic:9},"Deluge, a finale, spends its Wrath Rune and a Cosmic Rune");
  await page.waitForFunction(()=>window.__featureLab!.getState().liveSpellParticles>0,undefined,{timeout:8000}).catch(()=>{});
  await page.waitForFunction(()=>document.querySelector(".abar.is-busy")===null,undefined,{timeout:12000});
  assert.deepEqual([...driver.consoleErrors,...driver.pageErrors],[]);
  await writeFile(path.join(out,"report.json"),JSON.stringify({passed:true,basicTiles,mindLeft,runes,errors:[]},null,2));
  console.log(JSON.stringify({passed:true,output:out}));
}finally{await driver.close();clear();}
