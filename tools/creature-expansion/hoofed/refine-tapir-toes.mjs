/** Conforming local refinement, projected onto the authored foot surface.
 * The rest of the animal's mesh stays unchanged.
 */
export function refineTapirToes(vertices,indices,uv,field,feet){
  const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
  const region=p=>{
    if(p[1]>.158)return 0;
    let value=0;
    for(const foot of feet){
      const x=Math.abs(p[0]-foot.x),z=p[2]-foot.z;
      if(x>.143||z<.003||z>.23)continue;
      value=Math.max(value,(1-smooth(.115,.158,p[1]))*smooth(.003,.035,z)*(1-smooth(.119,.143,x)));
    }
    return value;
  };
  const project=p=>{
    const weight=region(p);if(weight<.001)return p;
    const result=p.slice(),h=.0007;
    for(let iteration=0;iteration<3;iteration++){
      const d=field(...result);if(Math.abs(d)<.000025)break;
      const gradient=[];
      for(let axis=0;axis<3;axis++){
        const hi=result.slice(),lo=result.slice();hi[axis]+=h;lo[axis]-=h;
        gradient.push((field(...hi)-field(...lo))/(2*h));
      }
      const squared=gradient.reduce((sum,v)=>sum+v*v,0);if(squared<1e-9)break;
      const scale=Math.min(1,.005/(Math.abs(d)/Math.sqrt(squared)));
      for(let axis=0;axis<3;axis++)result[axis]-=gradient[axis]*d/squared*scale;
    }
    return result.map((value,axis)=>p[axis]+(value-p[axis])*weight);
  };
  vertices.forEach((point,index)=>{if(region(point)>.001)vertices[index]=project(point);});
  const edgeKey=(a,b)=>a<b?`${a},${b}`:`${b},${a}`;
  for(let round=0;round<2;round++){
    const edges=new Map();
    for(let i=0;i<indices.length;i+=3){
      const a=indices[i],b=indices[i+1],c=indices[i+2];
      if(![a,b,c].some(index=>region(vertices[index])>.001))continue;
      for(const [start,end]of [[a,b],[b,c],[c,a]]){
        const midpoint=vertices[start].map((value,axis)=>(value+vertices[end][axis])*.5);
        if(region(midpoint)<.001)continue;
        const key=edgeKey(start,end);if(edges.has(key))continue;
        const point=project(midpoint),index=vertices.length;vertices.push(point);
        uv.push((Math.atan2(point[0],point[2]-.2)/Math.PI+1)*.5,point[1]/2.3);edges.set(key,index);
      }
    }
    const next=[];
    for(let i=0;i<indices.length;i+=3){
      const a=indices[i],b=indices[i+1],c=indices[i+2],ab=edges.get(edgeKey(a,b)),bc=edges.get(edgeKey(b,c)),ca=edges.get(edgeKey(c,a));
      const mask=(ab!==undefined?1:0)|(bc!==undefined?2:0)|(ca!==undefined?4:0);
      switch(mask){
        case 0:next.push(a,b,c);break;
        case 1:next.push(a,ab,c,ab,b,c);break;
        case 2:next.push(a,b,bc,a,bc,c);break;
        case 3:next.push(ab,b,bc,a,ab,c,ab,bc,c);break;
        case 4:next.push(a,b,ca,b,c,ca);break;
        case 5:next.push(a,ab,ca,ab,b,c,ab,c,ca);break;
        case 6:next.push(c,ca,bc,a,b,ca,b,bc,ca);break;
        case 7:next.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca);break;
      }
    }
    indices.length=0;for(const index of next)indices.push(index);
  }
}
