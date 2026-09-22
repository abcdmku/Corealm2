import * as THREE from "three";
import type { MeshBasicNodeMaterial } from "three/webgpu";
import { float, modelNormalMatrix, normalGeometry, positionGeometry, sin, varying } from "three/tsl";
import { basicSpellPath } from "./basicSpellPath.js";
import { BasicParticleMotion } from "./basicParticleMotion.js";
import type { SpellElement, Vec3 } from "../contracts.js";
import type { ElementalCast } from "../systems/elementalAttacks.js";
import { ElementalAtmosphere } from "./elementalAtmosphere.js";
import { ElementalFlowSurfaces } from "./elementalFlowSurfaces.js";
import { AirCurrentSheets } from "./airCurrentSheets.js";
import { ElementalEnergyBodies } from "./elementalEnergyBodies.js";
import { FracturedBoulder } from "./fracturedBoulder.js";
import type { ElementalParticleCloud } from "./elementalParticleCloud.js";
import type { ElementalFluidBodies } from "./elementalFluidBodies.js";
import { createElementalRefractionMaterial, registerElementalRefraction } from "./elementalRefraction.js";
import { clockUniform } from "./elementalNodes.js";

const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const smooth=(v:number)=>{const t=clamp(v);return t*t*(3-2*t);};
const random=(i:number,s=0)=>{const x=Math.sin(i*127.1+s*311.7)*43758.5453;return x-Math.floor(x);};

