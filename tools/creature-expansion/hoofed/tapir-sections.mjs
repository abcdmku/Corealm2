/** Axial sections author the dorsal and ventral contours directly, avoiding
 * three overlapping oval masses. Rows: z, vertical center, width, height. */
export function axialField(rows, bone, rig, blend=.025) {
  const low=[-Math.max(...rows.map(r=>r[2])),Math.min(...rows.map(r=>r[1]-r[3])),rows[0][0]],high=[-low[0],Math.max(...rows.map(r=>r[1]+r[3])),rows.at(-1)[0]];
  return {type:'axial',rows,blend,weights:[[rig.index[bone],1]],center:low.map((v,i)=>(v+high[i])/2),extent:low.map((v,i)=>(high[i]-v)/2+blend*2)};
}
export function axialDistance(f,x,y,z){
  const rows=f.rows,zz=Math.max(rows[0][0],Math.min(rows.at(-1)[0],z));
  let i=0;while(i<rows.length-2&&rows[i+1][0]<zz)i++;
  const a=rows[i],b=rows[i+1],prev=rows[Math.max(0,i-1)],next=rows[Math.min(rows.length-1,i+2)],h=b[0]-a[0],t=(zz-a[0])/h;
  const sample=k=>{const m0=(b[k]-prev[k])/(b[0]-prev[0]),m1=(next[k]-a[k])/(next[0]-a[0]);return (2*t**3-3*t*t+1)*a[k]+(t**3-2*t*t+t)*h*m0+(-2*t**3+3*t*t)*b[k]+(t**3-t*t)*h*m1;};
  const cy=sample(1),w=Math.max(.004,sample(2)),height=Math.max(.004,sample(3)),q=(Math.abs(x/w)**2.25+Math.abs((y-cy)/height)**2.25)**(1/2.25);
  const radial=(q-1)*Math.min(w,height),end=Math.abs(z-zz);
  return end>0?Math.hypot(Math.max(0,radial),end):radial;
}
export function tapirFields(rig){return [
  axialField([[-.98,.79,.006,.008],[-.87,.79,.20,.20],[-.66,.80,.35,.265],[-.40,.79,.365,.28],[-.10,.77,.34,.27],[.20,.76,.30,.27],[.43,.78,.26,.25],[.61,.83,.18,.185],[.73,.87,.06,.09],[.76,.87,.004,.006]],'Body',rig),
  axialField([[.52,.83,.09,.12],[.63,.87,.16,.165],[.79,.925,.135,.125],[.91,.952,.10,.09],[.98,.95,.004,.006]],'Neck',rig,.026),
  axialField([[.81,.957,.007,.01],[.91,.965,.114,.116],[1.03,.957,.117,.105],[1.14,.925,.095,.075],[1.25,.890,.074,.055],[1.31,.862,.053,.05],[1.35,.840,.034,.033],[1.37,.837,.004,.006]],'Head',rig,.018),
  axialField([[1.29,.86,.026,.032],[1.35,.833,.040,.045],[1.395,.810,.033,.034],[1.42,.805,.004,.006]],'Nose',rig,.016)
];}
