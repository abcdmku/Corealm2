import * as THREE from "three";
import type { Vec3 } from "../contracts.js";
import type { ElementalCast } from "../systems/elementalAttacks.js";
import type { ElementalParticleCloud } from "./elementalParticleCloud.js";
import type { ElementalFilaments } from "./elementalFilaments.js";
import type { ElementalVolumes } from "./elementalVolumes.js";
import { ElementalAtmosphere } from "./elementalAtmosphere.js";
import { ElementalEnergyBodies } from "./elementalEnergyBodies.js";
import { ElementalFlowSurfaces } from "./elementalFlowSurfaces.js";
import { elementalPulseArt } from "./elementalPulseArt.js";

const TAU=Math.PI*2;
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const ease=(v:number)=>{const t=clamp(v);return t*t*(3-2*t);};
const random=(i:number,s=0)=>{const x=Math.sin(i*127.1+s*311.7)*43758.5453;return x-Math.floor(x);};
const mix=(a:Vec3,b:Vec3,t:number):Vec3=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
const bezier=(a:Vec3,b:Vec3,c:Vec3,d:Vec3,t:number):Vec3=>{const s=1-t;const at=(k:number)=>s*s*s*a[k]!+3*s*s*t*b[k]!+3*s*t*t*c[k]!+t*t*t*d[k]!;return [at(0),at(1),at(2)];};

