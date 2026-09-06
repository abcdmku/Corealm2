import type { Page } from "playwright";

/**
 * Diagnostic taps only: originals still execute, with their arguments and return values intact.
 *
 * Records, all on `performance.now()`:
 * - `starts`: every AudioBufferSourceNode.start with the context time it was scheduled at;
 * - `markers`: CorealmAudioBridge method calls (semantic edges reaching the audio layer);
 * - `rig`: CharacterRig motion events as drained by the loop (measured clip contact frames);
 * - `recordStart`: wall and context time when the MediaRecorder began, so a scheduled start can be
 *   located inside the recording.
 */
export async function installAudioCapture(page:Page):Promise<void>{
  await page.addInitScript(`(() => {
    window.audioCapture={chunks:[],starts:[],markers:[],rig:[],recordStart:null};
    const connect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(destination,...args){
      if(destination===this.context.destination){
        if(!window.audioCapture.destination)window.audioCapture.destination=this.context.createMediaStreamDestination();
        connect.call(this,window.audioCapture.destination);
      }return connect.call(this,destination,...args);
    };
    const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){
      window.audioCapture.starts.push({atMs:performance.now(),contextTime:this.context.currentTime,duration:this.buffer?.duration,loop:this.loop,offsetS:args[1]??0,rate:this.playbackRate.value});
      return start.apply(this,args);
    };
  })()`);
  await page.route("**/src/audio/gameAudio.ts*",async route=>{
    const response=await route.fetch();const source=await response.text();
    await route.fulfill({response,body:source+`
      for(const method of ['handleEvent','handlePlayerCombatMotion','handleGatherMotion','handleFootstep','handleInteraction']){
        const original=CorealmAudioBridge.prototype[method];
        CorealmAudioBridge.prototype[method]=function(...args){
          window.audioCapture.markers.push({method,args,atMs:performance.now()});
          return original.apply(this,args);
        };
      }
    `});
  });
  await page.route("**/src/render/characterRig.ts*",async route=>{
    const response=await route.fetch();const source=await response.text();
    await route.fulfill({response,body:source+`
      {
        const original=CharacterRig.prototype.drainMotionEvents;
        CharacterRig.prototype.drainMotionEvents=function(){
          const events=original.apply(this,arguments);
          const atMs=performance.now();
          for(const event of events)window.audioCapture.rig.push({...event,atMs});
          return events;
        };
      }
    `});
  });
}
export async function startAudioCapture(page:Page):Promise<void>{
  await page.evaluate(`(() => {
    const c=window.audioCapture;c.starts=[];c.markers=[];c.rig=[];window.__gameDebug.clearAudioHistory();
    const r=new MediaRecorder(c.destination.stream,{mimeType:'audio/webm;codecs=opus'});
    r.ondataavailable=e=>{if(e.data.size)c.chunks.push(e.data)};c.recorder=r;
    c.recordStart={atMs:performance.now(),contextTime:c.destination.context.currentTime};r.start();
  })()`);
}
export interface AudioCaptureResult {
  bytes:number[];
  starts:AudioSourceStart[];
  markers:AudioMarker[];
  rig:RigMarker[];
  recordStart:{atMs:number;contextTime:number};
}
export async function stopAudioCapture(page:Page):Promise<AudioCaptureResult>{
  return page.evaluate(`(async()=>{
    const c=window.audioCapture;const stopped=new Promise(resolve=>c.recorder.onstop=resolve);c.recorder.stop();await stopped;
    return {bytes:Array.from(new Uint8Array(await new Blob(c.chunks).arrayBuffer())),starts:c.starts,markers:c.markers,rig:c.rig,recordStart:c.recordStart};
  })()`);
}
export interface AudioMarker {method:string;args:Array<Record<string,unknown>|string>;atMs:number}
export interface RigMarker {kind:string;pose:string;foot?:string;atMs:number}
export interface AudioSourceStart {atMs:number;contextTime:number;duration?:number;loop:boolean;offsetS:number;rate:number}
