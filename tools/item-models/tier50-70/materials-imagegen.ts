import * as THREE from 'three';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import type {GrainMaps} from './materials-textures.js';

const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const size=2048;
const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));

/** Close the height field at its tile boundaries before computing derivatives.
 * A narrow Hermite strip joins both value and first derivative, preventing a
 * hard normal-map seam without mirroring the interior weave or fold pattern.
 */
function periodic(field:Float64Array,maxSlope=Infinity):void {
 const band=40;
 const join=(indices:number[])=>{
  const values=indices.map(i=>field[i]!);
  const end=size-1, value=(values[0]!+values[end]!)/2;
  const slope=clamp(((values[2]!-values[0]!)+(values[end]!-values[end-2]!))/4,-maxSlope,maxSlope);
  const hermite=(a:number,b:number,da:number,db:number,t:number)=>
   (2*t**3-3*t*t+1)*a+(t**3-2*t*t+t)*da+(-2*t**3+3*t*t)*b+(t**3-t*t)*db;
  const leftSlope=clamp((values[band+1]!-values[band-1]!)/2,-maxSlope,maxSlope);
  const rightSlope=clamp((values[end-band+1]!-values[end-band-1]!)/2,-maxSlope,maxSlope);
  for(let i=0;i<=band;i++){
   field[indices[i]!]=hermite(value,values[band]!,slope*band,leftSlope*band,i/band);
   field[indices[end-band+i]!]=hermite(values[end-band]!,value,rightSlope*band,slope*band,i/band);
  }
 };
 for(let y=0;y<size;y++)join(Array.from({length:size},(_,x)=>y*size+x));
 for(let x=0;x<size;x++)join(Array.from({length:size},(_,y)=>y*size+x));
}

