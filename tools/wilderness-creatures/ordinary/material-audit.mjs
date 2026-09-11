import assert from 'node:assert/strict';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const out='test-results/wilderness-creatures/ordinary',io=new NodeIO().registerExtensions(ALL_EXTENSIONS),catalog=JSON.parse(await readFile(`${out}/catalog.json`,'utf8'));
const hash=x=>createHash('sha256').update(x).digest('hex'),report=[];
for(const entry of catalog.assets){const doc=await io.read(`${out}/${catalog.files[entry.id]}`),r=doc.getRoot();
 const geometry=r.listNodes().filter(n=>n.getMesh()).map(n=>({node:n.getName(),primitives:n.getMesh().listPrimitives().map(p=>({indices:p.getIndices()?Array.from(p.getIndices().getArray()):null,attributes:Object.fromEntries(['POSITION','NORMAL','JOINTS_0','WEIGHTS_0'].filter(k=>p.getAttribute(k)).map(k=>[k,Array.from(p.getAttribute(k).getArray())]))}))}));
 const clips=r.listAnimations().map(a=>({name:a.getName(),channels:a.listChannels().map(c=>({node:c.getTargetNode().getName(),path:c.getTargetPath(),input:Array.from(c.getSampler().getInput().getArray()),output:Array.from(c.getSampler().getOutput().getArray()),interpolation:c.getSampler().getInterpolation()}))}));
 const hierarchy=r.listNodes().map(n=>({name:n.getName(),parent:n.getParentNode()?.getName(),t:n.getTranslation(),q:n.getRotation(),s:n.getScale()}));
 const row={id:entry.id,geometry:hash(JSON.stringify(geometry)),clips:hash(JSON.stringify(clips)),hierarchy:hash(JSON.stringify(hierarchy)),size:entry.size,materials:[]};
 for(const m of r.listMaterials()){
  assert.equal(m.getMetallicFactor(),0,`${entry.id} ${m.getName()} metal`);
  if(m.getBaseColorTexture())for(const mesh of r.listMeshes())for(const p of mesh.listPrimitives())if(p.getMaterial()===m)assert(p.getAttribute('TEXCOORD_0'),`${m.getName()} no UV`);
  const emission=m.getEmissiveFactor().some(v=>v>0);if(!process.argv.includes('--snapshot')&&emission){assert(m.getEmissiveTexture(),`${m.getName()} no heat emission texture`);assert.equal(m.getEmissiveTexture(),m.getBaseColorTexture(),`${m.getName()} heat maps differ`);const stats=await sharp(m.getEmissiveTexture().getImage()).stats();
   if(m.getName().includes('innerwall_mask')){
    // A localized mask intentionally has mostly black pixels. Judge its lit area and retained
    // black centre directly; whole-image variance would demand an excessively broad glow.
    const {data,info}=await sharp(m.getEmissiveTexture().getImage()).removeAlpha().raw().toBuffer({resolveWithObject:true});let lit=0,centreMax=0;for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const i=(y*info.width+x)*info.channels,v=Math.max(data[i],data[i+1],data[i+2]);if(v>16)lit++;if(x>=info.width*.42&&x<=info.width*.75)centreMax=Math.max(centreMax,v);}const coverage=lit/(info.width*info.height);assert(coverage>.01&&coverage<.15,`Innerwall mask must remain a localized strip: ${coverage}`);assert(centreMax<8,`Innerwall centre is no longer black: ${centreMax}`);assert(stats.channels.some(c=>c.max>120),`Innerwall strip has no visible spectral variation`);
   }else assert(stats.channels.some(c=>c.stdev>30),`${m.getName()} flat emission map`);
  }
  row.materials.push({name:m.getName(),factor:m.getBaseColorFactor(),roughness:m.getRoughnessFactor(),metallic:m.getMetallicFactor(),emission:m.getEmissiveFactor(),textured:!!m.getBaseColorTexture(),emissionTextured:!!m.getEmissiveTexture()});
 }
 report.push(row);
}
if(process.argv.includes('--snapshot')){await writeFile(`${out}/material-baseline.json`,JSON.stringify(report,null,2)+'\n');console.log('Material-only geometry/clip/hierarchy baseline saved');}
else{const before=JSON.parse(await readFile(`${out}/material-baseline.json`,'utf8'));for(const row of report){const old=before.find(x=>x.id===row.id);for(const key of ['geometry','clips','hierarchy','size'])assert.deepEqual(row[key],old[key],`${row.id} changed ${key}`);}await writeFile(`${out}/material-audit.json`,JSON.stringify(report,null,2)+'\n');console.log('Six candidates: geometry, clips, hierarchy and dimensions unchanged; all emission cores textured and nonmetallic');}
