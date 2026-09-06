// Original procedural replacement material, sampled in source object space into
// the authored UV atlas. No excluded photography or source colour maps are used.
import sharp from 'sharp';
import * as T from 'three';
import {ImprovedNoise} from 'three/addons/math/ImprovedNoise.js';
import {loadLavaSource} from './source-glb.mjs';
const source=loadLavaSource('tools/rpg-bestiary/lava-golem-source/derived/idle.glb'),N=1024,noise=new ImprovedNoise(),rgb=Buffer.alloc(N*N*3,92),normal=Buffer.alloc(N*N*3),mask=new Uint8Array(N*N);
for(let i=0;i<N*N;i++)normal.set([128,128,255],i*3);
const n=(x,y,z,f)=>noise.noise(x*f+17.2,y*f-4.7,z*f+8.1);
source.object.traverse(o=>{if(!o.isMesh)return;const g=o.geometry,p=g.attributes.position,uv=g.attributes.uv,ix=g.index.array;
for(let q=0;q<ix.length;q+=3){const [a,b,c]=[ix[q],ix[q+1],ix[q+2]],A=new T.Vector3().fromBufferAttribute(p,a),B=new T.Vector3().fromBufferAttribute(p,b),C=new T.Vector3().fromBufferAttribute(p,c),u=[uv.getX(a)*N,uv.getX(b)*N,uv.getX(c)*N],v=[uv.getY(a)*N,uv.getY(b)*N,uv.getY(c)*N],det=(v[1]-v[2])*(u[0]-u[2])+(u[2]-u[1])*(v[0]-v[2]);if(Math.abs(det)<1e-8)continue;
const e1=B.clone().sub(A),e2=C.clone().sub(A),du1=u[1]-u[0],du2=u[2]-u[0],dv1=v[1]-v[0],dv2=v[2]-v[0],d=du1*dv2-du2*dv1,t=e1.clone().multiplyScalar(dv2).addScaledVector(e2,-dv1).divideScalar(d).normalize(),bit=e2.clone().multiplyScalar(du1).addScaledVector(e1,-du2).divideScalar(d).normalize();
for(let y=Math.max(0,Math.floor(Math.min(...v)));y<=Math.min(N-1,Math.ceil(Math.max(...v)));y++)for(let x=Math.max(0,Math.floor(Math.min(...u)));x<=Math.min(N-1,Math.ceil(Math.max(...u)));x++){
const wa=((v[1]-v[2])*(x+.5-u[2])+(u[2]-u[1])*(y+.5-v[2]))/det,wb=((v[2]-v[0])*(x+.5-u[2])+(u[0]-u[2])*(y+.5-v[2]))/det,wc=1-wa-wb;if(Math.min(wa,wb,wc)<-.002)continue;
const px=A.x*wa+B.x*wb+C.x*wc,py=A.y*wa+B.y*wb+C.y*wc,pz=A.z*wa+B.z*wb+C.z*wc,grain=n(px,py,pz,160),broad=n(px,py,pz,7),mid=n(px,py,pz,35),value=Math.max(32,Math.min(165,105+broad*43+mid*26+grain*15)),i=(y*N+x)*3;
rgb[i]=value*1.02;rgb[i+1]=value;rgb[i+2]=value*.96;mask[y*N+x]=1;
const eps=.001,ht=n(px+t.x*eps,py+t.y*eps,pz+t.z*eps,95)-n(px-t.x*eps,py-t.y*eps,pz-t.z*eps,95),hb=n(px+bit.x*eps,py+bit.y*eps,pz+bit.z*eps,95)-n(px-bit.x*eps,py-bit.y*eps,pz-bit.z*eps,95),nn=new T.Vector3(-ht*.72,hb*.72,1).normalize();normal[i]=(nn.x*.5+.5)*255;normal[i+1]=(nn.y*.5+.5)*255;normal[i+2]=(nn.z*.5+.5)*255;
}}});
// Four texels of padding prevent atlas borders from bleeding at mip transitions.
for(let pass=0;pass<4;pass++){const before=mask.slice();for(let y=1;y<N-1;y++)for(let x=1;x<N-1;x++){const i=y*N+x;if(before[i])continue;const near=[i-1,i+1,i-N,i+N].find(j=>before[j]);if(near===undefined)continue;rgb.copy(rgb,i*3,near*3,near*3+3);normal.copy(normal,i*3,near*3,near*3+3);mask[i]=1;}}
await sharp(rgb,{raw:{width:N,height:N,channels:3}}).png().toFile('tools/rpg-bestiary/lava-golem-source/derived/original-basalt-color.png');
await sharp(normal,{raw:{width:N,height:N,channels:3}}).png().toFile('tools/rpg-bestiary/lava-golem-source/derived/original-basalt-normal.png');
console.log('Wrote original object-space basalt colour and tangent-space micro-normal atlases.');
