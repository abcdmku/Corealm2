import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {GameDriver} from "./lib/driver.js";
import {argValue,repoRoot} from "./lib/paths.js";
import {installTestDeadline} from "./lib/deadline.js";
import {BASIC_ELEMENTAL_SPELL} from "../game/src/content/basicSpellVariants.js";
import {planElementalAttack} from "../game/src/systems/elementalAttacks.js";
import {CAMERA} from "../game/src/app/config.js";
import type {SpellElement,SpellRangeApi} from "../game/src/contracts.js";
declare global {interface Window {__spellRange?:SpellRangeApi}}
const element=(argValue(process.argv,"--element")??"water") as SpellElement;
const clear=installTestDeadline(`Basic variants: ${element}`,60000);
const server={url:argValue(process.argv,"--url")??"http://127.0.0.1:4178",close:async()=>{}};
const driver=new GameDriver(server,{viewport:{width:1440,height:1000},browserArgs:["--use-angle=d3d11","--enable-gpu","--ignore-gpu-blocklist","--mute-audio"]});
const out=path.join(repoRoot,"test-results/elemental-spells/basic-tiers",element);await mkdir(out,{recursive:true});
const evidence:unknown[]=[];
try{
  await driver.launch();await driver.open(30000,"/index.html?mode=combat&spells=1");const page=driver.page!;
  await page.waitForFunction(()=>!!window.__spellRange);
  await page.locator("#spell-range-select").selectOption(BASIC_ELEMENTAL_SPELL[element]);
  await page.locator("#spell-range-slow").check();
  const impactAt=planElementalAttack(BASIC_ELEMENTAL_SPELL[element],[0,0,0],[0,0,10])[0]!.at;
  let prior=0;
  for(const tier of ["lash","bolt","burst","surge"]){
    await page.locator("#spell-range-basic-tier").selectOption(tier);
    const before=await page.evaluate(()=>window.__spellRange!.getState());assert.equal(before.casting,false);
    await page.locator("#spell-range-cast").click();
    await page.waitForFunction(t=>window.__spellRange!.getState().elapsed>=t,impactAt*.34);
    const rising=await page.evaluate(()=>window.__spellRange!.getState());assert.equal(rising.damage,0);
    await page.screenshot({path:path.join(out,`${tier}-rising.png`)});
    await page.waitForFunction(t=>window.__spellRange!.getState().elapsed>=t,impactAt*.65);
    const flight=await page.evaluate(()=>window.__spellRange!.getState());assert.equal(flight.impacts,0);assert(flight.bodyCount>0);
    await page.screenshot({path:path.join(out,`${tier}-flight.png`)});
    await page.waitForFunction(t=>window.__spellRange!.getState().elapsed>=t,impactAt*.86);
    const falling=await page.evaluate(()=>window.__spellRange!.getState());assert.equal(falling.impacts,0);
    await page.screenshot({path:path.join(out,`${tier}-falling.png`)});
    await page.waitForFunction(()=>window.__spellRange!.getState().impacts===1);
    await page.waitForTimeout(120);const hit=await page.evaluate(()=>window.__spellRange!.getState());
    assert.equal(hit.basicTier,tier);assert.equal(hit.totalImpacts,1);assert.equal(hit.hits,1);assert(hit.damage>0);
    assert(Math.abs(hit.impactHeight-1.49565)<.0001);assert(hit.particleCount>prior);prior=hit.particleCount;
    assert.equal(hit.droppedParticles,0);assert.equal(hit.droppedBodies,0);
    const camera=await page.evaluate(()=>window.__gameDebug!.getCamera());
    assert.equal((camera as {freeMove:boolean}).freeMove,false);
    const pose=camera as {requestedDistance:number;pitch:number};
    assert(pose.requestedDistance>=CAMERA.minDistance&&pose.requestedDistance<=CAMERA.maxDistance);
    assert(pose.pitch>=CAMERA.minPitch&&pose.pitch<=CAMERA.maxPitch);
    await page.screenshot({path:path.join(out,`${tier}.png`)});evidence.push({tier,before,rising,flight,falling,hit,camera});
    await page.waitForFunction(()=>window.__spellRange!.getState().instances===0);
  }
  assert.deepEqual([...driver.consoleErrors,...driver.pageErrors],[]);
  await writeFile(path.join(out,"report.json"),JSON.stringify({passed:true,element,evidence,errors:[]},null,2));console.log(JSON.stringify({passed:true,element,output:out}));
}finally{await driver.close();clear();}
