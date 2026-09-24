import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const dir='assets/art/tripo/imports/creatures/audit-polish-bandits';
const catalog=JSON.parse(await readFile(`${dir}/lab-catalog.json`,'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const equalArrays=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const reports=[];
for(const entry of catalog.assets){
  const source=await io.read(entry.sourceProvenance.file);
  const outputFile=`${dir}/models/${entry.id}.glb`;
  const outputBytes=await readFile(outputFile);
  const candidate=await io.read(outputFile);
  const a=source.getRoot(),b=candidate.getRoot();
  const errors=[];
  if(hash(outputBytes)!==entry.sha256||outputBytes.length!==entry.bytes) errors.push('candidate hash or size');
  if(b.listMeshes().length!==a.listMeshes().length+3) errors.push('mesh count');
  let vertexCount=0;
  for(let m=0;m<a.listMeshes().length;m++){
    const ap=a.listMeshes()[m].listPrimitives(),bp=b.listMeshes()[m].listPrimitives();
    if(ap.length!==bp.length){errors.push(`primitive count ${m}`);continue;}
    for(let p=0;p<ap.length;p++){
      for(const semantic of ['POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0']){
        const aa=ap[p].getAttribute(semantic)?.getArray(),bb=bp[p].getAttribute(semantic)?.getArray();
        if(!aa||!bb||!equalArrays(aa,bb))errors.push(`attribute ${m}/${p}/${semantic}`);
      }
      const ai=ap[p].getIndices()?.getArray(),bi=bp[p].getIndices()?.getArray();
      if((!!ai)!==(!!bi)||(ai&&bi&&!equalArrays(ai,bi)))errors.push(`indices ${m}/${p}`);
      vertexCount+=ap[p].getAttribute('POSITION').getCount();
    }
  }
  const as=a.listSkins()[0],bs=b.listSkins()[0];
  if(b.listSkins().length!==1)errors.push('skin count');
  if(!equalArrays(as.listJoints().map(j=>j.getName()),bs.listJoints().map(j=>j.getName())))errors.push('joint names or order');
  if(!equalArrays(as.getInverseBindMatrices().getArray(),bs.getInverseBindMatrices().getArray()))errors.push('inverse bind matrices');
  const expectedClips=['Idle','Walk','Run','Attack','Hit','Death'];
  if(!equalArrays(b.listAnimations().map(c=>c.getName()).sort(),expectedClips.sort()))errors.push('native clip names');
  const jointSet=new Set(bs.listJoints());
  for(const clip of b.listAnimations()){
    if(!clip.listChannels().length)errors.push(`empty clip ${clip.getName()}`);
    for(const channel of clip.listChannels())if(!jointSet.has(channel.getTargetNode()))errors.push(`clip targets foreign bone ${clip.getName()}`);
  }
  const headNodes=b.listNodes().filter(n=>n.getMesh()&&['Eyebrows','Eyes','Superhero_Female','SuperHero_Male'].includes(n.getName()));
  if(headNodes.length!==3||headNodes.some(n=>n.getSkin()!==bs))errors.push('visible face, eyes and brows skin');
  if(!b.listNodes().some(n=>n.getName().includes('Head_Hood')&&n.getMesh()))errors.push('hood');
  for(const mat of a.listMaterials()){
    const other=b.listMaterials().find(m=>m.getName()===mat.getName());
    if(!other){errors.push(`missing material ${mat.getName()}`);continue;}
    for(const slot of ['getNormalTexture','getMetallicRoughnessTexture','getOcclusionTexture','getEmissiveTexture']){
      const ta=mat[slot](),tb=other[slot]();
      if((!!ta)!==(!!tb)||(ta&&tb&&hash(ta.getImage())!==hash(tb.getImage())))errors.push(`changed ${slot} ${mat.getName()}`);
    }
    if(mat.getName()!=='MI_Ranger'){
      const ta=mat.getBaseColorTexture(),tb=other.getBaseColorTexture();
      if((!!ta)!==(!!tb)||(ta&&tb&&hash(ta.getImage())!==hash(tb.getImage())))errors.push(`changed skin base color ${mat.getName()}`);
    }
  }
  reports.push({id:entry.id,sourceId:entry.metadata.sourceAssetId,sourceSha256:entry.sourceProvenance.sha256,candidateSha256:entry.sha256,outfitMeshCount:a.listMeshes().length,completeMeshCount:b.listMeshes().length,outfitVertexCount:vertexCount,joints:as.listJoints().length,nativeClips:b.listAnimations().map(c=>c.getName()),faceNodes:headNodes.map(n=>n.getName()),garmentAtlasChanged:hash(a.listMaterials().find(m=>m.getName()==='MI_Ranger').getBaseColorTexture().getImage())!==hash(b.listMaterials().find(m=>m.getName()==='MI_Ranger').getBaseColorTexture().getImage()),errors,passed:errors.length===0});
}
const result={schema:'corealm-bandit-polish-cpu-validation/1',reports,passed:reports.every(r=>r.passed)};
await writeFile(`${dir}/validation.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if(!result.passed)process.exitCode=1;
