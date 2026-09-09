import * as THREE from "three";
import type { SpellElement, Vec3 } from "../contracts.js";
import { elementalSpell, ELEMENTAL_SPELLS, type ElementalSpellId } from "../content/elementalSpells.js";
import type { ElementalCast } from "../systems/elementalAttacks.js";

const TAU = Math.PI * 2;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => { const t = clamp(x); return t * t * (3 - 2 * t); };
const palette: Record<SpellElement, [number, number]> = {
  wind: [0x9e9cff, 0xd5f4ff], water: [0x2385ff, 0x86fff1],
  earth: [0x52ce93, 0xe0db9c], fire: [0xff651d, 0xffe2a0],
};

/** Original pen-stroke geometry, not a decal or a camera-facing effect card.
 * Each school has its own central sign and each spell has its own surrounding script.
 * Strokes are tapered and reveal in writing order. Large rituals remain world anchored.
 */
function inscription(element: SpellElement, rank: number, variant: number): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], orders: number[] = [];
  let stroke = 0;
  const line = (points: number[][], width = .017) => {
    const order = stroke++;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!, dx = b[0]! - a[0]!, dy = b[1]! - a[1]!, d = Math.hypot(dx, dy) || 1;
      const w = width * (.55 + .45 * Math.sin(i / points.length * Math.PI)), nx = -dy / d * w, ny = dx / d * w;
      const p = [[a[0]!+nx,a[1]!+ny],[a[0]!-nx,a[1]!-ny],[b[0]!+nx,b[1]!+ny],[b[0]!-nx,b[1]!-ny]];
      for (const k of [0,1,2,2,1,3]) {
        const px=p[k]![0]!,py=p[k]![1]!;
        // Ink hangs on a shallow curved magical surface, including the freestanding gates.
        positions.push(px,py,.028+.025*Math.sin(px*3)*Math.cos(py*2));
        uvs.push(k%2, i/points.length); orders.push(order);
      }
    }
  };
  const arc = (r: number, start: number, end: number, width = .011) => line(Array.from({length:25},(_,i)=>[Math.cos(start+(end-start)*i/24)*r,Math.sin(start+(end-start)*i/24)*r]),width);
  if (element === "wind") {
    const arms=[3,2,4][variant]!;
    for(let k=0;k<arms;k++) line(Array.from({length:17},(_,i)=>{const u=i/16,a=u*(4.8-variant*.55)+k*TAU/arms,r=.08+u*.52;return [Math.cos(a)*r,Math.sin(a)*r];}),.027);
  } else if (element === "water") {
    if(variant!==1)line(Array.from({length:33},(_,i)=>{const a=i/32*TAU;return [Math.sin(a)*(.31-.18*Math.cos(a)),.50*Math.cos(a)];}),.027);
    else line([[-.45,.4],[-.32,-.17],[0,-.4],[.32,-.17],[.45,.4]],.028);
    if(variant===2)line([[0,-.1],[0,.72],[-.16,.5],[0,.72],[.16,.5]],.018);
    for(let k=0;k<2;k++)line(Array.from({length:17},(_,i)=>{const x=i/16*1.15-.575;return [x,Math.sin(x*5+k*.7)*.10-.25-k*.13];}),.020);
  } else if (element === "earth") {
    line([[-.52,-.35],[-.12-variant*.07,.46-variant*.07],[.09,.05],[.31,.33+variant*.12],[.56,-.35],[-.52,-.35]],.032);
    if(variant)line([[-.25,-.1],[0,.20],[.25,-.1]],.018);
    line([[-.29,-.50],[0,-.68],[.29,-.50]],.024); line([[0,-.25],[0,.01]],.034);
  } else {
    line([[-.43,-.38],[-.32,.02+variant*.12],[-.12,.18],[.05,.61],[.16,.19],[.38,-.04+variant*.18],[.44,-.38],[.10,-.58],[-.18,-.55],[-.43,-.38]],.026);
    line([[-.08,-.32],[.04,.03],[.18,-.29],[.06,-.43],[-.08,-.32]],.023);
  }
  const sections = (rank < 2 ? 2 : rank === 5 ? 5 : rank)+variant;
  for(let k=0;k<sections;k++) arc(.76,k*TAU/sections+.07,(k+1)*TAU/sections-.10,.010);
  // Unequal hand-authored rune stems, hooks and diamonds. No Latin labels or sci-fi grids.
  const runes=6+rank*2+variant;
  for(let k=0;k<runes;k++) {
    const a=k*TAU/runes+rank*.13, r=.95, c=Math.cos(a),s=Math.sin(a);
    const transform=(p:number[])=>[c*(r+p[1]!)-s*p[0]!,s*(r+p[1]!)+c*p[0]!];
    const glyph = (k+rank+variant)%4;
    const points = glyph===0?[[-.05,-.05],[0,.10],[.05,-.05],[0,0],[-.05,-.05]]:
      glyph===1?[[-.05,.04],[0,.10],[0,-.09],[.06,-.03]]:
      glyph===2?[[-.05,-.07],[.04,.07],[-.04,.07],[.05,-.07]]:
      [[-.06,.02],[0,.10],[.06,.02],[0,-.08],[-.06,.02]];
    line(points.map(transform),.013);
  }
  if(rank>=3)for(let k=0;k<4;k++)arc(1.13,k*Math.PI/2+.09,k*Math.PI/2+.72,.008);
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2));
  g.setAttribute("scriptOrder",new THREE.Float32BufferAttribute(orders.map(n=>n/Math.max(1,stroke-1)),1));
  return g;
}

