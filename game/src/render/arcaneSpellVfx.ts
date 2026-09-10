import { FINALE } from "../content/elementalFinales.js";
import { basicSpellPath } from "./basicSpellPath.js";
import * as THREE from "three";
import type { SpellElement, Vec3 } from "../contracts.js";
import { elementalSpell } from "../content/elementalSpells.js";
import type { ElementalCast } from "../systems/elementalAttacks.js";
import { ElementalEnergyBodies } from "./elementalEnergyBodies.js";
import type { ElementalParticleCloud } from "./elementalParticleCloud.js";
import { elementalPulseArt } from "./elementalPulseArt.js";

const TAU = Math.PI * 2;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => { const t = clamp(x); return t*t*(3-2*t); };
const random = new Float32Array(8192);
let seed = 61937;
for(let i=0;i<random.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;random[i]=seed/4294967296;}
const rand=(i:number,s=0)=>random[(i*37+s*139)&8191]!;
const palette: Record<SpellElement, [number, number]> = {
  wind: [0x5d8be5, 0xd5f4ff], water: [0x1676ff, 0x80fff0],
  earth: [0x45d894, 0xe5efae], fire: [0xff5b24, 0xffe0a0],
};
type Path = (u:number)=>Vec3;

/** Directional magical light. Silhouette comes from moving strokes and dispersed sparks. */
export class ArcaneSpellVfx {
  private readonly swooshes: ElementalEnergyBodies;
  private readonly cores: THREE.InstancedMesh<THREE.BufferGeometry,THREE.ShaderMaterial>;
  private readonly object = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly clock={value:0};
  dropped=0;
  readonly state={rite:"",inscriptions:0,cores:0,swooshes:0,composition:""};
  constructor(parent:THREE.Object3D,private readonly ground:(x:number,z:number)=>number,
    private readonly particles:ElementalParticleCloud) {
    this.swooshes=new ElementalEnergyBodies(parent,"earth",true);
    this.swooshes.mesh.name="elemental-magic-swooshes";
    const g=new THREE.IcosahedronGeometry(1,1);
    g.setAttribute("coreTint",new THREE.InstancedBufferAttribute(new Float32Array(64*4),4).setUsage(THREE.DynamicDrawUsage));
    const material=new THREE.ShaderMaterial({uniforms:{time:this.clock},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      vertexShader:`attribute vec4 coreTint;uniform float time;varying vec3 vNormal,vView,vLocal;varying vec4 vTint;
        void main(){vec3 p=position*(1.+sin(position.x*7.+time*11.)*sin(position.z*8.-time*8.)*.06);
          vec4 view=modelViewMatrix*instanceMatrix*vec4(p,1.);vNormal=normalize(normalMatrix*mat3(instanceMatrix)*normal);vView=-view.xyz;vLocal=position;vTint=coreTint;gl_Position=projectionMatrix*view;}`,
      fragmentShader:`uniform float time;varying vec3 vNormal,vView,vLocal;varying vec4 vTint;
        void main(){float face=max(0.,dot(normalize(vNormal),normalize(vView)));float n=.5+.5*sin(vLocal.y*9.-time*9.+sin(vLocal.x*8.+time*5.)*2.);
          float a=vTint.a*pow(face,1.8)*(.6+n*.4);if(a<.008)discard;
          gl_FragColor=vec4(vTint.rgb*(3.+pow(face,7.)*5.)+vec3(.6,.7,.8)*pow(face,18.),a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`});
    this.cores=new THREE.InstancedMesh(g,material,64);this.cores.count=0;this.cores.visible=false;this.cores.frustumCulled=false;
    this.cores.name="elemental-arcane-concentrated-foci";this.cores.userData["magicGlow"]=true;this.cores.userData["magicGlowOnly"]=true;
    this.cores.instanceMatrix.setUsage(THREE.DynamicDrawUsage);parent.add(this.cores);
  }
  get instances():number{return this.cores.count+this.swooshes.instances;}
  begin(seconds:number):void {
    this.clock.value=seconds;this.dropped=0;this.cores.count=0;this.swooshes.begin(seconds);
    this.state.rite="";this.state.cores=0;this.state.inscriptions=0;this.state.swooshes=0;this.state.composition="";
  }
  private core(element:SpellElement,p:Vec3,r:number,alpha:number,stretch:Vec3=[1,1,1]):void {
    if(alpha<.01||r<.005)return;const i=this.cores.count;if(i===64){this.dropped++;return;}
    this.object.position.set(...p);this.object.rotation.set(0,0,0);this.object.scale.set(r*stretch[0],r*stretch[1],r*stretch[2]);this.object.updateMatrix();this.cores.setMatrixAt(i,this.object.matrix);
    this.color.setHex(palette[element][0]);(this.cores.geometry.getAttribute("coreTint") as THREE.InstancedBufferAttribute).setXYZW(i,this.color.r,this.color.g,this.color.b,alpha);this.cores.count++;this.state.cores++;
  }
  update(cast:ElementalCast,now:number,focus?:Vec3):void {
    const def=elementalSpell(cast.spellId),id=def.id,element=def.element,rank=def.rank,
      age=now-cast.started,first=cast.pulses[0]!,last=cast.pulses.at(-1)!.at;
    if(age<0||age>last+1000)return;
    this.state.rite=id;
    const [x,,z]=cast.aim,y=this.ground(x,z),[ox,oy,oz]=cast.origin,
      yaw=Math.atan2(x-ox,z-oz),fx=Math.sin(yaw),fz=Math.cos(yaw);
    const hand:Vec3=focus??[ox+fx*.6+fz*.28,oy+1.3,oz+fz*.6-fx*.28];
    const gathering=ease(age/85)*(1-ease((age-Math.min(480,first.at*.55))/200));
    if(gathering>.01){
      this.core(element,hand,rank===0?.08:.13+rank*.008,gathering*.85);
      // Loose energy gathers into the socket; there are no drawn staff arcs.
      const count=rank===0?28:240+rank*50;
      for(let i=0;i<count;i++){
        const u=(rand(i,51)+age*.0018)%1,angle=rand(i,52)*TAU,reach=(rank===0?.55:1.8)*(1-u);
        const groundFed=element==="earth"||element==="water"||element==="fire";
        const sourceY=groundFed?this.ground(hand[0],hand[2])+.04:hand[1]+(rand(i,53)-.2)*2.5;
        this.particles.put(hand[0]+Math.cos(angle)*reach,sourceY+(hand[1]-sourceY)*ease(u),
          hand[2]+Math.sin(angle)*reach,.012+rand(i,54)*.020,palette[element][i%6===0?1:0],
          gathering*Math.sin(u*Math.PI)*.8,i,1.2,1.8);
      }
    }
    if(rank===0){
      this.state.composition="small-enchanted-streak";
      if(element==="fire")return; // Kindle owns its shaded flame, smoke and contact.
      const release:Vec3=cast.release??[ox+fx*.5+fz*.28,oy+1.17,oz+fz*.5-fx*.28];
      const size=cast.visualScale??1;
      const path=basicSpellPath(release,[x,y+(cast.impactHeight??1.5),z]);
      const releaseAt=cast.releaseAt??100;
      this.comet(element,path,(age-releaseAt)/(first.at-releaseAt),.14*size,.115*size,0,Math.round(64*(cast.particleScale??1)));
      if(!cast.missed)this.splash(element,[x,y+(cast.impactHeight??1.5),z],(age-first.at)/1000,.65*size,0,1);
      return;
    }
    if(id==="flint-shot"||id==="siege-boulder"){
      const big=id==="siege-boulder",size=big?.28:.19,launch=big?320:90,
        u=(age-launch)/(first.at-launch),arc=big?5.1:2.8;
      const path:Path=v=>[ox+(x-ox)*v,oy+1.55+(y+(cast.impactHeight??1.5)-oy-1.55)*v+Math.sin(v*Math.PI)*arc,oz+(z-oz)*v];
      this.state.composition=big?"braided-jade-siege-comet":"flint-light-lance";
      this.comet(element,path,u,big?.28:.26,big?.52:.30,big?12:6,big?1700:800);
    }else if(id==="air-needle"){
      const path:Path=u=>[ox+(x-ox)*u+fz*Math.sin(u*Math.PI)*.32,y+(cast.impactHeight??1.5),oz+(z-oz)*u-fx*Math.sin(u*Math.PI)*.32];
      this.state.composition="silver-pressure-needle";
      this.comet(element,path,(age-150)/(first.at-150),.25,.20,1,650);
    }else if(id==="waterjet"||id==="tidal-fan"){
      this.state.composition=id==="waterjet"?"twin-cobalt-light-jets":"five-banked-azure-wakes";
      for(const [i,p] of cast.pulses.entries()){
        const art=elementalPulseArt(id,i),launch=Math.max(90,p.at-500),u=(age-launch)/(p.at-launch),
          dx=p.point[0]-ox,dz=p.point[2]-oz,len=Math.hypot(dx,dz)||1;
        const path:Path=v=>[ox+dx*v+dz/len*Math.sin(v*Math.PI)*art.bend,
          oy+1.45+(this.ground(p.point[0],p.point[2])+(cast.impactHeight??1.5)-oy-1.45)*v+Math.sin(v*Math.PI)*art.lift*.35,
          oz+dz*v-dx/len*Math.sin(v*Math.PI)*art.bend];
        this.comet(element,path,u,.30,id==="waterjet"?.20:.24+i*.025,20+i,700);
      }
    }else if(id==="thunder-lance"){
      const end=cast.pulses.at(-1)!,near=Math.hypot(first.point[0]-ox,first.point[2]-oz),far=Math.hypot(end.point[0]-ox,end.point[2]-oz);
      const distance=age<first.at?clamp((age-280)/(first.at-280))*near:near+(age-first.at)/(end.at-first.at)*(far-near);
      const path:Path=u=>[ox+fx*far*u,y+(cast.impactHeight??1.5),oz+fz*far*u];
      this.state.composition="piercing-pressure-wake";
      if(age>280)this.comet(element,path,distance/far,.27,.31,31,1100);
    }else if(id==="geyser-chain"){
      this.state.composition=id==="geyser-chain"?"branching-spring-bursts":"gathered-spiral-spray";
      for(const [i,p] of cast.pulses.entries())if(p.form==="spike"){
        const a=(age-p.at)/1000,f=ease((a+.2)/.25)*(1-ease((a-.15)/.7));
        if(f>.01)for(let k=0;k<(i%3===0?1:i%3===1?2:3);k++){
          const clock=age/1000,angle=k*(1.2+rand(i,28)*1.6)+i*.9+Math.sin(clock*2.2+k)*.22,r=.2+rand(k,i+29)*.7,
            h=(1.6+rand(k,i)*3.8)*f*(.9+Math.sin(clock*5+k*1.8)*.10),curl=Math.sin(clock*3.7+k)*.55;
          const base:Vec3=[p.point[0]+Math.cos(angle)*r,y+.05,p.point[2]+Math.sin(angle)*r];
          const b:Vec3=[base[0]-.3*Math.sin(angle),y+h*.6,base[2]+.3*Math.cos(angle)],
            c:Vec3=[base[0]+Math.cos(angle)*1.5-Math.sin(angle)*curl,y+h*1.3,base[2]+Math.sin(angle)*1.5+Math.cos(angle)*curl],
            d:Vec3=[base[0]+Math.cos(angle)*2.3,y+h*.25,base[2]+Math.sin(angle)*2.3];
          this.stroke(element,base,b,c,d,.10+rand(k,i+27)*.13,f*.66,i*4+k);
          this.currentSpray(base,b,c,d,age/1000,f,i*4+k,260);

        }
      }
    }else if(id==="deluge"){
      this.state.composition="perimeter-surf-inward-collision";
    }else if(id==="faultline"||id==="basalt-jaw"){
      this.state.composition=id==="basalt-jaw"?"crossing-mineral-rakes":"running-mineral-seam";
      for(const [i,p] of cast.pulses.entries()){
        const a=(age-p.at)/1000,f=ease((a+.18)/.18)*(1-ease((a-.18)/.65));
        if(f<.01)continue;
        const angle=yaw+(id==="faultline"?0:i*2.4),dx=Math.sin(angle),dz=Math.cos(angle),reach=2.0;
        this.stroke(element,[p.point[0]-dx*reach,y+.07,p.point[2]-dz*reach],
          [p.point[0]-dx*.8,y+.25,p.point[2]-dz*.8],
          [p.point[0]+dx*.4,y+(id==="basalt-jaw"?2.1:1.15),p.point[2]+dz*.4],
          [p.point[0]+dx*reach,y+.15,p.point[2]+dz*reach],.20,f*.76,i);
      }
    }
    if(id==="mountainfall")this.state.composition="toppling-slabs-and-inward-fracture";
    // Contact light follows the pulse's direction and has open space between its strokes.
    // Large fields scatter their flashes over the footprint; no central orb or rune plane.
    if(id!=="skybreaker"&&id!=="deluge"&&id!=="undertow"&&id!=="mountainfall"&&element!=="fire")for(const [i,p] of cast.pulses.entries()){
      if(p.form==="vortex"||p.form==="wing")continue;
      const a=(age-p.at)/1000;
      this.splash(element,[p.point[0],this.ground(p.point[0],p.point[2])+(p.form==="dart"||p.form==="beam"?(cast.impactHeight??1.5):.18),p.point[2]],
        a,Math.min(2.8,p.radius*.72),i,rank<3?2:3);
    }
  }
  private stroke(element:SpellElement,a:Vec3,b:Vec3,c:Vec3,d:Vec3,width:number,alpha:number,seed:number):void {
    this.swooshes.curve(a,b,c,d,width,palette[element][seed%3===0?1:0],alpha,seed,.42,element==="fire"?1:element==="wind"?2:element==="water"?3:0);
  }
  private comet(element:SpellElement,path:Path,u:number,span:number,width:number,seed:number,count:number):void {
    if(u<0||u>1.15)return;
    const head=clamp(u),tail=Math.max(0,u-span),fade=ease(u*9)*(1-ease((u-1)/.15));
    if(head<=tail||fade<.01)return;
    const at=path(head),a=path(tail),b=path(tail+(head-tail)/3),c=path(tail+(head-tail)*2/3);
    const dx=at[0]-a[0],dz=at[2]-a[2],length=Math.hypot(dx,dz)||1,rx=dz/length,rz=-dx/length;
    this.core(element,at,width*(element==="earth"?.82:.56),fade*.88,[.8,.8,1.15]);
    this.stroke(element,a,b,c,at,width,fade*.82,seed);
    if(width>.18){
      const side=seed%2?1:-1;
      this.stroke(element,[a[0]+.25*side,a[1]-.1,a[2]],
        [b[0]+width*1.9*side,b[1]+width*.8,b[2]],
        [c[0]-width*.7*side,c[1]+width*.65,c[2]],at,width*.47,fade*.56,seed+1);
    }
    for(let i=0;i<count;i++){
      const lag=rand(i,seed)*span,v=u-lag;if(v<0||v>1)continue;
      const p=path(v),angle=rand(i,seed+1)*TAU+v*12,r=width*(.12+lag/span*1.5)*Math.sqrt(rand(i,seed+2));
      this.particles.put(p[0]+rx*Math.cos(angle)*r,p[1]+Math.sin(angle)*r,p[2]+rz*Math.cos(angle)*r,
        .012+rand(i,seed+4)*.023,palette[element][i%7===0?1:0],fade*(1-lag/span)*.88,i,1.25,1.6);
    }
  }
  private currentSpray(a:Vec3,b:Vec3,c:Vec3,d:Vec3,time:number,alpha:number,seed:number,count:number):void {
    for(let i=0;i<count;i++){
      const u=(rand(i,seed+30)+time*(.62+rand(i,seed+31)*.24))%1,v=1-u,
        spread=(.035+u*u*.19),offset=rand(i,seed+32)-.5;
      const point=(k:number)=>v*v*v*a[k]!+3*v*v*u*b[k]!+3*v*u*u*c[k]!+u*u*u*d[k]!;
      this.particles.put(point(0)+Math.sin(i+time*5)*spread,
        Math.max(this.ground(point(0),point(2))+.04,point(1)+offset*spread-u*u*rand(i,seed+33)*.32),
        point(2)+Math.cos(i-time*4)*spread,.012+rand(i,seed+34)*.024,
        i%8===0?0xd0fff4:i%3?0x3bdaff:0x2773eb,alpha*(.35+.65*Math.sin(u*Math.PI)),i,1.25,1.6);
    }
  }
  private splash(element:SpellElement,point:Vec3,t:number,r:number,seed:number,strokes:number):void {
    if(t<0||t>.55)return;
    const f=(1-ease(t/.55)),spread=r*(.1+ease(t/.45)),[x,y,z]=point;
    if(t<.14)this.core(element,point,.12+Math.min(.13,r*.05),f*.7,[1.4,.65,1]);
    const marks=seed%4===0?0:seed%4===2?2:1;
    if(strokes>1)for(let k=0;k<marks;k++){
      const a=seed*.71+k*(.8+rand(seed,7)*1.9),dx=Math.cos(a),dz=Math.sin(a),h=.3+r*(seed%3===0?.18:.25+rand(k,seed)*.65);
      this.stroke(element,[x+dx*spread*.25,y,z+dz*spread*.25],
        [x+dx*spread*.45-dz*.25,y+h*f,z+dz*spread*.45+dx*.25],
        [x+dx*spread-dz*.35,y+h*.6,z+dz*spread+dx*.35],
        [x+dx*spread*1.5,y-.05,z+dz*spread*1.5],.065+r*.035,f*.50,seed+k);
    }
    const count=strokes===1?32:180+strokes*65;
    for(let i=0;i<count;i++){
      const a=seed*.71+(rand(i,seed+7)-.5)*(seed%3===0?2.4:seed%3===1?4.5:TAU),velocity=r*(1+rand(i,seed+8)*3),d=t*velocity,
        px=x+Math.cos(a)*d,pz=z+Math.sin(a)*d,py=Math.max(this.ground(px,pz)+.04,y+t*(1+rand(i,seed+9)*r*3)-4*t*t);
      this.particles.put(px,py,pz,.012+rand(i,seed+10)*.023,palette[element][i%5===0?1:0],f*.8,i,1.2,1.5);
    }
  }
  end():void {
    this.swooshes.end();this.cores.visible=this.cores.count>0;this.cores.instanceMatrix.needsUpdate=true;
    this.cores.geometry.getAttribute("coreTint").needsUpdate=true;
    this.state.swooshes=this.swooshes.instances;this.dropped+=this.swooshes.dropped;
  }
  dispose():void {this.swooshes.dispose();this.cores.removeFromParent();this.cores.geometry.dispose();this.cores.material.dispose();}
}
