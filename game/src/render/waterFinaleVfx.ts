import { DelugeSurface, delugePoint, delugeSplashPoint } from "./delugeSurface.js";
import { DelugeCollision } from "./delugeCollision.js";
import type { ElementalCast } from "../systems/elementalAttacks.js";
import { FINALE } from "../content/elementalFinales.js";
import { ElementalParticleCloud } from "./elementalParticleCloud.js";
import { ElementalFlowSurfaces } from "./elementalFlowSurfaces.js";
import * as THREE from "three";

const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const ease=(n:number)=>{const t=clamp(n);return t*t*(3-2*t);};
const rand=(i:number,s=0)=>{const n=Math.sin(i*127.1+s*311.7)*43758.5453;return n-Math.floor(n);};
const TAU=Math.PI*2;

let launchCache:{spray:Float32Array;foam:Float32Array}|undefined;
function waterLaunches(){
  if(launchCache)return launchCache;
  const spray=new Float32Array(18000*8),foam=new Float32Array(12000*4);
  const crash=FINALE.deluge.contact+FINALE.deluge.rowGap*2;
  // Launch positions, velocities and particle variation are fixed for this
  // recipe. Cache them at setup, leaving only ballistic motion in each frame.
  for(let i=0;i<18000;i++){
    const n=i*8,burst=i<6000,birth=.018+Math.pow(rand(i,30),1.7)*(burst?.115:.26),lobe=Math.floor(rand(i,31)*8),v=rand(i,32);
    const launch=delugeSplashPoint(lobe,rand(i,36),burst?.18+v*.45:.52+v*.46,crash+birth*1000);
    const angle=Math.atan2(launch[2],launch[0])-(burst?.25:.7)+(rand(i,37)-.5)*.85;
    const speed=burst?6+rand(i,33)*9:1.2+rand(i,33)*5.8;
    spray.set([birth,...launch,Math.cos(angle)*speed,burst?2+rand(i,34)*5:3.5+rand(i,34)*8.5,Math.sin(angle)*speed,
      i%43===0?.060+v*.032:.018+rand(i,35)*.028],n);
  }
  for(let i=0;i<12000;i++)foam.set([rand(i,10)*TAU,.26+rand(i,11)*.65,rand(i,16),.017+rand(i,12)*.025],i*4);
  return launchCache={spray,foam};
}

