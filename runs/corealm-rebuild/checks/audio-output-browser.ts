import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { audioCheckUrl } from "./audio-capture-support.js";
import { installTestDeadline } from "../../../tools/lib/deadline.js";

// DOM-only recording of the actual production AudioEngine mix and real catalogue files.
// Direct soundboard/region stimuli are declared setup, not integrated gameplay timing proof.
const caseIndex=process.argv.indexOf("--case");
const scenario=caseIndex<0?"species":process.argv[caseIndex+1];
assert(["species","ambience","contacts"].includes(scenario));
const out=`test-results/audio-output/${scenario}-${Date.now()}`;
await mkdir(out,{recursive:true});
const finish=installTestDeadline("Audio output capture",59000);
const browser=await chromium.launch({args:["--disable-gpu","--autoplay-policy=no-user-gesture-required"]});
const report:Record<string,unknown>={passed:false,scenario,listening:"Captured for listening review; waveform and cue history do not establish subjective quality."};
try {
  const page=await browser.newPage();
  await page.route("**/audio-output-fixture",route=>route.fulfill({contentType:"text/html",body:"<button>Record production audio</button>"}));
  await page.goto(`${audioCheckUrl()}/audio-output-fixture`);
  const result=await page.evaluate(`(async()=>{
    const {AudioEngine}=await import('/src/audio/engine.ts');
    const {AudioDirector}=await import('/src/audio/director.ts');
    const {COREALM_AUDIO_CATALOG:catalog}=await import('/src/audio/corealmCatalog.ts');
    const context=new AudioContext();const capture=context.createMediaStreamDestination();
    const connect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(destination,...args){
      if(destination===context.destination) connect.call(this,capture);
      return connect.call(this,destination,...args);
    };
    const diagnostics=[];
    const engine=new AudioEngine(catalog,{contextFactory:()=>context,onDiagnostic:d=>diagnostics.push(d)});
    const director=new AudioDirector(engine,catalog);
    await engine.unlock();const chunks=[];
    const recorder=new MediaRecorder(capture.stream,{mimeType:'audio/webm;codecs=opus'});
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
    recorder.start();const start=performance.now();const timeline=[];
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const mark=label=>timeline.push({label,atMs:performance.now()-start,state:engine.snapshot()});
    try {
      if(${JSON.stringify(scenario)}==='ambience') {
        for(const region of ['fallowmarch','vellenwood','karrowmoor','kilnhalt','gravelmaw']) {
          director.setRegion(region);mark('region '+region);await sleep(5000);mark('settled '+region);
        }
        director.dispose();engine.resetOneShots();await sleep(700);mark('disposed silent');
      } else {
        const cues=${JSON.stringify(scenario)}==='species'
          ? Object.keys(catalog.cues).filter(cue=>cue.startsWith('creature.'))
          : ['movement.footstep_grass','movement.footstep_stone','movement.footstep_wood','movement.footstep_cave',
            'gather.mining_swing','gather.mining_impact','gather.wood_swing','gather.wood_impact',
            'combat.melee_swing','combat.melee_hit','combat.magic_cast','combat.magic_hit','combat.player_death'];
        for(const cue of cues){mark(cue);const played=await engine.playCue(cue);if(!played)throw new Error('Cue failed '+cue);
          await sleep(2600);engine.resetOneShots();await sleep(150)}
      }
      await sleep(300);mark('finished');
      const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.stop();await stopped;
      const bytes=Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
      return {bytes,timeline,diagnostics,history:engine.history(),state:engine.snapshot()};
    } finally {director.dispose();await engine.dispose();AudioNode.prototype.connect=connect}
  })()` ) as {bytes:number[];timeline:unknown[];diagnostics:unknown[];history:unknown[];state:{activeLoops:string[];desiredLoops:string[]}};
  await writeFile(`${out}/production-output.webm`,Buffer.from(result.bytes));
  Object.assign(report,{...result,bytes:result.bytes.length});
  assert(result.bytes.length>1000);assert.deepEqual(result.diagnostics,[]);
  if(scenario==="ambience"){assert.deepEqual(result.state.activeLoops,[]);assert.deepEqual(result.state.desiredLoops,[])}
  report.passed=true;
  console.log(JSON.stringify({passed:true,out,bytes:result.bytes.length}));
} catch(error){report.error=String(error);throw error}
finally {await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();finish()}
