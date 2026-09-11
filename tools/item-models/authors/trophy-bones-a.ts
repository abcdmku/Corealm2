import * as THREE from 'three';
import type { ItemModelAuthor } from '../contracts';

type P = readonly [number, number, number, number];
const TAU = Math.PI * 2;
const ids = ['curl_horn', 'ox_horn', 'stag_antler', 'curved_tusk', 'coyote_fang', 'bear_claw'] as const;
const descriptions: Record<string, string> = {
  curl_horn: 'One horn from a goat. Hollow, and loud if you know how to blow it.',
  ox_horn: 'Short, thick and scarred at the base. Millfield turns them into cups and lamp horn.',
  stag_antler: 'A six-point stag antler. Cut and polished, it makes a strong knife handle.',
  curved_tusk: "Ivory, yellowed, and ground to an edge by the animal's own jaw.",
  coyote_fang: 'Long in the root, which is the part nobody expects until they pull one.',
  bear_claw: 'Longer than a finger and blunt from stone. Hillcrest hangs them over doorways.',
};
function hash(n: number): number { return (Math.sin(n * 127.1 + 51.7) * 43758.5453 % 1 + 1) % 1; }
function material(name: string, base: number[], end: number[], roughness: number, mode: 'ring' | 'grain' | 'enamel' | 'root'): THREE.MeshStandardMaterial {
  const size = 512, data = new Uint8Array(size * size * 4), rough = new Uint8Array(size * size * 4), normal = new Uint8Array(size * size * 4);
  for (let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const u=x/(size-1), v=y/(size-1), index=(y*size+x)*4;
    const grain=Math.sin(u*TAU*65 + Math.sin(v*19)*.55), fine=Math.sin(u*TAU*213+v*17);
    const noise=hash(x+y*size), groove=mode==='ring' ? Math.pow(Math.max(0,Math.cos(v*TAU*28+.25*Math.sin(u*TAU*3))),10) : Math.pow(Math.max(0,grain),16);
    const mix = mode==='enamel' ? v*.15 : mode==='root' ? v*.35 : Math.min(1,Math.max(0,(v-.53)*2.4));
    const revised = /ox horn|ivory fine|tooth root|canine enamel|claw|cementum/.test(name);
    const patch = Math.sin(u*TAU*7+Math.sin(v*23))*Math.sin(v*TAU*11+Math.cos(u*TAU*3));
    const pore = Math.pow(Math.max(0,Math.sin(u*TAU*39+v*37)*Math.sin(v*TAU*67-u*25)),14);
    const wear = revised ? patch*(mode==='enamel'?10:21)-pore*(mode==='root'?67:24) : 0;
    const weather= wear + (mode==='enamel' ? (grain*1.4+fine+noise*5-3) : grain*5+fine*2+(noise-.5)*17-groove*24);
    for(let k=0;k<3;k++) data[index+k]=Math.max(0,Math.min(255,base[k]!*(1-mix)+end[k]!*mix+weather));
    if(revised && name.includes('ox horn') && v<.14){const stain=Math.max(0,1-v/.14)*(.45+.3*patch);for(let k=0;k<3;k++)data[index+k]=data[index+k]!*(1-stain);}
    if(name.includes('ivory fine')){const worn=Math.exp(-Math.pow((u-.5)/.12,2))*.55*Math.sin(v*Math.PI);const brown=[127,102,71];for(let k=0;k<3;k++)data[index+k]=data[index+k]!*(1-worn)+brown[k]!*worn;}
    data[index+3]=255;
    const r=Math.max(0,Math.min(255,roughness*255+(noise-.5)*18+groove*12));
    rough[index]=rough[index+1]=rough[index+2]=r;rough[index+3]=255;
    normal[index]=128+Math.round(Math.cos(u*TAU*65+Math.sin(v*19)*.55)*(mode==='enamel'?2:7));
    normal[index+1]=128+Math.round(Math.sin(v*180+u*12)*2);normal[index+2]=255;normal[index+3]=255;
  }
  function tex(bytes: Uint8Array, suffix: string, color=false): THREE.DataTexture {
    const t=new THREE.DataTexture(bytes,size,size);t.name=name+' '+suffix;t.wrapS=THREE.RepeatWrapping;t.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;t.needsUpdate=true;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;return t;
  }
  const m=new THREE.MeshStandardMaterial({map:tex(data,'albedo',true),roughnessMap:tex(rough,'roughness'),normalMap:tex(normal,'fine growth relief'),roughness:1,metalness:0});m.name=name;return m;
}
interface SweepOptions { hollow?: boolean; oval?: number; rings?: number; longitudinal?: number; segments?: number; ringCount?: number; relief?: number; wobble?: number; openEnd?: boolean; innerWear?: boolean; }
function sweep(g: THREE.Group, name: string, points: readonly P[], mat: THREE.Material, opts: SweepOptions = {}): void {
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(p[0],p[1],p[2])),false,'centripetal');
  const n=opts.segments??128,sides=48,positions:number[]=[],uv:number[]=[],indices:number[]=[];
  const radius=(t:number):number=>{const f=t*(points.length-1),j=Math.min(points.length-2,Math.floor(f)),s=f-j;return THREE.MathUtils.lerp(points[j]![3],points[j+1]![3],s);};
  const point=(t:number,a:number,r:number):THREE.Vector3=>{
    const tt=THREE.MathUtils.clamp(t+(opts.wobble??0)*Math.sin(a*3+.7)*Math.pow(1-t,8),0,1);
    const tangent=curve.getTangent(tt).normalize();const across=new THREE.Vector3(0,0,1).cross(tangent).normalize();const front=tangent.clone().cross(across).normalize();
    const ridge=1+(opts.rings??0)*Math.pow(.5+.5*Math.cos(t*TAU*(opts.ringCount??28)+.23*Math.sin(a*3)),5)+(opts.longitudinal??.012)*Math.sin(a*17+t*9);
    const relief=1+(opts.relief??0)*(Math.sin(a*7+t*9)*.6+Math.sin(a*3-t*13)*.4);
    r*=relief;
    if(opts.innerWear)r*=1-.16*Math.exp(-Math.pow((a-Math.PI)/.46,2))*Math.sin(t*Math.PI);
    return curve.getPoint(tt).addScaledVector(across,Math.cos(a)*r*ridge).addScaledVector(front,Math.sin(a)*r*(opts.oval??.83)*ridge);
  };
  // Continuous outer wall, rounded lip, deep inner taper and sealed cavity floor.
  const rows:{t:number;r:number;v:number}[]=[];
  for(let i=0;i<=n;i++){const t=i/n;rows.push({t,r:radius(t),v:t});}
  function addRow(row:{t:number;r:number;v:number}):void {for(let j=0;j<=sides;j++){const a=j/sides*TAU,p=point(row.t,a,row.r);positions.push(p.x,p.y,p.z);uv.push(j/sides,row.v);}}
  for(const row of rows)addRow(row);
  for(let i=0;i<n;i++)for(let j=0;j<sides;j++){const a=i*(sides+1)+j,b=a+sides+1;indices.push(a,b,a+1,b,b+1,a+1);}
  // Close the tiny tip explicitly.
  const tip=curve.getPoint(1),tipIndex=positions.length/3;positions.push(tip.x,tip.y,tip.z);uv.push(.5,1);
  if(!opts.openEnd)for(let j=0;j<sides;j++)indices.push(n*(sides+1)+j,tipIndex,n*(sides+1)+j+1);
  const start=positions.length/3;
  const insideRows=opts.hollow?34:1;
  for(let i=0;i<=insideRows;i++) {
    const t=opts.hollow?(opts.openEnd?i/insideRows:.36*i/insideRows):0;
    const r=opts.hollow?radius(t)*.87*(opts.openEnd?1:Math.sqrt(Math.max(0,1-i/insideRows))):radius(0)*(1-i);
    addRow({t,r,v:opts.hollow?.06+.10*i/insideRows:0});
  }
  for(let j=0;j<sides;j++)indices.push(j,j+1,start+j,start+j,j+1,start+j+1);
  for(let i=0;i<insideRows;i++)for(let j=0;j<sides;j++){const a=start+i*(sides+1)+j,b=a+sides+1;indices.push(a,a+1,b,b,a+1,b+1);}
  for(let i=0;i<indices.length;i+=3){const b=indices[i+1]!;indices[i+1]=indices[i+2]!;indices[i+2]=b;}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo,mat);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;g.add(mesh);
}
function build(id:string):THREE.Group {
  if(!ids.includes(id as typeof ids[number]))throw new Error('Unsupported trophy '+id);
  const g=new THREE.Group();g.name=id;g.userData.itemModel={itemId:id,author:'trophy-bones-a',reference:`art/item-icons/generated/${id}.png`,description:descriptions[id]};
  if(id==='curl_horn'){
    const horn=material('Weathered amber goat horn growth layers',[171,126,78],[61,45,33],.43,'ring');
    sweep(g,'Hollow deeply ringed goat horn',[[.015,-.14,.10,.056],[-.10,-.095,.02,.062],[-.13,.025,-.018,.065],[-.075,.14,-.023,.057],[.055,.17,-.009,.044],[.16,.11,.008,.031],[.18,.015,.02,.015],[.145,-.065,.024,.0006]],horn,{hollow:true,rings:.09,segments:224});
  } else if(id==='ox_horn'){
    const horn=material('Ivory ox horn fading to dark charcoal point',[217,191,145],[41,34,31],.33,'grain');
    sweep(g,'Open ox horn with thick scarred basal lip',[[-.15,-.105,.055,.065],[-.035,-.085,0,.062],[.095,-.02,-.01,.051],[.16,.09,-.014,.033],[.178,.2,-.005,.014],[.155,.26,.002,.0004]],horn,{hollow:true,longitudinal:.025,relief:.035,wobble:.009,segments:160});
    const scar=material('Dark basal horn scar tissue',[134,100,65],[162,125,79],.63,'root');
    sweep(g,'Ox horn ragged growth collar',[[-.15,-.105,.055,.067],[-.132,-.104,.043,.068],[-.118,-.101,.034,.065]],scar,{hollow:true,openEnd:true,longitudinal:.02,relief:.08,segments:20});
  } else if(id==='curved_tusk'){
    const ivory=material('Yellow ivory fine longitudinal grain',[223,190,126],[249,232,188],.29,'enamel');
    sweep(g,'Solid crescent tusk',[[.11,-.105,.015,.061],[.017,-.09,.004,.056],[-.095,-.025,0,.044],[-.13,.09,0,.031],[-.095,.195,.007,.016],[-.033,.285,.011,.0003]],ivory,{oval:.93,longitudinal:.016,relief:.035,innerWear:true,segments:192});
    const root=material('Tusk brown cementum root ridges',[157,120,77],[200,167,111],.55,'ring');
    sweep(g,'Tusk root collar',[[.158,-.105,.018,.05],[.135,-.106,.017,.063],[.111,-.105,.015,.062],[.085,-.102,.012,.056]],root,{rings:.13,ringCount:3,relief:.065,oval:.94,segments:64});
  } else if(id==='coyote_fang'){
    const root=material('Porous tan tooth root dentine',[173,135,88],[194,153,104],.72,'root');
    const enamel=material('Cream polished canine enamel',[241,222,179],[255,246,218],.21,'enamel');
    sweep(g,'Long tapered grooved tooth root',[[.032,-.105,0,.004],[.037,-.077,0,.014],[.025,-.025,0,.018],[-.003,.028,.003,.024]],root,{oval:.94,longitudinal:.03,relief:.15,segments:100});
    sweep(g,'Swept pointed enamel crown',[[-.003,.02,.003,.021],[-.015,.057,.004,.019],[-.037,.09,.002,.012],[-.077,.126,0,.00025]],enamel,{oval:.96,longitudinal:.016,relief:.025,wobble:.032,segments:112});
  } else if(id==='bear_claw'){
    const horn=material('Dark chestnut claw keratin with worn grey tip',[110,66,37],[147,136,112],.3,'grain');
    sweep(g,'Deep curved bear claw flattened side walls',[[-.054,.065,.008,.032],[-.015,.052,0,.038],[.028,.022,0,.033],[.052,-.021,0,.024],[.052,-.067,.004,.014],[.035,-.1,.006,.003]],horn,{oval:.84,longitudinal:.035,relief:.065,segments:160});
    const root=material('Ochre rough claw attachment',[142,100,57],[99,66,38],.64,'root');
    sweep(g,'Scalloped hollow attachment socket',[[-.076,.073,.012,.03],[-.064,.069,.01,.038],[-.046,.062,.006,.034]],root,{hollow:true,openEnd:true,oval:.85,longitudinal:.025,relief:.10,segments:40});
  } else {
    const antler=material('Brown antler bark grain with polished cream tips',[130,91,53],[244,224,180],.52,'grain');
    const paths: P[][]=[
      [[-.22,-.20,.015,.029],[-.13,-.16,0,.032],[-.045,-.085,-.005,.034],[.07,-.028,0,.028],[.15,.068,-.012,.023],[.21,.177,-.005,.015],[.255,.285,0,.0004]],
      [[-.065,-.11,0,.028],[-.055,-.017,.012,.024],[-.085,.08,.006,.019],[-.099,.163,.004,.013],[-.061,.235,0,.0003]],
      [[-.074,.045,.01,.018],[-.038,.093,.02,.013],[.003,.135,.017,.0003]],
      [[.08,-.011,0,.022],[.15,.014,.015,.018],[.214,.044,.026,.011],[.242,.083,.018,.0003]],
      [[.012,-.06,0,.023],[.095,-.093,.014,.018],[.165,-.087,.026,.011],[.195,-.063,.026,.0004]],
      [[-.115,-.153,0,.025],[-.031,-.201,.018,.021],[.06,-.217,.025,.012],[.122,-.19,.025,.0004]],
    ];
    paths.forEach((p,i)=>sweep(g,i===0?'Main antler beam and high terminal tine':`Antler branching tine ${i}`,p,antler,{longitudinal:.06,segments:90}));
    const cut=material('Antler burr porous bone',[199,162,107],[226,196,144],.75,'root');
    sweep(g,'Cut antler pedicle with scalloped burr',[[-.23,-.207,.017,.029],[-.216,-.197,.014,.035],[-.204,-.191,.011,.029]],cut,{longitudinal:.13,segments:24});
    for(let i=0;i<22;i++){
      const a=i/22*TAU;const geo=new THREE.SphereGeometry(.004+hash(i)*.002,10,8);const mesh=new THREE.Mesh(geo,cut);mesh.name=`Burr bone pearl ${i}`;mesh.position.set(-.217+Math.cos(a)*.023,-.198-Math.cos(a)*.021,.014+Math.sin(a)*.03);mesh.scale.set(1,.8,1);g.add(mesh);
    }
  }
  return g;
}
export const author:ItemModelAuthor={ids,build};