export async function imagegenCloth(theme:'dragonhide'|'starhide'):Promise<{maps:GrainMaps;provenance:Record<string,unknown>}> {
 const sourceImage=`art/tier50-70/textures/imagegen-r13/${theme}-embroidered-source.png`;
 const promptFile=`art/tier50-70/textures/imagegen-r13/${theme}-embroidered-prompt.txt`;
 const referenceImage='art/tier50-70/references/embroidered-fabric-r12.png';
 const editTargetImage=`art/tier50-70/textures/imagegen-r12/${theme}-embroidered-source.png`;
 const source=await readFile(sourceImage),prompt=await readFile(promptFile);
 const dyed=await sharp(source).resize(size,size,{fit:'fill'}).removeAlpha().raw().toBuffer();
 assert.equal(dyed.length,size*size*3);
 const dyeMeanSRGB=theme==='dragonhide'?'#571827':'#25355d';
 const target=new THREE.Color(dyeMeanSRGB).toArray();
 const toLinear=(byte:number)=>byte/255<=.04045?byte/255/12.92:Math.pow((byte/255+.055)/1.055,2.4);
 const toSRGB=(linear:number)=>255*(linear<=.0031308?linear*12.92:1.055*Math.pow(linear,1/2.4)-.055);
 const smooth=THREE.MathUtils.smoothstep;
 const stitch=new Float64Array(size*size),gray=new Uint8Array(size*size);
 const channelMeans=[0,0,0];let fabricWeight=0,clothGrayMean=0;
 for(let p=0;p<size*size;p++){
  const r=dyed[p*3]!/255,g=dyed[p*3+1]!/255,b=dyed[p*3+2]!/255;
  // The generated celestial embroidery is warm gold; both base textiles are
  // strongly separated from it in hue. Keep metal response on those yarns only.
  const mask=smooth((r-b)/Math.max(r,.01),.08,.28)*smooth(g/Math.max(r,.01),.28,.58)*smooth((r+g)/2,.12,.35);
  stitch[p]=mask;
  const weight=(1-mask)**4;fabricWeight+=weight;
  const luminance=(r*.2126+g*.7152+b*.0722)*255;
  gray[p]=Math.round(luminance);clothGrayMean+=luminance*weight;
  for(let c=0;c<3;c++)channelMeans[c]!+=toLinear(dyed[p*3+c]!)*weight;
 }
 for(let c=0;c<3;c++)channelMeans[c]!/=fabricWeight;clothGrayMean/=fabricWeight;
 const dyedChannels=[new Float64Array(size*size),new Float64Array(size*size),new Float64Array(size*size)];
 for(let i=0;i<size*size;i++)for(let c=0;c<3;c++){
  const linear=toLinear(dyed[i*3+c]!),relative=linear/channelMeans[c]!;
  const fabric=target[c]!*Math.pow(relative,.48);
  dyedChannels[c]![i]=clamp(toSRGB(THREE.MathUtils.lerp(fabric,linear*.80,stitch[i]!)),0,255);
 }
 for(const field of dyedChannels)periodic(field,.08);
 // Remove the bright gold pigment from the low-frequency cloth estimate. The
 // stitch relief is added independently, so gold does not become giant ridges.
 for(let i=0;i<gray.length;i++)gray[i]=Math.round(THREE.MathUtils.lerp(gray[i]!,clothGrayMean,stitch[i]!));
 const blurred=async(sigma:number)=>sharp(gray,{raw:{width:size,height:size,channels:1}}).blur(sigma).grayscale().raw().toBuffer();
 const [medium,broad]=await Promise.all([blurred(1.6),blurred(14)]);
 for(const plane of [gray,medium,broad])assert.equal(plane.length,size*size,'Cloth height planes must contain one scalar per pixel');
 const height=new Float64Array(size*size),rough=new Float64Array(size*size),metal=new Float64Array(size*size);
 let mean=0;for(const value of broad)mean+=value/(size*size);
 for(let i=0;i<gray.length;i++){
  const macro=(broad[i]!-mean)/255,mid=(medium[i]!-broad[i]!)/255,fine=(gray[i]!-medium[i]!)/255;
  height[i]=macro*.010+mid*.0007+fine*.00018+stitch[i]!*.0008;
  const fabricRough=clamp(.95+Math.abs(fine)*.2-mid*.05,.92,.99);
  rough[i]=THREE.MathUtils.lerp(fabricRough,.46,stitch[i]!);
  metal[i]=stitch[i]!*.58;
 }
 periodic(height,.000005);periodic(rough,.0003);periodic(metal,.0003);
 const colorBytes=new Uint8Array(size*size*4),normalBytes=new Uint8Array(size*size*4),roughBytes=new Uint8Array(size*size*4);
 const sample=(x:number,y:number)=>height[((y+size)%size)*size+(x+size)%size]!;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const p=y*size+x,i=p*4;
  const dx=clamp((sample(x+1,y)-sample(x-1,y))*size/(2*.35),-.8,.8);
  const dy=clamp((sample(x,y+1)-sample(x,y-1))*size/(2*.35),-.8,.8);
  const length=Math.hypot(dx,dy,1);
  colorBytes.set([Math.round(dyedChannels[0]![p]!),Math.round(dyedChannels[1]![p]!),Math.round(dyedChannels[2]![p]!),255],i);
  normalBytes.set([Math.round((.5-.5*dx/length)*255),Math.round((.5-.5*dy/length)*255),Math.round((.5+.5/length)*255),255],i);
  roughBytes.set([255,Math.round(clamp(rough[p]!,0,1)*255),Math.round(clamp(metal[p]!,0,1)*255),255],i);
 }
 const texture=(data:Uint8Array,name:string,color=false)=>{
  const t=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);t.name=`imagegen-r13-cloth-${name}`;
  t.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.anisotropy=8;t.needsUpdate=true;return t;
 };
 return {maps:{map:texture(colorBytes,'color',true),normalMap:texture(normalBytes,'normal'),roughnessMap:texture(roughBytes,'roughness')},provenance:{
  mode:'built-in image_gen',sourceImage,sourceSha256:digest(source),promptFile,promptSha256:digest(prompt),
  colorSourceImage:sourceImage,colorSourceSha256:digest(source),colorPromptFile:promptFile,colorPromptSha256:digest(prompt),dyeMeanSRGB,
  referenceImage,referenceSha256:digest(await readFile(referenceImage)),
  editTargetImage,editTargetSha256:digest(await readFile(editTargetImage)),imagegenIntent:'edit: calmer fine cloth with moderately more celestial embroidery',
  albedoEncoding:'Imagegen embroidered textile RGB. Base-yarn mean normalized to deep robe dye, value ratios softened with power .48. Preserve warm embroidery color at 80 percent linear reflectance. White base factor.',
  baker:'tools/item-models/tier50-70/materials-imagegen.ts',
  method:'Imagegen fabric edited for quieter nap and moderately more celestial threadwork. Separate hue-selected raised stitch relief and restrained fabric microrelief; inferred heights, not measured material data',
  resolution:[size,size],nominalTileMeters:.35,heightGains:{broad:.010,medium:.0007,yarn:.00018,stitch:.0008},
  packedMaterial:{file:'cloth-roughness.png',channels:{R:'unused white',G:'roughness',B:'metallic'},baseCloth:{metallic:0,roughness:[.92,.99]},embroidery:{maxMetallic:.58,roughness:.46},mask:'Warm-gold hue and brightness, isolated from maroon/navy base'},
  boundary:'40-pixel Hermite closure with bounded tangents for height, RGB, roughness and metallic mask',
 }};
}