/** Fantasy spell grammar: invocation, enchanted focus, a spell-specific rite, contact seal.
 * Supplements elemental matter; it never changes the attack's damage clock or camera.
 */
export class ArcaneSpellVfx {
  private readonly signs = new Map<string, THREE.InstancedMesh<THREE.BufferGeometry,THREE.ShaderMaterial>>();
  private readonly cores: THREE.InstancedMesh<THREE.BufferGeometry,THREE.ShaderMaterial>;
  private readonly object = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly clock={value:0};
  dropped=0;
  readonly state={rite:"",inscriptions:0,cores:0};
  constructor(parent:THREE.Object3D,private readonly ground:(x:number,z:number)=>number) {
    for(const spell of ELEMENTAL_SPELLS) for(let variant=0;variant<3;variant++) {
      const g=inscription(spell.element,spell.rank,variant);
      g.setAttribute("riteLife",new THREE.InstancedBufferAttribute(new Float32Array(24*4),4).setUsage(THREE.DynamicDrawUsage));
      const material=new THREE.ShaderMaterial({
        uniforms:{time:this.clock,tint:{value:new THREE.Color(palette[spell.element][0])},gold:{value:new THREE.Color(palette[spell.element][1])}},
        transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
        vertexShader:`attribute vec4 riteLife;attribute float scriptOrder;varying vec4 vLife;varying vec2 vUv;varying float vOrder;
          void main(){vLife=riteLife;vUv=uv;vOrder=scriptOrder;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
        fragmentShader:`uniform float time;uniform vec3 tint,gold;varying vec4 vLife;varying vec2 vUv;varying float vOrder;
          void main(){float reveal=1.-smoothstep(vLife.y-.13,vLife.y+.04,vOrder);
            float ink=.78+.22*sin(vOrder*31.-time*4.+vLife.z);
            float a=vLife.x*reveal*ink;if(a<.006)discard;
            vec3 c=mix(tint,gold,vLife.w)*3.3+gold*pow(.5+.5*sin(vOrder*15.-time*3.),12.)*1.2;
            gl_FragColor=vec4(c,a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      });
      const mesh=new THREE.InstancedMesh(g,material,24);mesh.count=0;mesh.visible=false;mesh.frustumCulled=false;
      mesh.name=`elemental-arcane-inscription-${spell.id}-${variant}`;mesh.userData["magicGlow"]=true;mesh.userData["magicGlowOnly"]=true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);parent.add(mesh);this.signs.set(`${spell.id}:${variant}`,mesh);
    }
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
  get instances():number{return this.state.inscriptions+this.state.cores;}
  begin(seconds:number):void {this.clock.value=seconds;this.dropped=0;this.cores.count=0;for(const m of this.signs.values())m.count=0;this.state.rite="";this.state.inscriptions=0;this.state.cores=0;}
  private sign(id:ElementalSpellId,p:Vec3,r:number,alpha:number,reveal=1,yaw=0,upright=false,gold=0,stretch=1,variant=0):void {
    if(alpha<.01||r<.02)return;const m=this.signs.get(`${id}:${variant%3}`)!,i=m.count;if(i===24){this.dropped++;return;}
    this.object.position.set(...p);this.object.rotation.set(upright?0:-Math.PI/2,upright?yaw:0,upright?0:yaw);this.object.scale.set(r,r*stretch,r);this.object.updateMatrix();m.setMatrixAt(i,this.object.matrix);
    (m.geometry.getAttribute("riteLife") as THREE.InstancedBufferAttribute).setXYZW(i,alpha,reveal*1.18,i,gold);m.count++;this.state.inscriptions++;
  }
  private core(element:SpellElement,p:Vec3,r:number,alpha:number,stretch:Vec3=[1,1,1]):void {
    if(alpha<.01||r<.005)return;const i=this.cores.count;if(i===64){this.dropped++;return;}
    this.object.position.set(...p);this.object.rotation.set(0,0,0);this.object.scale.set(r*stretch[0],r*stretch[1],r*stretch[2]);this.object.updateMatrix();this.cores.setMatrixAt(i,this.object.matrix);
    this.color.setHex(palette[element][0]);(this.cores.geometry.getAttribute("coreTint") as THREE.InstancedBufferAttribute).setXYZW(i,this.color.r,this.color.g,this.color.b,alpha);this.cores.count++;this.state.cores++;
  }
  update(cast:ElementalCast,now:number,focus?:Vec3):void {
    const def=elementalSpell(cast.spellId),id=def.id,element=def.element,rank=def.rank,age=now-cast.started,t=age/1000,
      first=cast.pulses[0]!,last=cast.pulses.at(-1)!.at;
    if(age<0||age>last+1000)return;
    this.state.rite=id;
    const [x,,z]=cast.aim,y=this.ground(x,z),[ox,oy,oz]=cast.origin,yaw=Math.atan2(x-ox,z-oz),fx=Math.sin(yaw),fz=Math.cos(yaw);
    const hand:Vec3=focus??[ox+fx*.6+fz*.28,oy+1.3,oz+fz*.6-fx*.28];
    const gathering=ease(age/95)*(1-ease((age-Math.min(600,first.at*.65))/240));
    if(gathering>.01){
      this.core(element,hand,rank===0?.12:.20+rank*.035,gathering*.9);
      if(rank>0) {
        this.sign(id,[ox,this.ground(ox,oz)+.045,oz],1.25+rank*.13,gathering*.56,ease(age/230),yaw,false,.40);
        this.sign(id,hand,.38+rank*.04,gathering*.60,ease(age/140),yaw,true,.15);
      }
    }
    // Starter incantations have a single small enchanted heart, then a brief contact glint.
    if(rank===0){
      const u=clamp((age-100)/(first.at-100)),a=(age-first.at)/1000;
      if(age>100&&a<0&&element!=="earth")this.core(element,[ox+(x-ox)*u,oy+1.18+(y-oy)*u,z+(oz-z)*(1-u)],.11, .72);
      if(a>=0&&a<.3)this.core(element,[x,y+1.05,z],.11+Math.sin(a/.3*Math.PI)*.18,(1-a/.3)*.62);
      return;
    }
    const target:Vec3=[x,y+.06,z];
    // These are composed rites, not one ring instantiated for every damage pulse.
    switch(id){
      case "air-needle": {
        const u=clamp((age-150)/(first.at-150));
        if(age>150&&age<first.at){const bend=Math.sin(u*Math.PI)*.32;this.core(element,[ox+(x-ox)*u+fz*bend,y+1.35,oz+(z-oz)*u-fx*bend],.20,.58,[.7,.7,1.5]);}
        this.contact(cast,age,0,1.15,yaw,true);break;
      }
      case "razor-crescent":
        for(let i=0;i<3;i++)this.contact(cast,age,i,1.15+i*.18,yaw+(i-1)*.55,true,.75+(i%2)*.45);break;
      case "vacuum-coil": {
        const f=ease((age-100)/350)*(1-ease((age-last)/650));
        this.sign(id,target,4.8,f*.48,ease(age/500),-.12*t,false,.12);
        // Three levitating binding signs lean into an empty eye, then sink as it collapses.
        for(let i=0;i<3;i++){const a=i*TAU/3+t*.24,r=3.8*(1-ease((age-last)/500));this.sign(id,[x+Math.cos(a)*r,y+1.0+Math.sin(t*3+i)*.14,z+Math.sin(a)*r],.68,f*.48,1,-a,true,.40);}
        if(age>=last)this.core(element,[x,y+.8,z],.55+ease((age-last)/180)*.9,(1-ease((age-last)/340))*.60,[1,.6,1]);break;
      }
      case "thunder-lance": {
        const f=ease((age-110)/160)*(1-ease((age-850)/220));
        // A vertical heraldic gate is held in front of the staff as the bore is released.
        this.sign(id,[ox+fx*1.5,oy+1.5,oz+fz*1.5],1.05,f*.64,ease(age/220),yaw,true,.12);
        for(let i=0;i<cast.pulses.length;i++)this.contact(cast,age,i,.9+(i%3)*.2,yaw,true,.75+(i%2)*.35);break;
      }
      case "skybreaker": {
        const f=ease((age-120)/450)*(1-ease((age-last)/750));
        this.sign(id,target,7.8,f*.38,ease(age/700),-.055*t,false,.10);
        // A wide, five-point storm ward anchors the violent wedge to the summoned site.
        for(let i=0;i<5;i++){const a=i*TAU/5+.3;this.sign(id,[x+Math.cos(a)*7.8,y+.18,z+Math.sin(a)*7.8],1.0,f*.56,1,a,false,.55);}
        break;
      }
      case "waterjet":
        this.contact(cast,age,0,1.4,yaw,true);this.contact(cast,age,1,1.05,yaw+.5,true,1.3);break;
      case "tidal-fan":
        for(let i=0;i<5;i++)this.contact(cast,age,i,.95+(i%3)*.18,yaw+(i-2)*.25,true,.75+(i%2)*.40);break;
      case "geyser-chain":
        for(let i=0;i<cast.pulses.length;i+=2){const p=cast.pulses[i]!,a=age-p.at,f=ease((a+420)/240)*(1-ease((a-100)/650));this.sign(id,[p.point[0],this.ground(p.point[0],p.point[2])+.05,p.point[2]],2.2+(i%3)*.3,f*.58,ease((a+400)/350),i*.8,false,.12,1+(i%2)*.2);}
        break;
      case "undertow": {
        const f=ease(age/500)*(1-ease((age-last)/700));this.sign(id,target,5.6,f*.42,ease(age/650),t*.10,false,.05);
        for(let i=0;i<3;i++){const a=t*.8+i*TAU/3,r=4*(1-ease((age-last+250)/650));this.core(element,[x+Math.cos(a)*r,y+.35,z+Math.sin(a)*r],.22,f*.75,[1,.5,1]);}
        break;
      }
      case "deluge": {
        const f=ease((age-50)/500)*(1-ease((age-950)/450));
        // A water temple's three arched gates awaken in sequence along the wave's breadth.
        for(let i=0;i<3;i++)this.sign(id,[x+(i-1)*5.3,y+2.5,z-5],2.05,f*.44,ease((age-i*120)/450),yaw,true,.12,1.15+(i===1?.25:0),i);break;
      }
      case "flint-shot": case "siege-boulder": {
        const big=id==="siege-boulder",u=clamp((age-(big?320:90))/(first.at-(big?320:90))),a=(age-first.at)/1000;
        const py=oy+1.55+(y+(big?2.05:.68)*.84-oy-1.55)*u+Math.sin(u*Math.PI)*(big?7.2:1.7);
        if(age>(big?320:90)&&a<0){const q:Vec3=[ox+(x-ox)*u,py,oz+(z-oz)*u];this.sign(id,q,big?2.65:.93,.66,1,yaw+t*.25,true,.36);if(big)this.sign(id,q,2.65,.42,1,yaw+Math.PI/2,true,.10);}
        if(a>=0)this.sign(id,target,big?5.7:1.75,(1-ease(a/.75))*.57,1,yaw,false,.20);break;
      }
      case "faultline":
        for(let i=0;i<cast.pulses.length;i++){const p=cast.pulses[i]!,a=age-p.at;this.sign(id,[p.point[0],this.ground(p.point[0],p.point[2])+.05,p.point[2]],1.15+(i%3)*.2,(ease((a+250)/160)*(1-ease((a-120)/650)))*.50,ease((a+250)/200),yaw+i*.3,false,.30,.75+(i%2)*.5);}break;
      case "basalt-jaw": {
        const f=ease(age/430)*(1-ease((age-last)/600));this.sign(id,target,4.65,f*.52,ease(age/600),yaw,false,.26);
        for(const side of [-1,1])this.sign(id,[x+side*3.5,y+2.5,z],1.75,f*.40,ease(age/500),side*Math.PI/2,true,.36,1.2);break;
      }
      case "mountainfall": {
        const f=ease(age/600)*(1-ease((age-last)/850));this.sign(id,target,8.2,f*.42,ease(age/800),yaw,false,.28);
        for(let i=0;i<4;i++){const a=i*Math.PI/2+.4;this.sign(id,[x+Math.cos(a)*6.7,y+1.1,z+Math.sin(a)*6.7],1.35,f*.58,ease((age-i*90)/650),-a,true,.44);}
        break;
      }
      case "ember-dart": {
        const u=clamp((age-90)/460);if(age>90&&age<550)this.core(element,[ox+(x-ox)*u,y+1.4,oz+(z-oz)*u],.26,.85);
        this.contact(cast,age,0,1.25,yaw,true);break;
      }
      case "furnace-whip":
        for(let i=0;i<cast.pulses.length;i++)this.contact(cast,age,i,1.0+(i%3)*.18,yaw+i*.34,true,.75+(i%2)*.4);break;
      case "cinder-mine": {
        const f=ease(age/400)*(1-ease((age-first.at)/480));this.sign(id,target,3.9*(1-ease(age/1800)*.55),f*.62,ease(age/600),-.14*t,false,.45);
        if(age<first.at)this.core(element,[x,y+.3,z],.15+ease(age/first.at)*.45,f*.8);
        if(age>=first.at)this.sign(id,target,5.7,(1-ease((age-first.at)/750))*.60,1,.2,false,.30);break;
      }
      case "phoenix-pass": {
        const f=ease(age/250)*(1-ease((age-950)/300));this.sign(id,[ox+fx*2.3,oy+2.2,oz+fz*2.3],1.85,f*.62,ease(age/300),yaw,true,.55,1.15);
        // The returning bird leaves three separate feather-shaped invocations, not ten clones.
        for(const i of [1,4,8])this.contact(cast,age,i,1.15+i*.055,yaw+(i%3)*.6,true,.70);break;
      }
      case "starfall": {
        const f=ease(age/500)*(1-ease((age-last)/850));this.sign(id,target,8.1,f*.42,ease(age/800),.08*t,false,.55);
        const descent=ease((age-550)/2150),h=y+2.8+(1-descent)*6;
        if(age<last){this.sign(id,[x,h,z],4.05,f*.56,1,-.12*t,false,.72);this.core(element,[x,h,z],1.8,f*.75);}
        // Each coronal contact is a short consecrating flare of a different aspect ratio.
        for(let i=0;i<9;i++) {const p=cast.pulses[i]!,a=(age-p.at)/1000;if(a>=0&&a<.30)this.core(element,[p.point[0],y+.6,p.point[2]],.5+(i%3)*.15,(1-a/.30)*.7,[.7,1.3+(i%2)*.5,.7]);}
        break;
      }
    }
  }
  private contact(cast:ElementalCast,age:number,index:number,r:number,yaw:number,upright:boolean,stretch=1):void {
    const p=cast.pulses[index]!;const a=(age-p.at)/1000;if(a<0||a>.55)return;
    const y=this.ground(p.point[0],p.point[2]),f=1-ease(a/.55);
    this.sign(cast.spellId,[p.point[0],y+(upright?1.2:.06),p.point[2]],r*(.8+ease(a/.3)*.35),f*.65,1,yaw,upright,.12,stretch,index);
    if(a<.22)this.core(elementalSpell(cast.spellId).element,[p.point[0],y+1.2,p.point[2]],r*.3*(.7+ease(a/.14)),(1-a/.22)*.66);
  }
  end():void {for(const m of [...this.signs.values(),this.cores]){m.visible=m.count>0;m.instanceMatrix.needsUpdate=true;const a=m.geometry.getAttribute(m===this.cores?"coreTint":"riteLife");a.needsUpdate=true;}}
  dispose():void {for(const m of [...this.signs.values(),this.cores]){m.removeFromParent();m.geometry.dispose();m.material.dispose();}}
}
