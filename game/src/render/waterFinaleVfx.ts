import { DelugeSurface } from "./delugeSurface.js";
import { DelugeCollision } from "./delugeCollision.js";
import type { ElementalCast } from "../systems/elementalAttacks.js";
import { FINALE } from "../content/elementalFinales.js";
import { DelugeParticles } from "./delugeParticles.js";
import { ElementalFlowSurfaces } from "./elementalFlowSurfaces.js";
import * as THREE from "three";

const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const ease=(n:number)=>{const t=clamp(n);return t*t*(3-2*t);};
/** Perimeter surf converges into one upward collision, then falls back as rain. */
export class WaterFinaleVfx {
  private readonly flow:ElementalFlowSurfaces;
  private readonly surf:DelugeSurface;
  private readonly splash:DelugeSurface;
  private readonly collision:DelugeCollision;
  private readonly droplets:DelugeParticles;
  readonly state={height:0,width:0,radius:0,splashHeight:0,phase:""};
  constructor(parent:THREE.Object3D,private readonly ground:(x:number,z:number)=>number){
    this.flow=new ElementalFlowSurfaces(parent);
    this.surf=new DelugeSurface(parent,false);this.splash=new DelugeSurface(parent,true);
    this.collision=new DelugeCollision(parent);
    this.droplets=new DelugeParticles(parent);
  }
  get particleCount(){return this.droplets.instances;}
  get particleCandidates(){return this.droplets.candidateCount;}
  get droppedParticles(){return this.droplets.dropped;}
  get instances(){return this.flow.instances+Number(this.surf.mesh.visible)+Number(this.splash.mesh.visible)+Number(this.collision.mesh.visible);}
  get dropped(){return this.flow.dropped;}
  begin(t:number){this.surf.hide();this.splash.hide();this.collision.hide();this.flow.begin(t);this.droplets.begin(t);Object.assign(this.state,{height:0,width:0,radius:0,splashHeight:0,phase:""});}
  end(){this.flow.end();this.droplets.end();}
  update(cast:ElementalCast,age:number){
    const timing=FINALE.deluge;
    if(age<0||age>=timing.end)return;
    const [x,,z]=cast.aim,y=this.ground(x,z),t=age/1000;
    this.droplets.update(x,y,z,age);
    const crash=timing.contact+timing.rowGap*2,a=(age-crash)/1000;
    const rise=ease((age-300)/1250),pull=ease((age-1600)/(crash-1600));
    const radius=10.2*(1-pull)+.7*pull,vanish=1-ease(a/.24);
    const yaw=Math.atan2(x-cast.origin[0],z-cast.origin[2]);
    this.state.phase=age<1600?"perimeter-waves":age<crash?"inward-surge":a<1.25?"collision-splash":"falling-rain";
    this.state.radius=radius;this.state.width=20.4;
    if(vanish>.01&&rise>.01){
      this.surf.update(x,y,z,age,rise*vanish*.96);
      this.state.radius=this.surf.radius;this.state.height=this.surf.height;
      // Height comes from the visible surf mesh; particles follow the same lip on the GPU.
      // Open, offset currents like Undertow, with gaps exposing the ground.
      for(let k=0;k<3;k++){
        const r=(7.8-k*1.9)*(1-pull*.7);
        this.flow.put("band","water",x+Math.sin(k*2.4)*.6,y+.08+k*.07,z+Math.cos(k*1.8)*.45,
          r,.22+k*.13,r*(.76+k*.08),rise*vanish*(.76-k*.08),k+311,
          yaw+k*2.2-t*(.55+k*.15),0,.32,{arc:.34+k*.055,lean:1.1});
      }
    }
    if(a>=0){
      this.collision.update(x,y,z,a,(1-ease((a-.30)/.85))*.93);
      // Unequal folded lobes rise from the collision; spray leaves their moving crests.
      this.splash.update(x,y,z,age,(1-ease((a-.60)/.62))*.98);
      this.state.splashHeight=this.splash.height;this.state.height=Math.max(this.state.height,this.splash.height);
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
