import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {GameDriver} from "./lib/driver.js";
import {argValue,repoRoot} from "./lib/paths.js";
import {installTestDeadline} from "./lib/deadline.js";
const clear=installTestDeadline("Basic spell combat integration",60000);
const server={url:argValue(process.argv,"--url")??"http://127.0.0.1:4178",close:async()=>{}};
const driver=new GameDriver(server,{viewport:{width:1440,height:1000},browserArgs:["--use-angle=d3d11","--enable-gpu","--ignore-gpu-blocklist","--mute-audio"]});
const out=path.join(repoRoot,"test-results/elemental-spells/basic-combat");await mkdir(out,{recursive:true});
const evidence:unknown[]=[];
try{
  await driver.launch();await driver.open(30000,"/index.html?mode=combat");const page=driver.page!;
  await page.waitForFunction(()=>window.__featureLab?.getState().ready);
  const preset=await page.evaluate(()=>window.__featureLab!.getState().target!.presetId);
  await page.evaluate(async()=>{
    const lab=window.__featureLab!;for(const skill of ["magic","melee"] as const)lab.setLevel(skill,99);
    await lab.equipPlayer("offHand",null);await lab.equipPlayer("mainHand","basic_wooden_staff");
    await lab.equipPlayer("body","marchhide_robe");lab.setFreeCameraEnabled(false);
  });
  for(const spell of ["squallsurge","tidesurge","scarpsurge","kilnsurge"] as const){
    const before=await page.evaluate(async({preset,spell})=>{const lab=window.__featureLab!;
      await lab.perform("reset-player");await lab.spawnTarget("creature",spell==="scarpsurge"?"redsill_cattle":preset,{distance:10});lab.setSpell(spell);return lab.getState();},{preset,spell});
    await page.evaluate(()=>window.__featureLab!.perform("cast"));
    await page.waitForFunction(({count,element})=>{
      const debug=window.__gameDebug as unknown as {getBasicSpellState():{element:string;particles:number}[]};
      return window.__featureLab!.getState().counters.spellLaunched>count&&debug.getBasicSpellState().some(s=>s.element===element&&s.particles>200);
    },{count:before.counters.spellLaunched,element:spell==="squallsurge"?"wind":spell==="tidesurge"?"water":spell==="scarpsurge"?"earth":"fire"});
    const during=await page.evaluate(()=>{
      const debug=window.__gameDebug as unknown as {getBasicSpellState():{impactHeight:number;size:number;dropped:number}[];getDrawnBounds(id:string):{min:{y:number};max:{y:number}};getCamera():unknown};
      const state=window.__featureLab!.getState();return {state,vfx:debug.getBasicSpellState(),bounds:debug.getDrawnBounds(state.target!.entityId),camera:debug.getCamera()};
    });
    assert(during.vfx.length>0);assert.equal(during.vfx[0]!.size,1.8);assert(during.vfx.every(v=>v.dropped===0));
    assert(during.bounds);const height= during.bounds.max.y-during.bounds.min.y;
    assert(Math.abs(during.vfx[0]!.impactHeight-height*.75)<Math.max(.06,height*.15),"Spell tracks scaled upper-body height");
    await page.screenshot({path:path.join(out,`${spell}.png`)});
    await page.waitForFunction(h=>window.__featureLab!.getState().target!.health!<h,before.target!.health!,{timeout:11000});
    const after=await page.evaluate(()=>window.__featureLab!.getState());assert(after.counters.spellLaunched>before.counters.spellLaunched);
    evidence.push({spell,before,during,after});await page.evaluate(()=>window.__featureLab!.perform("reset-player"));
    await page.waitForFunction(()=>window.__featureLab!.getState().liveSpellParticles===0);
  }
  await page.waitForFunction(()=>window.__featureLab!.getState().liveSpellParticles===0);
  assert.deepEqual([...driver.consoleErrors,...driver.pageErrors],[]);
  await writeFile(path.join(out,"report.json"),JSON.stringify({passed:true,evidence,errors:[]},null,2));console.log(JSON.stringify({passed:true,output:out}));
}finally{await driver.close();clear();}
