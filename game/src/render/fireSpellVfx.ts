import { FINALE, elementalChoreographyDuration } from "../content/elementalFinales.js";
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
import { FurnaceLash } from "./furnaceLash.js";

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
  private readonly darkSmoke:ElementalAtmosphere;
  private readonly flow:ElementalFlowSurfaces;
  private readonly lash:FurnaceLash;
  readonly state={variant:"",mainShapes:0,composition:""};
  constructor(parent:THREE.Object3D,private readonly ground:(x:number,z:number)=>number,
    private readonly sparks:ElementalParticleCloud,private readonly smoke:ElementalParticleCloud,
    private readonly lines:ElementalFilaments,private readonly volumes:ElementalVolumes,
    private readonly illuminate:(x:number,y:number,z:number,color:number,intensity:number,distance:number)=>void){
    this.bodies=new ElementalEnergyBodies(parent,"fire",true);this.bodies.mesh.name="elemental-fire-authored-shapes";
    this.atmosphere=new ElementalAtmosphere(parent,'fire');
    this.darkSmoke=new ElementalAtmosphere(parent,'smoke');
    this.flow=new ElementalFlowSurfaces(parent);
    this.lash=new FurnaceLash(parent);
  }
  get instances():number{return this.bodies.instances+this.atmosphere.instances+this.darkSmoke.instances+this.flow.instances+this.lash.instances;}
  get dropped():number{return this.bodies.dropped+this.atmosphere.dropped+this.darkSmoke.dropped+this.flow.dropped;}
  begin(seconds:number):void{this.bodies.begin(seconds);this.atmosphere.begin(seconds);this.darkSmoke.begin(seconds);this.flow.begin(seconds);this.lash.hide();this.state.mainShapes=0;}
  end():void{this.bodies.end();this.atmosphere.end();this.darkSmoke.end();this.flow.end();this.state.mainShapes=this.instances;}
  update(cast:ElementalCast,now:number):void{
    const age=now-cast.started,t=age/1000,last=cast.pulses.at(-1)!.at;
    if(age<0||age>=elementalChoreographyDuration(cast.spellId,last))return;
    this.state.variant=cast.spellId;
    const [x,,z]=cast.aim,y=this.ground(x,z),end=1-ease((age-last-350)/650);
    const yaw=Math.atan2(x-cast.origin[0],z-cast.origin[2]),dx=Math.sin(yaw),dz=Math.cos(yaw);
    const release:Vec3=[cast.origin[0]+dx*.5+dz*.3,cast.origin[1]+1.18,cast.origin[2]+dz*.5-dx*.3];
    const charge=ease(age/180)*(1-ease((age-300)/220));

    if(cast.spellId==="ember-dart"){
      this.state.composition="single-comet-and-crawling-burn";
      const progress=clamp((age-90)/460),head:Vec3=[release[0]+(x-release[0])*progress,release[1]+(y+(cast.impactHeight??1.5)-release[1])*progress,release[2]+(z-release[2])*progress];
      if(age<650){
        const trailLength=Math.min(1.8,progress*12+.2),tail:Vec3=[head[0]-dx*trailLength,head[1]+.15,head[2]-dz*trailLength];
        this.stroke(tail,mix(tail,head,.3),[head[0]+.14,head[1]+.3,head[2]],head,.34,0xffad30,1,1);

        this.emitTrail(u=>mix(tail,head,u),900,t,1,.2);
      }
      if(age>=550){
        const a=(age-550)/1000;
        // A contact tears upward into two unequal flame folds, then becomes drifting cinders.
        const lick=1-ease((a-.25)/.8);
        this.flow.put("plume","fire",x-.12,y+.04,z,.95,1.9*lick,.65,lick*.95,17,yaw,.22,0,{arc:.62,lean:1.2});
        this.flow.put("plume","fire",x+.22,y+.07,z-.12,.5,1.15*lick,.42,lick*.85,29,yaw+1.7,-.18,0,{arc:.48,lean:-.9});
        this.burst([x,y+(cast.impactHeight??1.5),z],a,1.1,1100,5,1);
      }
    }else if(cast.spellId==="furnace-whip"){
      this.state.composition="continuous-ribbon-unfurl-crack-and-cinders";
      const fade=ease((age-190)/150)*(1-ease((age-1100)/380)),height=y+(cast.impactHeight??1.5);
      const first=cast.pulses[0]!.point;
      const tipAt=(ms:number):Vec3=>{
        if(ms<600){
          const u=ease((ms-190)/410),p=mix(release,[first[0],height,first[2]],u);
          return [p[0]+dz*Math.sin(u*Math.PI)*1.3,p[1]+Math.sin(u*Math.PI)*.5,p[2]-dx*Math.sin(u*Math.PI)*1.3];
        }
        const u=clamp((ms-600)/500),index=Math.min(4,Math.floor(u*5)),blend=u*5-index;
        const p=mix(cast.pulses[index]!.point,cast.pulses[index+1]!.point,blend);
        return [p[0],height+Math.sin(u*Math.PI*2)*.14,p[2]];
      };
      const path=(u:number):Vec3=>{
        const p=tipAt(Math.max(190,Math.min(age,1100)-(1-u)*490));
        const recoil=clamp((age-1100)/380),flutter=Math.sin(u*6.3-t*3.8)*Math.sin(u*Math.PI)*.22;
        return [p[0]+dz*flutter+dx*recoil*.9,p[1]+Math.sin(u*Math.PI)*(.32+recoil*.8),p[2]-dx*flutter+dz*recoil*.9];
      };
      this.lash.update(path,t,fade,.85);
      this.emitTrail(path,2500,t,57,fade*.92);
      // Each contact strips fine cinders from the moving leading edge, without a second flame shape.
      for(const [i,pulse] of cast.pulses.entries()){
        const local=(age-pulse.at)/1000;if(local<0||local>.65)continue;
        const f=1-ease(local/.65),direction=-1.2+i*.48;
        for(let j=0;j<320;j++){
          const speed=2+random(j,i+400)*6,scatter=(random(j,i+401)-.5)*1.2,angle=yaw+direction+scatter;
          const distance=local*speed,py=Math.max(y+.04,height+local*(random(j,i+402)*4-1)-local*local*4);
          this.sparks.put(pulse.point[0]+Math.cos(angle)*distance,py,pulse.point[2]-Math.sin(angle)*distance,
            .013+random(j,i+403)*.025,j%9?0xe73c08:0xffc36a,f,j,1.6,1.8);
        }
      }
      const head=tipAt(Math.min(age,1100));this.illuminate(...head,0xff8020,24*fade,5);
    }else if(cast.spellId==="cinder-mine"){
      this.state.composition="inward-embers-and-separated-flame-bursts";
      if(age<1800){
        const charge=ease(age/1800);
        for(let k=0;k<3;k++){
          const angle=[.31,2.15,4.53][k]!,r=(3.0+random(k,420)*2)*(1-charge*.85);
          const a:Vec3=[x+Math.cos(angle)*r,y+.05,z+Math.sin(angle)*r];
          this.stroke(a,[x+Math.cos(angle+.4)*r*.7,y+.1,z+Math.sin(angle+.4)*r*.7],
            [x+.3*Math.cos(angle),y+.18+charge*.4,z+.3*Math.sin(angle)],[x,y+.2,z],.12+charge*.12,0xff4b0c,.75,k);
        }
        this.emitTrail(u=>[x+(u-.5)*5*(1-charge),y+.08+Math.sin(u*7)*.03,z+Math.sin(u*5+1.3)*(1-charge)*2],1100,t,4,.4);
        this.illuminate(x,y+.4,z,0xff6615,23*charge,6);
      }else{
        const a=(age-1800)/1000,r=5.5*(1-Math.exp(-a*7)),h=1.4+Math.sin(clamp(a)*Math.PI)*2.8;
        // A low, fast combustion front rips across the footprint, with a trailing smoke roll.
        for(let k=0;k<4;k++){
          const angle=[.2,1.8,3.6,5.1][k]!,travel=r*(.4+random(k,15)*.35),px=x+Math.cos(angle)*travel,pz=z+Math.sin(angle)*travel;
          const f=1-ease((a-.16)/.7),roll=1-Math.exp(-a*22);
          this.flow.put("plume","fire",px,y+.035,pz,2.4+random(k,12),(.9+random(k,16)*2.4)*roll,1.1,
            f*.96,k+61,angle,.40,0,{arc:.48+random(k,17)*.25,lean:2.6});
          if(k%2===0)this.atmosphere.put(px,y+.65,pz,1.3,.85,1.1,f*.6,k+85,y);
        }
        this.burst([x,y+.5,z],a,5.5,5500,9,8);
        if(age>=2150)this.burst([x,y+.15,z],(age-2150)/1000,6,3000,12,9,true);
      }
    }else if(cast.spellId==="phoenix-pass"){
      this.state.composition="kiln-rupture-staggered-vents";
      for(const [i,p] of cast.pulses.entries()){
        const a=(age-p.at)/1000,[px,,pz]=p.point,py=this.ground(px,pz);
        const ready=ease((a+.15)/.11)*(1-ease(a/.06));
        if(ready>.01){
          this.flow.put("band","fire",px,py+.05,pz,1.1,.12,.8,ready*.8,i,yaw+i,0,0,{arc:.45});
          this.emitTrail(v=>[px+Math.sin(v*7+i)*.5,py+.04+v*.3,pz+(v-.5)*1.7],280,t,i+120,ready*.65);
        }
        if(a<0||a>1.04)continue;
        const f=1-ease((a-.17)/.87),rise=1-Math.exp(-a*28),h=p.height*rise*(1-a*.55);
        // Unequal vent tongues, lifted ash and a bright torn base, no bird silhouette.
        for(let k=0;k<(i%3===0?1:i%3===1?2:3);k++){
          const angle=i*2.1+k*1.63,offset=.15+random(k,i+20)*.65,px0=px+Math.cos(angle)*offset,pz0=pz+Math.sin(angle)*offset;
          this.flow.put("plume","fire",px0,py+.04,pz0,(i%3===0?2.2:.85+k*.32),h*(i%3===0?.55:1-k*.22),.8+random(k,i+21)*.65,f*.94,i*3+k,angle,.12+random(k,i+22)*.42,0,{lean:Math.sin(t*4+i+k)*1.1,arc:.4+random(k,i+23)*.5});
        }
        this.darkSmoke.put(px+a*(.8+Math.sin(i)),py+h*.54+.35,pz-a*.4,1.0+a*.6,h*.34+.3,1.2,f*.75,i,py);
        if(i%3===0)this.atmosphere.put(px+.3,py+h*.3,pz,1.5,h*.25,1.1,f*.8,i+415,py);
        for(let k=0;k<(i%2?1:2);k++){
          const side=k?1:-1,drift=Math.sin(t*7+i+k)*.35;
          this.stroke([px+side*.3,py+.06,pz],[px+side*.5,py+h*.32,pz+.15],
            [px-side*.25+drift,py+h*.77,pz-.35],[px+side*.3+drift,py+h*.96,pz-.15],.46-k*.12,0xffb45e,f*.95,i*2+k+131);
        }
        for(let j=0;j<1800;j++){
          const v=random(j,i+11),angle=random(j,i+12)*TAU,rad=Math.sqrt(v)*(.25+a*1.4);
          const py0=Math.max(py+.04,py+a*(2+random(j,i+13)*8)-a*a*5);
          this.sparks.put(px+Math.cos(angle)*rad,py0,pz+Math.sin(angle)*rad,.014+random(j,i+14)*.029,
            j%7===0?0xffb64d:j%3?0xc93a08:0xc9290b,f*(1-v*.5),j,1.4,2.2);
          if(j%22===0)this.smoke.put(px+Math.cos(angle)*rad,py0+.3,pz+Math.sin(angle)*rad,.13+a*.23,0x343236,f*.45,j);
        }
        this.illuminate(px,py+1,pz,0xff8020,17*f,5);
      }
    }else{
      this.sunfall(cast,age);
    }
  }
  private sunfall(cast:ElementalCast,age:number):void {
    this.state.composition="single-advected-combustion-blast";
    const [x,,z]=cast.aim,y=this.ground(x,z),t=age/1000,hit=FINALE.starfall.contact;
    const yaw=Math.atan2(x-cast.origin[0],z-cast.origin[2]),dx=Math.sin(yaw),dz=Math.cos(yaw);
    const a=(age-hit)/1000,u=clamp((age-450)/(hit-450));
    const dest:Vec3=[x,y+.6,z],start:Vec3=[x-dx*5+dz*1.5,y+11.5,z-dz*5-dx*1.5];
    const path=(v:number)=>mix(start,dest,v);
    if(age<hit){
      const f=ease((age-250)/750),head=path(u*u),r=1.3+u*2.0;
      this.atmosphere.put(head[0],head[1],head[2],r*1.08,r*.91,r,f*.95,90,y);
      this.atmosphere.put(head[0]-r*.45,head[1]+r*.32,head[2]+r*.25,r*.7,r*.8,r*.65,f*.8,105,y);
      for(let k=0;k<4;k++){
        const tail=path(Math.max(0,u*u-.12-k*.07));
        this.darkSmoke.put(tail[0]+Math.sin(k*2.4)*r*.55,tail[1]+.5,tail[2]+Math.cos(k*2.4)*r*.55,
          r*.7,r*.78,r*.7,f*.52,230+k,y);
      }
      // One torn wake follows the falling core. The former repeated corona loops are gone.
      const tail=path(Math.max(0,u*u-.36));
      this.stroke(tail,[tail[0]+dz*.7,tail[1]+.8,tail[2]-dx*.7],
        [head[0]-dz*.9,head[1]+r*.8,head[2]+dx*.9],head,r*.48,0xffab42,f*.75,91);
      this.emitTrail(v=>path(Math.max(0,u*u-v*.35)),7200,t,94,f*.90);
      for(let i=0;i<2200;i++){
        const angle=random(i,140)*TAU,radius=(2+random(i,141)*7)*(1-u*.42),lift=random(i,142)*u*3;
        this.sparks.put(x+Math.cos(angle)*radius,y+.08+lift,z+Math.sin(angle)*radius,.015+random(i,143)*.025,
          i%7?0xff7a1c:0xffd88a,f*u*.65,i,1.4,1.7);
      }
      this.illuminate(...head,0xffa43c,70*f,14);
      this.illuminate(x,y+.6,z,0xff6e19,16*u,11);
    }else{
      const fade=1-ease((a-1.95)/1.25);
      // One contact launches this whole blast. Its fire and airborne embers persist without extra damage pulses.
      const flash=1-ease(a/.26);
      if(flash>.01)this.volumes.put("sphere",x,y+1.2,z,1.1+a*12,1.0+a*8,1.1+a*12,0xffbd5f,flash*1.8,201);
      // A single spatial temperature/density field rolls from this contact into
      // flames and cooling soot. There are no repeated sheets or smoke pockets.
      this.atmosphere.put(x,y+4.6,z,11.8,5.6,10.4,fade*.96,310,y,a);
      for(let i=0;i<18000;i++){
        const birth=random(i,170)*.28,flight=a-birth;if(flight<0)continue;
        const angle=random(i,171)*TAU,speed=2.5+random(i,172)*6.5,vy=3+random(i,173)*10;
        const d=.4+speed*(1-Math.exp(-flight*1.1))/1.1;
        const px=x+Math.cos(angle)*d*(.65+random(i,176)*.35)+flight*.7,pz=z+Math.sin(angle)*d-flight*.3;
        const gy=this.ground(px,pz),py=Math.max(gy+.035,y+.4+vy*flight-flight*flight*5.4);
        const cooling=1-ease((a-1.6)/1.6);
        this.sparks.put(px,py,pz,.014+random(i,174)*.030,i%11===0?0xffc55c:i%3?0xca3205:0xbd2410,fade*cooling,i,1.5,1.7);
        if(i%28===0)this.smoke.put(px,py+.35+a*.45,pz,.15+random(i,175)*.30+a*.13,0x302c2b,fade*.42,i,1.7,1.3);
      }
      this.illuminate(x,y+2,z,0xff8b29,52*(1-ease(a/2.2)),13);
    }
  }
  private stroke(a:Vec3,b:Vec3,c:Vec3,d:Vec3,width:number,color:number,alpha:number,seed:number):void{
    this.bodies.curve(a,b,c,d,width,color,alpha,seed,.45,1);
    if(seed%4===0&&width>.25)for(let i=1;i<=8;i++){
      const p=bezier(a,b,c,d,(i-1)/8),q=bezier(a,b,c,d,i/8);
      this.lines.segment(p[0],p[1],p[2],q[0],q[1],q[2],.014,0xffbd55,alpha*.3,seed,(i-1)/8,i/8);
    }
  }
  private emitTrail(path:(u:number)=>Vec3,count:number,t:number,seed:number,alpha:number):void{
    if(alpha<.01)return;
    const billows=count>4000?5:count>1000?3:1;
    for(let k=0;k<billows;k++){
      const v=.10+k/(billows+1)*.7,p=path(v),size=count>4000?.65:.26;
      this.darkSmoke.put(p[0]+Math.sin(k+seed)*size*.5,p[1]+size*.7,p[2],
        size,size*1.45,size*.85,Math.min(1,alpha*1.7),seed+k);
    }
    for(let i=0;i<count;i++){
      const u=(random(i,seed)+t*.43)%1,p=path(u),lag=random(i,seed+1);
      this.sparks.put(p[0]+Math.sin(i+t*7)*lag*.22,p[1]+lag*.5,p[2]+Math.cos(i+t*6)*lag*.22,
        .013+random(i,seed+2)*.032,i%11===0?0xffbb49:i%3?0xcf3c08:0xd82309,alpha*(1-lag*.6),i,1.3,1.6);
    }
  }
  private burst(origin:Vec3,t:number,radius:number,count:number,speed:number,seed:number,low=false):void{
    if(t<0||t>1.02)return;
    const fade=1-ease((t-.35)/.67),variant=elementalPulseArt(this.state.variant as ElementalCast["spellId"],seed);
    const spread=radius*(.15+1.05*(1-Math.exp(-t*7)));
    if(count>=1000){
      this.flow.put("band","fire",origin[0],this.ground(origin[0],origin[2])+.06,origin[2],spread*variant.width,(low?.45:.8)*variant.lift,spread*variant.depth,fade*.48,seed,variant.yaw,0,0,{arc:Math.min(.62,variant.arc),lean:variant.bend});

    }else{
      // Small contacts inherit the lash/wing direction but have individually shaped flame folds.
      for(let k=0;k<variant.lobes;k++){
        const angle=variant.yaw+k/variant.lobes*Math.PI*2,offset=radius*(.1+t*.65);
        this.flow.put("plume","fire",origin[0]+Math.cos(angle)*offset,origin[1],origin[2]+Math.sin(angle)*offset,
          (.24+radius*.12)*variant.width,(.7+radius*.25)*variant.lift*fade,(.24+radius*.12)*variant.depth,fade*.68,seed+k,
          angle,variant.bend*.15,0,{arc:variant.arc,lean:variant.bend});
      }
    }
    for(let k=0;k<(radius>3?5:2);k++){
      const angle=k*2.399+seed,d=spread*(.3+random(k,seed+71)*.45),sx=origin[0]+Math.cos(angle)*d,sz=origin[2]+Math.sin(angle)*d;
      const size=(.32+radius*.12)*(1+t*.9);
      this.darkSmoke.put(sx,origin[1]+.2+t*1.2,sz,size,size*1.3,size,fade*.88,k+seed,this.ground(sx,sz));
    }
    // Brief hooked flames unfurl at different heights, then shed their hot tips into sparks.
    for(let k=0;k<(low?2:3);k++){
      const angle=variant.yaw+k*2.399,cs=Math.cos(angle),sn=Math.sin(angle),
        rise=1-Math.exp(-t*9),h=(.85+random(k,seed+17)*1.2)*variant.lift*rise,
        r=spread*(.35+random(k,seed+18)*.3),flutter=Math.sin(t*11+seed+k)*.35;
      const base:Vec3=[origin[0]+cs*r,origin[1]+.03,origin[2]+sn*r];
      this.stroke(base,[base[0]-sn*.3,base[1]+h*.3,base[2]+cs*.3],
        [base[0]+cs*(.4+flutter)-sn*.4,base[1]+h,base[2]+sn*(.4+flutter)+cs*.4],
        [base[0]+cs*.7+sn*.3,base[1]+h*.88,base[2]+sn*.7-cs*.3],
        .12+radius*.018,0xffc55a,fade*(1-t*.45)*.82,seed+k+100);
    }
    for(let i=0;i<count;i++){
      const a=variant.yaw+random(i,seed)*TAU*variant.arc,birth=random(i,seed+1)*(.08+variant.depth*.06),age=t-birth;if(age<0)continue;
      const d=(.04+(1-Math.exp(-age*1.7))/1.7*speed/radius)*radius*(.3+random(i,seed+2)*.7);
      const x=origin[0]+Math.cos(a)*d*variant.width,z=origin[2]+Math.sin(a)*d*variant.depth;
      const y=Math.max(this.ground(x,z)+.04,origin[1]+age*(low?.5:2+random(i,seed+3)*speed*.65)*variant.lift-age*age*5);
      this.sparks.put(x,y,z,.015+random(i,seed+4)*.035,i%9===0?0xffb84b:i%3?0xbf3006:0xd42609,fade,i,1.7,1.7);
      if(i%19===0)this.smoke.put(x,y+.18,z,(.06+random(i,seed+5)*.16)*(1+age*1.5),0x4d4237,fade*.35,i,1.5);
    }
    this.illuminate(origin[0],origin[1]+1,origin[2],0xff8b27,(16+radius*3)*fade,5+radius);
  }
  dispose():void{this.bodies.dispose();this.atmosphere.dispose();this.darkSmoke.dispose();this.flow.dispose();this.lash.dispose();}
}
