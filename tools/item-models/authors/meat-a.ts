import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

const ids = ['raw_game_meat','roast_game','burnt_game','raw_venison','roast_venison','burnt_venison'] as const;
const descriptions = [
  'Whatever the Farmland was carrying. Fowl, goat or rabbit, jointed the same way.',
  'Turned over a range until the fat stops running. Frontier cooking, and it works.',
  'Left on the range. Black through and nothing left worth eating.',
  'Dark, close-grained deepwood meat. Hangs two days before it is worth cooking.',
  'Seared hard and rested. The one meal in Oakwood nobody complains about.',
  'A stag walked all summer for this and you left it on the coals.',
];
const TAU = Math.PI*2;
const hash=(n:number)=>{const x=Math.sin(n*127.13+91.7)*43758.54;return x-Math.floor(x);};
type Mode = 'raw'|'roast'|'burnt';
function material(name:string, mode:Mode|'bone'|'fat'|'herb', cut=false):THREE.MeshPhysicalMaterial {
  const size=256, color=new Uint8Array(size*size*4), normal=new Uint8Array(size*size*4), rough=new Uint8Array(size*size*4);
  const base=mode==='raw'?(cut?[147,35,42]:[132,35,43]):mode==='roast'?(cut?[168,108,90]:[125,52,19]):mode==='burnt'?(cut?[119,94,80]:[32,27,25]):mode==='bone'?[219,194,151]:mode==='fat'?[234,194,172]:[66,69,21];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/size,v=y/size,i=(y*size+x)*4, noise=hash(x+y*size);
    const fiber=Math.sin(u*900+Math.sin(v*23)*4+v*55), wide=Math.sin(u*21+v*15)*Math.cos(v*33-u*8);
    let blend=0, shade=wide*13+(noise-.5)*17+fiber*5;
    if(mode==='raw')blend=Math.pow(Math.max(0,Math.sin(u*45+v*8+Math.sin(v*21)*1.8)),35)*.36;
    if(mode==='roast'&&!cut)shade+=Math.sin(u*37+Math.sin(v*15)*2)*21;
    if(mode==='burnt'){
      const px=u*13,py=v*11;let d1=99,d2=99;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const cx=Math.floor(px)+dx,cy=Math.floor(py)+dy,k=cx+cy*73;
        const d=(cx+.17+.66*hash(k)-px)**2+(cy+.17+.66*hash(k+89)-py)**2;
        if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;
      }
      const crack=d2-d1<.045;shade+=crack?(cut?-47:-24):(cut?3:11);
    }
    for(let k=0;k<3;k++)color[i+k]=Math.max(0,Math.min(255,base[k]!+shade+(225-base[k]!)*blend));color[i+3]=255;
    normal[i]=128+fiber*3;normal[i+1]=128+Math.cos(v*700+u*25)*3;normal[i+2]=255;normal[i+3]=255;
    const r=mode==='raw'?95:mode==='roast'?110:mode==='burnt'?192:150;rough[i]=rough[i+1]=rough[i+2]=r+noise*22;rough[i+3]=255;
  }
  function tex(data:Uint8Array,suffix:string,srgb=false){const t=new THREE.DataTexture(data,size,size);t.name=name+' '+suffix;t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;}
  const m=new THREE.MeshPhysicalMaterial({map:tex(color,'pigment and grain',true),normalMap:tex(normal,'fine fibers'),roughnessMap:tex(rough,'surface moisture'),roughness:1,clearcoat:mode==='raw'?.22:mode==='roast'?.27:0,clearcoatRoughness:.32});m.name=name;return m;
}
function add(g:THREE.Group,name:string,geo:THREE.BufferGeometry,mat:THREE.Material){const m=new THREE.Mesh(geo,mat);m.name=name;m.castShadow=m.receiveShadow=true;g.add(m);return m;}
function tube(g:THREE.Group,name:string,points:THREE.Vector3[],r:number,mat:THREE.Material){return add(g,name,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),Math.max(12,points.length*5),r,6,false),mat);}
function ball(g:THREE.Group,name:string,p:THREE.Vector3,s:THREE.Vector3,mat:THREE.Material,detail=24){const m=add(g,name,new THREE.SphereGeometry(1,detail,Math.max(5,Math.floor(detail*2/3))),mat);m.position.copy(p);m.scale.copy(s);return m;}
function surface(g:THREE.Group,name:string,fn:(a:number,t:number)=>THREE.Vector3,mat:THREE.Material,segments=80,rows=55,reverse=false){
  const p:number[]=[],uv:number[]=[],ix:number[]=[];
  for(let j=0;j<=rows;j++)for(let i=0;i<=segments;i++){const v=fn(i/segments*TAU,j/rows);p.push(v.x,v.y,v.z);uv.push(i/segments,j/rows);}
  for(let j=0;j<rows;j++)for(let i=0;i<segments;i++){const a=j*(segments+1)+i,b=a+segments+1;ix.push(a,b,a+1,a+1,b,b+1);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));if(reverse)for(let i=0;i<ix.length;i+=3){const first=ix[i]!;ix[i]=ix[i+2]!;ix[i+2]=first;}geo.setIndex(ix);geo.computeVertexNormals();return add(g,name,geo,mat);
}
function game(g:THREE.Group,mode:Mode){
  const meat=material('Game '+mode+' flesh',mode),fat=material(mode==='raw'?'Cream connective fat':'Rendered fat',mode==='raw'?'fat':mode==='roast'?'roast':'burnt'),bone=material('Exposed joint bone','bone');
  const shrink=mode==='raw'?1:mode==='roast'?.94:.88;
  const fn=(a:number,t:number)=>{
    const profile=Math.pow(Math.sin(Math.PI*t),.61)*(.135-.084*t)*shrink;
    const lobes=1+.065*Math.sin(a*3+t*8)+.035*Math.sin(a*5-t*5);
    const skin=mode==='raw'?0:mode==='roast'?.0018*Math.sin(a*19+t*74):.0028*Math.sin(a*31+t*95);
    const r=profile*lobes+skin*Math.sin(Math.PI*t);
    return new THREE.Vector3(Math.cos(a)*r+.023*t*t,-.145+t*.325,Math.sin(a)*r*.85);
  };
  surface(g,'Solid pear shaped '+mode+' game joint',fn,meat);
  // Distinct muscle partitions run over the raw joint; the cooked skin gathers into folds.
  const seams=mode==='raw'?[.2,1.3,2.7,4.3,5.4]:mode==='roast'?[.5,2.2,4.7]:[.8,3.1,5.4];
  seams.forEach((a,k)=>{const points:THREE.Vector3[]=[];for(let j=0;j<=24;j++){const t=.08+j/24*.78;const q=fn(a+.28*Math.sin(t*6+k),t);q.multiplyScalar(1.008);points.push(q);}tube(g,'Longitudinal '+(mode==='raw'?'fat fascia':'shrunk skin fold')+' '+k,points,mode==='raw'?.0028:.002,fat);});
  if(mode==='raw')for(let k=0;k<3;k++){const p:THREE.Vector3[]=[];for(let j=0;j<=28;j++)p.push(fn(.25+j/28*2.55,.18+k*.22+.065*Math.sin(j/28*Math.PI)));tube(g,'Branching intermuscular fat '+k,p,.0031,fat);}
  const b=surface(g,'Irregular exposed tapered shin and knuckle',(a,t)=>{const r=.013+.006*(1-t)+.014*Math.pow(t,6);return new THREE.Vector3(.022+.031*t+Math.cos(a)*r,.115+t*.125,Math.sin(a)*r*.84);},bone,40,25);
  ball(g,'Left bone condyle',new THREE.Vector3(.035,.236,0),new THREE.Vector3(.023,.018,.021),bone);
  ball(g,'Right bone condyle',new THREE.Vector3(.067,.236,0),new THREE.Vector3(.021,.017,.021),bone);
  if(mode!=='raw'){
    for(let k=0;k<12;k++){const a=k/12*TAU,p=new THREE.Vector3(.053+.026*Math.cos(a),.24+.009*Math.sin(a*3),.021*Math.sin(a));ball(g,'Browned knuckle residue '+k,p,new THREE.Vector3(.008,.006,.004),meat);}
  }
  if(mode==='burnt')for(let k=0;k<22;k++){const t=.12+.71*hash(k+7),a=TAU*hash(k+42),p:THREE.Vector3[]=[];for(let j=0;j<8;j++)p.push(fn(a+(j-3)*.019,t+j*.008));tube(g,'Raised torn char edge '+k,p,.0018,fat);}
  b.name='Solid tapered exposed bone';
}
function venison(g:THREE.Group,mode:Mode){
  const meat=material('Venison '+mode+' outer muscle',mode),cut=material('Venison '+mode+' cut face',mode,true),fat=material('Venison connective rim',mode==='raw'?'fat':mode==='burnt'?'burnt':'roast');
  const raw=mode==='raw',burnt=mode==='burnt',length=raw?.35:burnt?.305:.325;
  const radius=(a:number,t:number)=>{let r=(raw?.083:burnt?.080:.088)*(1+.035*Math.sin(a*3+.6)+.025*Math.cos(a*5+t*7))*(.94+.06*Math.sin(t*Math.PI));if(!raw){const d=Math.sin(t*Math.PI*4.5+a*.35);r-=.0035*Math.exp(-d*d*110);}return r;};
  const fn=(a:number,t:number)=>{const r=radius(a,t);return new THREE.Vector3(Math.cos(a)*r,Math.sin(a)*r*.89,(t-.5)*length);};
  surface(g,'Solid '+mode+' boneless loin with shaped crust',fn,meat,80,55,true);
  // Both cut ends are solid discs with independently mapped muscle grain.
  for(const end of [0,1]){
    const pos:number[]=[0,0,(end-.5)*length],uv:number[]=[.5,.5],ix:number[]=[];
    for(let i=0;i<=96;i++){const a=i/96*TAU,v=fn(a,end);pos.push(v.x,v.y,v.z);uv.push(.5+.49*Math.cos(a),.5+.49*Math.sin(a));if(i<96)ix.push(0,end===1?i+1:i+2,end===1?i+2:i+1);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(ix);geo.computeVertexNormals();add(g,'Exposed '+(end?'front':'rear')+' '+mode+' cut face',geo,cut);
    const rim:THREE.Vector3[]=[];for(let j=0;j<=96;j++)rim.push(fn(j/96*TAU,end));tube(g,'Thin '+(raw?'fat':'seared')+' cut perimeter '+end,rim,raw?.0023:.0018,fat);
  }
  if(raw){
    for(const a of [.55,2.7,4.6]){const points:THREE.Vector3[]=[];for(let j=0;j<=24;j++)points.push(fn(a+.16*Math.sin(j*.19),j/24));tube(g,'White longitudinal silverskin seam '+a,points,.0016,fat);}
    for(const a of [.7,3.0,4.8]){const p:THREE.Vector3[]=[];for(let j=0;j<=12;j++){const r=j/12*.98,outer=fn(a+.13*Math.sin(j*.3),1);p.push(new THREE.Vector3(outer.x*r,outer.y*r,length/2+.0002));}tube(g,'Fine cut face muscle division '+a,p,.0008,fat);}
  }else if(!burnt){
    const herb=material('Roasted rosemary leaves','herb'),pepper=new THREE.MeshStandardMaterial({color:0x211610,roughness:.82});pepper.name='Cracked black pepper';const seed=new THREE.MeshStandardMaterial({color:0xb7873c,roughness:.63});seed.name='Toasted seasoning seeds';
    for(let k=0;k<95;k++){const a=.12+hash(k+5)*2.9,t=.03+hash(k+41)*.94,p=fn(a,t);p.x*=1.009;p.y*=1.009;ball(g,'Pepper and seed '+k,p,new THREE.Vector3(.0014+hash(k)*.0007,.0013,.0017),k%3?pepper:seed,8);}
    for(let k=0;k<7;k++){const a=.65+hash(k+2)*1.8,t=.14+k*.105,points:THREE.Vector3[]=[];for(let j=0;j<6;j++)points.push(fn(a+.018*j,t+j*.012).multiply(new THREE.Vector3(1.018,1.018,1)));tube(g,'Rosemary stem '+k,points,.00065,herb);for(let j=1;j<5;j++)for(const side of [-1,1]){const p=fn(a+.018*j,t+j*.012).multiply(new THREE.Vector3(1.024,1.024,1)),q=fn(a+.018*j+side*.12,t+j*.012+.015).multiply(new THREE.Vector3(1.026,1.026,1));tube(g,'Rosemary needle '+k+' '+j+' '+side,[p,p.clone().lerp(q,.6).add(new THREE.Vector3(0,.001,0)),q],.0009,herb);}}
  }else{
    // Deep dry fissures physically break the front cut into uneven muscle sectors.
    const dark=new THREE.MeshStandardMaterial({color:0x37251c,roughness:1});dark.name='Dry fissure interior';
    for(let k=0;k<11;k++){const a=TAU*k/11,points:THREE.Vector3[]=[];for(let j=0;j<=8;j++){const r=.012+j*.008;points.push(new THREE.Vector3(Math.cos(a+.09*Math.sin(j*1.7))*r,Math.sin(a+.07*Math.cos(j)) *r*.89,length/2+.00045));}tube(g,'Split dry cut face '+k,points,.0008,dark);}
    for(let k=0;k<20;k++){const a=TAU*hash(k),t=.08+.8*hash(k+90),points:THREE.Vector3[]=[];for(let j=0;j<8;j++)points.push(fn(a+j*.018,t+j*.008).multiply(new THREE.Vector3(1.008,1.008,1)));tube(g,'Curled carbon crust edge '+k,points,.0014,fat);}
  }
}
export const author:ItemModelAuthor={ids,build(id){const index=ids.indexOf(id as typeof ids[number]);if(index<0)throw new Error('Unsupported meat-a item '+id);const g=new THREE.Group();g.name=id;g.userData.itemModel={itemId:id,author:'meat-a',reference:`art/item-icons/generated/${id}.png`,description:descriptions[index]};const mode:Mode=id.startsWith('raw')?'raw':id.startsWith('roast')?'roast':'burnt';if(id.includes('venison'))venison(g,mode);else game(g,mode);return g;}};

