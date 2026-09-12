import {readFile,writeFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {EXTTextureWebP} from '@gltf-transform/extensions';
import {createHash} from 'node:crypto';
const root='test-results/fairy-terraces-assets/rounded-banks';
const reports=[];
for(const id of ['fairy_rounded_bank_0','fairy_rounded_bank_1']){
 const bytes=await readFile(`${root}/models/${id}.glb`),doc=await new NodeIO().registerExtensions([EXTTextureWebP]).readBinary(bytes);
 const scene=doc.getRoot().getDefaultScene(),nodes=scene.listChildren();
 if(nodes.length!==1||nodes[0].getTranslation().some(v=>v!==0)||nodes[0].getScale().some(v=>v!==1)||nodes[0].getRotation().some((v,i)=>v!==(i===3?1:0)))throw Error(`${id} not identity`);
 const mesh=nodes[0].getMesh();if(mesh.listPrimitives().length!==1)throw Error(`${id} extra draw calls`);
 const primitive=mesh.listPrimitives()[0],attribute=primitive.getAttribute('POSITION'),p=attribute.getArray(),n=primitive.getAttribute('NORMAL').getArray();
 const min=attribute.getMin([]),max=attribute.getMax([]);if(min[1]!==0||Math.abs(min[0]+max[0])>1e-5||Math.abs(min[2]+max[2])>1e-5)throw Error(`${id} invalid base`);
 const step=.1,w=Math.ceil((max[0]-min[0])/step),h=Math.ceil((max[2]-min[2])/step),heights=new Float32Array(w*h).fill(-Infinity);
 let downwardCaps=0,capArea=0;
 for(let i=0;i<p.length;i+=9){
  const ax=p[i],ay=p[i+1],az=p[i+2],bx=p[i+3],by=p[i+4],bz=p[i+5],cx=p[i+6],cy=p[i+7],cz=p[i+8];
  const den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(den)<1e-10)continue;
  if(ay===0&&by===0&&cy===0){downwardCaps++;capArea+=Math.abs(den)/2;if(n[i+1]>-.99)throw Error('Upward cap normal');}
  const xmin=Math.max(0,Math.floor((Math.min(ax,bx,cx)-min[0])/step)),xmax=Math.min(w-1,Math.ceil((Math.max(ax,bx,cx)-min[0])/step));
  const zmin=Math.max(0,Math.floor((Math.min(az,bz,cz)-min[2])/step)),zmax=Math.min(h-1,Math.ceil((Math.max(az,bz,cz)-min[2])/step));
  for(let row=zmin;row<=zmax;row++)for(let col=xmin;col<=xmax;col++){
   const x=min[0]+(col+.5)*step,z=min[2]+(row+.5)*step;
   const a=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den,b=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den,c=1-a-b;
   if(Math.min(a,b,c)<-1e-7)continue;const ii=row*w+col;heights[ii]=Math.max(heights[ii],ay*a+by*b+cy*c);
  }
 }
 const visited=new Uint8Array(w*h),components=[];for(let seed=0;seed<heights.length;seed++){
  if(visited[seed]||heights[seed]===-Infinity)continue;const stack=[seed];visited[seed]=1;let count=0;
  while(stack.length){const i=stack.pop(),x=i%w,y=Math.floor(i/w);count++;for(const j of [x>0?i-1:-1,x+1<w?i+1:-1,y>0?i-w:-1,y+1<h?i+w:-1])if(j>=0&&!visited[j]&&heights[j]!==-Infinity){visited[j]=1;stack.push(j);}}
  components.push(count);
 }
 components.sort((a,b)=>b-a);if(components.length!==1)throw Error(`${id} disconnected footprints: ${components}`);
 const visible=[...heights].filter(Number.isFinite);visible.sort((a,b)=>a-b);
 reports.push({id,sha256:createHash('sha256').update(bytes).digest('hex'),nodeIdentity:true,bounds:{min,max},triangles:p.length/9,meshCount:1,materialCount:1,downwardCaps,capAreaWithOverlaps:capArea,footprint:{gridStep:step,area:visible.length*step*step,connectedComponents:components.length},visibleHeights:{median:visible[Math.floor(visible.length*.5)],p90:visible[Math.floor(visible.length*.9)],maximum:Math.max(...visible)},undergroundGeometry:false,groundingRecommendation:'Place Y=ground-0.08*uniformScale. Use actual XZ footprint for collision and native highest Y for planting.'});
}
await writeFile(`${root}/geometry-validation.json`,JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2));
