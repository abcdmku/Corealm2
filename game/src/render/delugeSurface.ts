import * as THREE from "three";
import { MeshBasicNodeMaterial, type Node } from "three/webgpu";
import * as N from "three/tsl";
import type { Vec3 } from "../contracts.js";
import { FINALE } from "../content/elementalFinales.js";
import { elementalRefractionScene, elementalRefractionViewport, registerElementalRefraction } from "./elementalRefraction.js";
import { authoredFlow } from "./elementalNodes.js";

const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const ease=(x:number)=>{const u=clamp(x);return u*u*(3-2*u);};
const crash=FINALE.deluge.contact+FINALE.deluge.rowGap*2;

// Direction, lift, outward speed, breadth, delay and sideways curl. The collision
// throws different masses of water, leaving air between their upper sheets.
const splashLobes=[
  [.14,9.2,4.8,2.55,0,.7], [.91,4.4,9.0,4.3,.020,-1.1],
  [1.86,7.6,3.6,2.9,.012,1.4], [2.48,3.1,11.2,4.9,.042,-.8],
  [3.32,6.8,5.6,2.3,.006,-1.2], [4.17,4.9,7.6,3.8,.032,.9],
  [5.03,3.6,10.1,4.5,.018,1.3], [5.73,7.3,4.4,2.5,.055,-.6],
] as const;

export function delugeSplashPoint(lobe:number,across:number,v:number,age:number):Vec3 {
  const [angle,height,speed,width,delay,twist]=splashLobes[lobe%splashLobes.length]!;
  const flight=Math.max(0,(age-crash)/1000-delay),rise=1-Math.exp(-flight*24);
  const lift=Math.max(0,height*rise-(5.7+speed*.35)*flight*flight);
  // Unequal helical currents wrap the turbulent collision. Their shared
  // circulation carries momentum from the inward surf into the rising spray.
  const taper=Math.pow(Math.max(0,Math.sin(v*Math.PI)),.65);
  const side=(across-.5)*width*.46*taper*rise;
  const turn=angle+v*(2.1+twist*.42)-flight*(1.8+speed*.08);
  const radial=(.55+v*(2.8+speed*flight*.55))*rise;
  const fold=Math.sin(across*Math.PI*1.8+v*4.2-flight*5+lobe)*.28*taper;
  const radius=radial+fold+side*.40;
  return [Math.cos(turn)*radius+Math.sin(v*5+flight*2+lobe)*v*.26,
    Math.max(.035,.035+v*lift*.85+side-v*v*flight*1.8),
    Math.sin(turn)*radius+Math.cos(v*4-flight*2+lobe)*v*.31];
}

