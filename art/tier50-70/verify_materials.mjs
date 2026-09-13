import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import * as THREE from 'three';
import {tsImport} from 'tsx/esm/api';
import sharp from 'sharp';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const hash = value => createHash('sha256').update(value).digest('hex');
const round = process.argv[2] ?? 'r12';
assert(['r11','r12'].includes(round),'Use r11 or r12');
const imagegenRevision = round === 'r12';
const starhideScalePigment=['#2d425b','#304765','#3a4564','#424563','#48425f','#294a58'];
const json = async file => JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
const colorStatsCache=new Map();
async function clothColorStats(image,theme) {
  const digest=hash(image),key=`${theme}:${digest}`;
  if(colorStatsCache.has(key))return colorStatsCache.get(key);
  const {data,info}=await sharp(image).removeAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.channels,3,'Cloth albedo must contain RGB yarn colors');
  assert.equal(info.width,2048);assert.equal(info.height,2048);
  const count=info.width*info.height,sum=[0,0,0],squares=[0,0,0],crossTotal=[0,0,0];
  let totalSquare=0;
  for(let i=0;i<data.length;i+=3){
    const total=data[i]+data[i+1]+data[i+2];totalSquare+=total*total;
    for(let c=0;c<3;c++){const value=data[i+c];sum[c]+=value;squares[c]+=value*value;crossTotal[c]+=value*total;}
  }
  const meanSRGB=sum.map(value=>value/count),meanTotal=meanSRGB.reduce((a,b)=>a+b,0);
  assert(meanTotal>0);
  const channelStdSRGB=squares.map((value,c)=>Math.sqrt(Math.max(0,value/count-meanSRGB[c]**2)));
  // Remove variation caused solely by brightness. A gray image or one uniform
  // dye multiplied by grayscale cannot supply distinct colored thread hues.
  const chromaticResidualRms=Math.sqrt(meanSRGB.reduce((result,mean,c)=>{
    const ratio=mean/meanTotal;
    return result+Math.max(0,squares[c]/count-2*ratio*crossTotal[c]/count+ratio*ratio*totalSquare/count);
  },0)/3);
  const valueStdSRGB=Math.sqrt(Math.max(0,totalSquare/count-meanTotal*meanTotal))/3;
  assert(valueStdSRGB>2,'Cloth yarns lack visible value variation');
  assert(chromaticResidualRms>1,'Cloth yarns have no meaningful color variation beyond one flat dye');
  const stats={width:info.width,height:info.height,pixelSha256:hash(data),meanSRGB,channelStdSRGB,
    valueStdSRGB,chromaticResidualRms,units:'sRGB byte values, 0 to 255',colorAndValueVariation:true};
  colorStatsCache.set(key,stats);return stats;
}
const surfaceStatsCache=new Map();
async function embroideredSurfaceStats(colorImage,packedImage,theme) {
  const key=`${theme}:${hash(colorImage)}:${hash(packedImage)}`;
  if(surfaceStatsCache.has(key))return surfaceStatsCache.get(key);
  const [{data:color,info},{data:packed,info:packedInfo}]=await Promise.all([
    sharp(colorImage).removeAlpha().raw().toBuffer({resolveWithObject:true}),
    sharp(packedImage).removeAlpha().raw().toBuffer({resolveWithObject:true}),
  ]);
  assert.equal(info.channels,3);assert.equal(packedInfo.channels,3);
  assert.equal(info.width,2048);assert.equal(info.height,2048);
  assert.equal(packedInfo.width,info.width);assert.equal(packedInfo.height,info.height);
  const count=info.width*info.height,channels=Buffer.alloc(count*2);
  const group=()=>({pixels:0,roughnessSum:0,metallicSum:0,colorSum:[0,0,0]});
  const base=group(),embroidery=group();let metallicMax=0,roughnessMin=1,roughnessMax=0;
  for(let p=0;p<count;p++){
    const i=p*3,roughness=packed[i+1]/255,metallic=packed[i+2]/255;
    channels[p*2]=packed[i+1];channels[p*2+1]=packed[i+2];
    assert(roughness>=.38&&roughness<=1,'Unexpected embroidered cloth roughness');
    assert(metallic<=.61,'Embroidery metallic response exceeds its authored range');
    metallicMax=Math.max(metallicMax,metallic);roughnessMin=Math.min(roughnessMin,roughness);roughnessMax=Math.max(roughnessMax,roughness);
    const selected=packed[i+2]<=1?base:metallic>=.55?embroidery:undefined;
    if(!selected)continue;
    if(selected===base)assert(roughness>=.90,'Nonmetallic base cloth lost its matte finish');
    else assert(roughness<=.58,'Gold stitch cores lost their finer reflective finish');
    selected.pixels++;selected.roughnessSum+=roughness;selected.metallicSum+=metallic;
    for(let c=0;c<3;c++)selected.colorSum[c]+=color[i+c];
  }
  assert(base.pixels/count>.10,'Missing substantial rough nonmetallic base fabric');
  assert(embroidery.pixels/count>.0001,'Missing gold embroidery cores');
  const summarize=row=>({pixels:row.pixels,fraction:row.pixels/count,meanRoughness:row.roughnessSum/row.pixels,
    meanMetallic:row.metallicSum/row.pixels,meanSRGB:row.colorSum.map(value=>value/row.pixels)});
  const baseCloth=summarize(base),goldEmbroidery=summarize(embroidery),dominant=theme==='dragonhide'?0:2;
  assert(baseCloth.meanSRGB.every((value,c)=>c===dominant||baseCloth.meanSRGB[dominant]>value),`${theme}: base cloth left its maroon/navy color family`);
  assert(goldEmbroidery.meanSRGB[0]>goldEmbroidery.meanSRGB[1]&&goldEmbroidery.meanSRGB[1]>goldEmbroidery.meanSRGB[2],`${theme}: metallic mask is not aligned with warm gold thread`);
  assert(goldEmbroidery.meanRoughness<baseCloth.meanRoughness);
  const stats={width:info.width,height:info.height,packedChannelsSha256:hash(channels),roughnessMin,roughnessMax,metallicMax,
    metallicMaskCoverage:1-base.pixels/count,
    baseCloth,goldEmbroidery,classification:{baseMetallicByteMaximum:1,embroideryMetallicMinimum:.55},
    matteBaseAndMetallicEmbroidery:true,encoding:'G roughness, B metallic; sRGB byte means reported separately'};
  surfaceStatsCache.set(key,stats);return stats;
}
async function sourceGoldCoverage(file,bytes) {
  const data=await sharp(bytes).resize(2048,2048,{fit:'fill'}).removeAlpha().raw().toBuffer();
  assert.equal(data.length,2048*2048*3);
  let marked=0,maskSum=0;
  for(let i=0;i<data.length;i+=3){
    const r=data[i]/255,g=data[i+1]/255,b=data[i+2]/255;
    const mask=THREE.MathUtils.smoothstep((r-b)/Math.max(r,.01),.08,.28)
      *THREE.MathUtils.smoothstep(g/Math.max(r,.01),.28,.58)
      *THREE.MathUtils.smoothstep((r+g)/2,.12,.35);
    if(mask>.05)marked++;maskSum+=mask;
  }
  return {file,sha256:hash(bytes),markedFraction:marked/(2048*2048),meanMask:maskSum/(2048*2048)};
}
async function compareBotanicalDensity(theme,currentFile) {
  const baselineFile=`art/tier50-70/textures/imagegen-r12/${theme}-botanical-source-v1.png`;
  let baselineBytes;
  try{baselineBytes=await readFile(baselineFile);}catch(error){if(error.code==='ENOENT')return {available:false,baselineFile};throw error;}
  const [previous,current]=await Promise.all([sourceGoldCoverage(baselineFile,baselineBytes),sourceGoldCoverage(currentFile,await readFile(currentFile))]);
  assert(current.markedFraction<previous.markedFraction,`${theme}: celestial source did not reduce gold motif coverage`);
  return {available:true,previous,current,coverageReduced:true,
    method:'Compare both 2048-pixel source images with the same warm-gold hue/brightness mask; count mask values above .05. Coverage is an image estimate, not a full-view visual acceptance.'};
}
function compareRelief(before,after,itemId) {
  const a=before.getRoot(),b=after.getRoot();
  const structural=d=>{const r=d.getRoot(),nodes=r.listNodes();return {
    nodes:nodes.map(n=>({name:n.getName(),matrix:n.getMatrix(),children:n.listChildren().map(c=>nodes.indexOf(c))})),
    skins:r.listSkins().map(s=>({joints:s.listJoints().map(n=>nodes.indexOf(n)),inverse:Array.from(s.getInverseBindMatrices().getArray())}))};};
  assert.deepEqual(structural(before),structural(after),`${itemId}: rig or transforms changed`);
  const am=a.listMeshes(),bm=b.listMeshes();assert.equal(am.length,bm.length);
  let maxScaleDisplacement=0,changedScaleCorners=0,preservedGarmentCorners=0,triangles=0;
  for(let m=0;m<am.length;m++){
    const ap=am[m].listPrimitives(),bp=bm[m].listPrimitives();assert.equal(ap.length,bp.length);
    for(let p=0;p<ap.length;p++){
      const x=ap[p],y=bp[p],name=x.getMaterial().getName();assert.equal(y.getMaterial().getName(),name);
      const flexible=name.includes('-scute-')||name.includes('-soft-dark-lining');
      const ix=x.getIndices()?.getArray(),iy=y.getIndices()?.getArray();
      const count=ix?.length??x.getAttribute('POSITION').getCount();assert.equal(iy?.length??y.getAttribute('POSITION').getCount(),count);
      triangles+=count/3;
      const xp=x.getAttribute('POSITION').getArray(),yp=y.getAttribute('POSITION').getArray();
      const xu=x.getAttribute('TEXCOORD_0').getArray(),yu=y.getAttribute('TEXCOORD_0').getArray();
      for(let i=0;i<count;i++){
        const ai=ix?.[i]??i,bi=iy?.[i]??i;
        assert.equal(xu[ai*2],yu[bi*2]);assert.equal(xu[ai*2+1],yu[bi*2+1]);
        const distance=Math.hypot(xp[ai*3]-yp[bi*3],xp[ai*3+1]-yp[bi*3+1],xp[ai*3+2]-yp[bi*3+2]);
        if(!flexible){assert.equal(distance,0,`${itemId}: cloth/trim silhouette changed`);preservedGarmentCorners++;}
        else{assert(distance<.008,`${itemId}: excessive plate displacement`);maxScaleDisplacement=Math.max(maxScaleDisplacement,distance);if(distance>1e-7)changedScaleCorners++;}
      }
    }
  }
  assert(triangles<=150000);assert(changedScaleCorners>0);
  const oldColors=a.listTextures().filter(t=>t.getName().includes('-color')&&!t.getName().includes('-cloth-'));
  for(const tex of oldColors){const revised=b.listTextures().find(t=>t.getName()===tex.getName());assert(revised);assert.equal(hash(revised.getImage()),hash(tex.getImage()),'Base texture grain changed');}
  return {rigAndGarmentSilhouetteUnchanged:true,topologyAndUVLayoutUnchanged:true,preservedGarmentCorners,changedScaleCorners,maxScaleDisplacement,triangles};
}
function geometry(doc) {
  const root = doc.getRoot(), accessors = root.listAccessors(), meshes = root.listMeshes(), nodes = root.listNodes();
  return {
    accessors: accessors.map(a => ({type:a.getType(), component:a.getComponentType(), normalized:a.getNormalized(), count:a.getCount(), hash:hash(Buffer.from(a.getArray().buffer,a.getArray().byteOffset,a.getArray().byteLength))})),
    meshes: meshes.map(m => ({name:m.getName(), primitives:m.listPrimitives().map(p => ({mode:p.getMode(), indices:accessors.indexOf(p.getIndices()), attributes:p.listSemantics().map(s=>[s,accessors.indexOf(p.getAttribute(s))]), material:p.getMaterial()?.getName()}))})),
    nodes: nodes.map(n => ({name:n.getName(), matrix:n.getMatrix(), mesh:meshes.indexOf(n.getMesh()), children:n.listChildren().map(c=>nodes.indexOf(c))})),
    skins: root.listSkins().map(s=>({joints:s.listJoints().map(n=>nodes.indexOf(n)), skeleton:nodes.indexOf(s.getSkeleton()), inverseBind:accessors.indexOf(s.getInverseBindMatrices())})),
    textures: root.listTextures().map(t=>({name:t.getName(), pixels:hash(t.getImage())})),
  };
}
const partKey=(name,extras)=>[name,extras.itemModelPart??'',extras.itemModelBone??'',extras.itemModelDeform??''].join(':');
async function robeParts(theme,after) {
  // Recover exporter corner ranges from the current named source meshes. The
  // GLB preserves their ordered sourceParts list; every emitted position is
  // checked below before these ranges authorize any deviation from R11.
  const {buildRobe}=await tsImport('../../tools/item-models/tier50-70/robe.ts',import.meta.url);
  const material=ending=>{
    const name=after.getRoot().listMaterials().find(m=>m.getName().endsWith(ending))?.getName();
    assert(name,`Missing material ${ending}`);return new THREE.MeshStandardMaterial({name});
  };
  const scutes=Array.from({length:6},(_,i)=>material(`scute-${i+1}-pebbled-hide`));
  const mats={cloth:material('close-twill-cloth'),lining:material('soft-dark-lining'),
    metal:material(theme==='dragonhide'?'chased-antique-gold':'chased-ivory-silver'),
    thread:material('fine-stitch-thread'),gem:material('polished-inset-stone'),scutes,scales:scutes[0],sole:scutes[0]};
  const group=buildRobe(theme,mats),rows=new Map();group.updateMatrixWorld(true);
  const frontNames=new Set(theme==='dragonhide'?['Dragonhide single central pointed cloth tabard']
    :['Split front long folded cloth tail 0','Split front long folded cloth tail 7']);
  const uvOnlyNames=new Set(['Smooth fitted sleeveless cloth bodice','Continuous upper back and curved open armholes',
    ...(theme==='dragonhide'?[1,2,3,4,5,6,7]:[1,2,3,4,5,6]).map(k=>`Overlapping side and back long folded cloth tail ${k}`),
    ...(theme==='dragonhide'
    ?['Open V folded lapel -1','Open V folded lapel 1']
    :['Starhide over crossing folded inner chest cloth','Starhide under crossing folded inner chest cloth',
      'Overlapping long V folded lapel -1','Overlapping long V folded lapel 1'])]);
  group.traverse(child=>{
    if(!child.isMesh)return;
    const geometry=child.geometry,indices=geometry.getIndex();
    const slices=Array.isArray(child.material)?geometry.groups:[{start:0,count:indices?.count??geometry.getAttribute('position').count,materialIndex:0}];
    for(const slice of slices){
      const mat=Array.isArray(child.material)?child.material[slice.materialIndex]:child.material;
      const key=partKey(mat.name,child.userData),row=rows.get(key)??{count:0,ranges:[]};
      const front=frontNames.has(child.name);
      if(front){assert.equal(geometry.getAttribute('position').count,1178);assert.equal(indices.count,7056);}
      const ornament=child.name.startsWith('Tail 0 sculpted hem ornament')
        ||(theme==='starhide'&&child.name.startsWith('Tail 7 sculpted hem ornament'));
      const kind=front?(slice.materialIndex===0?'outer':'lining'):ornament?'ornament':undefined;
      row.ranges.push({name:child.name,start:row.count,end:row.count+slice.count,sliceStart:slice.start,kind,
        uvOnly:uvOnlyNames.has(child.name),geometry,matrix:child.matrixWorld.clone()});
      row.count+=slice.count;rows.set(key,row);
    }
  });
  return {rows,group,materials:[...new Set(Object.values(mats).flat())]};
}
async function compareDrape(before,after,theme,itemId) {
  const source=await robeParts(theme,after),a=before.getRoot(),b=after.getRoot();
  const topology=doc=>{const g=geometry(doc);return {nodes:g.nodes,skins:g.skins.map(({inverseBind,...s})=>s)};};
  assert.deepEqual(topology(before),topology(after),`${itemId}: node transforms or rig topology changed`);
  assert.equal(a.listSkins().length,b.listSkins().length);
  a.listSkins().forEach((s,i)=>assert.deepEqual(s.getInverseBindMatrices().getArray(),b.listSkins()[i].getInverseBindMatrices().getArray()));
  const oldMeshes=a.listMeshes(),newMeshes=b.listMeshes();assert.equal(oldMeshes.length,newMeshes.length);
  let triangles=0,preservedCorners=0,guardCorners=0,changedCorners=0,changedUVScalars=0,changedWeightScalars=0;
  const maxDisplacement={outer:0,lining:0,ornament:0},parts=new Set(),uvOnlyParts=new Set();
  try {
    for(let m=0;m<oldMeshes.length;m++){
      const oldNode=a.listNodes().find(n=>n.getMesh()===oldMeshes[m]);
      const node=b.listNodes().find(n=>n.getMesh()===newMeshes[m]);
      const ap=oldMeshes[m].listPrimitives(),bp=newMeshes[m].listPrimitives();assert.equal(ap.length,bp.length);
      for(let p=0;p<ap.length;p++){
        const x=ap[p],y=bp[p],name=x.getMaterial().getName();assert.equal(y.getMaterial().getName(),name);
        const row=source.rows.get(partKey(name,node.getExtras()));assert(row,`${itemId}: source grouping changed`);
        assert.deepEqual(node.getExtras().sourceParts,row.ranges.map(range=>range.name));
        assert.deepEqual(oldNode.getExtras().sourceParts,node.getExtras().sourceParts);
        assert.equal(x.getMode(),y.getMode());assert.deepEqual(x.listSemantics().sort(),y.listSemantics().sort());
        const ix=x.getIndices()?.getArray(),iy=y.getIndices()?.getArray();
        const count=ix?.length??x.getAttribute('POSITION').getCount();
        assert.equal(iy?.length??y.getAttribute('POSITION').getCount(),count);assert.equal(row.count,count);triangles+=count/3;
        const xp=x.getAttribute('POSITION').getArray(),yp=y.getAttribute('POSITION').getArray();
        let rangeIndex=0;
        for(let corner=0;corner<count;corner++){
          while(corner>=row.ranges[rangeIndex].end)rangeIndex++;
          const range=row.ranges[rangeIndex],ai=ix?.[corner]??corner,bi=iy?.[corner]??corner;
          const offset=range.sliceStart+corner-range.start,vertex=range.geometry.getIndex()?.getX(offset)??offset;
          const emitted=new THREE.Vector3().fromBufferAttribute(range.geometry.getAttribute('position'),vertex).applyMatrix4(range.matrix);
          for(let c=0;c<3;c++)assert(Math.abs(emitted.getComponent(c)-yp[bi*3+c])<2e-7,`${itemId}: incorrect source corner mapping`);
          const delta=[0,1,2].map(c=>yp[bi*3+c]-xp[ai*3+c]),distance=Math.hypot(...delta);
          let guard=false;
          if(range.kind==='outer'||range.kind==='lining'){
            const grid=vertex%589,u=(grid%19)/18,v=Math.floor(grid/19)/30;
            guard=u<=.095||u>=.905||v<=.08||v>=.97;
          }
          if(!range.kind||guard){assert.equal(distance,0,`${itemId}: changed fixed part/guard ${range.name}`);preservedCorners++;if(guard)guardCorners++;}
          else{
            maxDisplacement[range.kind]=Math.max(maxDisplacement[range.kind],distance);
            if(distance>1e-7){changedCorners++;parts.add(range.name);}
            if(range.kind==='outer'){assert.equal(delta[0],0);assert.equal(delta[1],0);}
          }
          for(const semantic of x.listSemantics()){
            if(semantic==='POSITION')continue;
            const old=x.getAttribute(semantic),current=y.getAttribute(semantic);
            assert.equal(old.getType(),current.getType());assert.equal(old.getComponentType(),current.getComponentType());
            assert.equal(old.getNormalized(),current.getNormalized());
            const size=old.getElementSize(),oa=old.getArray(),ca=current.getArray();
            for(let c=0;c<size;c++){
              const from=oa[ai*size+c],to=ca[bi*size+c];
              // Hanging cloth and the explicit bodice/chest/lapel shells use
              // upright textile UVs. UV-only parts retain all other attributes.
              const allowed=(semantic==='TEXCOORD_0'&&(range.kind||range.uvOnly))
                ||(range.kind&&!guard&&(semantic==='NORMAL'||(distance>0&&semantic==='WEIGHTS_0')));
              if(!allowed)assert.equal(to,from,`${itemId}: ${range.name} changed fixed ${semantic}`);
              else{assert(Number.isFinite(to));
                if(semantic==='TEXCOORD_0'){
                  const sourceUV=range.geometry.getAttribute('uv');assert.equal(to,sourceUV.array[vertex*2+c],`${itemId}: cloth UV no longer matches its authored surface`);
                  if(to!==from){changedUVScalars++;if(range.uvOnly)uvOnlyParts.add(range.name);}
                }
                if(semantic==='WEIGHTS_0'){assert(to>=0&&to<=1);if(to!==from)changedWeightScalars++;}}
            }
          }
          if(range.kind&&!guard&&distance>0){
            const smooth=(low,high,value)=>{const t=Math.max(0,Math.min(1,(value-low)/(high-low)));return t*t*(3-2*t);};
            const swing=(.30+.30*smooth(-.075,.085,yp[bi*3+2]))*(1-smooth(.34,1.04,yp[bi*3+1]));
            const left=smooth(-.20,.20,yp[bi*3]),expected=[1-swing,swing*left,swing*(1-left),0];
            const weights=y.getAttribute('WEIGHTS_0').getArray();
            expected.forEach((value,c)=>assert(Math.abs(weights[bi*4+c]-value)<1e-6,`${itemId}: moved cloth weights do not follow the existing skirt rule`));
          }
        }
      }
    }
    assert(triangles<=150000);assert(changedCorners>0);assert(guardCorners>0);
    for(const [kind,distance] of Object.entries(maxDisplacement))assert(distance<=.0120001,
      `${itemId}: ${kind} exceeds 12 mm exported displacement; measured ${JSON.stringify(maxDisplacement)}`);
    return {rigAndJointsUnchanged:true,decodedTriangleTopologyUnchanged:true,scalesAndUnrelatedPartsExact:true,
      fixedGuardVerticesExact:true,preservedCorners,guardCorners,changedCorners,changedUVScalars,changedWeightScalars,
      maxDisplacement,displacementLimit:.012,parts:[...parts].sort(),uvOnlyParts:[...uvOnlyParts].sort(),
      uvOnlyPartGeometryNormalsJointsAndWeightsExact:true,triangles};
  }finally{
    source.group.traverse(child=>{if(child.isMesh)child.geometry.dispose();});source.materials.forEach(material=>material.dispose());
  }
}
async function compareR11(before,after,itemId,theme,file,bytes) {
  const meshData=doc=>{const {textures,...rest}=geometry(doc);return rest;};
  const drape=itemId.endsWith('_robe')?await compareDrape(before,after,theme,itemId):undefined;
  if(!drape)assert.deepEqual(meshData(before),meshData(after),`${itemId}: R12 changed non-robe geometry, normals, UVs, weights or rig`);
  const prior=before.getRoot().listMaterials(),current=after.getRoot().listMaterials();
  assert.equal(prior.length,current.length);
  for(const material of prior.filter(m=>!m.getName().endsWith('close-twill-cloth'))) {
    const revised=current.find(m=>m.getName()===material.getName());
    const pigmentVariant=theme==='starhide'?material.getName().match(/^starhide-scute-([1-6])-pebbled-hide$/):undefined;
    assert(revised && material.equals(revised,new Set(['extras',...(pigmentVariant?['baseColorFactor']:[])])),`${itemId}: R12 changed non-cloth material/texture ${material.getName()}`);
    if(pigmentVariant)assert.deepEqual(revised.getBaseColorFactor(),[...new THREE.Color(starhideScalePigment[Number(pigmentVariant[1])-1]).toArray(),1],`${itemId}: unexpected T70 scale pigment`);
    const {surfaceConstruction:oldDescription,...oldExtras}=material.getExtras();
    const {surfaceConstruction:newDescription,...newExtras}=revised.getExtras();
    assert.deepEqual(newExtras,oldExtras,`${itemId}: unrelated non-cloth metadata changed`);
    assert(oldDescription===newDescription||(oldDescription==='actual overlapping plate geometry with original procedural fine grain'
      &&newDescription==='original procedural fine grain over authored geometry'),`${itemId}: unexpected material construction metadata change`);
  }
  const oldCloth=prior.find(m=>m.getName().endsWith('close-twill-cloth'));
  const cloth=current.find(m=>m.getName().endsWith('close-twill-cloth'));
  if(cloth && oldCloth) {
    assert.deepEqual(cloth.getBaseColorFactor(),[1,1,1,1],'R12 cloth dye must live in the RGB yarn texture');
    assert.notEqual(hash(cloth.getNormalTexture().getImage()),hash(oldCloth.getNormalTexture().getImage()),'R12 cloth normal texture did not change');
  }
  return {available:true,file,sha256:hash(bytes),exactGeometryAndRigUnchanged:!drape,...(drape?{drape}:{}),
    nonClothTextureBytesUnchanged:true,nonClothMaterialsUnchangedExceptDeclaredPigment:true,
    ...(theme==='starhide'?{scalePigmentRevision:{srgb:starhideScalePigment,onlyBaseColorFactorChanged:true}}:{}),
    geometrySha256:hash(JSON.stringify(meshData(after)))};
}
const clothProvenance=[];
const clothReference=imagegenRevision?{file:'art/tier50-70/references/embroidered-fabric-r12.png',
  sha256:hash(await readFile('art/tier50-70/references/embroidered-fabric-r12.png'))}:undefined;
