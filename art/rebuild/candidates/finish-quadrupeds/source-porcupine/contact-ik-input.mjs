import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {KHRONOS_EXTENSIONS} from '@gltf-transform/extensions';
const dir=new URL('./',import.meta.url),bytes=await readFile(new URL('cdmir-porcupine-normalized.glb',dir)),doc=await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).readBinary(bytes);
const baseline=JSON.parse(await readFile(new URL('contact-audit.json',dir),'utf8')),mapping=JSON.parse(await readFile(new URL('native-export-source-mapping.json',dir),'utf8'));
const clips=doc.getRoot().listAnimations().filter(a=>['Walk','Run'].includes(a.getName())).map(a=>{const duration=Math.max(...a.listSamplers().map(s=>s.getInput().getScalar(s.getInput().getCount()-1))),times=new Set(Array.from({length:481},(_,i)=>i*duration/480));for(const s of a.listSamplers())for(let i=0;i<s.getInput().getCount();i++)times.add(s.getInput().getScalar(i));return{name:a.getName(),duration,times:[...new Set([...times].map(Math.fround))].sort((a,b)=>a-b)};});
await writeFile(new URL('contact-ik-input.json',dir),JSON.stringify({file:'cdmir-porcupine-normalized.glb',sha256:createHash('sha256').update(bytes).digest('hex'),normalization:baseline.normalization,feet:baseline.feet,correctives:mapping.correctives,clips},null,2));
console.log(clips.map(c=>[c.name,c.times.length]));

