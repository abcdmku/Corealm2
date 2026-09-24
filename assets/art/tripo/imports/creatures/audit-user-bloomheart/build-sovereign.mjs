import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {Accessor,NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import sharp from 'sharp';

const dir='assets/art/tripo/imports/creatures/audit-user-bloomheart';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc=await io.read(dir+'/bloomheart-matriarch-candidate.glb'),root=doc.getRoot();
const silverwoodSource=dir+'/textures/sovereign-silverwood-uv-imagegen.png';
const silverwoodImage=await sharp(silverwoodSource).resize(2048,2048).jpeg({quality:94,chromaSubsampling:'4:4:4'}).toBuffer();
const bark=doc.createTexture('Image generated silverwood violet foliage and opal blossoms').setImage(silverwoodImage).setMimeType('image/jpeg');
const formerBase=root.listMaterials()[0].getBaseColorTexture();
root.listMaterials()[0].setBaseColorTexture(bark);
formerBase.dispose();
const textureImage=await sharp(dir+'/textures/amethyst-imagegen.png').flatten({background:'#4b3168'}).extract({left:125,top:125,width:1000,height:1000}).resize(1024,1024).jpeg({quality:94,chromaSubsampling:'4:4:4'}).toBuffer();
const image=doc.createTexture('Image generated amethyst facets and gold veins').setImage(textureImage).setMimeType('image/jpeg');
const crystal=doc.createMaterial('Amethyst crystal with silver and gold inclusions').setBaseColorTexture(image).setMetallicFactor(.12).setRoughnessFactor(.35).setDoubleSided(true);
const nodes=new Map(root.listNodes().map(n=>[n.getName(),n]));
const crystals={Crown:[],LeftTwig:[],RightTwig:[],Bole:[]};
for(let i=0;i<16;i++){const a=i*Math.PI*2/16,r=.07+.05*(i%3)/2;crystals.Crown.push({p:[Math.cos(a)*r,.03,Math.sin(a)*r],height:.12+.07*(i%4)/3,width:.017+.006*(i%3),tilt:[Math.cos(a)*.5,1,Math.sin(a)*.5]});}
for(const side of ['LeftTwig','RightTwig'])for(let i=0;i<6;i++)crystals[side].push({p:[(i%2)*.012-.006,.01+(i%3)*.025,(side==='LeftTwig'?1:-1)*(.01+i*.015)],height:.09+.035*(i%3),width:.012+.004*(i%2),tilt:[.2,1,(side==='LeftTwig'?1:-1)*.3]});
for(let i=0;i<8;i++){const a=i*Math.PI*2/8;crystals.Bole.push({p:[Math.cos(a)*.085,.04+Math.sin(i*3)*.06,Math.sin(a)*.085],height:.09+.02*(i%3),width:.018,tilt:[Math.cos(a)*.8,.6,Math.sin(a)*.8]});}
for(const [bone,list] of Object.entries(crystals)){
 const pos=[],uv=[],norm=[],idx=[];
 for(let ci=0;ci<list.length;ci++){const c=list[ci],[x,y,z]=c.p,w=c.width,h=c.height,t=c.tilt;
  const base=Array.from({length:6},(_,i)=>{const a=i*Math.PI/3;return [x+Math.cos(a)*w,y,z+Math.sin(a)*w]});
  const mid=base.map(p=>[p[0]+t[0]*h*.48,y+t[1]*h*.57,p[2]+t[2]*h*.48]);
  const tip=[x+t[0]*h,y+t[1]*h,z+t[2]*h];
  const triangle=(v0,v1,v2,face)=>{
   const ax=v1[0]-v0[0],ay=v1[1]-v0[1],az=v1[2]-v0[2],bx=v2[0]-v0[0],by=v2[1]-v0[1],bz=v2[2]-v0[2];
   let nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx,len=Math.hypot(nx,ny,nz)||1;nx/=len;ny/=len;nz/=len;
   const start=pos.length/3;for(const p of [v0,v1,v2]){pos.push(...p);norm.push(nx,ny,nz);}idx.push(start,start+1,start+2);
   const u=.12+((ci*7+face*3)%11)*.055,v=.12+((ci*5+face*2)%11)*.055;
   uv.push(u,v,u+.22,v+.02,u+.11,v+.27);
  };
  for(let k=0;k<6;k++){const next=(k+1)%6;triangle(base[k],base[next],mid[k],k*2);triangle(mid[k],base[next],mid[next],k*2+1);triangle(mid[k],mid[next],tip,k+12);}
 }
 const mesh=doc.createMesh(bone+' grown faceted amethyst');
 const primitive=doc.createPrimitive().setMaterial(crystal).setIndices(doc.createAccessor(bone+'Indices').setType(Accessor.Type.SCALAR).setArray(Uint16Array.from(idx)).setBuffer(root.listBuffers()[0]));
 primitive.setAttribute('POSITION',doc.createAccessor(bone+'Position').setType(Accessor.Type.VEC3).setArray(Float32Array.from(pos)).setBuffer(root.listBuffers()[0]));
 primitive.setAttribute('NORMAL',doc.createAccessor(bone+'Normal').setType(Accessor.Type.VEC3).setArray(Float32Array.from(norm)).setBuffer(root.listBuffers()[0]));
 primitive.setAttribute('TEXCOORD_0',doc.createAccessor(bone+'UV').setType(Accessor.Type.VEC2).setArray(Float32Array.from(uv)).setBuffer(root.listBuffers()[0]));
 mesh.addPrimitive(primitive);nodes.get(bone).addChild(doc.createNode(bone+'CrystalGrowths').setMesh(mesh));
}
const out=await io.writeBinary(doc),file=dir+'/amethyst-sovereign-candidate.glb';await writeFile(file,out);
const sha=b=>createHash('sha256').update(b).digest('hex');
await writeFile(dir+'/sovereign-validation.json',JSON.stringify({candidateFile:file,sha256:sha(out),bytes:out.length,derivedFrom:dir+'/bloomheart-matriarch-candidate.glb',sourceSha256:'b910e4ae7848a9b8f8da73e05df58b08de9388535daee58452ce158afb50d9ab',silverwoodMap:silverwoodSource,silverwoodPrompt:'Preserve the exact Bloomheart UV atlas layout and material anatomy; layered pale silverwood and deep plum heartwood with fine violet prismatic veins and tiny gold mineral fissures; variegated midnight violet, aubergine, dusky teal and pearl-lavender foliage with silver leaf veins; opalescent lilac and amethyst blossoms with luminous gold centers.',silverwoodRuntimeSha256:sha(silverwoodImage),imageGeneratedMap:dir+'/textures/amethyst-imagegen.png',imagePrompt:'Seamless tileable 2D amethyst crystal with lavender-to-violet facets, silver inclusions, gold mineral veins, magenta glints and internal fractures.',runtimeMapSha256:sha(textureImage),crystalCount:Object.values(crystals).reduce((a,c)=>a+c.length,0),attachedBones:Object.keys(crystals),status:'awaiting-root-lab-review'},null,2)+'\n');
console.log(JSON.stringify({file,sha256:sha(out),bytes:out.length,crystals:36},null,2));