/** Perimeter surf converges into one upward collision, then falls back as rain. */
export class WaterFinaleVfx {
  private readonly flow:ElementalFlowSurfaces;
  private readonly surf:DelugeSurface;
  private readonly splash:DelugeSurface;
  private readonly collision:DelugeCollision;
  private readonly droplets:ElementalParticleCloud;
  private readonly launches=waterLaunches();
  readonly state={height:0,width:0,radius:0,splashHeight:0,phase:""};
  constructor(parent:THREE.Object3D,private readonly ground:(x:number,z:number)=>number){
    this.flow=new ElementalFlowSurfaces(parent);
    this.surf=new DelugeSurface(parent,false);this.splash=new DelugeSurface(parent,true);
    this.collision=new DelugeCollision(parent);
    this.droplets=new ElementalParticleCloud(parent,"droplet",30000);
    this.droplets.mesh.name="elemental-3d-deluge-droplets";
  }
  get particleCount(){return this.droplets.instances;}
  get droppedParticles(){return this.droplets.dropped;}
  get instances(){return this.flow.instances+Number(this.surf.mesh.visible)+Number(this.splash.mesh.visible)+Number(this.collision.mesh.visible);}
  get dropped(){return this.flow.dropped;}
  begin(t:number){this.surf.hide();this.splash.hide();this.collision.hide();this.flow.begin(t);this.droplets.begin(t);Object.assign(this.state,{height:0,width:0,radius:0,splashHeight:0,phase:""});}
  end(){this.flow.end();this.droplets.end();}
  update(cast:ElementalCast,age:number){
    const timing=FINALE.deluge;
    if(age<0||age>=timing.end)return;
    const [x,,z]=cast.aim,y=this.ground(x,z),t=age/1000;
    const crash=timing.contact+timing.rowGap*2,a=(age-crash)/1000;
    const rise=ease((age-300)/1250),pull=ease((age-1600)/(crash-1600));
    const radius=10.2*(1-pull)+.7*pull,vanish=1-ease(a/.24);
    const yaw=Math.atan2(x-cast.origin[0],z-cast.origin[2]);
    this.state.phase=age<1600?"perimeter-waves":age<crash?"inward-surge":a<1.25?"collision-splash":"falling-rain";
    this.state.radius=radius;this.state.width=20.4;
    if(vanish>.01&&rise>.01){
      this.surf.update(x,y,z,age,rise*vanish*.96);
      this.state.radius=this.surf.radius;this.state.height=this.surf.height;
      // Foam stays attached to the continuously bending lip, then spills off with gravity.
      for(let i=0;i<12000;i++){
        const n=i*4,data=this.launches.foam;
        const pos=delugePoint(data[n]!,data[n+1]!,age),spill=(data[n+2]!+t*.85)%1;
        const drift=spill*pull*.8,fall=spill*spill*pull*1.2;
        this.state.height=Math.max(this.state.height,pos[1]);
        this.droplets.put(x+pos[0]*(1-drift*.07),y+Math.max(.04,pos[1]-fall),z+pos[2]*(1-drift*.07),
          data[n+3]!,i%5?0x8fbec5:0xe1edeb,rise*vanish*(.6+spill*.3),i,1.25);
      }
      // Open, offset currents like Undertow, with gaps exposing the ground.
      for(let k=0;k<3;k++){
        const r=(7.8-k*1.9)*(1-pull*.7);
        this.flow.put("band","water",x+Math.sin(k*2.4)*.6,y+.08+k*.07,z+Math.cos(k*1.8)*.45,
          r,.22+k*.13,r*(.76+k*.08),rise*vanish*(.76-k*.08),k+311,
          yaw+k*2.2-t*(.55+k*.15),0,.32,{arc:.34+k*.055,lean:1.1});
      }
    }
    if(a>=0){
      const rain=1-ease((a-2.3)/1.1);
      this.collision.update(x,y,z,a,(1-ease((a-.30)/.85))*.93);
      // Unequal folded lobes rise from the collision; spray leaves their moving crests.
      this.splash.update(x,y,z,age,(1-ease((a-.60)/.62))*.98);
      this.state.splashHeight=this.splash.height;this.state.height=Math.max(this.state.height,this.splash.height);
      for(let i=0;i<18000;i++){
        const n=i*8,data=this.launches.spray,flight=a-data[n]!;if(flight<0)continue;
        const velocityY=data[n+5]!,h=data[n+2]!+velocityY*flight-6*flight*flight;
        if(h<0)continue;
        const px=x+data[n+1]!+data[n+4]!*flight+flight*flight*.45,pz=z+data[n+3]!+data[n+6]!*flight-flight*.3;
        this.droplets.put(px,y+h,pz,data[n+7]!,i%7?0x8cb9c1:0xd6e8e8,rain*.94,i,1.25+Math.min(1.6,Math.abs(velocityY-12*flight)*.10));
      }
      const drain=1-ease((a-1.8)/1.6);
      if(a>.6)for(let k=0;k<5;k++){
        const angle=k*2.399,rr=2+k*.7;
        this.flow.put("band","water",x+Math.cos(angle)*rr,y+.055,z+Math.sin(angle)*rr,1.3,.18,1.1,
          drain*.45,190+k,angle,0,1,{arc:.42,lean:.8});
      }
    }
  }
  dispose(){this.surf.dispose();this.splash.dispose();this.collision.dispose();this.flow.dispose();this.droplets.dispose();}
}
