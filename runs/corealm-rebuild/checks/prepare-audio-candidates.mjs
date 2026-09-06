import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve('runs/corealm-rebuild/audio-candidates');
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const probe=file=>JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration,bit_rate:stream=codec_name,sample_rate,channels','-of','json',file],{encoding:'utf8'}));
const candidates=[
  {id:'chicken',creator:'Breviceps',page:'https://freesound.org/people/Breviceps/sounds/456803/',
    preview:'https://cdn.freesound.org/previews/456/456803_9159316-hq.mp3',sourceClaim:'Clucking of a chicken',
    intervals:[[1.14,1.79],[6.35,7.95]]},
  {id:'rabbit',creator:'kessir',page:'https://freesound.org/people/kessir/sounds/372075/',
    preview:'https://cdn.freesound.org/previews/372/372075_4521595-hq.mp3',sourceClaim:"Author describes recording their own rabbit's oinks/squeaks",
    intervals:[[6.44,6.98],[8.07,8.51]]},
];
const report={date:'2026-09-05',status:'prepared candidates, not production replacements',
  licence:'CC0 1.0 https://creativecommons.org/publicdomain/zero/1.0/',
  qualityLimit:'Public HQ MP3 preview, not original WAV. Lossy preview decoded and re-encoded as Vorbis; no sample-rate upscaling.',
  selection:'Intervals selected by -32dBFS/150ms silence boundaries with 50-100ms context; source identity comes from creator description. No listening acceptance claimed.',candidates:[]};
for(const candidate of candidates){
  const source=path.join(root,candidate.id+'-preview.mp3');
  const entry={...candidate,sourceFile:path.basename(source),sourceSha256:hash(source),sourceFormat:probe(source),crops:[]};
  for(const [index,[start,end]] of candidate.intervals.entries()){
    const file=path.join(root,`${candidate.id}-candidate-${index+1}.ogg`),duration=end-start;
    const filter=`afade=t=in:d=0.01,afade=t=out:st=${(duration-.03).toFixed(4)}:d=0.03,volume=-6dB`;
    const args=['-hide_banner','-loglevel','error','-y','-ss',String(start),'-i',source,'-t',String(duration),'-af',filter,'-c:a','libvorbis','-q:a','5','-fflags','+bitexact','-flags:a','+bitexact',file];
    execFileSync('ffmpeg',args);
    const meter=spawnSync('ffmpeg',['-hide_banner','-i',file,'-af','volumedetect','-f','null',process.platform==='win32'?'NUL':'/dev/null'],{encoding:'utf8'});
    if(meter.status!==0)throw new Error(meter.stderr);
    const meanDbfs=Number(/mean_volume: ([-\d.]+)/.exec(meter.stderr)?.[1]);
    const peakDbfs=Number(/max_volume: ([-\d.]+)/.exec(meter.stderr)?.[1]);
    if(!Number.isFinite(peakDbfs)||peakDbfs>=0)throw new Error('Silent or clipped candidate');
    entry.crops.push({file:path.basename(file),start,end,duration,filter,meanDbfs,peakDbfs,sha256:hash(file),format:probe(file)});
  }
  report.candidates.push(entry);
}
writeFileSync(path.join(root,'manifest.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
