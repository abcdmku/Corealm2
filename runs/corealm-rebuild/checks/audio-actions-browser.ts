import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {GameDriver,FAST_TEST_SETTINGS} from "../../../tools/lib/driver.js";
import {installTestDeadline} from "../../../tools/lib/deadline.js";
import {assertGameplayHardware} from "./finish-gameplay-renderer.js";
import {installAudioCapture,startAudioCapture,stopAudioCapture} from "./audio-capture-support.js";
const index=process.argv.indexOf("--case");const scenario=index<0?"combat":process.argv[index+1];
assert(["combat","spell","death","travel"].includes(scenario!));
const out=`test-results/audio-actions/${scenario}-${Date.now()}`;await mkdir(out,{recursive:true});
const finish=installTestDeadline(`Audio ${scenario}`,59000);
const report:Record<string,unknown>={passed:false,scenario,scope:"Production actions and decoded mix; diagnostic actor/loadout/approach setup. Listening quality not inferred."};
const driver=new GameDriver({url:process.env.COREALM_URL??"http://127.0.0.1:4175",close:async()=>{}},
  {headless:true,browserArgs:["--use-angle=d3d11","--enable-gpu","--ignore-gpu-blocklist","--autoplay-policy=no-user-gesture-required"],
    settings:{...FAST_TEST_SETTINGS,music:0.3,ambient:0.5,sfx:0.9}});
try{
  await driver.launch();const page=driver.page!;page.setDefaultTimeout(4000);await installAudioCapture(page);
  await driver.open(24000,`/index.html?mode=combat${scenario==='travel'?'&portal=1':''}`);
  report.renderer=await assertGameplayHardware(page);await page.locator("#panel-feature-lab .panel__close").click();
  if(scenario!=="travel")await page.evaluate(`(async()=>{
    const lab=window.__featureLab;const preset=lab.getCatalog().targets.creature.find(p=>/Brown Bear/.test(p.label));
    if(!preset)throw new Error('Authored Brown Bear preset missing');
    await lab.spawnTarget('creature',preset.id,{distance:${scenario==='spell'?6:2}});
    lab.setLevel('melee',${scenario==='death'?1:99});lab.setLevel('magic',1);
    await lab.equipPlayer('mainHand',${scenario==='spell'?'"air_staff"':scenario==='death'?'"worn_sword"':'"kaldite_sword"'});
    if(${JSON.stringify(scenario)}==='spell')lab.setSpell('voltrend');
  })()`);
  await startAudioCapture(page);report.before=await driver.callDebug("getSaveBlob",[]);
  if(scenario==='death')await driver.callDebug('setHealth',[1]);
  if(scenario==="travel"){
    const snapshots:unknown[]=[];
    for(const [id,region,ambient] of [["lab:portal:entry","gravelmaw","ambient.cave"],["lab:portal:exit","fallowmarch","ambient.open-plains"]]){
      await page.evaluate(`(() => {const d=window.__gameDebug;const p=d.getEntity(${JSON.stringify(id)}).interactionPosition;if(!d.teleport(p))throw new Error('Portal approach failed')})()`);
      snapshots.push(await driver.callDebug("callTool",["corealm_interact",{entityId:id,interaction:"enter"}]));
      await page.waitForFunction(`window.__gameDebug.getPlayer().regionId===${JSON.stringify(region)}`,undefined,{timeout:9000});
      await page.waitForFunction(`(() => {const s=window.__gameDebug.getAudioState();return s.activeLoops.includes(${JSON.stringify(ambient)})&&!s.activeLoops.includes(${JSON.stringify(region==='gravelmaw'?'ambient.open-plains':'ambient.cave')})})()`,undefined,{timeout:6000});
      snapshots.push(await driver.callDebug("getAudioState",[]));
    }report.travel=snapshots;
  }else{
    report.action=await page.evaluate(`window.__featureLab.perform(${JSON.stringify(scenario==='spell'?'cast':'attack')})`);
    const cue=scenario==='spell'?'combat.magic_hit':scenario==='death'?'combat.player_death':'combat.melee_hit';
    await page.waitForFunction(`window.__gameDebug.getAudioHistory().some(e=>e.cue===${JSON.stringify(cue)})`,undefined,{timeout:20000});
    if(scenario==='death'){
      assert.equal(await page.evaluate("JSON.parse(window.__gameDebug.getSaveBlob()).player.health"),0);
      await page.waitForTimeout(2000);
    }else{await driver.callDebug("callTool",["corealm_stop",{}]);await page.waitForTimeout(250)}
  }
  report.after=await driver.callDebug("getSaveBlob",[]);report.history=await driver.callDebug("getAudioHistory",[]);
  report.audio=await driver.callDebug("getAudioState",[]);report.events=await driver.callDebug("getEvents",[0]);
  const capture=await stopAudioCapture(page);await writeFile(`${out}/production-${scenario}.webm`,Buffer.from(capture.bytes));
  report.markers=capture.markers;report.sourceStarts=capture.starts;
  const history=report.history as Array<{cue?:string;kind:string;atMs:number}>;
  if(scenario==='spell'){
    const cast=history.find(e=>e.cue==='combat.magic_cast'),hit=history.find(e=>e.cue==='combat.magic_hit');assert(cast&&hit);
    assert(hit.atMs>cast.atMs+50,'Spell impact follows actual launch');
    const marker=capture.markers.find(m=>m.method==='handleEvent'&&(m.args[0] as Record<string,unknown>).type==='spell.launched');assert(marker);
    report.castDelayMs=cast.atMs-marker.atMs;assert(cast.atMs-marker.atMs<500,'Decoded cast starts promptly after launch');
  }
  if(scenario==='combat'){
    const swing=history.find(e=>e.cue==='combat.melee_swing'),hit=history.find(e=>e.cue==='combat.melee_hit');assert(swing&&hit);assert(hit.atMs>swing.atMs);
    report.contactMarkers=capture.markers.filter(m=>m.method==='handlePlayerCombatMotion');assert((report.contactMarkers as unknown[]).length>=2);
  }
  if(scenario==='death'){
    const deaths=history.filter(e=>e.cue==='combat.player_death');assert.equal(deaths.length,1);
    assert(!history.some(e=>e.cue?.startsWith('creature.')&&e.atMs>deaths[0]!.atMs+100));
    const audio=report.audio as {activeOneShots:number;pendingOneShots:number};assert.equal(audio.pendingOneShots,0);assert.equal(audio.activeOneShots,0);
  }
  assert(capture.bytes.length>1000);assert.deepEqual(driver.pageErrors,[]);assert.deepEqual(driver.consoleErrors,[]);report.passed=true;
}catch(error){report.error=String(error);report.audio=await driver.callDebug("getAudioState",[]).catch(()=>null);throw error}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await driver.close();finish();console.log(JSON.stringify({passed:report.passed,out}))}
