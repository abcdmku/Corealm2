import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';
type V = [number,number,number];
const ids = ['cragfin','seared_cragfin','burnt_cragfin','ashfin','seared_ashfin','burnt_ashfin'] as const;
const descriptions = ["A slab-sided tarn fish with a spined dorsal. Hillcrest eats little else.","The reason anyone survives Quarry Warden's floor. Hillcrest will not sell you fewer than five.","Ninety-six marks of fish, ruined. Hillcrest has opinions about this.","A dark-finned spring fish that thrives where the water runs warm. Oily and rich.","The oil crisps its own skin. What a Fire Ogre attempt is provisioned with.","It cooked itself the rest of the way while you watched."];
const tau = Math.PI*2;
function hash(n:number){return (Math.sin(n*127.1+7.3)*43758.5453)%1*.5+.5;}
function geo(p:number[],uv:number[],ix:number[]){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return g;}
function tex(name:string,sample:(u:number,v:number)=>number[],normal=false){const n=512,d=new Uint8Array(n*n*4);for(let y=0;y<n;y++)for(let x=0;x<n;x++){const c=sample(x/(n-1),y/(n-1)),i=(y*n+x)*4;for(let k=0;k<3;k++)d[i+k]=Math.max(0,Math.min(255,c[k]!));d[i+3]=255;}const t=new THREE.DataTexture(d,n,n);t.name=name;t.colorSpace=normal?THREE.NoColorSpace:THREE.SRGBColorSpace;t.needsUpdate=true;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;return t;}
function build(id:string){
 const index=ids.indexOf(id as typeof ids[number]);if(index<0)throw new Error('Unknown fish '+id);
 const bass=index>=3,state=index%3,cooked=state>0,burnt=state===2;
 const root=new THREE.Group();root.name=id+' anatomical whole fish';root.userData.itemModel={itemId:id,author:'fish-b',reference:'art/item-icons/generated/'+id+'.png',description:descriptions[index]};
 const body=new THREE.Group();body.name='Whole fish with bilateral anatomy';body.rotation.z=.22;root.add(body);
 function add(name:string,g:THREE.BufferGeometry,m:THREE.Material){const o=new THREE.Mesh(g,m);o.name=name;o.castShadow=true;o.receiveShadow=true;body.add(o);return o;}
 function mat(name:string,color:number,roughness:number){const m=new THREE.MeshStandardMaterial({color,roughness});m.name=name;return m;}
 function cut(u:number,v:number){if(!cooked)return 0;const a=v*tau,s=Math.sin(a),c=Math.cos(a);if(Math.abs(s)<.40||u<.30||u>.85||Math.abs(c)>.86)return 0;let d=1;for(const center of [.43,.59,.75])d=Math.min(d,Math.abs(u-center+c*.10));return Math.max(0,1-d/(burnt?.021:.025))*Math.min(1,(Math.abs(s)-.4)*5);}
 function surface(u:number,v:number,extra=0):V{const x=-.34+u*.67,a=v*tau;const shape=Math.sin(Math.PI*(.055+u*.93));const taper=1-.67*Math.pow(u,2);const ry=(bass?.169:.156)*Math.pow(shape,.72)*taper;const rz=(bass?.091:.076)*Math.pow(shape,.78)*taper;const dent=cut(u,v)*.007;return [x,Math.cos(a)*(ry-dent+extra)+.022*u,Math.sin(a)*(rz-dent+extra)];}
 const skin=mat('Scaled '+(burnt?'cracked charcoal':cooked?'blistered golden roast':bass?'olive bass':'gold barred perch')+' skin',0xffffff,burnt?.79:cooked?.31:.25);
 skin.map=tex('Bilateral scales, belly and species markings',(u,v)=>{const a=v*tau,back=(Math.cos(a)+1)/2;const row=Math.floor(v*66),sx=(u*112+(row%2)*.5)%1,sy=(v*66)%1;const rim=Math.max(0,1-Math.abs(Math.sqrt((sx-.5)**2+(sy-.1)**2)-.56)*25);const fleck=hash(Math.floor(u*511)+Math.floor(v*511)*512);let c:number[];
 if(burnt){const crack=Math.pow(Math.abs(Math.sin(u*221+Math.sin(v*191)*1.9)*Math.cos(v*169+Math.sin(u*181))),18);c=[31+fleck*30+crack*55,27+fleck*28+crack*51,23+fleck*25+crack*48];}
 else if(cooked){const blister=Math.max(0,Math.sin(u*119+Math.cos(v*123))*Math.cos(v*161+u*37));c=[205-back*90-blister*70+fleck*21,133-back*82-blister*58+fleck*16,61-back*40-blister*33+fleck*12];}
 else{const stripe=bass?Math.exp(-(((back-.52)*12)**2))*(.55+.45*Math.sin(u*113)**2):Math.pow(Math.max(0,Math.cos(u*36+Math.cos(a)*1.1)),8)*Math.min(1,back*2);c=[226-back*161-stripe*72,222-back*137-stripe*67,195-back*155-stripe*43];}
 const score=cut(u,v);if(score>.08){const mix=Math.min(1,score*2.2);const flesh=burnt?[137,113,85]:[251,220,163];c=c.map((k,i)=>k*(1-mix)+flesh[i]!*mix+Math.sin(v*340+u*29)*4);}
 return c.map(k=>k+rim*(burnt?3:15));});
 skin.normalMap=tex('Gentle overlapping scale normal',(u,v)=>{const row=Math.floor(v*66),sx=(u*112+row%2*.5)%1,sy=v*66%1;return [128+Math.sin(sx*tau)*10,128+Math.cos(sy*tau)*8,254];},true);skin.normalScale.set(.35,.35);
 const fin=mat('Fin web '+(burnt?'carbonized':cooked?'roast amber':bass?'dark olive':'orange and ochre'),burnt?0x29211b:cooked?0x9c4817:bass?0x655b33:0xb67429,burnt?.87:.38);
 fin.map=tex('Fin translucent-looking ribbed membrane',(u,v)=>{const rib=Math.cos(u*90)**8;const edge=v>.88? .55:1;return [230*edge-rib*55,195*edge-rib*55,143*edge-rib*43];});
 const rib=mat('Fin rays and lip edges',burnt?0x514034:cooked?0x9b5b29:bass?0x948360:0xb9a178,.41);
 const eye=mat('Eye glass or cooked cloudy cornea',burnt?0x736452:cooked&&!bass?0xc7b58c:0x060807,cooked?.30:.09);
 const iris=mat('Amber iris',burnt?0x44352b:0x9d701e,.25);
 const mouth=mat('Deep oral cavity',burnt?0x140e0b:cooked?0x4b2511:0x6b4940,.69);
 const ash=mat('Raised charcoal crust flakes',0x343333,.86);
 const p:number[]=[],uv:number[]=[],ix:number[]=[];const nu=160,nv=96;for(let i=0;i<=nu;i++)for(let j=0;j<=nv;j++){p.push(...surface(i/nu,j/nv));uv.push(i/nu,j/nv);}for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){const k=i*(nv+1)+j;ix.push(k,k+1,k+nv+1,k+1,k+nv+2,k+nv+1);}add('Continuous sculpted scaled fish body with recessed cooking scores',geo(p,uv,ix),skin);
 function tube(name:string,points:V[],r:number,m:THREE.Material){return add(name,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),Math.max(8,points.length*5),r,5,false),m);}
 function oval(name:string,pos:V,scale:V,m:THREE.Material){const o=add(name,new THREE.SphereGeometry(1,20,12),m);o.position.set(...pos);o.scale.set(...scale);return o;}
 // Inward oral funnel, ring lips and full lower jaw. Bass has the deeper gape.
 const gape=bass?.034:.021, mp:number[]=[],mu:number[]=[],mi:number[]=[];for(let k=0;k<3;k++)for(let j=0;j<=40;j++){const a=j/40*tau,r=1-k*.38;mp.push(-.346+k*.027,-.018+Math.cos(a)*gape*r,Math.sin(a)*.026*r);mu.push(j/40,k/2);}for(let k=0;k<2;k++)for(let j=0;j<40;j++){const a=k*41+j;mi.push(a,a+41,a+1,a+1,a+41,a+42);}add('Recessed open mouth and throat',geo(mp,mu,mi),mouth);
 const lp:V[]=[];for(let j=0;j<=40;j++){const a=j/40*tau;lp.push([-.348-.004*Math.cos(a),-.018+Math.cos(a)*gape,Math.sin(a)*.026]);}tube('Continuous thick lip rim',lp,.004,rib);oval('Fleshy projecting lower jaw',[-.317,-.018-gape,.0],[.038,.011,.032],skin);
 for(const side of [-1,1]){
  oval('Eye socket '+side,[-.263,.027,side*.045],[.024,.024,.010],mouth);oval('Amber iris '+side,[-.265,.028,side*.052],[.018,.018,.006],iris);oval('Convex cornea '+side,[-.267,.029,side*.057],[.012,.013,.007],eye);
  const gp:V[]=[];for(let j=0;j<=18;j++){const a=-.83+j/18*2.55;gp.push([-.191+Math.cos(a)*.034,Math.sin(a)*.105-.010,side*(.052+.013*Math.cos(a))]);}tube('Swept operculum gill-cover rim '+side,gp,.004,rib);tube('Recessed gill slit '+side,gp.map(p=>[p[0]+.004,p[1],p[2]*.986]),.0025,mouth);
 }
 // Each fin is a closed, curved solid web between rooted ray ends and a scalloped edge.
 function fan(name:string,bases:V[],tips:V[],material=fin){const fp:number[]=[],fu:number[]=[],fi:number[]=[];const n=tips.length;for(let side=0;side<2;side++)for(let k=0;k<n;k++)for(let r=0;r<=6;r++){const t=r/6,b=bases[k]!,e=tips[k]!;fp.push(b[0]+(e[0]-b[0])*t,b[1]+(e[1]-b[1])*t,b[2]+(e[2]-b[2])*t+(side?1:-1)*(.0012+.002*Math.sin(t*Math.PI)));fu.push(k/(n-1),t);}const layer=n*7;for(let side=0;side<2;side++)for(let k=0;k<n-1;k++)for(let r=0;r<6;r++){const a=side*layer+k*7+r;if(side)fi.push(a,a+7,a+1,a+1,a+7,a+8);else fi.push(a,a+1,a+7,a+1,a+8,a+7);}for(let k=0;k<n-1;k++){const a=k*7+6,b=(k+1)*7+6;fi.push(a,b,a+layer,b,b+layer,a+layer);}for(let k=0;k<n-1;k++){const a=k*7,b=(k+1)*7;fi.push(a,a+layer,b,b,a+layer,b+layer);}for(const k of [0,n-1])for(let r=0;r<6;r++){const a=k*7+r;fi.push(a,a+layer,a+1,a+1,a+layer,a+layer+1);}add(name+' solid membrane',geo(fp,fu,fi),material);for(let k=0;k<n;k+=2){const b=bases[k]!,t=tips[k]!;tube(name+' ray '+k,[b,[(b[0]+t[0])*.5,(b[1]+t[1])*.5,(b[2]+t[2])*.5],t],.0012,rib);}}
 function dorsal(start:number,end:number,height:number,rays:number,name:string){const b:V[]=[],t:V[]=[];for(let j=0;j<=rays*2;j++){const f=j/(rays*2),u=start+(end-start)*f,q=surface(u,0);b.push(q);const h=height*Math.sin(Math.PI*(.14+.78*f))*(j%2?.78:1)*(burnt?.8+.16*Math.sin(j*2):1);t.push([q[0]+.017,q[1]+h,q[2]+(burnt?.012*Math.sin(f*5):.003)]);}fan(name,b,t);}
 dorsal(bass?.34:.27,bass?.63:.64,bass?.074:.108,10,'Spined anterior dorsal');dorsal(.65,.86,bass?.051:.061,8,'Soft posterior dorsal');
 const tb:V[]=[],tt:V[]=[];for(let j=0;j<=28;j++){const f=j/28,y=(f-.5)*.21;tb.push([.316,.022+(f-.5)*.025,0]);const notch=(bass?.012:.039)*(1-Math.abs(f-.5)*2);tt.push([.420-notch+(burnt?.008*Math.sin(j*4):0),.022+y*(burnt?.94:1),.004*Math.sin(f*5)+(burnt?.01*Math.sin(f*9):0)]);}fan('Forked caudal tail',tb,tt);
 for(const side of [-1,1]){const b:V[]=[],t:V[]=[];for(let j=0;j<=16;j++){const f=j/16;b.push([-.139,-.048+f*.018,side*.065]);t.push([-.031+.011*Math.sin(f*Math.PI),-.099+f*.074,side*(.083+(burnt?.021*Math.sin(f*3):.012))]);}fan('Pectoral fin '+side,b,t);
 const vb:V[]=[],vt:V[]=[];for(let j=0;j<=12;j++){const f=j/12;vb.push([-.087+f*.030,-.130,side*.026]);vt.push([-.038+f*.047,-.183+.037*f+(burnt?.020*Math.sin(f*4):0),side*(.037+.009*f)]);}fan('Paired pelvic fin '+side,vb,vt);}
 const ab:V[]=[],at:V[]=[];for(let j=0;j<=14;j++){const f=j/14,q=surface(.75+f*.12,.5);ab.push(q);at.push([q[0]+.022,q[1]-.059*Math.sin(Math.PI*(.12+.83*f))*(burnt?.7:1),burnt?.012*Math.sin(f*5):0]);}fan('Anal fin',ab,at);
 if(burnt){const cp:number[]=[],cu:number[]=[],ci:number[]=[];for(let i=0;i<44;i++)for(let j=0;j<26;j++){const u=.025+i/46+hash(i+j*51)*.006,v=j/26+hash(i*73+j)*.01;if(u>.965||cut(u,v)>.22||Math.cos(v*tau)<-.55)continue;const start=cp.length/3;const du=.008+hash(i*3+j)*.005,dv=.010+hash(i+j)*.005;const center=surface(u,v,.0013+hash(i+j*31)*.0014);cp.push(...center);cu.push(u,v);for(let k=0;k<=5;k++){const a=k/5*tau;cp.push(...surface(u+Math.cos(a)*du,v+Math.sin(a)*dv,.0006));cu.push(u+Math.cos(a)*du,v+Math.sin(a)*dv);if(k>0)ci.push(start,start+k,start+k+1);}}add('Lifted irregular charcoal skin plates with open fissures',geo(cp,cu,ci),ash);}
 return root;
}
export const author:ItemModelAuthor={ids,build};


