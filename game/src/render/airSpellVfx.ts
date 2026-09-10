import { FINALE } from "../content/elementalFinales.js";
import { tornadoDebris } from "./tornadoDebris.js";
import * as THREE from "three";
import type { ElementalCast } from "../systems/elementalAttacks.js";
import type { ElementalParticleCloud } from "./elementalParticleCloud.js";
import type { ElementalFilaments } from "./elementalFilaments.js";
import { ElementalAtmosphere } from "./elementalAtmosphere.js";
import { ElementalFlowSurfaces } from "./elementalFlowSurfaces.js";
import { AirCurrentSheets } from "./airCurrentSheets.js";
import { elementalPulseArt } from "./elementalPulseArt.js";
import { elementalRefractionFragment, refractionUniforms, registerElementalRefraction } from "./elementalRefraction.js";

const TAU = Math.PI * 2;
const clamp = (x: number) => Math.max(0,Math.min(1,x));
const smooth = (x: number) => { const t=clamp(x); return t*t*(3-2*t); };
const random = (i: number, seed = 0) => { const n=Math.sin(i*127.1+seed*311.7)*43758.5453; return n-Math.floor(n); };
type PressureShape = "shell" | "funnel" | "ripple";

/** Moving pressure, with sparse directional tracers. Large storms lift dark dust and fine ground debris. */
export class AirSpellVfx {
  private readonly batches = new Map<PressureShape, THREE.InstancedMesh<THREE.BufferGeometry,THREE.ShaderMaterial>>();
  private readonly unregister: (()=>void)[] = [];
  private readonly atmosphere:ElementalAtmosphere;
  private readonly dustHaze:ElementalAtmosphere;
  private readonly flow:ElementalFlowSurfaces;
  private readonly currents:AirCurrentSheets;
  private readonly clock = { value: 0 };
  private readonly object = new THREE.Object3D();
  dropped = 0;
  readonly state={baseDiameter:0,height:0,variant:"",composition:"",phase:"",airborneDebris:0,settledDebris:0};
  constructor(parent: THREE.Object3D, private readonly ground: (x:number,z:number)=>number,
    private readonly particles: ElementalParticleCloud, _lines: ElementalFilaments,
    private readonly debris:ElementalParticleCloud,private readonly dust:ElementalParticleCloud) {
    this.atmosphere=new ElementalAtmosphere(parent,'wind');
    this.dustHaze=new ElementalAtmosphere(parent,'dust');
    this.flow=new ElementalFlowSurfaces(parent);
    this.currents=new AirCurrentSheets(parent);
    const funnel = new THREE.CylinderGeometry(1,.12,1,32,20,true);
    funnel.translate(0,.5,0);
    const ripple = new THREE.TorusGeometry(1,.16,8,48);
    ripple.rotateX(Math.PI/2);
    for (const [kind,geometry] of [["shell",new THREE.SphereGeometry(1,24,16)],["funnel",funnel],["ripple",ripple]] as const) {
      geometry.setAttribute("pressureLife",new THREE.InstancedBufferAttribute(new Float32Array(96*3),3).setUsage(THREE.DynamicDrawUsage));
      const material=new THREE.ShaderMaterial({
        uniforms: refractionUniforms(this.clock,false,kind==="funnel"?19:14,kind==="funnel"?1:0),
        defines: { PRESSURE_FUNNEL: kind==="funnel"?1:0 },
        transparent:true,depthWrite:false,side:THREE.FrontSide,toneMapped:false,
        vertexShader:`attribute vec3 pressureLife;uniform float time;
          varying vec3 vRefNormal,vRefView,vRefLocal;varying float vRefAlpha,vRefSeed;
          void main(){vec3 p=position;vec3 n=normal;
            #if PRESSURE_FUNNEL == 1
              p.xz*=(pressureLife.z+(1.-pressureLife.z)*p.y)/(.12+.88*p.y);
              float phase=p.y*15.0-time*5.0+pressureLife.y;
              p.xz*=1.0+.09*sin(phase)+.04*sin(phase*2.1);
              p.x+=sin(p.y*5.0+time*1.7)*.09*p.y;
              p.z+=cos(p.y*7.0-time*1.3)*.06*p.y;
              n.xz+=vec2(sin(phase),cos(phase))*.24;
            #else
              p*=1.0+.035*sin(p.y*11.0-time*7.0+pressureLife.y)*sin(p.x*9.0+time*4.0);
            #endif
            vec4 world=instanceMatrix*vec4(p,1.0);vec4 view=modelViewMatrix*world;
            mat3 m=mat3(instanceMatrix);n/=vec3(dot(m[0],m[0]),dot(m[1],m[1]),dot(m[2],m[2]));
            vRefNormal=normalize(normalMatrix*m*n);vRefView=-view.xyz;vRefLocal=p;
            vRefAlpha=pressureLife.x;vRefSeed=pressureLife.y;gl_Position=projectionMatrix*view;}`,
        fragmentShader:elementalRefractionFragment,
      });
      const mesh=new THREE.InstancedMesh(geometry,material,96);
      mesh.count=0;mesh.visible=false;mesh.frustumCulled=false;
      mesh.name=`elemental-air-pressure-${kind}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      parent.add(mesh);this.batches.set(kind,mesh);
      this.unregister.push(registerElementalRefraction(mesh));
    }
  }
  get instances(): number { return this.currents.instances+this.flow.instances+this.atmosphere.instances+this.dustHaze.instances+[...this.batches.values()].reduce((n,m)=>n+m.count,0); }
  begin(seconds:number):void {
    this.clock.value=seconds;this.dropped=0;this.atmosphere.begin(seconds);this.dustHaze.begin(seconds);this.flow.begin(seconds);this.currents.begin(seconds);
    this.state.baseDiameter=0;this.state.height=0;this.state.phase="";this.state.airborneDebris=0;this.state.settledDebris=0;this.state.variant="";this.state.composition="";
    for(const mesh of this.batches.values()){mesh.count=0;mesh.visible=false;}
  }
  private put(kind:PressureShape,x:number,y:number,z:number,sx:number,sy:number,sz:number,alpha:number,seed:number,yaw=0,foot=.12,pitch=0):void {
    if(alpha<.008||Math.min(sx,sy,sz)<.005)return;
    const mesh=this.batches.get(kind)!;
    if(mesh.count===96){this.dropped++;return;}
    this.object.position.set(x,y,z);this.object.rotation.set(pitch,yaw,0);this.object.scale.set(sx,sy,sz);this.object.updateMatrix();
    mesh.setMatrixAt(mesh.count,this.object.matrix);
    (mesh.geometry.getAttribute("pressureLife") as THREE.InstancedBufferAttribute).setXYZ(mesh.count++,alpha,seed,foot);
  }
  update(cast:ElementalCast,now:number):void {
    const age=now-cast.started,t=age/1000;
    this.state.variant=cast.spellId;

    switch(cast.spellId){
      case "air-needle": this.state.composition="compressed-dart";this.needle(cast,age,t);break;
      case "razor-crescent": this.state.composition="crossing-pressure-blades";this.crescents(cast,age,t);break;
      case "vacuum-coil": this.state.composition="inward-spiral-eye";this.vacuum(cast,age,t);break;
      case "thunder-lance": this.state.composition="travelling-corkscrew-bore";this.cannon(cast,age,t);break;
      case "skybreaker": this.state.composition="wedge-and-satellite-vortices";this.tornado(cast,age,t);break;
    }
  }
  private charge(cast:ElementalCast,age:number,t:number):void {
    const length=Math.min(620,cast.pulses[0]!.at*.62),u=age/length;
    if(u<0||u>1)return;
    const dx=cast.aim[0]-cast.origin[0],dz=cast.aim[2]-cast.origin[2],len=Math.hypot(dx,dz)||1,
      yaw=Math.atan2(dx,dz),x=cast.origin[0]+dx/len*.55+dz/len*.28,
      z=cast.origin[2]+dz/len*.55-dx/len*.28,y=cast.origin[1]+1.26,fade=Math.sin(u*Math.PI);
    const big=cast.spellId==="skybreaker"||cast.spellId==="thunder-lance",r=(big?1.2:.65)*(1-u*.65);
    // Wind gathers from two unequal directions and folds into the casting hand.
    for(let k=0;k<2;k++)this.currents.put("spiral",x,y,z,r,r*.45,r,fade*(.7-k*.18),3+k,yaw+k*2.3,.5+k*.4,0,{turns:.8+k*.28,width:.3,drift:3});
    if(big)this.put("shell",x,y,z,r*.75,r*.7,r*.75,fade*.55,3);
    for(let i=0;i<280;i++){
      const u0=(random(i)+t*1.4)%1,a=random(i,1)*TAU+u0*5,rad=(1-u0)*r*1.6;
      this.particles.put(x+Math.cos(a)*rad,y+(random(i,2)-.5)*rad,z+Math.sin(a)*rad,.024+random(i,3)*.023,
        i%9?0x9bdee9:0xb8a8f2,fade*u0*.75,i,1.8,2);
    }
  }
  private needle(cast:ElementalCast,age:number,t:number):void {
    const p=cast.pulses[0]!,u=(age-150)/(p.at-150),local=(age-p.at)/1000;
    const dx=p.point[0]-cast.origin[0],dz=p.point[2]-cast.origin[2],len=Math.hypot(dx,dz)||1,yaw=Math.atan2(dx,dz);
    if(u>=0&&u<1.1){
      const f=1-smooth((u-1)/.1),v=clamp(u),bend=Math.sin(v*Math.PI)*.32,
        x=cast.origin[0]+dx*v+dz/len*bend,z=cast.origin[2]+dz*v-dx/len*bend,y=this.ground(x,z)+(cast.impactHeight??1.5);
      this.currents.put("jet",x,y,z,.53,.53,1.55,f,2,yaw,0,0,{turns:.52,width:.88,drift:4});
      this.currents.put("jet",x-dx/len*.35,y,z-dz/len*.35,.76,.60,1.2,f*.5,5,yaw,0,Math.PI,{turns:.8,width:.35,drift:4});
      this.flow.put("plume","wind",x,y,z,.25,1.2,.25,f*.42,2,yaw,Math.PI/2);
      for(let i=0;i<550;i++){
        const tail=random(i)*.23,v0=v-tail;if(v0<0)continue;
        const a=random(i,1)*TAU+t*9,rad=.05+tail*1.8,curve=Math.sin(v0*Math.PI)*.32;
        this.particles.put(cast.origin[0]+dx*v0+dz/len*(curve+Math.cos(a)*rad),y+Math.sin(a)*rad,
          cast.origin[2]+dz*v0-dx/len*(curve+Math.cos(a)*rad),.023+random(i,2)*.022,
          i%8?0xa3e0ef:0xc2b4ff,(1-tail/.23)*f*.65,i,1.7,2.2);
      }
    }
    if(local>=0&&local<.82){
      const [x,,z]=p.point,y=this.ground(x,z)+(cast.impactHeight??1.5),fade=1-smooth(local/.82),r=.28+local*2.2;
      this.put("shell",x,y,z,r*.6,r*.7,r*.3,fade*.7,2,yaw);
      for(let k=0;k<2;k++)this.currents.put("crescent",x,y,z,r,r*.9,r*.55,fade*.78,4+k,yaw+k*Math.PI,.4+k*.5,0,{width:.35});
      this.spray(x,y,z,1.1,local,fade,4,yaw,450);
    }
  }
  private crescents(cast:ElementalCast,age:number,t:number):void {
    for(const [i,p] of cast.pulses.entries()){
      const art=elementalPulseArt(cast.spellId,i),u=(age-(p.at-550))/550,local=(age-p.at)/1000,
        dx=p.point[0]-cast.origin[0],dz=p.point[2]-cast.origin[2],len=Math.hypot(dx,dz)||1,yaw=Math.atan2(dx,dz),
        roll=[-.38,.60,-.82][i]!,pitch=[.18,-.26,.36][i]!;
      if(u>=0&&u<1.15){
        const v=clamp(u),f=smooth(u*5)*(1-smooth((u-1)/.15)),side=Math.sin(v*Math.PI)*(i-1)*1.25,
          x=cast.origin[0]+dx*v+dz/len*side,z=cast.origin[2]+dz*v-dx/len*side,y=this.ground(x,z)+(cast.impactHeight??1.5)+Math.sin(v*Math.PI)*.6;
        this.currents.put("crescent",x,y,z,2.9*art.width,1.8*art.lift,2.0*art.depth,f*.95,10+i,yaw,pitch,roll,{width:.42+i*.07});
        this.currents.put("crescent",x-dx/len*.65,y-.12,z-dz/len*.65,2.1*art.width,1.6,1.5,f*.48,15+i,yaw+.09,pitch,roll,{width:.24});
        for(let j=0;j<650;j++){
          const a=(random(j,i)-.5)*2.9,trail=random(j,8)*1.5,width=2.6*art.width,
            side0=Math.sin(a)*width,forward=Math.cos(a)*1.6-.8-trail;
          this.particles.put(x+dz/len*side0+dx/len*forward,y+side0*Math.sin(roll)*.55+(random(j,2)-.5)*.2,
            z-dx/len*side0+dz/len*forward,.022+random(j,3)*.024, j%11?0x9edee8:0xb8acff,f*(1-trail/1.5)*.55,j,2,2);
        }
      }
      if(local>=0&&local<.9){
        const [x,,z]=p.point,y=this.ground(x,z)+(cast.impactHeight??1.5),fade=1-smooth(local/.9),r=1+local*2.1;
        this.currents.put("crescent",x,y+local,z,r*art.width,1.6,r*art.depth,fade*.9,20+i,yaw+local*(i%2?-2:2),pitch,roll,{width:.42});
        this.flow.put("band","wind",x,y-.65,z,r,.42,r*.8,fade*.36,i,yaw,0,0,{arc:.42,lean:art.bend});
        this.spray(x,y,z,p.radius,local,fade,i,yaw+Math.PI/2,550);
      }
    }
  }
  private cannon(cast:ElementalCast,age:number,t:number):void {
    const first=cast.pulses[0]!,last=cast.pulses.at(-1)!,dx=cast.aim[0]-cast.origin[0],dz=cast.aim[2]-cast.origin[2],len=Math.hypot(dx,dz)||1,
      fx=dx/len,fz=dz/len,yaw=Math.atan2(fx,fz),near=Math.hypot(first.point[0]-cast.origin[0],first.point[2]-cast.origin[2]),
      far=Math.hypot(last.point[0]-cast.origin[0],last.point[2]-cast.origin[2]),end=(age-last.at)/1000;
    if(age>280&&end<.28){
      const distance=age<first.at?clamp((age-280)/(first.at-280))*near:near+(age-first.at)/(last.at-first.at)*(far-near),
        fade=smooth((age-280)/200)*(1-smooth(end/.28)),x=cast.origin[0]+fx*distance,z=cast.origin[2]+fz*distance,y=this.ground(x,z)+(cast.impactHeight??1.5),
        tail=Math.min(3.6,distance*.7+.5);
      // One connected drill advances through the damage lane. No projectile is respawned at each target.
      this.currents.put("jet",x-fx*tail*.55,y,z-fz*tail*.55,1.65,1.45,tail,fade*.95,21,yaw,0,0,{turns:1.15,width:.75,drift:6});
      this.currents.put("jet",x-fx*tail*.75,y,z-fz*tail*.75,1.2,1.05,tail*.90,fade*.7,23,yaw,0,Math.PI,{turns:1.7,width:.38,drift:6});
      for(let k=0;k<3;k++){
        const d=distance-k*1.05;if(d<.8)continue;
        this.put("ripple",cast.origin[0]+fx*d,y,cast.origin[2]+fz*d,1.0+k*.24,.18,1.0+k*.24,fade*(.58-k*.11),21+k,yaw,.12,Math.PI/2);
      }
      for(let j=0;j<1500;j++){
        const back=random(j)*tail*1.8,a=random(j,1)*TAU+t*11+back*2.5,r=(.08+back*.20)*( .6+random(j,2)*.4);
        this.particles.put(x-fx*back+fz*Math.cos(a)*r,y+Math.sin(a)*r,z-fz*back-fx*Math.cos(a)*r,
          .024+random(j,3)*.025,j%7?0x8fdde7:0xc3afff,fade*(1-back/(tail*1.8))*.75,j,2,2.5);
      }
    }
    for(const [i,p] of cast.pulses.entries()){
      const local=(age-p.at)/1000;if(local<0||local>.85)continue;
      const art=elementalPulseArt(cast.spellId,i),[x,,z]=p.point,y=this.ground(x,z)+(cast.impactHeight??1.5),fade=1-smooth(local/.85),r=.8+local*1.8;
      this.currents.put("spiral",x,y,z,r*art.width,.6,r*art.depth,fade*.85,30+i,yaw,Math.PI/2,i*.8,{turns:.65+i*.16,width:.24,drift:2});
      this.put("ripple",x,y,z,r,.3,r*.8,fade*.55,i,yaw,.12,Math.PI/2);
      this.spray(x,y,z,1.7,local,fade,i,yaw,360);
      this.stormDust(x,this.ground(x,z),z,1.6,1.5,fade*.8,t,220,false);
    }
  }
  private vacuum(cast:ElementalCast,age:number,t:number):void {
    const [x,,z]=cast.aim,y=this.ground(x,z),end=cast.pulses.at(-1)!.at,fade=smooth((age-220)/380)*(1-smooth((age-end)/720));
    if(fade<.009)return;
    const release=clamp((age-end)/550),radius=(4.5+Math.sin(t*6)*.28)*(1-release*.84),height=2.7+Math.sin(t*4)*.3;
    this.state.baseDiameter=radius*2;this.state.height=height;
    this.stormDust(x,y,z,radius,height,fade,t,900,false);
    // A low open eye with inward spirals, deliberately separate from the tall wedge tornado.
    for(let k=0;k<3;k++){
      const phase=k*TAU/3+t*.28;
      this.currents.put("spiral",x,y+.12+k*.12,z,radius*(1-k*.08),height,radius*(1-k*.08),fade*(.9-k*.12),40+k,phase,0,(k-1)*.08,
        {turns:1.30+k*.19,width:.29+k*.045,drift:2.4});
      this.flow.put("band","wind",x,y+.13+k*.4,z,radius*(1-k*.21),.7,radius*(1-k*.21),fade*.3,k,phase,0,0,{arc:.55,lean:k-1});
      this.put("ripple",x,y+.18+k*.45,z,radius*(1-k*.24),.46,radius*(1-k*.24),fade*.52,k,phase);
    }
    // Short airborne curls converge on the eye, with space between each arm.
    for(let k=0;k<2;k++)this.currents.put("helix",x,y+.2,z,1.9,height,1.9,fade*.52,44+k,t*2+k*Math.PI,0,0,{foot:1,turns:.80+k*.3,width:.16,drift:2.4});
    for(let i=0;i<3100;i++){
      const u=(random(i)+t*.43)%1,a=random(i,1)*TAU+u*8+t*1.2,r=(1-u*.88)*radius,
        h=.1+u*u*height+Math.sin(a*2)*.12;
      this.particles.put(x+Math.cos(a)*r,y+h,z+Math.sin(a)*r,.021+random(i,2)*.024,
        i%8?0x9ee1e9:0xb1a3ef,fade*Math.sin(u*Math.PI)*.7,i,1.9,2);
    }
    if(age>=end){
      const u=(age-end)/1000,r=.6+(1-Math.exp(-u*6))*6,f=1-smooth(u/.85);
      this.put("ripple",x,y+.25,z,r,.65,r,f*.85,47);
      this.currents.put("spiral",x,y+.3,z,r,.8,r,f*.95,49,t*.4,0,0,{turns:.9,width:.23,drift:1.2});
      this.spray(x,y+.4,z,6,u,f,47,0,1100);
    }
  }
  private tornado(cast:ElementalCast,age:number,t:number):void {
    const timing=FINALE.skybreaker,first=cast.pulses[0]!,start=250;
    if(age<start||age>=timing.end)return;
    const [x,,z]=first.point,y=this.ground(x,z),form=smooth((age-start)/(first.at-start));
    const fade=smooth((age-start)/650)*(1-smooth((age-timing.release)/(timing.windEnd-timing.release)));
    const r=8.4*(.42+.58*form),h=3+14*form,foot=.25+.43*smooth((form-.25)/.75);
    const descent=(1-form)*10,touchdown=(age-first.at)/1000;
    this.state.baseDiameter=r*foot*2;this.state.height=h;
    this.state.phase=age<first.at?"forming-and-descending":age<timing.release?"sustained-vortex":age<timing.windEnd?"unravelling":"debris-settling";
    // Begin as loose elevated curls. The neck lengthens, its base widens and ground dust feeds it.
    for(let k=0;k<3;k++){
      const growth=smooth((age-start-k*180)/1100),radius=(3.5+k*.85)*(1+form*.28);
      this.currents.put("spiral",x,y+descent+1.5+k*1.7,z,radius,1.0+form,radius,
        fade*growth*(1-form)*.62,120+k,t*.6+k*2.1,0,0,{turns:.75+k*.2,width:.19,drift:2.2});
    }
    for(let i=0;i<2800;i++){
      const grain=tornadoDebris(i,age,x,z,this.ground);
      if(grain.alpha<.01)continue;
      this.debris.put(...grain.position,grain.size,i%4?0x464a43:0x797365,grain.alpha,i+Math.min(t,timing.release/1000)*5,1.2,1.5);
      if(grain.settled)this.state.settledDebris++;else this.state.airborneDebris++;
      if(i%35===0&&age<timing.windEnd)this.dust.put(...grain.position,.19+random(i,156)*.28,0x373e45,grain.alpha*fade*.5,i+t);
    }
    const warning=smooth((age-start)/260)*(1-smooth((age-first.at+80)/180));
    if(warning>.009){
      const gather=clamp((age-start)/(first.at-start)),rad=9.2-gather*3.4;
      this.currents.put("spiral",x,y+.12,z,rad,.58,rad,warning*.68,81,t*.4,0,0,{turns:.82,width:.22,drift:2});
      this.currents.put("spiral",x,y+.18,z,rad*.78,.85,rad*.78,warning*.50,84,t*.4+Math.PI,0,0,{turns:.67,width:.25,drift:2.7});

      for(let i=0;i<900;i++){
        const u=(random(i,81)+t*.8)%1,a=random(i,82)*TAU+u*5,rr=rad*(1-u*.4);
        this.particles.put(x+Math.cos(a)*rr,y+.12+u*.55,z+Math.sin(a)*rr,.021+random(i,83)*.022,
          0xa6dce9,warning*Math.sin(u*Math.PI)*.62,i,1.9,1.8);
      }
    }
    this.atmosphere.put(x,y+descent+h*.5,z,r,h*.5,r,fade*.88,2,y);
    for(let k=0;k<8;k++){
      const angle=k*2.399+t*1.4,rr=r*foot*.85;
      this.dustHaze.put(x+Math.cos(angle)*rr,y+.4+(k%3)*form*1.9,z+Math.sin(angle)*rr,
        2,1.2+form*.7,1.7,fade*smooth((age-700)/1000)*.85,k+51,y);
    }
    // Refractive mass supplies the broad wedge. Unequal rotating currents describe its circulation.
    this.put("funnel",x,y+descent,z,r,h,r,fade*form*.62,2,0,foot);
    this.put("funnel",x+.2,y+descent+.1,z-.2,r*.86,h*.94,r*.86,fade*form*.42,12,-t*.3,.76);
    this.flow.put("funnel","wind",x,y+descent,z,r,h,r,fade*.34,2,0,0,0,{foot,lean:.4});
    this.flow.put("funnel","wind",x,y+descent,z,r*.83,h*.98,r*.83,fade*.24,12,-t*.35,0,0,{foot:.78,twist:1.3});
    for(let k=0;k<5;k++){
      const turn=1.15+(k%3)*.23;
      this.currents.put("helix",x,y+descent+.15,z,r*(.89+k*.035),h*(.87+k*.025),r*(.89+k*.035),fade*(.48+k*.045),51+k,
        k*1.256+t*.4,0,0,{foot:.68+(k%2)*.08,turns:turn,width:.11+(k%3)*.025,drift:2.2+k*.12});
    }
    if(touchdown>-.2){
      const groundFade=fade*smooth((touchdown+.2)/.24);
      for(let k=0;k<3;k++){
        const a=t*(1.3+k*.12)+k*2.1,rad=5.6+k*.25,sx=x+Math.cos(a)*rad,sz=z+Math.sin(a)*rad;
        this.currents.put("spiral",sx,y+.12,sz,1.6+k*.22,2.2+k*.5,1.6+k*.22,groundFade*.70,60+k,a,0,0,{turns:1.3,width:.35,drift:3});
        this.currents.put("spiral",x,y+.10+k*.06,z,7.8+k*.5,.85,7.8+k*.5,groundFade*.65,65+k,a,0,0,{turns:.62,width:.26,drift:2.3});
      }
    }
    for(let i=0;i<4700;i++){
      const u=(random(i,3)+t*.30)%1,a=random(i,4)*TAU+t*4.4+u*8,rad=r*(foot+u*(1-foot))*(.92+random(i,5)*.13);
      this.particles.put(x+Math.cos(a)*rad,y+descent+u*h,z+Math.sin(a)*rad,.021+random(i,6)*.025,
        i%9?0xafdae4:0xb6a4e8,fade*.65*Math.sin(u*Math.PI),i,2.4,1.8);
    }
    // Damage resolves inside the continuous storm. No expanding shell or pulse rings.
  }

  private stormDust(x:number,y:number,z:number,r:number,h:number,fade:number,t:number,count:number,tall:boolean):void {
    for(let k=0;k<(tall?8:4);k++){
      const angle=k*2.399+t*(tall?1.5:1.1),rr=r*(.68+Math.sin(k)*.12),lift=tall?(k%3)*h*.19:.2;
      this.dustHaze.put(x+Math.cos(angle)*rr,y+.5+lift,z+Math.sin(angle)*rr,
        r*.38,tall?1.5:Math.max(.4,h*.28),r*.33,fade*(tall?.92:.74),k+51,y);
    }
    for(let i=0;i<count;i++){
      const u=(random(i,151)+t*(tall?.45:.65))%1,angle=random(i,152)*TAU+t*(3.5+u)+u*7,
        rr=r*(.68+random(i,153)*.30)*(1-u*.24),py=y+.06+u*u*h;
      this.debris.put(x+Math.cos(angle)*rr,py,z+Math.sin(angle)*rr,.018+random(i,154)*.049,
        i%3?0x494a45:0x777263,fade*Math.sin(u*Math.PI),i+t*6,1.2,1.6);
      if(i%8===0)this.dust.put(x+Math.cos(angle)*rr,py,z+Math.sin(angle)*rr,.15+random(i,155)*.25,
        0x424751,fade*.75,i+t,1.8,1.2);
    }
  }
  private spray(x:number,y:number,z:number,radius:number,age:number,fade:number,seed:number,yaw:number,count:number):void {
    for(let i=0;i<count;i++){
      const a=random(i,seed)*TAU,d=(.1+age*1.45)*radius*Math.sqrt(random(i,seed+1)),bias=.6+Math.cos(a-yaw)*.4;
      this.particles.put(x+Math.cos(a)*d,y+Math.sin(age*Math.PI)*random(i,seed+2)*1.2,z+Math.sin(a)*d,
        .020+random(i,seed+3)*.025,i%10?0xa4dfe8:0xb9a9f4,fade*bias*.7,i,1.7,2.1);
    }
  }
  end():void {
    this.atmosphere.end();this.dustHaze.end();
    this.flow.end();this.currents.end();this.dropped+=this.flow.dropped+this.atmosphere.dropped+this.dustHaze.dropped+this.currents.dropped;
    for(const mesh of this.batches.values()){
      mesh.visible=mesh.count>0;mesh.instanceMatrix.needsUpdate=true;
      mesh.geometry.getAttribute("pressureLife").needsUpdate=true;
    }
  }
  dispose():void {
    this.atmosphere.dispose();this.dustHaze.dispose();
    this.flow.dispose();
    this.currents.dispose();
    for(const unregister of this.unregister)unregister();
    for(const mesh of this.batches.values()){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();}
  }
}
