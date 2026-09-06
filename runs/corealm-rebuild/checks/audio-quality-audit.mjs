import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const base='runs/corealm-rebuild/audio-candidates';
const paths=['chicken-candidate-1.ogg','chicken-candidate-2.ogg','rabbit-candidate-1.ogg','rabbit-candidate-2.ogg'];
const old=['hen-cluck-01.ogg','hen-cluck-02.ogg','rodent-squeak-01.ogg','rodent-squeak-02.ogg'];
const rows=[...old.map(file=>({file,path:'game/public/audio/sfx/animals/'+file,kind:'Current shipped source'})),
  ...paths.map(file=>({file,path:base+'/'+file,kind:'CC0 preview crop candidate'}))];
const db=value=>20*Math.log10(Math.max(value,1e-12));
for(const row of rows){
  const raw=execFileSync('ffmpeg',['-v','error','-i',row.path,'-ac','1','-ar','16000','-f','f32le','pipe:1'],{maxBuffer:10000000});
  const values=Array.from({length:raw.length/4},(_,i)=>raw.readFloatLE(i*4));
  const frames=[];let peak=0,power=0,clipped=0;
  for(let i=0;i<values.length;i+=320){let sum=0;const frame=values.slice(i,i+320);
    for(const x of frame){sum+=x*x;power+=x*x;peak=Math.max(peak,Math.abs(x));if(Math.abs(x)>=.999)clipped++}
    frames.push(Math.sqrt(sum/frame.length));
  }
  const active=frames.map((value,i)=>({value,i})).filter(({value})=>db(value)>-45);
  row.metrics={duration:values.length/16000,peakDbfs:db(peak),meanDbfs:db(Math.sqrt(power/values.length)),clippedSamples:clipped,
    framesAboveMinus45Dbfs:active.length,frameCount:frames.length,activeFraction:active.length/frames.length,
    leadingQuietMs:active.length?active[0].i*20:values.length/16,
    crestDb:db(peak)-db(Math.sqrt(power/values.length))};
}
writeFileSync(base+'/quality-audit.json',JSON.stringify({scope:'Decoded-sample integrity and envelope measures; not subjective listening or species recognition.',rows},null,2));
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const cards=rows.map(row=>`<section><h3>${esc(row.file)}</h3><p>${row.kind}</p><audio controls preload="metadata" src="data:audio/ogg;base64,${readFileSync(row.path).toString('base64')}"></audio><p>${row.metrics.duration.toFixed(2)} seconds · mean ${row.metrics.meanDbfs.toFixed(1)} dBFS · peak ${row.metrics.peakDbfs.toFixed(1)} dBFS · ${Math.round(row.metrics.activeFraction*100)}% of 20ms frames above −45 dBFS</p><label>Listening notes <textarea placeholder="Animal identity, background handling noise, clipped call edges, comfort in the game mix"></textarea></label></section>`).join('');
writeFileSync(base+'/listening-review.html',`<!doctype html><meta charset="utf-8"><title>Corealm animal audio review</title><style>body{font:16px system-ui;max-width:1050px;margin:32px auto;padding:0 20px;background:#181b19;color:#f3eee1}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}section{background:#252b27;padding:18px;border:1px solid #526456;border-radius:8px}h3{margin:0}p{color:#c8d3c8}audio{width:100%;margin:8px 0}textarea{display:block;width:95%;min-height:64px;margin-top:8px}a{color:#9bdaaf}</style><h1>Animal audio: current clips and candidates</h1><p>Review the actual recordings. Playback starts at 50% volume; only one player plays at once. Notes stay on this page and are not submitted. Candidates have not been listening-approved or installed in the game.</p><p>Compare animal identity, background handling noise, call boundaries, and level. Quiet rabbit transients need special care: a correct creator label does not establish that every crop is a useful vocalization.</p><p>Sources: <a href="https://freesound.org/people/Breviceps/sounds/456803/">Breviceps chicken</a> · <a href="https://freesound.org/people/kessir/sounds/372075/">kessir rabbit</a> · both creator pages show CC0. Crops use public MP3 previews, not original WAV files.</p><main>${cards}</main><script>document.querySelectorAll('audio').forEach(a=>{a.volume=.5;a.addEventListener('play',()=>document.querySelectorAll('audio').forEach(b=>{if(b!==a)b.pause()}))})</script>`);
console.log(JSON.stringify(rows.map(({file,metrics})=>({file,...metrics})),null,2));
