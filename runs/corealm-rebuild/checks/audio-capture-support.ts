import type { Page } from "playwright";

/** Diagnostic taps only: originals still execute, with their arguments and return values intact. */
export async function installAudioCapture(page:Page):Promise<void>{
  await page.addInitScript(`(() => {
    window.audioCapture={chunks:[],starts:[],markers:[]};
    const connect=AudioNode.prototype.connect;
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
  await page.route("**/src/audio/gameAudio.ts*",async route=>{
    const response=await route.fetch();const source=await response.text();
    await route.fulfill({response,body:source+`
      for(const method of ['handleEvent','handlePlayerCombatMotion','handleGatherMotion','handleFootstep']){
        const original=CorealmAudioBridge.prototype[method];
        CorealmAudioBridge.prototype[method]=function(...args){
          window.audioCapture.markers.push({method,args,atMs:performance.now()});
          return original.apply(this,args);
        };
      }
    `});
  });
}
export async function startAudioCapture(page:Page):Promise<void>{
  await page.evaluate(`(() => {
    const c=window.audioCapture;c.starts=[];c.markers=[];window.__gameDebug.clearAudioHistory();
    const r=new MediaRecorder(c.destination.stream,{mimeType:'audio/webm;codecs=opus'});
    r.ondataavailable=e=>{if(e.data.size)c.chunks.push(e.data)};c.recorder=r;r.start();
  })()`);
}
export async function stopAudioCapture(page:Page):Promise<{bytes:number[];starts:unknown[];markers:AudioMarker[]}>{
  return page.evaluate(`(async()=>{
    const c=window.audioCapture;const stopped=new Promise(resolve=>c.recorder.onstop=resolve);c.recorder.stop();await stopped;
    return {bytes:Array.from(new Uint8Array(await new Blob(c.chunks).arrayBuffer())),starts:c.starts,markers:c.markers};
  })()`);
}
export interface AudioMarker {method:string;args:Array<Record<string,unknown>|string>;atMs:number}
