import * as THREE from "three";
import type { ElementalCast } from "../systems/elementalAttacks.js";
import type { ElementalParticleCloud } from "./elementalParticleCloud.js";
import type { ElementalFilaments } from "./elementalFilaments.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ElementalAtmosphere } from "./elementalAtmosphere.js";
import { FracturedBoulder } from "./fracturedBoulder.js";
import { ElementalFlowSurfaces } from "./elementalFlowSurfaces.js";
import { elementalFlowTexture, flowSampling } from "./elementalFlowTexture.js";
import { isolateMagicEmission } from "./magicGlow.js";
import { elementalPulseArt } from "./elementalPulseArt.js";

const TAU = Math.PI*2;
const clamp = (v:number) => Math.max(0,Math.min(1,v));
const ease = (v:number) => { const t=clamp(v);return t*t*(3-2*t); };
const random = (i:number,s=0) => { const x=Math.sin(i*127.1+s*311.7)*43758.5453;return x-Math.floor(x); };

type Crag=[number,number,number,number,number,number,number,number];
// Hand-placed intersecting masses: one rooted silhouette, with unequal fracture planes.
const mountainCrags:Crag[]=[
  [.65,3.25,.7,2.75,5.6,2.35,.27,-.12],[-2.15,1.9,-.8,2.3,3.7,2.15,-.35,.24],
  [3.05,1.3,-1.25,1.8,3.5,2.1,.6,-.29],[-.7,.9,-3.15,2.6,2.5,1.8,.2,.18],
  [-3.8,.6,1.5,2.,2.4,2.2,-.7,.35],[2.75,.5,2.8,2.6,2.2,1.6,.55,-.4],
  [.15,-.5,.2,5.8,2.7,4.9,.1,0],[-.9,4.35,.8,1.3,2.3,1.3,-.4,.32],
  [1.65,4.05,1.25,1.1,2.55,1.3,.9,-.27],[-4.9,-.35,-1.4,1.9,1.35,2.2,.7,.25],
];
function mountainHeight(x:number,z:number):number{
  let result=0;
  for(const [cx,cy,cz,sx,sy,sz] of mountainCrags){const d=(x-cx)**2/sx**2+(z-cz)**2/sz**2;if(d<1)result=Math.max(result,cy+Math.sqrt(1-d)*sy*.76);}
  return result;
}
function rockAssembly(crags:Crag[]):THREE.BufferGeometry{
  const parts:THREE.BufferGeometry[]=[];
  for(const [index,[x,y,z,sx,sy,sz,yaw,tilt]] of crags.entries()){
    const g=new THREE.IcosahedronGeometry(1,1),p=g.getAttribute('position'),colors:number[]=[];
    for(let i=0;i<p.count;i++){
      const px=p.getX(i),py=p.getY(i),pz=p.getZ(i);
      const cut=.91+Math.sin(px*5.2+py*3.8+index)*Math.cos(pz*6.1+index*.7)*.075;
      p.setXYZ(i,px*cut+.12*py,Math.max(-.82,Math.min(.73+px*.17-pz*.08,py))*cut,pz*cut);
      const mineral=.83+random(index,45)*.23;colors.push(mineral,mineral*(.98+random(index,46)*.03),mineral*.94);
    }
    g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();
    g.scale(sx,sy,sz);g.rotateZ(tilt);g.rotateY(yaw);g.translate(x,y,z);parts.push(g);
  }
  const result=mergeGeometries(parts)!;for(const p of parts)p.dispose();return result;
}
function faultGeometry():THREE.BufferGeometry{
  return rockAssembly(Array.from({length:9},(_,i):Crag=>[Math.sin(i*.85)*.45,.1+i*.13,-6.3+i*1.55,1.05+random(i,21)*.35,1.5+i*.22,1.3,.4+random(i,22)*.4,-.18-random(i,23)*.2]));
}
function jawGeometry(opposite=false):THREE.BufferGeometry{
  const crags:Crag[]=[
    [-.25,.05,0,1.5,1.6,4.1,0,0],[-.3,1.2,-2.7,1.15,3.3,1.4,.2,-.18],
    [-.25,1.6,-.9,1.2,3.7,1.4,-.15,-.24],[-.3,1.4,1.1,1.15,3.4,1.5,.1,-.33],
    [-.35,.9,2.9,1.2,2.8,1.25,.4,-.35],[.55,3.6,-.85,.5,1.1,.65,.2,-.48],
  ];
  return rockAssembly(crags.map((crag,i):Crag=>opposite?[crag[0]+.13*Math.sin(i),crag[1]*.91,crag[2]+.12*Math.cos(i),crag[3]*(1.08-i*.025),crag[4]*(.84+random(i,101)*.29),crag[5],crag[6]-.18,crag[7]+.08]:crag));
}

