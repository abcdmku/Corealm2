import { FINALE, elementalChoreographyDuration } from "../content/elementalFinales.js";
import * as THREE from "three";
import type { ElementalCast } from "../systems/elementalAttacks.js";
import type { ElementalParticleCloud } from "./elementalParticleCloud.js";
import type { ElementalFilaments } from "./elementalFilaments.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ElementalAtmosphere } from "./elementalAtmosphere.js";
import { FracturedBoulder, fracturedBoulderGeometry, fadeFractureShadow } from "./fracturedBoulder.js";
import { ElementalFlowSurfaces } from "./elementalFlowSurfaces.js";
import { elementalFlowTexture, flowSampling } from "./elementalFlowTexture.js";
import { isolateMagicEmission } from "./magicGlow.js";
import { elementalPulseArt } from "./elementalPulseArt.js";
import { ElementalEnergyBodies } from "./elementalEnergyBodies.js";
import type { Vec3 } from "../contracts.js";

const TAU = Math.PI*2;
const clamp = (v:number) => Math.max(0,Math.min(1,v));
const ease = (v:number) => { const t=clamp(v);return t*t*(3-2*t); };
const random = (i:number,s=0) => { const x=Math.sin(i*127.1+s*311.7)*43758.5453;return x-Math.floor(x); };

