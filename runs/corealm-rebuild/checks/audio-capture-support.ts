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
    window.audioCapture={chunks:[],starts:[],allStarts:[],markers:[],rig:[],recordStart:null,
      census:{bufferSource:0,gain:0,panner:0,disconnects:0}};
    const connect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(destination,...args){
      if(destination===this.context.destination){
        if(!window.audioCapture.destination)window.audioCapture.destination=this.context.createMediaStreamDestination();
        connect.call(this,window.audioCapture.destination);
      }return connect.call(this,destination,...args);
    };
    // Construction counters. A source that plays and ends is not a leak; a graph that keeps
    // building nodes it never disconnects is. Counting both sides is the only way to tell them
    // apart from outside the engine, since Web Audio exposes no node census.
    const disconnect=AudioNode.prototype.disconnect;
    AudioNode.prototype.disconnect=function(...args){
      window.audioCapture.census.disconnects+=1;return disconnect.apply(this,args);
    };
    for(const [method,key] of [['createBufferSource','bufferSource'],['createGain','gain'],['createPanner','panner']]){
      const original=BaseAudioContext.prototype[method];
      BaseAudioContext.prototype[method]=function(...args){
        window.audioCapture.census[key]+=1;return original.apply(this,args);
      };
    }
    const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){
      const record={atMs:performance.now(),contextTime:this.context.currentTime,duration:this.buffer?.duration,loop:this.loop,offsetS:args[1]??0,rate:this.playbackRate.value,endedAtMs:null};
      window.audioCapture.starts.push(record);window.audioCapture.allStarts.push(record);
      // A listener, not an \`onended\` assignment: the engine owns that property and uses it to
      // release the voice. Clobbering it would create the very leak this is measuring.
      this.addEventListener('ended',()=>{record.endedAtMs=performance.now()});
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
export interface AudioSourceStart {atMs:number;contextTime:number;duration?:number;loop:boolean;offsetS:number;rate:number;endedAtMs:number|null}

export interface AudioNodeCensus {
  /** Nodes the graph has constructed since page load, by type. */
  bufferSource:number;gain:number;panner:number;
  /** `AudioNode.disconnect` calls. Cleanup paths disconnect source, gain and panner each. */
  disconnects:number;
  /** Buffer sources started but not yet ended. Loops legitimately sit here; one-shots must not. */
  liveSources:number;
  /** Of those, the ones started with `loop = true`. */
  liveLoopSources:number;
}

/** Snapshot of the graph's node accounting, for before/after leak comparisons. */
export async function audioNodeCensus(page:Page):Promise<AudioNodeCensus>{
  return page.evaluate(`(() => {
    const c=window.audioCapture;const live=c.allStarts.filter(s=>s.endedAtMs===null);
    return {...c.census,liveSources:live.length,liveLoopSources:live.filter(s=>s.loop).length};
  })()`);
}

/**
 * The dev server these audio checks talk to.
 *
 * `--url`, then `COREALM_URL`, then this slice's own port. It used to be a hard-coded 4175, which
 * is the root lease: eleven worktrees share this machine, and a run that silently attaches to
 * another agent's server measures another agent's build.
 */
export function audioCheckUrl(argv: readonly string[] = process.argv.slice(2)): string {
  const index = argv.indexOf("--url");
  if (index >= 0 && argv[index + 1]) return argv[index + 1]!;
  return process.env.COREALM_URL ?? "http://127.0.0.1:4186";
}