if(imagegenRevision)for(const theme of ['dragonhide','starhide']) {
  const file=`art/tier50-70/textures/${theme}/provenance.json`,provenance=await json(file);
  const source=provenance.clothSource;
  assert.equal(source.mode,'built-in image_gen');
  assert.equal(source.sourceImage,`art/tier50-70/textures/imagegen-r12/${theme}-embroidered-source.png`);
  assert.equal(source.promptFile,`art/tier50-70/textures/imagegen-r12/${theme}-embroidered-prompt.txt`);
  assert.equal(source.baker,'tools/item-models/tier50-70/materials-imagegen.ts');
  assert.equal(hash(await readFile(source.sourceImage)),source.sourceSha256);
  assert.equal(hash(await readFile(source.promptFile)),source.promptSha256);
  assert.equal(source.colorSourceImage,source.sourceImage);
  assert.equal(source.colorPromptFile,source.promptFile);
  assert.equal(hash(await readFile(source.colorSourceImage)),source.colorSourceSha256);
  assert.equal(hash(await readFile(source.colorPromptFile)),source.colorPromptSha256);
  assert.equal(source.dyeMeanSRGB,theme==='dragonhide'?'#571827':'#25355d','Expected nominal dye target as an sRGB hex color');
  assert.equal(source.referenceImage,clothReference.file);assert.equal(source.referenceSha256,clothReference.sha256);
  assert.equal(source.editTargetImage,`art/tier50-70/textures/imagegen-r12/${theme}-botanical-source-v1.png`);
  assert.equal(source.editTargetSha256,hash(await readFile(source.editTargetImage)));
  assert.equal(source.imagegenIntent,'edit: sparse celestial embroidery replaces botanical pattern');
  assert.equal(source.packedMaterial.file,'cloth-roughness.png');
  assert.deepEqual(source.packedMaterial.channels,{R:'unused white',G:'roughness',B:'metallic'});
  assert.deepEqual(source.packedMaterial.baseCloth,{metallic:0,roughness:[.92,.99]});
  assert.deepEqual(source.packedMaterial.embroidery,{maxMetallic:.58,roughness:.46});
  assert(source.method.includes('not measured'),'Cloth provenance must identify inferred relief');
  const maps=provenance.files.filter(row=>row.file.startsWith('cloth-'));
  assert.equal(maps.length,3);
  for(const row of maps) {
    assert(row.width>0 && row.height>0);
    assert.equal(hash(await readFile(`art/tier50-70/textures/${theme}/${row.file}`)),row.sha256);
  }
  const threadColor=await clothColorStats(await readFile(`art/tier50-70/textures/${theme}/cloth-color.png`),theme);
  const embroidery=await embroideredSurfaceStats(await readFile(`art/tier50-70/textures/${theme}/cloth-color.png`),
    await readFile(`art/tier50-70/textures/${theme}/cloth-roughness.png`),theme);
  const patternDensity=await compareBotanicalDensity(theme,source.sourceImage);
  clothProvenance.push({theme,file,sha256:hash(await readFile(file)),clothSource:source,maps,threadColor,embroidery,patternDensity});
}
const assets=[];
for (const theme of ['dragonhide','starhide']) for (const piece of ['hood','robe','leggings','boots','wraps']) {
  const itemId=`${theme}_${piece}`, file=`art/item-models/candidates/armor-${theme}-reference/models/items/${itemId}.glb`;
  const baseline=`test-results/tier50-70/r10-material-baseline/${itemId}.glb`;
  const [before,after]=await Promise.all([io.read(baseline),io.read(file)]);
  const r11File=`test-results/tier50-70/r11-texture-baseline/${itemId}.glb`;
  const r11Bytes=imagegenRevision?await readFile(r11File):undefined;
  const r11=imagegenRevision?await io.readBinary(r11Bytes):undefined;
  const relief={...compareRelief(before,r11??after,itemId),comparison:imagegenRevision?'R10 to preserved R11':'R10 to current'};
  const r11Baseline=imagegenRevision?await compareR11(r11,after,itemId,theme,r11File,r11Bytes):undefined;
  const scutes=after.getRoot().listMaterials().filter(m=>m.getName().includes('-scute-'));
  assert.equal(scutes.length,6);
  for (const m of scutes) {
    const film=m.getExtension('KHR_materials_iridescence'),coat=m.getExtension('KHR_materials_clearcoat');
    assert(film && coat,`${m.getName()}: missing exported physical finish`);
    assert.equal(film.getIridescenceFactor(),theme==='dragonhide'?.85:1);assert.equal(film.getIridescenceIOR(),theme==='dragonhide'?1.35:1.45);
    assert.equal(coat.getClearcoatFactor(),theme==='dragonhide'?.38:.42);assert.equal(coat.getClearcoatRoughnessFactor(),.19);
    const variant=Number(m.getName().match(/-scute-(\d+)-/)[1])-1;
    assert.equal(film.getIridescenceThicknessMinimum(),100);
    assert.equal(film.getIridescenceThicknessMaximum(),[320,380,345,410,365,300][variant]);
    assert.equal(m.getMetallicFactor(),theme==='dragonhide'?.52:.70);
    assert.equal(m.getRoughnessFactor(),theme==='dragonhide'?.60:.48);
    assert.equal(m.getNormalScale(),.72);
  }
  const beforeCloth=before.getRoot().listMaterials().find(m=>m.getName().endsWith('close-twill-cloth'));
  const cloth=after.getRoot().listMaterials().find(m=>m.getName().endsWith('close-twill-cloth'));
  if(cloth && beforeCloth) {
    assert.notDeepEqual(cloth.getBaseColorFactor(),beforeCloth.getBaseColorFactor());
    assert.equal(cloth.getExtension('KHR_materials_ior').getIOR(),1.3);
    assert.equal(cloth.getMetallicFactor(),imagegenRevision?1:0);assert.equal(cloth.getRoughnessFactor(),1);
    if(imagegenRevision){
      assert.equal(cloth.getExtension('KHR_materials_clearcoat')?.getClearcoatFactor()??0,0);
      assert.deepEqual(cloth.getExtension('KHR_materials_sheen')?.getSheenColorFactor()??[0,0,0],[0,0,0]);
    }
  }
  const threadColor=imagegenRevision&&cloth?await clothColorStats(cloth.getBaseColorTexture().getImage(),theme):undefined;
  if(threadColor){
    assert.deepEqual(cloth.getBaseColorFactor(),[1,1,1,1]);
    assert.equal(threadColor.pixelSha256,clothProvenance.find(row=>row.theme===theme).threadColor.pixelSha256,`${itemId}: embedded cloth pixels differ from the provenanced bake`);
  }
  const embroidery=imagegenRevision&&cloth?await embroideredSurfaceStats(cloth.getBaseColorTexture().getImage(),cloth.getMetallicRoughnessTexture().getImage(),theme):undefined;
  if(embroidery)assert.equal(embroidery.packedChannelsSha256,clothProvenance.find(row=>row.theme===theme).embroidery.packedChannelsSha256,`${itemId}: embedded G/B cloth channels differ from the provenanced bake`);
  assets.push({itemId,file,sha256:hash(await readFile(file)),baselineSha256:hash(await readFile(baseline)),relief,...(r11Baseline?{r11Baseline}:{}),geometrySha256:hash(JSON.stringify(geometry(after))),cloth:cloth?{baseColor:cloth.getBaseColorFactor(),ior:1.3,metalness:cloth.getMetallicFactor(),roughness:1,...(threadColor?{threadColor}:{}),...(embroidery?{embroidery}:{})}:undefined,scutes:scutes.map(m=>({name:m.getName(),baseColor:m.getBaseColorFactor(),metalness:m.getMetallicFactor(),roughness:m.getRoughnessFactor(),iridescence:m.getExtension('KHR_materials_iridescence').getIridescenceFactor(),ior:m.getExtension('KHR_materials_iridescence').getIridescenceIOR(),thickness:m.getExtension('KHR_materials_iridescence').getIridescenceThicknessMaximum(),clearcoat:m.getExtension('KHR_materials_clearcoat').getClearcoatFactor()}))});
}
const report={round,passed:true,method:(imagegenRevision?'Preserve the R10-to-R11 bounded scale-relief proof, then compare all ten current GLBs to preserved R11. Exact non-robe geometry, scale geometry/textures/physical parameters, unrelated source parts, joints and rig. Only the six T70 scute baseColorFactor values may change among non-cloth materials; require the declared darker palette in linear RGB, with all other non-cloth parameters, textures and extras preserved. Map robe triangle corners to verified named source-part ranges; permit at most 12 mm only on front cloth shells and attached hem ornaments, with exact outer X/Y and seam/waist/hem guard positions. Normals and corresponding moved-vertex weights may change only within those draped parts. UVs must match the current authored source on draped parts and on explicitly named remaining cloth tails, bodice, chest, lapel and upper-back shells; those additional shells retain exact positions, normals, joints and weights. No subdivision. Verify the supplied embroidery reference, per-theme imagegen source/prompt and baked-map hashes; inferred textile relief is not measured. Require white cloth factors, matching decoded baked/embedded color and packed G roughness/B metallic channels, maroon/navy nonmetallic base fabric and warm gold metallic thread cores. Record nominal dye targets separately from actual pixel means and measure decoration coverage against preserved botanical sources when present.':'Compare decoded triangle corners against preserved R10 GLBs: cloth and trim positions stay exact; only scute faces/cut-edge batches may move, below 8 mm. Triangle counts, UV layout, skeleton and node transforms remain exact. Cloth grain/dye/ripple maps and hide normal/roughness maps are revised; other color texture images are preserved.')+' Verify sixty film/clearcoat materials and low-IOR base cloth.',...(imagegenRevision?{clothReference,clothProvenance}:{}),assets};
await writeFile('runs/tier50-70/evidence/materials.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,assets:assets.length,scaleMaterials:assets.reduce((n,a)=>n+a.scutes.length,0),garmentSilhouetteAndRigUnchanged:true,maxScaleDisplacement:Math.max(...assets.map(a=>a.relief.maxScaleDisplacement))}));