/** Cast-level stone choreography. Damage pulses never create duplicate main formations. */
export class EarthSpellVfx {
  private readonly haze:ElementalAtmosphere;
  private readonly flow:ElementalFlowSurfaces;
  private readonly flint: FracturedBoulder;
  private readonly siege: FracturedBoulder;
  private readonly mountain: THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
  private readonly ridge: THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
  private readonly jaws: THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>[]=[];
  private readonly front={value:0};
  private readonly clock={value:0};
  private readonly forms: THREE.Mesh[]=[];
  readonly state={variant:"",boulderPieces:0,shatterSeconds:0,mainShapes:0,geometryId:""};
  constructor(parent:THREE.Object3D,private readonly ground:(x:number,z:number)=>number,
    private readonly fragments:ElementalParticleCloud,private readonly dust:ElementalParticleCloud,
    private readonly light:ElementalParticleCloud,private readonly lines:ElementalFilaments){
    this.haze=new ElementalAtmosphere(parent,'dust');
    this.flow=new ElementalFlowSurfaces(parent);
    this.flint=new FracturedBoulder(parent,72,"elemental-flint-connected-fracture");
    this.siege=new FracturedBoulder(parent,180,"elemental-siege-connected-fracture");
    const make=(geometry:THREE.BufferGeometry,name:string,color:number)=>{
      const material=new THREE.MeshStandardMaterial({color,roughness:.9,flatShading:true,vertexColors:true});
      material.onBeforeCompile=shader=>{
        shader.uniforms["mineralTime"]=this.clock;
        shader.uniforms["flowTexture"]={value:elementalFlowTexture()};
        shader.vertexShader=`varying vec3 rockSurface;\n${shader.vertexShader}`.replace("#include <begin_vertex>","#include <begin_vertex>\nrockSurface=position;");
        shader.fragmentShader=`uniform float mineralTime;varying vec3 rockSurface;${flowSampling}
          float stoneHash(vec3 p){p=fract(p*.3183099+.17);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
          float stoneNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(stoneHash(i),stoneHash(i+vec3(1,0,0)),f.x),mix(stoneHash(i+vec3(0,1,0)),stoneHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(stoneHash(i+vec3(0,0,1)),stoneHash(i+vec3(1,0,1)),f.x),mix(stoneHash(i+vec3(0,1,1)),stoneHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
          \n${shader.fragmentShader}`.replace("#include <color_fragment>",`#include <color_fragment>
          float grain=stoneNoise(rockSurface*19.),mineral=stoneNoise(rockSurface*2.4+stoneNoise(rockSurface*4.1)*1.6);
          float fissure=1.-smoothstep(.008,.034,abs(mineral-.5));
          diffuseColor.rgb*=.78+grain*.3;
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.085,.093,.08),fissure*.48);
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.28,.32,.23),smoothstep(.66,.83,mineral)*.23);
          float etched=authoredFlow(rockSurface.xz*.24+rockSurface.y*.13,0.,2.);
          diffuseColor.rgb*=.62+etched*.7;`)
          .replace("#include <emissivemap_fragment>",`#include <emissivemap_fragment>
            float vein=pow(smoothstep(.46,.72,etched),2.);
            float charge=pow(.5+.5*sin(rockSurface.y*2.1+etched*15.-mineralTime*3.),8.);
            totalEmissiveRadiance=vec3(.19,.74,.42)*vein*(.95+charge*2.0);`);
      };
      isolateMagicEmission(material);
      const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;mesh.visible=false;
      mesh.frustumCulled=false;mesh.userData["magicGlow"]=true;parent.add(mesh);this.forms.push(mesh);return mesh;
    };
    this.mountain=make(rockAssembly(mountainCrags),"elemental-mountain-contiguous-mass",0x918b7c);
    this.ridge=make(faultGeometry(),"elemental-fault-travelling-ridge",0x8c8777);
    const shade=this.ridge.material.onBeforeCompile;
    this.ridge.material.onBeforeCompile=(shader,renderer)=>{
      shade(shader,renderer);shader.uniforms["faultFront"]=this.front;
      shader.vertexShader=`uniform float faultFront;\n${shader.vertexShader}`.replace("rockSurface=position;","rockSurface=position;transformed.y*=smoothstep(-.13,.13,faultFront-position.z/14.0-.5);");
    };
    const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});depth.onBeforeCompile=this.ridge.material.onBeforeCompile;this.ridge.customDepthMaterial=depth;
    for(let i=0;i<2;i++)this.jaws.push(make(jawGeometry(i===1),`elemental-basalt-closing-jaw-${i}`,0x898e7c));
  }
  get instances():number {return this.flow.instances+this.haze.instances+this.forms.filter(m=>m.visible).length+Number(this.flint.mesh.visible)+Number(this.siege.mesh.visible);}
  get dropped():number{return this.flow.dropped+this.haze.dropped;}
  get fracturePieces():number{return this.state.shatterSeconds>0?this.state.boulderPieces:0;}
  begin(seconds=0):void{this.clock.value=seconds;this.haze.begin(seconds);this.flow.begin(seconds);for(const mesh of this.forms)mesh.visible=false;this.flint.hide();this.siege.hide();this.state.mainShapes=0;this.state.boulderPieces=0;this.state.shatterSeconds=0;this.state.geometryId="";}
  update(cast:ElementalCast,now:number):void{
    const age=now-cast.started,t=age/1000,first=cast.pulses[0]!,last=cast.pulses.at(-1)!.at;
    if(age<0||age>last+1050)return;
    this.state.variant=cast.spellId;
    const [x,,z]=cast.aim,y=this.ground(x,z),yaw=Math.atan2(x-cast.origin[0],z-cast.origin[2]);
    const fade=1-ease((age-last-450)/600);
    // Mineral motes rise from the ground and gather ahead of the casting gesture.
    // The target's contracting pressure footprint prepares its larger formation.
    const gathering=ease(age/90)*(1-ease((age-260)/220));
    if(gathering>.01){
      const ox=cast.origin[0],oz=cast.origin[2],oy=this.ground(ox,oz);
      this.flow.put("band","earth",ox,oy+.05,oz,.95,.22,.95,gathering*.8,86,-t);
      for(let i=0;i<280;i++){
        const u=(random(i,81)+t*1.7)%1,a=random(i,82)*TAU+t*3,r=(1-u)*.82+.07;
        this.light.put(ox+Math.cos(a)*r+Math.sin(yaw)*u*.6,oy+.04+u*1.22,oz+Math.sin(a)*r+Math.cos(yaw)*u*.6,
          .016+random(i,83)*.018,i%5?0x95cc77:0xdbeab7,gathering*(1-u*.5),i,1.5,2.2);
      }
    }
    if(cast.spellId!=="flint-shot"&&cast.spellId!=="siege-boulder"&&age<first.at){
      const u=clamp(age/first.at),radius=cast.spellId==="mountainfall"?8:cast.spellId==="basalt-jaw"?4.5:3;
      this.flow.put("band","earth",x,y+.055,z,radius*(1.14-u*.22),.28+u*.38,radius*(1.14-u*.22),ease(u*3)*.6,96,t*.3);
      this.cracks(x,y,z,radius*u,ease(u*2)*.55,101);
    }
    if(cast.spellId==="flint-shot"||cast.spellId==="siege-boulder"){
      const big=cast.spellId==="siege-boulder",body=big?this.siege:this.flint,size=big?2.05:.68;
      const launch=big?320:90,u=clamp((age-launch)/(first.at-launch)),local=(age-first.at)/1000;
      if(age>=launch&&local<1.05){
        const hx=cast.origin[0]+(x-cast.origin[0])*u,hz=cast.origin[2]+(z-cast.origin[2])*u;
        const hy=cast.origin[1]+1.55+(y+size*.84-cast.origin[1]-1.55)*u+Math.sin(u*Math.PI)*(big?7.2:1.7);
        body.pose(hx,hy,hz,size,Math.min(age,first.at)*(big?.004:.011),local,1-ease((local-.68)/.37));
        if(local<.22){
          const aura=local<0?.62:(1-local/.22)*.62;
          this.flow.put("shell","earth",hx,hy,hz,size*1.23,size*1.18,size*1.23,aura,27,t*.7);
        }
        this.state.boulderPieces=local>=0?body.pieces:1;this.state.shatterSeconds=Math.max(0,local);this.state.geometryId=body.mesh.geometry.uuid;
        if(local>=0)this.burst(x,y+size*.5,z,size,local,big?5600:1600,big?7:3,71);
        else this.trail(cast,u,big?7.2:1.7,size,big?950:350);
        this.cracks(x,y,z,first.radius*(.25+ease(local/.25)),Math.max(0,1-local),17);
      }
      if(big&&age>=2000)this.burst(x,y+.1,z,4,(age-2000)/1000,1900,6,112,true);
    }else if(cast.spellId==="faultline"){
      const growth=ease((age-530)/650),settle=1-ease((age-1600)/650);
      if(growth*settle>.001){
        this.ridge.visible=true;this.ridge.position.set(x,y,z);this.ridge.rotation.y=yaw;this.ridge.scale.set(1,settle,1);this.front.value=growth;
        for(let k=0;k<cast.pulses.length;k++){
          const p=cast.pulses[k]!,a=(age-p.at)/1000;
          if(a>=0&&a<1)this.burst(p.point[0],y+.2,p.point[2],.5,a,780,3.5,k+31);
        }
        this.cracks(x,y,z,6.5,growth*settle,91);
      }
    }else if(cast.spellId==="basalt-jaw"){
      const rise=ease((age-620)/250),close=ease((age-1120)/430),sink=1-ease((age-1950)/650);
      for(const [i,jaw] of this.jaws.entries()){
        const side=i?1:-1,offset=side*(3.8-close*1.25);
        jaw.visible=rise*sink>.001;
        jaw.position.set(x+Math.cos(yaw)*offset,y-.1,z-Math.sin(yaw)*offset);
        jaw.rotation.set(0,yaw+(i?Math.PI:0)+side*.24,-side*close*.12);jaw.scale.set(1,rise*sink,1);
      }
      if(age>=850)this.burst(x,y+.1,z,3,(age-850)/1000,2400,4,76,true);
      if(age>=1550)this.burst(x,y+1.3,z,1.5,(age-1550)/1000,3500,5,77);
      this.cracks(x,y,z,5,rise*sink,45);
    }else{
      const rise=ease((age-800)/500),collapse=ease((age-2180)/600);
      this.mountain.visible=rise*fade>.001;
      this.mountain.position.set(x,y-.15,z);this.mountain.rotation.y=yaw+.27;
      this.mountain.scale.set(1+collapse*.15,rise*(1-collapse*.88)*fade,1+collapse*.15);
      this.cracks(x,y,z,10,rise*fade,103);
      for(const [i,p] of cast.pulses.entries()){
        const a=(age-p.at)/1000;if(a<0||a>1.05)continue;
        if(i===0)this.burst(x,y+.1,z,5,a,1800,5,11,true);
        else if(i===cast.pulses.length-1)this.burst(x,y+.1,z,7,a,4500,10,55,true);
        else {
          // Avalanche starts on this mass's actual slopes, then rolls out toward its footprint.
          const angle=(i-1)*TAU/8,localX=Math.cos(angle)*3.6,localZ=Math.sin(angle)*3.6,turn=yaw+.27;
          const px=x+localX*Math.cos(turn)+localZ*Math.sin(turn),pz=z-localX*Math.sin(turn)+localZ*Math.cos(turn);
          this.burst(px,y+mountainHeight(localX,localZ)*rise*(1-collapse*.88),pz,.45,a,1150,5.5,i+11);
        }
      }
    }
    this.state.mainShapes=this.instances;
  }
  end():void{this.haze.end();this.flow.end();}
  private trail(cast:ElementalCast,u:number,arc:number,size:number,count:number):void{
    for(let i=0;i<count;i++){
      const v=u-random(i,13)*.19;if(v<0)continue;
      const x=cast.origin[0]+(cast.aim[0]-cast.origin[0])*v,z=cast.origin[2]+(cast.aim[2]-cast.origin[2])*v;
      const y=cast.origin[1]+1.55+(this.ground(x,z)+size*.84-cast.origin[1]-1.55)*v+Math.sin(v*Math.PI)*arc;
      this.dust.put(x+(random(i,14)-.5)*size,y+(random(i,15)-.5)*size,z+(random(i,16)-.5)*size,.04+random(i,17)*.08,0x8a8270,.18,i,1.4);
    }
  }
  private burst(x:number,y:number,z:number,radius:number,t:number,count:number,speed:number,seed:number,grounded=false):void{
    if(t<0||t>1.05)return;
    const fade=1-ease((t-.65)/.4),variant=elementalPulseArt(this.state.variant as ElementalCast["spellId"],seed);
    const front=radius*.6+speed*(1-Math.exp(-t*4))*.48;
    this.flow.put("band","earth",x,this.ground(x,z)+.07,z,front*variant.width,(.45+radius*.17)*variant.lift,front*variant.depth,fade*.8,seed,variant.yaw,0,0,{arc:variant.arc,lean:variant.bend});
    if(count>=1100&&t<.7)this.flow.put("shell","earth",x,y+.12,z,front*variant.width,front*.48*variant.lift,front*variant.depth,(1-t/.7)*.48,seed+1,variant.yaw,0,0,{arc:variant.arc,lean:variant.bend});
    if(count>=1100)for(let k=0;k<variant.lobes;k++){
      const a=k*2.4+variant.yaw,d=radius*.65+t*speed*.4,scale=(.4+radius*.15)*(1+t*2);
      const hx=x+Math.cos(a)*d,hz=z+Math.sin(a)*d,gy=this.ground(hx,hz);
      this.haze.put(hx,gy+.25+t*.7,hz,scale*1.3*variant.width,scale*.65*variant.lift,scale*variant.depth,fade*.48,k+seed,gy);
    }
    for(let i=0;i<count;i++){
      const a=variant.yaw+random(i,seed)*TAU*variant.arc,originRadius=Math.cbrt(random(i,seed+1))*radius;
      const d=originRadius+(1-Math.exp(-t*1.5))/1.5*speed*(.35+random(i,seed+2));
      const px=x+Math.cos(a)*d*variant.width,pz=z+Math.sin(a)*d*variant.depth;
      const py=Math.max(this.ground(px,pz)+.025,y+(grounded?0:(random(i,seed+3)-.5)*radius)+t*(1+random(i,seed+4)*speed*.8)*variant.lift-7*t*t);
      if(i%7===0)this.light.put(px,py,pz,.015+random(i,seed+5)*.022,i%3?0xc9d99b:0x85d989,fade*.75,i,1.1,2.4);
      else this.fragments.put(px,py,pz,(.018+random(i,seed+5)**2*.075)*fade,i%3?0x777264:0xaba28a,1,i+t*3);
      if(i%9===0)this.dust.put(px,py+.08,pz,(.055+random(i,seed+6)*.09)*(1+t),0x8a8272,fade*.38,i,1.6);
    }
  }
  private cracks(x:number,y:number,z:number,r:number,alpha:number,seed:number):void{
    if(alpha<.01||r<.1)return;
    for(let k=0;k<7;k++){
      const a=random(k,seed)*TAU;let ax=x,az=z;
      for(let j=1;j<=8;j++){
        const angle=a+(random(j,k+seed)-.5)*.5,d=r*j/8;
        const bx=x+Math.cos(angle)*d,bz=z+Math.sin(angle)*d;
        this.lines.segment(ax,y+.035,az,bx,this.ground(bx,bz)+.035,bz,.014,0x94b685,alpha*.5,k,(j-1)/8,j/8);
        ax=bx;az=bz;
      }
    }
  }
  dispose():void{this.flow.dispose();this.haze.dispose();this.flint.dispose();this.siege.dispose();for(const mesh of this.forms){mesh.removeFromParent();mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();mesh.customDepthMaterial?.dispose();}}
}