/** Each spell owns one continuous composition. Individual damage hits only shed secondary sparks. */
export class FireSpellVfx {
  private readonly bodies:ElementalEnergyBodies;
  private readonly atmosphere:ElementalAtmosphere;
  private readonly flow:ElementalFlowSurfaces;
  readonly state={variant:"",mainShapes:0,composition:""};
  constructor(parent:THREE.Object3D,private readonly ground:(x:number,z:number)=>number,
    private readonly sparks:ElementalParticleCloud,private readonly smoke:ElementalParticleCloud,
    private readonly lines:ElementalFilaments,private readonly volumes:ElementalVolumes,
    private readonly illuminate:(x:number,y:number,z:number,color:number,intensity:number,distance:number)=>void){
    this.bodies=new ElementalEnergyBodies(parent,"fire");this.bodies.mesh.name="elemental-fire-authored-shapes";
    this.atmosphere=new ElementalAtmosphere(parent,'fire');
    this.flow=new ElementalFlowSurfaces(parent);
  }
  get instances():number{return this.bodies.instances+this.atmosphere.instances+this.flow.instances;}
  get dropped():number{return this.bodies.dropped+this.atmosphere.dropped+this.flow.dropped;}
  begin(seconds:number):void{this.bodies.begin(seconds);this.atmosphere.begin(seconds);this.flow.begin(seconds);this.state.mainShapes=0;}
  end():void{this.bodies.end();this.atmosphere.end();this.flow.end();this.state.mainShapes=this.instances;}
  update(cast:ElementalCast,now:number):void{
    const age=now-cast.started,t=age/1000,last=cast.pulses.at(-1)!.at;
    if(age<0||age>last+1050)return;
    this.state.variant=cast.spellId;
    const [x,,z]=cast.aim,y=this.ground(x,z),end=1-ease((age-last-350)/650);
    const yaw=Math.atan2(x-cast.origin[0],z-cast.origin[2]),dx=Math.sin(yaw),dz=Math.cos(yaw);
    const release:Vec3=[cast.origin[0]+dx*.5+dz*.3,cast.origin[1]+1.18,cast.origin[2]+dz*.5-dx*.3];
    const charge=ease(age/180)*(1-ease((age-300)/220));
    this.flow.put("shell","fire",release[0],release[1],release[2],.25,.30,.25,charge*.9,43);
    if(cast.spellId==="ember-dart"){
      this.state.composition="single-comet-and-crawling-burn";
      const progress=clamp((age-90)/460),head:Vec3=[release[0]+(x-release[0])*progress,release[1]+progress*.22,release[2]+(z-release[2])*progress];
      if(age<650){
        const trailLength=Math.min(1.8,progress*12+.2),tail:Vec3=[head[0]-dx*trailLength,head[1]+.15,head[2]-dz*trailLength];
        this.stroke(tail,mix(tail,head,.3),[head[0]+.14,head[1]+.3,head[2]],head,.34,0xffad30,1,1);
        this.flow.put("shell","fire",head[0],head[1],head[2],.42,.45,.42,.95,3);
        this.emitTrail(u=>mix(tail,head,u),900,t,1,.2);
      }
      if(age>=550){
        const a=(age-550)/1000;
        for(let k=0;k<5;k++){
          const angle=k*2.4+t*1.1,r=.5+k*.07;
          this.flow.put("plume","fire",x+Math.cos(angle)*r*.6,y+.04,z+Math.sin(angle)*r*.6,.45,.95+Math.sin(t*6+k)*.16,.45,end*.86,k);
        }
        this.burst([x,y+.8,z],a,1.1,1100,5,1);
      }
    }else if(cast.spellId==="furnace-whip"){
      this.state.composition="one-flexing-lash";
      const u=clamp((age-450)/650),index=Math.min(4,Math.floor(u*5)),blend=u*5-index;
      const target=mix(cast.pulses[index]!.point,cast.pulses[index+1]!.point,blend);
      const start:Vec3=release,head:Vec3=[target[0],y+1.3,target[2]];
      const fade=ease((age-150)/300)*(1-ease((age-1200)/650));
      const a:Vec3=[start[0]+dx*4+dz*Math.sin(t*4)*2,start[1]+2.3,start[2]+dz*4-dx*Math.sin(t*4)*2];
      const b:Vec3=[head[0]-dx*2+dz*Math.sin(t*5),y+3,head[2]-dz*2-dx*Math.sin(t*5)];
      this.stroke(start,a,b,head,.5,0xffa52e,fade,8);
      this.stroke(start,[a[0]-.13,a[1]-.18,a[2]],[b[0],b[1]+.15,b[2]],head,.23,0xff5521,fade,9);
      this.emitTrail(u=>bezier(start,a,b,head,u),2600,t,2,fade*.5);
      for(let k=0;k<10;k++){
        const p=bezier(start,a,b,head,.13+k*.08),h=.5+random(k)*.5;
        this.stroke(p,[p[0]-.3,p[1]+h*.3,p[2]-.2],[p[0]+Math.sin(t*8+k)*.4,p[1]+h*.8,p[2]-.5],
          [p[0],p[1]+h,p[2]-.75],.16,0xff6d17,fade*.7,k+10);
      }
      for(const [i,p] of cast.pulses.entries())this.burst([p.point[0],y+.1,p.point[2]],(age-p.at)/1000,1.1,600,4,i+40,true);
    }else if(cast.spellId==="cinder-mine"){
      this.state.composition="compressed-core-and-blast-canopy";
      if(age<1800){
        const charge=ease(age/1800);
        for(let k=0;k<9;k++){
          const angle=k*TAU/9+t*1.5,r=3.8*(1-charge*.85);
          const a:Vec3=[x+Math.cos(angle)*r,y+.05,z+Math.sin(angle)*r];
          this.stroke(a,[x+Math.cos(angle+.4)*r*.7,y+.1,z+Math.sin(angle+.4)*r*.7],
            [x+.3*Math.cos(angle),y+.18+charge*.4,z+.3*Math.sin(angle)],[x,y+.2,z],.12+charge*.12,0xff4b0c,.75,k);
        }
        this.emitTrail(u=>[x+Math.cos(u*TAU+t*3)*(1-charge)*3,y+.08+u*.6,z+Math.sin(u*TAU+t*3)*(1-charge)*3],1100,t,4,.4);
        this.illuminate(x,y+.4,z,0xff6615,50*charge,8);
      }else{
        const a=(age-1800)/1000,r=5.5*(1-Math.exp(-a*7)),h=1.4+Math.sin(clamp(a)*Math.PI)*2.8;
        // Unequal rolling billows form a blast front, with dense sparks between them.
        for(let k=0;k<11;k++){
          const angle=k*2.39996,spread=r*(.35+random(k,15)*.42),size=1.2+random(k,12)*.65;
          const lift=h*(.2+random(k,16)*.32),curl=angle+a*(.3+random(k,18));
          this.flow.put("plume","fire",x+Math.cos(curl)*spread,y+.04,z+Math.sin(curl)*spread,size*1.15,lift*1.4+1.1,size*1.15,end*.9,k+10);
          if(k<4)this.flow.put("shell","fire",x+Math.cos(curl)*spread*.7,y+lift*.5,z+Math.sin(curl)*spread*.7,size,Math.max(.25,lift),size,end*.75,k+17);
        }
        this.flow.put("band","fire",x,y+.08,z,r,1.1*(1-a*.7),r,end,12);
        this.burst([x,y+.5,z],a,5.5,5500,9,8);
        if(age>=2150)this.burst([x,y+.15,z],(age-2150)/1000,6,3000,12,9,true);
      }
    }else if(cast.spellId==="phoenix-pass"){
      this.state.composition="one-phoenix-outward-and-return";
      const pulse=cast.pulses.find(p=>age<p.at)??cast.pulses.at(-1)!;
      const u=clamp((age-(pulse.launchAt??0))/(pulse.at-(pulse.launchAt??0))),from=pulse.from??cast.origin;
      const p=mix(from,pulse.point,u),returning=age>=1500,span=returning?3.4:5.8;
      const direction=returning?-1:1,fx=dx*direction,fz=dz*direction;
      const h=y+2.5+Math.sin(u*Math.PI)*.35,flap=Math.sin(t*7)*.65,fade=ease(age/200)*end;
      const head:Vec3=[p[0]+fx*.7,h+.4,p[2]+fz*.7],tail:Vec3=[p[0]-fx*2.4,h-.15,p[2]-fz*2.4];
      this.stroke(tail,[p[0]-fx,h+.2,p[2]-fz],[p[0]+fx*.2,h+.7,p[2]+fz*.2],head,.63,0xffb332,fade,4);
      for(const side of [-1,1])for(let k=0;k<6;k++){
        const s=side*(span-k*.45),back=k*.38;
        this.stroke([p[0],h,p[2]],[p[0]+dz*s*.28,h+1.5+flap,p[2]-dx*s*.28],
          [p[0]+dz*s*.76-fx*back,h+1.15+flap-k*.13,p[2]-dx*s*.76-fz*back],
          [p[0]+dz*s-fx*(1.1+back),h-.1-k*.2,p[2]-dx*s-fz*(1.1+back)],
          k===0?.63:.45,k%3?0xff8420:0xffd26b,fade*(1-k*.05),k+8);
      }
      for(let k=0;k<3;k++)this.stroke(tail,[tail[0]-fx,h,tail[2]-fz],
        [tail[0]-fx*2+dz*(k-1),h-.2+Math.sin(t*6+k)*.4,tail[2]-fz*2-dx*(k-1)],
        [tail[0]-fx*3+dz*(k-1),h-.7,tail[2]-fz*3-dx*(k-1)],.25,0xff561b,fade,k+21);
      this.emitTrail(v=>[p[0]+dz*(v-.5)*span*2-fx*Math.abs(v-.5)*3,h+Math.sin(v*Math.PI)*1.2+flap*v,p[2]-dx*(v-.5)*span*2-fz*Math.abs(v-.5)*3],3200,t,7,fade*.45);
      for(const [i,hit] of cast.pulses.entries())this.burst([hit.point[0],y+.15,hit.point[2]],(age-hit.at)/1000,hit.radius,450,4,i+60,true);
      this.illuminate(p[0],h,p[2],0xff9426,120*fade,15);
    }else{
      this.state.composition="single-solar-mass-and-coronal-strikes";
      const descent=ease((age-550)/2150),height=2.8+(1-descent)*6,r=3.0+Math.sin(t*8)*.12;
      if(age<2850){
        const fade=ease(age/500)*(1-ease((age-2700)/150));
        this.flow.put("shell","fire",x,y+height,z,r,r*1.07,r,fade,7,t*.4);
        this.flow.put("shell","fire",x,y+height,z,r*.83,r*.88,r*.83,fade,17,-t*.3);
        this.atmosphere.put(x,y+height,z,r*.69,r*.73,r*.69,fade*.45,7,y);
        this.illuminate(x,y+height,z,0xff942a,145*fade,18);
        // Asymmetric coronal tongues break away from a filled solar mass.
        for(let k=0;k<9;k++){
          const angle=k*2.39996+t*.5,vertical=random(k,72)*1.6-.8,ring=Math.sqrt(1-vertical*vertical),reach=1+random(k,73)*1.7;
          const start:Vec3=[x+Math.cos(angle)*r*ring*.8,y+height+vertical*r*.8,z+Math.sin(angle)*r*ring*.8];
          this.stroke(start,[start[0]+Math.cos(angle)*reach*.5,start[1]+reach*.4,start[2]+Math.sin(angle)*reach*.5],
            [start[0]+Math.cos(angle+.7)*reach,start[1]+reach,start[2]+Math.sin(angle+.7)*reach],
            [start[0]+Math.cos(angle+1)*reach,start[1]+reach*1.5,start[2]+Math.sin(angle+1)*reach],.28+random(k,74)*.25,0xff9127,fade*.78,k+70);
        }
        for(const [i,hit] of cast.pulses.slice(0,-1).entries()){
          const local=(age-hit.at)/1000;if(local<-.24||local>.32)continue;
          const alpha=Math.sin(clamp((local+.24)/.56)*Math.PI),dest:Vec3=[hit.point[0],y+.1,hit.point[2]];
          const origin:Vec3=[x,y+height,z];
          this.stroke(origin,[x+(dest[0]-x)*.5,y+height*.85,z+(dest[2]-z)*.3],
            [dest[0]+Math.sin(i)*1.2,y+height*.4,dest[2]],dest,.33,0xffaf2d,alpha,i+32);
          this.burst(dest,local,2,850,6,i+90,true);
        }
        this.emitTrail(u=>[x+Math.cos(u*TAU*5+t)*r,y+height+Math.sin(u*TAU*3+t*.5)*r,z+Math.sin(u*TAU*5+t)*r],2100,t,9,fade*.4);
      }
      if(age>=2700){
        const local=(age-2700)/1000,expand=1-Math.exp(-local*6),radius=9*expand,crest=1+3*Math.sin(clamp(local)*Math.PI);
        for(let k=0;k<14;k++){
          const a=k*2.39996,cs=Math.cos(a),sn=Math.sin(a),h=crest*(.75+random(k,61)*.6),size=1.35+random(k,62)*.65;
          this.flow.put("plume","fire",x+cs*radius*.76,y+.04,z+sn*radius*.76,size*1.4,h*1.3,size*1.4,end*.92,k+30);
          if(k%2===0)this.stroke([x+cs*radius*.5,y+.06,z+sn*radius*.5],
            [x+cs*radius*.7,y+h*.65,z+sn*radius*.7],[x+cs*radius*.85,y+h*.8,z+sn*radius*.85],
            [x+cs*radius,y+.3,z+sn*radius],.33,0xff8a22,end*.6,k);
        }
        this.flow.put("band","fire",x,y+.08,z,radius,1.2+crest*.35,radius,end,45);
        this.flow.put("band","fire",x,y+.11,z,radius*.82,.9,radius*.82,end*.75,75,t*.2);
        this.burst([x,y+.9,z],local,9,10500,14,90);
      }
    }
  }
  private stroke(a:Vec3,b:Vec3,c:Vec3,d:Vec3,width:number,color:number,alpha:number,seed:number):void{
    this.bodies.curve(a,b,c,d,width*1.35,color,alpha,seed,.7,1);
    if(seed%4===0&&width>.25)for(let i=1;i<=8;i++){
      const p=bezier(a,b,c,d,(i-1)/8),q=bezier(a,b,c,d,i/8);
      this.lines.segment(p[0],p[1],p[2],q[0],q[1],q[2],.014,0xffbd55,alpha*.3,seed,(i-1)/8,i/8);
    }
  }
  private emitTrail(path:(u:number)=>Vec3,count:number,t:number,seed:number,alpha:number):void{
    if(alpha<.01)return;
    for(let i=0;i<count;i++){
      const u=(random(i,seed)+t*.43)%1,p=path(u),lag=random(i,seed+1);
      this.sparks.put(p[0]+Math.sin(i+t*7)*lag*.22,p[1]+lag*.5,p[2]+Math.cos(i+t*6)*lag*.22,
        .013+random(i,seed+2)*.032,i%9?0xff8c22:0xffd48c,alpha*(1-lag*.6),i,1.3,1.6);
    }
  }
  private burst(origin:Vec3,t:number,radius:number,count:number,speed:number,seed:number,low=false):void{
    if(t<0||t>1.02)return;
    const fade=1-ease((t-.35)/.67),variant=elementalPulseArt(this.state.variant as ElementalCast["spellId"],seed);
    const spread=radius*(.15+1.05*(1-Math.exp(-t*7)));
    if(count>=1000){
      this.flow.put("band","fire",origin[0],this.ground(origin[0],origin[2])+.06,origin[2],spread*variant.width,(low?.45:.8)*variant.lift,spread*variant.depth,fade*.85,seed,variant.yaw,0,0,{arc:variant.arc,lean:variant.bend});
      if(t<.4)this.flow.put("shell","fire",origin[0],origin[1],origin[2],spread*.65*variant.width,spread*.55*variant.lift,spread*.65*variant.depth,(1-t/.4)*.8,seed+5,variant.yaw,0,0,{arc:variant.arc,lean:variant.bend});
    }else{
      // Small contacts inherit the lash/wing direction but have individually shaped flame folds.
      for(let k=0;k<variant.lobes;k++){
        const angle=variant.yaw+k/variant.lobes*Math.PI*2,offset=radius*(.1+t*.65);
        this.flow.put("plume","fire",origin[0]+Math.cos(angle)*offset,origin[1],origin[2]+Math.sin(angle)*offset,
          (.24+radius*.12)*variant.width,(.7+radius*.25)*variant.lift*fade,(.24+radius*.12)*variant.depth,fade*.68,seed+k,
          angle,variant.bend*.15,0,{arc:variant.arc,lean:variant.bend});
      }
    }
    for(let i=0;i<count;i++){
      const a=variant.yaw+random(i,seed)*TAU*variant.arc,birth=random(i,seed+1)*(.08+variant.depth*.06),age=t-birth;if(age<0)continue;
      const d=(.04+(1-Math.exp(-age*1.7))/1.7*speed/radius)*radius*(.3+random(i,seed+2)*.7);
      const x=origin[0]+Math.cos(a)*d*variant.width,z=origin[2]+Math.sin(a)*d*variant.depth;
      const y=Math.max(this.ground(x,z)+.04,origin[1]+age*(low?.5:2+random(i,seed+3)*speed*.65)*variant.lift-age*age*5);
      this.sparks.put(x,y,z,.015+random(i,seed+4)*.035,i%7?0xff821d:0xffce76,fade,i,1.7,1.7);
      if(i%19===0)this.smoke.put(x,y+.18,z,(.06+random(i,seed+5)*.16)*(1+age*1.5),0x4d4237,fade*.35,i,1.5);
    }
    this.illuminate(origin[0],origin[1]+1,origin[2],0xff8b27,(65+radius*12)*fade,7+radius);
  }
  dispose():void{this.bodies.dispose();this.atmosphere.dispose();this.flow.dispose();}
}