function splashGeometry():THREE.BufferGeometry {
  const positions:number[]=[],uvs:number[]=[],lobes:number[]=[],indices:number[]=[];
  // Eight unjoined patches share the old 2,880-triangle budget.
  for(let lobe=0;lobe<8;lobe++){
    const offset=positions.length/3;
    for(let v=0;v<=30;v++)for(let u=0;u<=6;u++){
      positions.push(0,0,0);uvs.push(u/6,v/30);lobes.push(lobe);
    }
    for(let v=0;v<30;v++)for(let u=0;u<6;u++){
      const a=offset+v*7+u,b=a+7;indices.push(a,b,a+1,a+1,b,b+1);
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  g.setAttribute('splashLobe',new THREE.Float32BufferAttribute(lobes,1));
  g.setIndex(indices);g.computeVertexNormals();return g;
}

// Authored flow stays on the curling liquid geometry. The shared scene-color
// capture supplies refraction without another render or texture copy per sheet.
function delugeFragment(splash:boolean, time:Node<"float">, opacity:Node<"float">):Node<"vec4"> {
  return N.Fn(():Node<"vec4"> => {
    const waterUv=N.uv();
    const u=splash?waterUv.x.add(N.attribute('splashLobe','float')).mul(.283):waterUv.x;
    const v=waterUv.y;
    const flowUv=N.vec2(u.mul(3.8).add(v.mul(.32)),v.mul(.73).sub(time.mul(.63)));
    const body=authoredFlow(flowUv,time.mul(.36),N.float(23)).toVar();
    const detail=authoredFlow(flowUv.mul(2.4).add(N.vec2(body.mul(.28),time.mul(.15))),time.mul(.5),N.float(6)).toVar();
    const gaps=authoredFlow(N.vec2(u.mul(2.3).sub(v.mul(.55)),v.mul(.35)),time.mul(.15),N.float(11)).toVar();
    const stream=N.smoothstep(.06,.36,body.mul(.8).add(detail.mul(.2)));
    const edgeFade=N.smoothstep(0,.045,v).mul(N.smoothstep(.92,1,v).oneMinus());
    const bulk=N.smoothstep(.40,.92,v).oneMinus();
    const coverage=opacity.mul(edgeFade).mul(stream.mul(.16).add(.82))
      .mul(N.mix(N.smoothstep(.045,.21,gaps),.96,bulk.mul(.86))).toVar();
    if(splash){
      const tear=body.mul(.52).add(gaps.mul(.48));
      coverage.mulAssign(N.smoothstep(0,.10,waterUv.x).mul(N.smoothstep(.90,1,waterUv.x).oneMinus()));
      N.If(v.greaterThan(.48).and(tear.lessThan(v.mul(.12).add(.16))),()=>N.Discard());
      coverage.mulAssign(N.mix(.98,N.smoothstep(.18,.37,tear),N.smoothstep(.42,.92,v)));
    }
    N.If(coverage.lessThan(.016),()=>N.Discard());
    const n=N.normalize(N.normalViewGeometry.normalize().add(N.vec3(detail.sub(body),body.sub(.4),detail.sub(.45)).mul(.45))).toVar();
    const fresnel=N.dot(n,N.positionViewDirection).abs().oneMinus().pow(3);
    const shift=n.xy.add(N.vec2(body.sub(.5),detail.sub(.5)).mul(1.4)).mul(17).mul(coverage).div(elementalRefractionViewport);
    const scene=elementalRefractionScene.sample(N.screenUV.add(shift.mul(N.vec2(1,-1))).clamp(.002,.998)).level(N.float(0)).rgb;
    const deep=N.mix(N.vec3(.018,.19,.21),N.vec3(.075,.40,.39),stream);
    const thickness=bulk.mul(.28).add(fresnel.mul(.10)).add(.55);
    const color=N.mix(scene.mul(N.vec3(.67,.92,.96)),deep,thickness).toVar();
    const foam=N.smoothstep(.22,.58,body).mul(N.smoothstep(.20,.60,detail));
    const crest=N.sin(v.mul(Math.PI)).max(0).pow(.7);
    color.assign(N.mix(color,N.vec3(.69,.89,.86),foam.mul(crest).mul(fresnel.mul(.18).add(.74))));
    if(splash){
      color.assign(N.mix(scene.mul(N.vec3(.65,.90,.94)),deep,fresnel.mul(.15).add(.62)));
      color.assign(N.mix(color,N.vec3(.79,.94,.91),foam.mul(N.smoothstep(.28,.88,v)).mul(.80)));
      const impact=time.sub((crash+90)/1000).div(.17).pow(2).negate().exp();
      color.addAssign(N.vec3(.19,.42,.43).mul(impact).mul(foam.mul(.55).add(fresnel.mul(.65)).add(.25)));
    }
    const glint=N.dot(n,N.vec3(-.35,.8,.45).normalize()).max(0).pow(30);
    color.addAssign(N.vec3(.39,.70,.69).mul(glint).mul(.75));
    color.addAssign(N.vec3(.055,.25,.28).mul(detail.pow(3)).mul(crest));
    return N.vec4(color,coverage);
  })();
}

/** One connected surf front. Adjacent points share motion; there are no repeated wave sections. */
export function delugePoint(angle:number,u:number,age:number,splash=false):Vec3 {
  const t=age/1000;
  const swell=Math.sin(angle*2+.8)*.39+Math.sin(angle*3-1.7)*.24+Math.sin(angle*7+.3)*.08;
  if(splash){
    const section=((angle/(Math.PI*2)%1)+1)%1*8;
    return delugeSplashPoint(Math.floor(section),section%1,u,age);
  }
  const localAge=age+swell*170;
  const rise=ease((localAge-250)/1300),pull=Math.pow(clamp((localAge-1650)/(crash-1650)),1.35);
  const radius=10.2*(1-pull)+.65*pull+swell*.9*(1-pull);
  const curl=-Math.PI/2+u*(Math.PI*1.43+Math.sin(angle*3-t*1.1)*.23);
  const breaking=1-ease((age-crash)/220);
  const compression=Math.pow(pull,4.)*(1-ease((age-crash)/130));
  const h=(4.1+swell*1.9)*rise*(1-pull*.14+compression*.40)*breaking;
  const lip=(Math.sin(curl)+1)*.5;
  angle-=pull*pull*1.35+u*pull*.48;
  const r=radius-Math.cos(curl)*(1.65+pull*.75)+Math.sin(angle*5-t*2.3)*u*.14;
  return [Math.cos(angle)*r, .035+lip*h,
    Math.sin(angle)*r];
}

/** 2,880 triangles per connected liquid sheet, deformed without skeletal animation. */
export class DelugeSurface {
  readonly mesh:THREE.Mesh<THREE.BufferGeometry,MeshBasicNodeMaterial>;
  height=0;
  radius=0;
  private readonly clock=N.uniform(0);
  private readonly opacity=N.uniform(0);
  private readonly unregister:()=>void;
  constructor(parent:THREE.Object3D,private readonly splash:boolean){
    const geometry=splash?splashGeometry():new THREE.PlaneGeometry(1,1,80,18);
    (geometry.getAttribute("position") as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    const material=new MeshBasicNodeMaterial({
      transparent:true,depthWrite:false,side:THREE.DoubleSide,toneMapped:false,fog:false,
    });
    material.fragmentNode=delugeFragment(splash,this.clock,this.opacity);
    this.mesh=new THREE.Mesh(geometry,material);this.mesh.name=splash?"elemental-deluge-torn-splash":"elemental-deluge-continuous-surf";
    this.mesh.frustumCulled=false;this.mesh.visible=false;this.mesh.renderOrder=splash?10:9;
    this.unregister=registerElementalRefraction(this.mesh);parent.add(this.mesh);
  }
  hide(){this.mesh.visible=false;this.height=0;this.radius=0;}
  update(x:number,y:number,z:number,age:number,alpha:number){
    this.mesh.visible=alpha>.01;if(!this.mesh.visible)return;
    this.mesh.position.set(x,y,z);this.clock.value=age/1000;this.opacity.value=alpha;
    const positions=this.mesh.geometry.getAttribute("position"),uvs=this.mesh.geometry.getAttribute("uv");
    this.height=0;this.radius=0;
    for(let i=0;i<positions.count;i++){
      const p=this.splash?delugeSplashPoint(this.mesh.geometry.getAttribute('splashLobe').getX(i),uvs.getX(i),uvs.getY(i),age)
        :delugePoint(uvs.getX(i)*Math.PI*2,uvs.getY(i),age);
      positions.setXYZ(i,...p);
      this.height=Math.max(this.height,p[1]);this.radius=Math.max(this.radius,Math.hypot(p[0],p[2]));
    }
    positions.needsUpdate=true;this.mesh.geometry.computeVertexNormals();
  }
  dispose(){this.unregister();this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
