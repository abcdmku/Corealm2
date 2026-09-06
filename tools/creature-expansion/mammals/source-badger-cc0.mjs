import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {KHRONOS_EXTENSIONS} from '@gltf-transform/extensions';
export const BADGER_CC0_REFERENCE={source:'https://opengameart.org/content/evil-giant-rat',author:'CDmir; TinyWorlds',license:'CC0-1.0',originalSpecies:'rat',anatomy:['https://science.rspca.org.uk/en/web/rspca/adviceandwelfare/wildlife/badgers','https://britishwildlifecentre.co.uk/planyourvisit/animals/badger/'],scope:'Complete-source Badger adaptation; no unverified badger mesh or texture used.'};
export const canonical=([x,y,z])=>[x,z,-y];
export const native=([x,y,z])=>[x,-z,y];
export const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function warpBadger(point,name='Body',weights=[]){
 let [x,y,z]=canonical(point);const [ox,oy,oz]=[x,y,z];
 const sum=(test)=>weights.reduce((s,[n,w])=>s+(test(n)?w:0),0);
 const tail=sum(n=>n.startsWith('Tail'));
 // Lower the entire axial arch while reinforcing its continuous shoulders.
 const torso=smooth(.15,.60,y)*(1-smooth(1.06,1.50,z));
 const shoulder=Math.exp(-(((z-.83)/.52)**2))*smooth(.22,.63,y);
 x*=1+.20*torso+.18*shoulder;y=y*.78+.12*shoulder;
 // A smooth compression retains every tail loop, with a substantial furred root.
 const distance=Math.max(0,-oz-.45),d=.36,t=Math.min(1,distance/d);
 const compressed=distance<=d?distance-.91*d*(t*t*t-.5*t*t*t*t):d*.545+(distance-d)*.09;
 z+=tail*(distance-compressed);x*=1+.42*tail*smooth(.45,.9,-oz);
 y=.32+(y-.32)*(1-.36*tail);
 // Broaden the actual source feet and low forearms, preserving authored digits.
 const foot=(1-smooth(.10,.29,oy))*sum(n=>n.includes('Leg'));
 const centre=Math.sign(ox)*(oz>.65?.385:.435);
 x+=(ox-centre)*.65*foot;
 y+=.025*foot*smooth(.015,.09,oy);
 // The source jaw is open in rest. Close it around its existing hinge.
 if(name==='Head'||name==='Teeth'||name==='Eyes'){
  const jaw=sum(n=>n==='Backbone.003');
  if(jaw){const dy=y-.5792035*.78,dz=z-1.4637687,a=.57*jaw;y=.5792035*.78+Math.cos(a)*dy+Math.sin(a)*dz;z=1.4637687-Math.sin(a)*dy+Math.cos(a)*dz;}
 }
 // Shared neck/skull taper is continuous through the original mesh joins.
 const head=smooth(1.08,1.48,oz);z-=.18*head*(z-1.08);x*=1+.23*head;
 if(name==='Head'||name==='Eyes'||name==='Teeth'){
  // Monotone compression above the ear root avoids folding the thin ear shell.
  if(y>.59)y=.59+(y-.59)*.50;
 }
 if(name==='Head'){
  const ear=smooth(.68,.83,oy)*(1-smooth(1.48,1.66,oz));
  const ax=Math.abs(x);if(ax>.20)x=Math.sign(x)*(.20+(ax-.20)*(1-.48*ear));
 }
 if(name==='Teeth')y=.47+(y-.47)*.45;
 return native([x,y,z]);
}
const hash=(a,b,c)=>{const n=Math.sin(a*127.1+b*311.7+c*74.7)*43758.5453123;return n-Math.floor(n);};
export function badgerCoat(point,name){
 const [x,y,z]=canonical(point),ax=Math.abs(x);
 if(name==='Eyes')return [.025,.020,.015];
 if(name==='Teeth')return [.64,.61,.49];
 const noise=hash(Math.floor(x*550),Math.floor(y*430),Math.floor(z*52));
 if(name==='Head'){
  const stripeCentre=.060+.12*(1-smooth(1.45,2.18,z));
  const stripeWidth=.048+.04*(1-smooth(1.4,1.95,z));
  const stripe=1-smooth(stripeWidth*.7,stripeWidth,Math.abs(ax-stripeCentre));
  const nose=smooth(2.13,2.20,z);
  const mouth=1-smooth(.40,.49,y);
  const ear=smooth(.80,.90,y)*smooth(.18,.25,ax)*(1-smooth(1.70,1.91,z));
  const black=Math.max(stripe,nose,mouth,ear*.7),white=.68+noise*.13;
  const c=white*(1-black)+(.024+noise*.018)*black;return [c,c*.985,c*.95];
 }
 const upper=smooth(.23,.65,y),neck=1-smooth(1.12,1.50,z);
 const grey=(.20+noise*.17)*upper*neck+.030*(1-upper*neck);
 return [grey,grey*.97,grey*.91];
}
export async function loadAdaptedBadgerCC0(){
 const dir=new URL('../../../art/rebuild/candidates/finish-quadrupeds/source-badger-cc0/',import.meta.url),bytes=await readFile(new URL('cdmir-badger-normalized.glb',dir)),report=JSON.parse(await readFile(new URL('badger-adaptation.json',dir),'utf8'));
 if(createHash('sha256').update(bytes).digest('hex')!==report.normalizedSha256)throw Error('Badger CC0 adaptation hash mismatch');
 return {document:await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).readBinary(bytes),bytes,report,provenance:BADGER_CC0_REFERENCE,labAccepted:false};
}