/** Starter casts stay small: one moving body, one contact, and a short particle tail. */
export class BasicElementalVfx {
  private readonly particles:BasicParticleMotion;
  private readonly flow:ElementalFlowSurfaces;
  private readonly smoke:ElementalAtmosphere;
  private readonly currents:AirCurrentSheets;
  private readonly flame:ElementalEnergyBodies;
  private readonly pebble:FracturedBoulder;
  private readonly pressure:THREE.Mesh<THREE.SphereGeometry,MeshBasicNodeMaterial>;
  private readonly clock={value:0};
  private readonly alpha={value:0};
  private readonly unregister:()=>void;
  constructor(parent:THREE.Object3D,private readonly ground:(x:number,z:number)=>number,
    private readonly fragments:ElementalParticleCloud,
    private readonly fluids:ElementalFluidBodies){
    this.particles=new BasicParticleMotion(parent);
    this.flow=new ElementalFlowSurfaces(parent);
    this.smoke=new ElementalAtmosphere(parent,"smoke");
    this.currents=new AirCurrentSheets(parent,"elemental-basic-air");
    this.flame=new ElementalEnergyBodies(parent,"fire",true);
    this.flame.mesh.name="elemental-basic-flame";
    this.pebble=new FracturedBoulder(parent,24,"elemental-basic-pebble",ground);
    const time=clockUniform(this.clock);
    const puff=positionGeometry.mul(sin(positionGeometry.y.mul(9).sub(time.mul(8))).mul(.045).add(1));
    const material=createElementalRefractionMaterial({clock:this.clock,liquid:false,strength:12,
      positionNode:puff,normalNode:varying(modelNormalMatrix.mul(normalGeometry)),
      localNode:varying(puff),alphaNode:clockUniform(this.alpha),seedNode:float(8)});
    material.side=THREE.FrontSide;
    this.pressure=new THREE.Mesh(new THREE.SphereGeometry(1,20,12),material);
    this.pressure.name="elemental-basic-pressure";this.pressure.visible=false;
    parent.add(this.pressure);this.unregister=registerElementalRefraction(this.pressure);
  }
  get particleCount():number{return this.particles.liveCount;}
  get droppedParticles():number{return this.particles.dropped;}
  get instances():number{return this.currents.instances+this.flow.instances+this.flame.instances+this.smoke.instances+Number(this.pressure.visible)+Number(this.pebble.mesh.visible);}
  get dropped():number{return this.currents.dropped+this.flow.dropped+this.flame.dropped+this.smoke.dropped;}
  get solidCount():number{return this.pebble.mesh.visible?this.pebble.pieces:0;}
  begin(seconds:number,energyGain=1):void{this.particles.begin(seconds,energyGain);this.clock.value=seconds;this.currents.begin(seconds);this.flow.begin(seconds);this.smoke.begin(seconds);this.flame.begin(seconds);this.pebble.hide();this.pressure.visible=false;}
  update(cast:ElementalCast,now:number,element:SpellElement):void{
    const age=now-cast.started,p=cast.pulses[0]!,local=(age-p.at)/1000;
    if(age<0||local>.92)return;
    const u=clamp((age-(cast.releaseAt??100))/(p.at-(cast.releaseAt??100))),size=cast.visualScale??1,density=cast.particleScale??1;
    const dx=cast.aim[0]-cast.origin[0],dz=cast.aim[2]-cast.origin[2],len=Math.hypot(dx,dz)||1,
      fx=dx/len,fz=dz/len,yaw=Math.atan2(fx,fz);
    const release:Vec3=cast.release??[cast.origin[0]+fx*.5+fz*.28,cast.origin[1]+1.17,cast.origin[2]+fz*.5-fx*.28];
    const impact:Vec3=[cast.aim[0],this.ground(cast.aim[0],cast.aim[2])+(cast.impactHeight??1.5),cast.aim[2]];
    const point=basicSpellPath(release,impact);
    const head=point(u),tail=point(Math.max(0,u-.12)),grow=(.4+smooth(age/140)*.6)*size;
    const fade=local<0?1:1-smooth(local/.88);
    if(element==="earth"){
      this.pebble.pose(head[0],head[1],head[2],.09*grow,Math.min(age,p.at)*.008,local,fade);
    }else if(local<0){
      if(element==="wind"){
        this.pressure.visible=true;this.pressure.position.set(...head);this.pressure.rotation.y=yaw;
        this.pressure.scale.set(.30*grow,.28*grow,.53*grow);this.alpha.value=.85;
        this.currents.put("crescent",...head,.52*grow,.55*grow,.48*grow,.75,8,yaw,.3,0,{width:.46});
      }else if(element==="water"){
        this.fluids.put("drop",...head,.07*grow,.07*grow,.16*grow,yaw);
      }else{
        this.smoke.put(tail[0],tail[1]+.12,tail[2],.27*grow,.33*grow,.26*grow,.8,7);
        this.flame.curve(tail,point(Math.max(0,u-.08)),point(Math.max(0,u-.04)),head,.23*grow,0xff9e27,1,7,.7,1);
        this.flow.put("plume",element,...head,.34*grow,.6*grow,.34*grow,.94,7,yaw,.5);
      }
    }
    const groundY=local<0?0:this.ground(head[0],head[2]);
    this.particles.update(cast,now,element,release,impact,fx,fz,groundY);
    if(local>=0){
      const r=(.16+(1-Math.exp(-local*7))*.95)*size;
      if(cast.missed){ /* A miss only sheds a few fading motes. */ }else if(element==="wind"){
        this.pressure.visible=fade>.01;this.pressure.position.set(...head);this.pressure.scale.set(r,r*.64,r);
        this.alpha.value=fade*.72;
        this.currents.put("crescent",...head,r,r*.64,r*.6,fade*.72,8,yaw+local*1.7,.25,0,{width:.38});
      }else if(element==="water"){
        this.flow.put("band",element,head[0],groundY+.05,head[2],r,.58*fade,r*.8,fade*.85,5,yaw,0,0,{arc:.83,lean:.7});
        this.fluids.put("pool",head[0],groundY+.035,head[2],r,.045*fade,r*.8,yaw);
      }else if(element==="fire"){
        for(let k=0;k<2;k++)this.smoke.put(head[0]+Math.sin(k*3+local)*.2,head[1]+.42*size+local*.7,head[2]+Math.cos(k*3)*.16,
          (.3+local*.3)*size,(.45+local*.45)*size,(.3+local*.3)*size,fade*.46,9+k);
        this.flow.put("plume",element,head[0],head[1]-.3,head[2],.52*fade*size,.9*fade*size,.46*fade*size,fade,9,yaw,0,0,{arc:.85,lean:.7});
      }
      // Fragment and water body renderers still own these sparse secondary particles.
      if(element==="earth"||element==="water")for(let i=0;i<Math.round((cast.missed?32:320)*density);i+=element==="earth"?5:16){
        const angle=random(i,4)*Math.PI*2,d=local*(.5+random(i,5)*2),x=head[0]+Math.cos(angle)*d,z=head[2]+Math.sin(angle)*d;
        const y=Math.max(groundY+.03,head[1]+local*(random(i,6)*2)-local*local*3.8);
        if(element==="earth")this.fragments.put(x,y,z,(.02+random(i,9)*.026)*fade,0x888071,fade,i+local*4);
        else this.fluids.put("drop",x,y,z,.028*fade,.045*fade,.028*fade,angle);
      }
    }
  }
  end():void{this.currents.end();this.flow.end();this.smoke.end();this.flame.end();}
  dispose():void{this.particles.dispose();this.currents.dispose();this.flow.dispose();this.smoke.dispose();this.flame.dispose();this.pebble.dispose();this.unregister();this.pressure.removeFromParent();this.pressure.geometry.dispose();this.pressure.material.dispose();}
}
