import * as THREE from 'three';
/** Rounded short pinnae with a pale rolled rim; no pointed terminal cap. */
export function tapirEar(s,side,palette){
 const bone=side<0?'EarL':'EarR';
 s.loft([[side*.079,1.020,.945,.022,.023],[side*.113,1.058,.938,.024,.021]],bone,palette.coat,{rings:8,sides:16});
 const segments=32,rings=8,points=[],indices=[],uv=[],yaw=side*.70;
 for(const back of [false,true])for(let j=0;j<=rings;j++)for(let k=0;k<segments;k++){
  const r=Math.max(.001,j/rings),a=k/segments*Math.PI*2,xx=Math.sin(a)*r*.047,yy=Math.cos(a)*r*.055,depth=(back?-.008:.003)+.014*r**3;
  points.push([side*.139+xx*Math.cos(yaw)+depth*Math.sin(yaw)+side*yy*.15,1.094+yy,.927-xx*Math.sin(yaw)+depth*Math.cos(yaw)]);uv.push(k/segments,j/rings);
 }
 const sheet=(rings+1)*segments;
 for(let f=0;f<2;f++)for(let j=0;j<rings;j++)for(let k=0;k<segments;k++){
  const a=f*sheet+j*segments+k,b=f*sheet+j*segments+(k+1)%segments,c=a+segments,d=b+segments;
  if(f)indices.push(a,c,b,b,c,d);else indices.push(a,b,c,b,d,c);
 }
 for(let k=0;k<segments;k++){const a=rings*segments+k,b=rings*segments+(k+1)%segments;indices.push(a,a+sheet,b,b,a+sheet,b+sheet);}
 s.add(points,indices,bone,(_p,i)=>new THREE.Color(i<sheet?palette.dark:palette.coat).lerp(new THREE.Color(palette.pale),THREE.MathUtils.smoothstep(Math.floor((i%sheet)/segments)/rings,.78,.97)),4,undefined,uv);
}
