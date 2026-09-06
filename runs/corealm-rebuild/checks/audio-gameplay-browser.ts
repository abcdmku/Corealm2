import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { GameDriver, FAST_TEST_SETTINGS } from "../../../tools/lib/driver.js";
import { installTestDeadline } from "../../../tools/lib/deadline.js";
import { assertGameplayHardware } from "./finish-gameplay-renderer.js";

// GPU lease required. Declared tool/inventory setup; actual gathering interaction and rig audio.
const out=`test-results/audio-gameplay/${Date.now()}`;await mkdir(out,{recursive:true});
const finish=installTestDeadline("Gameplay audio recording",59000);
const report:Record<string,unknown>={passed:false,scope:"Real gathering and stop output, recorded from production mix. Listening review remains separate."};
const driver=new GameDriver({url:process.env.COREALM_URL??"http://127.0.0.1:4175",close:async()=>{}},
  {headless:true,browserArgs:["--use-angle=d3d11","--enable-gpu","--ignore-gpu-blocklist","--autoplay-policy=no-user-gesture-required"],
    settings:{...FAST_TEST_SETTINGS,music:0.3,ambient:0.5,sfx:0.9}});
try {
  await driver.launch();const page=driver.page!;page.setDefaultTimeout(4500);
  await page.addInitScript(`(() => {
    const connect=AudioNode.prototype.connect;window.audioCapture={chunks:[],starts:[]};
    AudioNode.prototype.connect=function(destination,...args){
      if(destination===this.context.destination){
        if(!window.audioCapture.destination)window.audioCapture.destination=this.context.createMediaStreamDestination();
        connect.call(this,window.audioCapture.destination);
      }return connect.call(this,destination,...args);
    };
    const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){
      window.audioCapture.starts.push({atMs:performance.now(),contextTime:this.context.currentTime,duration:this.buffer?.duration,loop:this.loop});
      return start.apply(this,args);
    };
  })()`);
  await driver.open(24000,"/index.html?mode=combat&forest=1");
  report.renderer=await assertGameplayHardware(page);
  await page.locator("#panel-feature-lab .panel__close").click();
  await page.evaluate(`(() => {
    const debug=window.__gameDebug;debug.clearInventory();debug.giveItem('copper_hatchet',1,'inventory');debug.clearAudioHistory();
    const tree=debug.getEntity('feature-lab:forest:oak:1');if(!tree)throw new Error('Forest fixture missing');
    const p=tree.interactionPosition??tree.position;if(!debug.teleport([p[0]-1.4,p[1],p[2]]))throw new Error('Tree approach failed');
    const recording=new MediaRecorder(window.audioCapture.destination.stream,{mimeType:'audio/webm;codecs=opus'});
    recording.ondataavailable=e=>{if(e.data.size)window.audioCapture.chunks.push(e.data)};
    window.audioCapture.recorder=recording;recording.start();
  })()`);
  report.before=await driver.callDebug("getSaveBlob",[]);
  report.action=await driver.callDebug("callTool",["corealm_interact",{entityId:"feature-lab:forest:oak:1",interaction:"chop"}]);
  await page.waitForFunction("window.__gameDebug.getAudioHistory().filter(e=>e.kind==='cue'&&e.cue==='gather.wood_impact').length>=2",undefined,{timeout:15000});
  report.active=await driver.callDebug("getAudioState",[]);
  report.stopped=await driver.callDebug("callTool",["corealm_stop",{}]);
  const stopAt=await page.evaluate("performance.now()");
  await page.waitForTimeout(1600);
  report.history=await driver.callDebug("getAudioHistory",[]);
  report.events=await driver.callDebug("getEvents",[0]);
  report.after=await driver.callDebug("getSaveBlob",[]);
  const history=report.history as Array<{kind:string;cue?:string;atMs:number}>;
  assert(history.some(e=>e.cue==="gather.wood_swing"));assert(history.filter(e=>e.cue==="gather.wood_impact").length>=2);
  assert(!history.some(e=>e.cue==="gather.wood_impact"&&e.atMs>stopAt+300),"No stale tool impacts after stop");
  const capture=await page.evaluate(`(async()=>{
    const c=window.audioCapture;const stopped=new Promise(resolve=>c.recorder.onstop=resolve);c.recorder.stop();await stopped;
    return {bytes:Array.from(new Uint8Array(await new Blob(c.chunks).arrayBuffer())),starts:c.starts};
  })()` ) as {bytes:number[];starts:unknown[]};
  await writeFile(`${out}/real-gathering.webm`,Buffer.from(capture.bytes));report.sourceStarts=capture.starts;
  assert(capture.bytes.length>1000);assert.deepEqual(driver.pageErrors,[]);assert.deepEqual(driver.consoleErrors,[]);
  report.passed=true;console.log(JSON.stringify({passed:true,out}));
}catch(error){report.error=String(error);throw error}
finally {await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await driver.close();finish()}