type Crag=[number,number,number,number,number,number,number,number];
function rockAssembly(crags:Crag[],partition=false):THREE.BufferGeometry{
  const parts:THREE.BufferGeometry[]=[];
  for(const [index,[x,y,z,sx,sy,sz,yaw,tilt]] of crags.entries()){
    const g=partition?fracturedBoulderGeometry(4):new THREE.IcosahedronGeometry(1,1),p=g.getAttribute('position'),colors:number[]=[];
    for(let i=0;i<p.count;i++){
      const px=p.getX(i),py=p.getY(i),pz=p.getZ(i);
      const cut=.91+Math.sin(px*5.2+py*3.8+index)*Math.cos(pz*6.1+index*.7)*.075;
      p.setXYZ(i,px*cut+.12*py,Math.max(-.82,Math.min(.73+px*.17-pz*.08,py))*cut,pz*cut);
      const mineral=.83+random(index,45)*.23;colors.push(mineral,mineral*(.98+random(index,46)*.03),mineral*.94);
    }
    g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();
    g.scale(sx,sy,sz);g.rotateZ(tilt);g.rotateY(yaw);g.translate(x,y,z);
    const centers:number[]=[],motions:number[]=[];
    const transform=new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationZ(tilt)).multiply(new THREE.Matrix4().makeScale(sx,sy,sz));transform.setPosition(x,y,z);
    const source=g.getAttribute('shardCentre'),motion=g.getAttribute('shardMotion'),center=new THREE.Vector3();
    for(let j=0;j<p.count;j++){
      let seed=index;
      if(partition){
        center.fromBufferAttribute(source,j);
        const px=center.x,py=center.y,pz=center.z,cut=.91+Math.sin(px*5.2+py*3.8+index)*Math.cos(pz*6.1+index*.7)*.075;
        center.set(px*cut+.12*py,Math.max(-.82,Math.min(.73+px*.17-pz*.08,py))*cut,pz*cut).applyMatrix4(transform);
        centers.push(center.x,center.y,center.z);seed=index*37+motion.getW(j);
      }else centers.push(x,y,z);
      motions.push(random(seed,301)*2-1,random(seed,302),random(seed,303)*2-1,random(seed,304)*4);
    }
    g.deleteAttribute('shardCentre');g.deleteAttribute('shardMotion');
    g.setAttribute('rockChunkCentre',new THREE.Float32BufferAttribute(centers,3));
    g.setAttribute('rockChunkMotion',new THREE.Float32BufferAttribute(motions,4));parts.push(g);
  }
  const result=mergeGeometries(parts)!;
  result.userData['pieces']=parts.reduce((n,p)=>n+Number(p.userData['pieces']??0),0);
  for(const p of parts)p.dispose();return result;
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
  private readonly energy:ElementalEnergyBodies;
  private readonly flint: FracturedBoulder;
  private readonly siege: FracturedBoulder;
  private readonly outcrops: THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>[]=[];
  private readonly collapses:Array<{value:number}>=[];
  private readonly ridge: THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
  private readonly jaws: THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>[]=[];
  private readonly front={value:0};
  private readonly clock={value:0};
  private readonly forms: THREE.Mesh[]=[];
  readonly state={variant:"",boulderPieces:0,shatterSeconds:0,mainShapes:0,geometryId:"",implosionRadius:0,phase:""};
  constructor(parent:THREE.Object3D,private readonly ground:(x:number,z:number)=>number,
    private readonly fragments:ElementalParticleCloud,private readonly dust:ElementalParticleCloud,
    private readonly light:ElementalParticleCloud,private readonly lines:ElementalFilaments){
    this.haze=new ElementalAtmosphere(parent,'dust');
    this.flow=new ElementalFlowSurfaces(parent);
    this.energy=new ElementalEnergyBodies(parent,'earth',true);
    this.energy.mesh.name='elemental-earth-mineral-currents';
    this.flint=new FracturedBoulder(parent,72,"elemental-flint-connected-fracture",ground);
    this.siege=new FracturedBoulder(parent,180,"elemental-siege-connected-fracture",ground);
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
    // Broad shelf, split buttress, leaning slab, low rubble bank: different rock structures.
    const formations:Crag[][]=[
      [[-.6,.2,0,1.5,.7,.8,.2,-.24],[.4,.55,-.3,.85,1.1,.6,-.3,-.35],[1,.05,.4,.7,.5,.9,.5,.1]],
      [[0,.25,0,.7,1.15,.55,-.4,.21],[-.5,-.1,.4,1.3,.4,.95,.1,-.12],[.45,.12,-.2,.5,.8,.6,.7,.37],[.1,.8,.1,.4,.55,.4,-.2,.1]],
      [[0,.1,0,1.6,.55,1.1,.4,-.08],[.55,.45,.1,1.1,.7,.65,.5,-.5]],
      [[-.4,.3,.2,.65,1.05,.9,.6,.32],[.45,.2,-.5,.8,.8,.6,-.3,-.2],[.6,-.15,.4,1.1,.35,.8,.2,0]],
      [[-.8,-.1,0,.85,.5,.9,-.4,-.3],[0,.25,.1,1,.85,.7,.2,-.15],[.8,.15,-.3,.75,.65,.8,-.5,-.4],[1.1,-.1,.4,.45,.4,.6,.7,0]],
    ];
    for(let i=0;i<5;i++){
      const rock=make(rockAssembly(formations[i]!,true),`elemental-mountain-fracture-outcrop-${i}`,0x858d7b);
      const release={value:0},floor={value:0},inverse={value:new THREE.Matrix4()},fade={value:1};
      this.collapses.push(release);rock.userData['fractureFloor']=floor;
      rock.userData['fractureInverse']=inverse;rock.userData['fractureFade']=fade;
      const shade=rock.material.onBeforeCompile;
      const programKey=rock.material.customProgramCacheKey();
      rock.material.customProgramCacheKey=()=>`${programKey}|world-fracture-v2`;
      rock.material.onBeforeCompile=(shader,renderer)=>{
        shade(shader,renderer);shader.uniforms['rockCollapse']=release;shader.uniforms['rockFloor']=floor;
        shader.uniforms['rockInverseModel']=inverse;
        shader.vertexShader=`attribute vec3 rockChunkCentre;attribute vec4 rockChunkMotion;uniform float rockCollapse,rockFloor;uniform mat4 rockInverseModel;
${shader.vertexShader}`
          .replace('rockSurface=position;',`rockSurface=position;
            vec3 worldCenter=(modelMatrix*vec4(rockChunkCentre,1.)).xyz;
            vec3 piece=(modelMatrix*vec4(transformed,1.)).xyz-worldCenter;
            float a=rockCollapse*(1.1+rockChunkMotion.w),c=cos(a),s=sin(a);
            vec3 axis=normalize(vec3(rockChunkMotion.x,.4,rockChunkMotion.z));
            piece=(piece*c+cross(axis,piece)*s+axis*dot(axis,piece)*(1.-c))*(1.-smoothstep(.015,.24,rockCollapse)*.82);
            vec4 worldRock=vec4(worldCenter+piece,1.);
            vec3 drift=normalize(mat3(modelMatrix)*vec3(rockChunkMotion.x,.05,rockChunkMotion.z));
            worldRock.xyz+=drift*((1.-exp(-rockCollapse*1.4))/1.4)*(6.+rockChunkMotion.w*1.6);
            worldRock.y+=rockCollapse*(7.+rockChunkMotion.y*10.)-9.*rockCollapse*rockCollapse;
            if(rockCollapse>0.){
              float centerY=(modelMatrix*vec4(rockChunkCentre,1.)).y+drift.y*((1.-exp(-rockCollapse*1.4))/1.4)*(6.+rockChunkMotion.w*1.6)
                +rockCollapse*(7.+rockChunkMotion.y*10.)-9.*rockCollapse*rockCollapse;
              worldRock.y+=max(0.,rockFloor+.23-centerY);
            }
            transformed=(rockInverseModel*worldRock).xyz;`);
      };
      const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
      depth.onBeforeCompile=(shader,renderer)=>{rock.material.onBeforeCompile(shader,renderer);fadeFractureShadow(shader,fade);};
      depth.customProgramCacheKey=()=>`${programKey}|world-fracture-depth-v2`;
      rock.customDepthMaterial=depth;
      rock.material.transparent=true;this.outcrops.push(rock);
    }
    this.ridge=make(faultGeometry(),"elemental-fault-travelling-ridge",0x8c8777);
    const shade=this.ridge.material.onBeforeCompile;
    const ridgeProgramKey=this.ridge.material.customProgramCacheKey();
    this.ridge.material.customProgramCacheKey=()=>`${ridgeProgramKey}|travelling-fault`;
    this.ridge.material.onBeforeCompile=(shader,renderer)=>{
      shade(shader,renderer);shader.uniforms["faultFront"]=this.front;
      shader.vertexShader=`uniform float faultFront;\n${shader.vertexShader}`.replace("rockSurface=position;","rockSurface=position;transformed.y*=smoothstep(-.13,.13,faultFront-position.z/14.0-.5);");
    };
    const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});depth.onBeforeCompile=this.ridge.material.onBeforeCompile;this.ridge.customDepthMaterial=depth;
    for(let i=0;i<2;i++)this.jaws.push(make(jawGeometry(i===1),`elemental-basalt-closing-jaw-${i}`,0x898e7c));
  }
  get instances():number {return this.flow.instances+this.haze.instances+this.energy.instances+this.forms.filter(m=>m.visible).length+Number(this.flint.mesh.visible)+Number(this.siege.mesh.visible);}
  get dropped():number{return this.flow.dropped+this.haze.dropped+this.energy.dropped;}
  get fracturePieces():number{return this.state.shatterSeconds>0?this.state.boulderPieces:0;}
  begin(seconds=0):void{this.clock.value=seconds;this.haze.begin(seconds);this.flow.begin(seconds);this.energy.begin(seconds);for(const mesh of this.forms)mesh.visible=false;for(const collapse of this.collapses)collapse.value=0;this.flint.hide();this.siege.hide();this.state.mainShapes=0;this.state.boulderPieces=0;this.state.shatterSeconds=0;this.state.geometryId="";this.state.implosionRadius=0;this.state.phase="";}
  update(cast:ElementalCast,now:number):void{
    const age=now-cast.started,t=age/1000,first=cast.pulses[0]!,last=cast.pulses.at(-1)!.at;
    if(age<0||age>=elementalChoreographyDuration(cast.spellId,last))return;
    this.state.variant=cast.spellId;
    const [x,,z]=cast.aim,y=this.ground(x,z),yaw=Math.atan2(x-cast.origin[0],z-cast.origin[2]);
    const fade=1-ease((age-last-450)/600);
    // Mineral motes rise from the ground and gather ahead of the casting gesture.
    // The target's contracting pressure footprint prepares its larger formation.
    const gathering=ease(age/90)*(1-ease((age-260)/220));
    if(gathering>.01){
      const ox=cast.origin[0],oz=cast.origin[2],oy=this.ground(ox,oz);

      for(let i=0;i<280;i++){
        const u=(random(i,81)+t*1.7)%1,a=random(i,82)*TAU+t*3,r=(1-u)*.82+.07;
        this.light.put(ox+Math.cos(a)*r+Math.sin(yaw)*u*.6,oy+.04+u*1.22,oz+Math.sin(a)*r+Math.cos(yaw)*u*.6,
          .016+random(i,83)*.018,i%5?0x95cc77:0xdbeab7,gathering*(1-u*.5),i,1.5,2.2);
      }
    }
    if(cast.spellId!=="flint-shot"&&cast.spellId!=="siege-boulder"&&age<first.at){
      const u=clamp(age/first.at),radius=cast.spellId==="mountainfall"?8:cast.spellId==="basalt-jaw"?4.5:3;

      this.cracks(x,y,z,radius*u,ease(u*2)*.55,101);
    }
    if(cast.spellId==="flint-shot"||cast.spellId==="siege-boulder"){
      const big=cast.spellId==="siege-boulder",body=big?this.siege:this.flint,size=big?.28:.19;
      const launch=big?320:90,u=clamp((age-launch)/(first.at-launch)),local=(age-first.at)/1000;
      if(age>=launch&&local<1.05){
        const hx=cast.origin[0]+(x-cast.origin[0])*u,hz=cast.origin[2]+(z-cast.origin[2])*u;
        const hy=cast.origin[1]+1.55+(y+(cast.impactHeight??1.5)-cast.origin[1]-1.55)*u+Math.sin(u*Math.PI)*(big?5.1:2.8);
        body.pose(hx,hy,hz,size,Math.min(age,first.at)*(big?.004:.011),local,1-ease((local-.68)/.37));
        this.state.boulderPieces=local>=0?body.pieces:1;this.state.shatterSeconds=Math.max(0,local);this.state.geometryId=body.mesh.geometry.uuid;
        if(local>=0)this.burst(x,y+(cast.impactHeight??1.5),z,size,local,big?5600:1600,big?7:3,71);
        else this.trail(cast,u,big?5.1:2.8,size,big?950:350);
        this.cracks(x,y,z,first.radius*(.25+ease(local/.25)),Math.max(0,1-local),17);
      }
      if(big&&age>=2000)this.burst(x,y+.1,z,4,(age-2000)/1000,1900,6,112,true);
    }else if(cast.spellId==="faultline"){
      const growth=ease((age-530)/650),settle=1-ease((age-1600)/650);
      if(growth*settle>.001){
        this.ridge.visible=true;this.ridge.position.set(x,y,z);this.ridge.rotation.y=yaw;this.ridge.scale.set(.72,settle*.43,1);this.front.value=growth;
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
        jaw.rotation.set(0,yaw+(i?Math.PI:0)+side*.24,-side*close*.12);jaw.scale.set(.56,rise*sink*.39,.80);
      }
      if(age>=850)this.burst(x,y+.1,z,3,(age-850)/1000,2400,4,76,true);
      if(age>=1550)this.burst(x,y+1.3,z,1.5,(age-1550)/1000,3500,5,77);
      this.cracks(x,y,z,5,rise*sink,45);
    }else{
      this.mountainfall(cast,age);
    }
    this.state.mainShapes=this.instances;
  }
  end():void{this.haze.end();this.flow.end();this.energy.end();}
  private mountainfall(cast:ElementalCast,age:number):void {
    const timing=FINALE.mountainfall,[x,,z]=cast.aim,y=this.ground(x,z),t=age/1000;
    const finish=1-ease((age-6100)/700),collapse=(age-timing.collapse)/1000;
    const charge=ease((age-250)/1300),pull=ease((age-3500)/740);
    if(collapse>0&&collapse<2.35){this.state.boulderPieces=this.outcrops.reduce((n,m)=>n+Number(m.geometry.userData['pieces']),0);this.state.shatterSeconds=collapse;}
    this.state.phase=age<3500?"rising-ridges":age<timing.collapse?"inward-collapse":"falling-fragments";
    this.state.implosionRadius=7*(1-pull*.82);
    this.cracks(x,y,z,10*charge,finish*.85,101);
    for(const [i,p] of cast.pulses.slice(0,-1).entries()){
      const local=(age-p.at)/1000;if(local<0||local>.36)continue;
      const [px,,pz]=p.point,py=this.ground(px,pz),a=random(i,450)*TAU,cs=Math.cos(a),sn=Math.sin(a);
      const height=(.8+random(i,451)*1.5)*(1-Math.exp(-local*30)),fade=1-ease(local/.36);
      this.energy.curve([px-cs*1.4,py+.05,pz-sn*1.4],[px-sn*.4,py+height*.35,pz+cs*.4],
        [px+sn*.8,py+height,pz-cs*.8],[px+cs*.9,py+.3,pz+sn*.9],
        .30+random(i,452)*.25,i%3?0x5ee5ad:0xd0ed9c,fade,i+450,.7);
    }
    const sites=[[-6.4,-3.3],[.7,-7.5],[6.2,-2.0],[4.1,5.0],[-3.8,6.1],[-7.0,1.8],[6.7,2.3],[-2.7,-6.3]];
    for(let k=0;k<this.outcrops.length;k++){
      const p=cast.pulses[k+1]!,a=(age-p.at)/1000,site=sites[k]!,len=Math.hypot(...site),cs=site[0]!/len,sn=site[1]!/len;
      const rise=ease((a+.48)/(.53+random(k,89)*.27));
      const start=3430+random(k,90)*260,fall=Math.pow(clamp((Math.min(age,timing.collapse)-start)/(timing.collapse-start)),2.65);
      const height=[4.5,5.2,4.0,5.5,3.8][k]!,width=[1.25,1.4,1.25,1.0,1.25][k]!;
      const skid=Math.sin(fall*Math.PI)*(.15+random(k,93)*.6)*(k%2?1:-1);
      const px=x+site[0]!*(1-fall*.85)-sn*skid,pz=z+site[1]!*(1-fall*.85)+cs*skid,py=this.ground(px,pz);
      const crag=this.outcrops[k]!,release=Math.max(0,collapse-random(k,94)*.09);
      crag.visible=rise>.002&&collapse<2.35;
      crag.position.set(px,py-height*.94*(1-rise)-fall*.38,pz);
      crag.rotation.set(-fall*sn*(.7+random(k,97)*.4),k*1.17+fall*(random(k,96)-.5)*.4,fall*cs*(.75+random(k,95)*.3));
      crag.scale.set(width,height,1.35+random(k,94)*.7);
      crag.material.opacity=1-ease((collapse-1.55)/.8);this.collapses[k]!.value=release;
      (crag.userData['fractureFloor'] as {value:number}).value=py;
      (crag.userData['fractureFade'] as {value:number}).value=crag.material.opacity;
      crag.updateWorldMatrix(true,false);
      (crag.userData['fractureInverse'] as {value:THREE.Matrix4}).value.copy(crag.matrixWorld).invert();
      // Fine chips originate on each actual slab. Their trails follow the slab's fall.
      const verts=crag.geometry.getAttribute('position'),point=new THREE.Vector3();
      for(let i=0;i<720;i++){
        const vi=Math.floor(random(i,k+118)*verts.count),flight=release,spread=random(i,k+119);
        point.fromBufferAttribute(verts,vi).multiplyScalar(.85+spread*.15).applyMatrix4(crag.matrix);
        const side=random(i,k+120)*2-1;
        const fx=point.x+(cs*side*3-sn*spread)*flight,fz=point.z+(sn*side*3+cs*spread)*flight;
        const h=Math.max(this.ground(fx,fz)+.03,point.y+flight*(7+spread*13)-8*flight*flight);
        if(i%7===0)this.fragments.put(fx,h,fz,.025+random(i,k+122)**2*.07,0x747b65,finish*rise,i+k*720);
        else this.light.put(fx,h,fz,.014+random(i,k+123)*.026,i%8?0x43d99a:0xe5ffc2,
          finish*rise*(collapse<0?.68:.80),i,1.3,2.6);
      }
      if(rise>.05){
        const slipping=Math.sin(fall*Math.PI),dustFade=collapse<0?.38+slipping*.25:(1-ease(collapse/1.8))*.8;
        this.haze.put(px-cs*.8,py+.3+Math.max(0,collapse)*.9,pz-sn*.8,
          width*.9+Math.max(0,collapse),.55+slipping+Math.max(0,collapse)*.7,1.3,charge*dustFade*.7,k,py);
      }
    }
    // Broad mineral currents gather between the five stone anchors, then whip into the collision.
    // Each follows a different spatial bend and carries a small dense trail of enchanted grit.
    const draw=ease((age-700)/600)*(1-ease(collapse/.24));
    if(draw>.01)for(let k=0;k<7;k++){
      const site=sites[k]!,r=Math.hypot(...site),cs=site[0]!/r,sn=site[1]!/r;
      const gather=ease((age-1600-k*95)/2300),curl=[1.8,-2.6,.9,2.9,-1.3,-2.1,1.4][k]!;
      const tipRadius=r*(1-gather*.96),h=(1.0+random(k,410)*3.1)*(1-pull*.55);
      const a:Vec3=[x+site[0]!,this.ground(x+site[0]!,z+site[1]!)+.10,z+site[1]!];
      const b:Vec3=[x+cs*r*.68-sn*curl,y+h*.50,z+sn*r*.68+cs*curl];
      const c:Vec3=[x+cs*tipRadius-sn*curl*.35,y+h,z+sn*tipRadius+cs*curl*.35];
      const d:Vec3=[x+cs*tipRadius,y+.45+pull*1.25,z+sn*tipRadius];
      const width=(.24+random(k,411)*.30)*(1+pull*.40),opacity=draw*(.6+random(k,412)*.3);
      this.energy.curve(a,b,c,d,width,k%3?0x36d998:0xa5e88a,opacity,k+410,.62);
      for(let i=0;i<360;i++){
        const u=(random(i,k+413)+t*(.42+random(k,414)*.2))%1,v=1-u;
        const px=v*v*v*a[0]+3*v*v*u*b[0]+3*v*u*u*c[0]+u*u*u*d[0];
        const py=v*v*v*a[1]+3*v*v*u*b[1]+3*v*u*u*c[1]+u*u*u*d[1];
        const pz=v*v*v*a[2]+3*v*v*u*b[2]+3*v*u*u*c[2]+u*u*u*d[2];
        const spread=random(i,k+415)*width,turn=random(i,k+416)*TAU;
        this.light.put(px-sn*Math.cos(turn)*spread,py+Math.sin(turn)*spread,pz+cs*Math.cos(turn)*spread,
          .016+random(i,k+417)*.019,i%9?0x67eab3:0xe3f8ba,opacity*(.5+u*.5),i+k*360,1.35,2.3);
      }
    }
    if(collapse>=0){
      const impulse=1-ease((collapse-.45)/1.0),up=1-Math.exp(-collapse*18);
      // The compressed magic breaks upward into unequal, torn jade folds rather than more boulders.
      if(collapse<1.05)for(let k=0;k<4;k++){
        const angle=[.4,2.0,3.8,5.4][k]!,cs=Math.cos(angle),sn=Math.sin(angle),r=(.35+collapse*3)*(1+random(k,440)*.5);
        const height=(3.8+random(k,441)*3.4)*up*(1-collapse*.55),f=1-ease((collapse-.3)/.75);
        const a:Vec3=[x+cs*.35,y+.18,z+sn*.35],d:Vec3=[x+cs*r-sn*.8,y+height*.88,z+sn*r+cs*.8];
        this.energy.curve(a,[x+cs*.8,y+height*.35,z+sn*.8],
          [x+cs*r+sn*.7,y+height,z+sn*r-cs*.7],d,.48+random(k,442)*.42,
          k%2?0x29d995:0xb5ed94,f*.95,k+440,.72);
      }
      for(let k=0;k<4;k++){
        const px=x+[-1.2,1.8,.4,-.6][k]!,pz=z+[.2,-.8,1.5,-1.8][k]!;
        this.haze.put(px,y+.6+collapse*(1.8+random(k,221)),pz,
          1.5+collapse,1.1+collapse*.9,1.2+collapse*.8,impulse*.45,k+220,y);
      }
      for(let i=0;i<6500;i++){
        const flight=collapse-random(i,230)*.12;if(flight<0)continue;
        const angle=random(i,231)*TAU,r=.3+flight*(.7+random(i,232)*3.1);
        const h=.15+(9+random(i,233)*9)*flight-7*flight*flight;if(h<0)continue;
        this.light.put(x+Math.cos(angle)*r,y+h,z+Math.sin(angle)*r,.014+random(i,234)*.026,
          i%9?0x52d896:0xe6ffd0,finish*impulse,i,1.4,2.5);
      }
    }
  }
  private trail(cast:ElementalCast,u:number,arc:number,size:number,count:number):void{
    for(let i=0;i<count;i++){
      const v=u-random(i,13)*.19;if(v<0)continue;
      const x=cast.origin[0]+(cast.aim[0]-cast.origin[0])*v,z=cast.origin[2]+(cast.aim[2]-cast.origin[2])*v;
      const y=cast.origin[1]+1.55+(this.ground(x,z)+(cast.impactHeight??1.5)-cast.origin[1]-1.55)*v+Math.sin(v*Math.PI)*arc;
      this.light.put(x+(random(i,14)-.5)*size,y+(random(i,15)-.5)*size,z+(random(i,16)-.5)*size,.012+random(i,17)*.021,i%7?0x57dc9e:0xdbeabc,.68,i,1.2,1.8);
    }
  }
  private burst(x:number,y:number,z:number,radius:number,t:number,count:number,speed:number,seed:number,grounded=false):void{
    if(t<0||t>1.05)return;
    const fade=1-ease((t-.65)/.4),variant=elementalPulseArt(this.state.variant as ElementalCast["spellId"],seed);
    const front=radius*.6+speed*(1-Math.exp(-t*4))*.48;
    this.flow.put("band","earth",x,this.ground(x,z)+.07,z,front*variant.width,(.45+radius*.17)*variant.lift,front*variant.depth,fade*.52,seed,variant.yaw,0,0,{arc:Math.min(.62,variant.arc),lean:variant.bend});

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
      if(i%6!==0)this.light.put(px,py,pz,.015+random(i,seed+5)*.022,i%5?0x70e5b0:0xe9efd0,fade*.8,i,1.1,2.6);
      else this.fragments.put(px,py,pz,(.018+random(i,seed+5)**2*.075)*fade,i%3?0x777264:0xaba28a,1,i);
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
  dispose():void{this.flow.dispose();this.haze.dispose();this.energy.dispose();this.flint.dispose();this.siege.dispose();for(const mesh of this.forms){mesh.removeFromParent();mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();mesh.customDepthMaterial?.dispose();}}
}
