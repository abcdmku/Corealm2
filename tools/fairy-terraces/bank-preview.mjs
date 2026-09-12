import {readFile,writeFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {EXTTextureWebP} from '@gltf-transform/extensions';
import {PerspectiveCamera,Vector3} from 'three';
import sharp from 'sharp';
const W=1200,H=800;
const normalise = (x,y,z) => {const l=Math.hypot(x,y,z)||1;return[x/l,y/l,z/l]};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const lin=x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4};
const srgb=x=>Math.max(0,Math.min(255,Math.round(255*(x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055))));
for (const id of ['fairy_moss_bank_0','fairy_moss_bank_1']) {
 const doc=await new NodeIO().registerExtensions([EXTTextureWebP]).read(`test-results/fairy-terraces-assets/banks/models/${id}.glb`);
 const primitive=doc.getRoot().listMeshes()[0].listPrimitives()[0];
 const positions=primitive.getAttribute('POSITION').getArray(),normals=primitive.getAttribute('NORMAL').getArray(),uv=primitive.getAttribute('TEXCOORD_0').getArray();
 const mat=primitive.getMaterial();const textures=[];
 for(const t of [mat.getBaseColorTexture(),mat.getNormalTexture()])textures.push(await sharp(t.getImage()).raw().toBuffer({resolveWithObject:true}));
 for(const angle of [0,Math.PI/2]){
 const pixels=new Uint8Array(W*H*3),depth=new Float32Array(W*H).fill(Infinity);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const q=(y*W+x)*3;pixels[q]=36+y/H*16;pixels[q+1]=44+y/H*13;pixels[q+2]=48+y/H*10;}
 const camera=new PerspectiveCamera(40,W/H,.1,100);camera.position.set(Math.sin(angle+.5)*14,7.5,Math.cos(angle+.5)*14);camera.lookAt(0,1.9,0);camera.updateMatrixWorld(true);
 const point=new Vector3();
 const project = (x,y,z) => {point.set(x,y,z).applyMatrix4(camera.matrixWorldInverse);const zEye=-point.z;point.applyMatrix4(camera.projectionMatrix);return[(point.x*.5+.5)*W,(.5-point.y*.5)*H,zEye]};
 const projected=[];for(let i=0;i<positions.length;i+=3)projected.push(project(positions[i],positions[i+1]-.4,positions[i+2]));
 const light=normalise(-.5,.85,.65);
 for(let i=0;i<positions.length/3;i+=3){
 const pp=projected.slice(i,i+3), us=[0,1,2].map(k=>[uv[(i+k)*2],uv[(i+k)*2+1]]),ps=[0,1,2].map(k=>Array.from(positions.slice((i+k)*3,(i+k)*3+3)));
 const den=(pp[1][1]-pp[2][1])*(pp[0][0]-pp[2][0])+(pp[2][0]-pp[1][0])*(pp[0][1]-pp[2][1]);if(Math.abs(den)<.001)continue;
 const minX=Math.max(0,Math.floor(Math.min(...pp.map(p=>p[0])))),maxX=Math.min(W-1,Math.ceil(Math.max(...pp.map(p=>p[0]))));
 const minY=Math.max(0,Math.floor(Math.min(...pp.map(p=>p[1])))),maxY=Math.min(H-1,Math.ceil(Math.max(...pp.map(p=>p[1]))));
 const dp1=ps[1].map((v,k)=>v-ps[0][k]),dp2=ps[2].map((v,k)=>v-ps[0][k]),du1=us[1][0]-us[0][0],du2=us[2][0]-us[0][0],dv1=us[1][1]-us[0][1],dv2=us[2][1]-us[0][1];
 const inv=1/(du1*dv2-du2*dv1);const tangent=dp1.map((v,k)=>(v*dv2-dp2[k]*dv1)*inv),bitangent=dp2.map((v,k)=>(v*du1-dp1[k]*du2)*inv);
 for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
 let a=((pp[1][1]-pp[2][1])*(x+.5-pp[2][0])+(pp[2][0]-pp[1][0])*(y+.5-pp[2][1]))/den;
 let b=((pp[2][1]-pp[0][1])*(x+.5-pp[2][0])+(pp[0][0]-pp[2][0])*(y+.5-pp[2][1]))/den,c=1-a-b;if(Math.min(a,b,c)<0)continue;
 const z=1/(a/pp[0][2]+b/pp[1][2]+c/pp[2][2]),index=y*W+x;if(z>=depth[index])continue;depth[index]=z;a*=z/pp[0][2];b*=z/pp[1][2];c*=z/pp[2][2];
 const v=us[0].map((q,k)=>q*a+us[1][k]*b+us[2][k]*c);const n=normalise(...[0,1,2].map(k=>normals[i*3+k]*a+normals[(i+1)*3+k]*b+normals[(i+2)*3+k]*c));
 const sample=(texture)=>{const {info,data}=texture;const tx=Math.max(0,Math.min(info.width-1,Math.floor(v[0]*info.width))),ty=Math.max(0,Math.min(info.height-1,Math.floor(v[1]*info.height)));const q=(ty*info.width+tx)*info.channels;return[data[q],data[q+1],data[q+2]]};
 const tex=sample(textures[0]),ns=sample(textures[1]).map(q=>q/127.5-1),t=normalise(...tangent.map((q,k)=>q-n[k]*dot(n,tangent))),bt=cross(n,t),sign=dot(bt,bitangent)<0?-1:1;
 const actual=normalise(...n.map((q,k)=>t[k]*ns[0]+bt[k]*sign*ns[1]+q*ns[2]));const shade=.5+.68*Math.max(0,dot(actual,light));
 for(let k=0;k<3;k++)pixels[index*3+k]=srgb(lin(tex[k])*shade);
 }
 }
 const label=`<svg width="${W}" height="${H}"><text x="20" y="35" font-family="sans-serif" font-size="22" fill="white">${id}: source crag; CPU material/silhouette preview, not gameplay acceptance</text></svg>`;
 await sharp(pixels,{raw:{width:W,height:H,channels:3}}).composite([{input:Buffer.from(label)}]).png().toFile(`test-results/fairy-terraces-assets/banks/${id}-${angle===0?'front':'side'}.png`);
 }
}
