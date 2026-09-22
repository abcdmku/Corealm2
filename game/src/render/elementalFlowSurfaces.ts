import * as THREE from "three";
import type { SpellElement } from "../contracts.js";
import { MeshBasicNodeMaterial, type Node } from "three/webgpu";
import {
  Fn, If, abs, attribute, buffer, clamp, cos, float, fract, instanceIndex, max,
  mix, mod, normalLocal, normalViewGeometry, positionViewDirection, pow, sin,
  smoothstep, uniform, uv, varying, vec2, vec3, vec4,
} from "three/tsl";
import { authoredFlow, clockUniform, flameColor, flameDetail, flameNoise } from "./elementalNodes.js";

type Shape = "band" | "shell" | "funnel" | "plume";
export interface FlowProfile { foot?:number; arc?:number; lean?:number; twist?:number; }
const kinds: Record<SpellElement,number> = {wind:0,water:1,earth:2,fire:3};

/** Curved, eroding impact sheets and flowing envelopes. 576 triangles per surface. */
export class ElementalFlowSurfaces {
  private readonly batches = new Map<Shape,THREE.InstancedMesh<THREE.BufferGeometry,MeshBasicNodeMaterial>>();
  private readonly pose = new THREE.Object3D();
  private readonly clock = {value:0};
  dropped = 0;
  constructor(parent: THREE.Object3D) {
    for (const [shape,shapeId] of [["band",0],["shell",1],["funnel",2],["plume",3]] as const) {
      const g=new THREE.PlaneGeometry(1,1,36,8);
      // Store the resting spatial form too, so bounds and geometry inspection describe
      // the rendered surface. The vertex shader adds its time-varying flow deformation.
      const positions=g.getAttribute("position"),uvs=g.getAttribute("uv");
      for(let i=0;i<positions.count;i++){
        const u=uvs.getX(i),v=uvs.getY(i),a=u*Math.PI*2;
        const r=shape==="band"?.48+v*.52:shape==="shell"?Math.sin(v*Math.PI):shape==="funnel"?.09+.91*Math.pow(v,1.15):(.23+Math.sin(v*Math.PI)*.5)*(1-v*.7);
        const y=shape==="band"?Math.sin(v*Math.PI)*.5:shape==="shell"?Math.cos(v*Math.PI):v;
        positions.setXYZ(i,Math.cos(a)*r,y,Math.sin(a)*r);
      }
      g.computeVertexNormals();
      g.setAttribute("flowLife",new THREE.InstancedBufferAttribute(new Float32Array(96*4),4).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute("flowProfile",new THREE.InstancedBufferAttribute(new Float32Array(96*4),4).setUsage(THREE.DynamicDrawUsage));
      const emission=uniform(0);
      const time:Node<"float">=clockUniform(this.clock);
      const material=new MeshBasicNodeMaterial({
        transparent:true,depthWrite:false,side:THREE.DoubleSide,fog:false,alphaTest:.012,
      });
      const mesh=new THREE.InstancedMesh(g,material,96);
      // positionNode follows Three's automatic instance transform. These UV-generated
      // positions replace that result, so apply the instance matrix explicitly.
      const instanceTransform:Node<"mat4">=buffer(mesh.instanceMatrix.array,"mat4" as const,96).element(instanceIndex);
      const life:Node<"vec4">=attribute("flowLife","vec4" as const);
      const profile:Node<"vec4">=attribute("flowProfile","vec4" as const);
      material.positionNode=Fn(():Node<"vec3">=>{
        const u=uv().x,v=uv().y,seed=life.z;
        const angle=u.mul(6.2831853).mul(profile.y).toVar();
        const turbulent=sin(angle.mul(5).add(v.mul(9)).sub(time.mul(2.3)).add(seed)).mul(.055)
          .add(sin(angle.mul(11).sub(v.mul(7)).add(time.mul(3.7)).add(seed)).mul(.024));
        const radius=float(0).toVar(),height=float(0).toVar();
        if(shapeId===0){
          radius.assign(v.mul(.52).add(.48).add(turbulent.mul(v.mul(.8).add(.2))));
          height.assign(sin(v.mul(3.14159)).mul(turbulent.mul(3).add(.5)));
        }else if(shapeId===1){
          radius.assign(sin(v.mul(3.14159)).mul(turbulent.mul(1.8).add(1)));
          height.assign(cos(v.mul(3.14159)));
          angle.addAssign(sin(v.mul(9).add(time.mul(1.2))).mul(.09));
        }else if(shapeId===2){
          radius.assign(profile.x.add(float(1).sub(profile.x).mul(pow(v,1.15))).mul(turbulent.mul(1.8).add(1)));
          height.assign(v);
          angle.addAssign(v.mul(7).mul(profile.w).sub(time.mul(1.8)));
        }else{
          radius.assign(sin(v.mul(3.14159)).mul(.5).add(.23).mul(float(1).sub(v.mul(.7))).mul(turbulent.mul(2).add(1)));
          height.assign(v);
          angle.addAssign(v.mul(5).sub(time));
          If(life.x.greaterThan(2.5),()=>{
            radius.assign(sin(v.mul(3.14159)).mul(.13).add(.3).mul(pow(max(.001,float(1).sub(v)),.85)).mul(turbulent.mul(2.5).add(1)));
            const flutter=fract(sin(seed.mul(31.7)).mul(43758.5453)).mul(.62).add(.72);
            angle.addAssign(sin(v.mul(flutter.mul(2).add(5.3)).sub(time.mul(3).mul(flutter)).add(seed)).mul(.32).mul(v));
          });
        }
        const p=vec3(cos(angle).mul(radius),height,sin(angle).mul(radius)).toVar();
        p.x.addAssign(profile.z.mul(height).mul(height).mul(.3));
        p.y.mulAssign(sin(angle.mul(mod(seed,4).add(3)).add(seed)).mul(.13).mul(abs(profile.z)).add(1));
        if(shapeId>=2){
          p.x.addAssign(sin(v.mul(4).add(time.mul(1.4)).add(seed)).mul(v).mul(.13));
          p.z.addAssign(cos(v.mul(5).sub(time).add(seed)).mul(v).mul(.1));
          If(life.x.greaterThan(2.5),()=>{
            p.x.addAssign(sin(v.mul(5).sub(time.mul(4.1)).add(seed)).mul(v).mul(v).mul(.3));
            p.z.addAssign(cos(v.mul(7).sub(time.mul(3.3)).add(seed)).mul(v).mul(v).mul(.2));
          });
        }
        if(shapeId===3){
          If(life.x.greaterThan(2.5),()=>{
            // Preserve the open, folded flame cloth and its unequal crown.
            const r0=fract(sin(seed.mul(17.13).add(4.7)).mul(43758.5453));
            const r1=fract(sin(seed.mul(43.71).add(1.3)).mul(31317.31));
            const clock=time.mul(r0.mul(1.4).add(1.25)),cross=u.sub(.5);
            const crown=sin(u.mul(r0.mul(3).add(3.7)).add(seed)).mul(.23).add(.62)
              .add(sin(u.mul(r1.mul(4).add(8.1)).sub(seed.mul(.7))).mul(.15));
            const bend=sin(v.mul(3.8).sub(clock).add(seed)).mul(v).mul(v);
            p.assign(vec3(cross.mul(float(1.3).sub(v.mul(.45))),v.mul(crown.mul(.45).add(.78)),0));
            p.x.addAssign(bend.mul(r0.mul(.34).add(.18)).add(profile.z.mul(v).mul(v).mul(.16)));
            p.y.subAssign(pow(v,4).mul(r1.mul(.22).add(.12)));
            p.z.assign(sin(u.mul(r1.mul(3).add(3.4)).add(v.mul(4.1)).add(seed)).mul(v.mul(.23).add(.13)).add(bend.mul(.27)));
            p.z.addAssign(cross.mul(cross).mul(r0.sub(.5)).mul(1.8));
          });
        }
        const normal=vec3(cos(angle),.3,sin(angle)).normalize();
        normalLocal.assign(instanceTransform.mul(vec4(normal,0)).xyz);
        return instanceTransform.mul(vec4(p,1)).xyz;
      })();
      const fragmentLife=varying(life),fragmentProfile=varying(profile);
      material.colorNode=Fn(():Node<"vec4">=>{
        const u=uv().x,v=uv().y,kind=fragmentLife.x;
        let flowUv:Node<"vec2">=vec2(u.mul(3),v.mul(1.2));
        if(shapeId===0)flowUv=vec2(u.mul(4),v.mul(.68));
        else if(shapeId===2)flowUv=vec2(v.mul(2.2),u.mul(3.5).sub(v.mul(4)).sub(time.mul(.95)));
        const n=authoredFlow(flowUv,time.mul(kind.lessThan(.5).select(1.9,1)),fragmentLife.z).toVar();
        If(kind.greaterThan(2.5),()=>{
          n.assign(flameDetail(vec2(u.mul(1.27).add(sin(v.mul(5).sub(time.mul(3)).add(fragmentLife.z)).mul(.045)),v.mul(.86)),time,fragmentLife.z));
        });
        let envelope:Node<"float">=float(1);
        if(shapeId===0)envelope=smoothstep(0,.16,v).mul(float(1).sub(smoothstep(.84,1,v)));
        else if(shapeId>=2)envelope=smoothstep(0,.07,v).mul(float(1).sub(smoothstep(.65,1,v)));
        const density=smoothstep(.08,.52,n),ridge=smoothstep(.4,.72,n);
        const alpha=fragmentLife.y.mul(density).mul(envelope).toVar();
        const arcFade=smoothstep(0,.09,u).mul(float(1).sub(smoothstep(.83,1,u)));
        If(fragmentProfile.y.lessThan(.99),()=>{alpha.mulAssign(arcFade);});
        const current=pow(sin(n.mul(24).add(v.mul(8)).sub(time.mul(4.2)).add(fragmentLife.z)).mul(.5).add(.5),10).mul(ridge);
        const fresnel=pow(float(1).sub(abs(normalViewGeometry.normalize().dot(positionViewDirection))),2);
        const color=vec3(0).toVar(),energy=vec3(0).toVar();
        If(kind.lessThan(.5),()=>{
          color.assign(mix(vec3(.022,.055,.095),vec3(.2,.39,.49),density));
          color.assign(mix(color,vec3(.72,.9,.98),current.mul(.7)));
          energy.assign(vec3(.1,.35,.82).mul(ridge).mul(.5).add(vec3(.6,1.35,2.2).mul(current).mul(1.2)));
          alpha.mulAssign(fresnel.mul(.28).add(.54));
        }).ElseIf(kind.lessThan(1.5),()=>{
          color.assign(mix(vec3(.005,.055,.3),vec3(.045,.39,.82),density));
          color.assign(mix(color,vec3(.62,.91,.97),ridge.mul(.65)));
          energy.assign(vec3(.025,.24,1.2).mul(ridge).mul(.8).add(vec3(.22,2.1,2.6).mul(current).mul(1.65)));
          color.assign(mix(color,mix(vec3(.26,.63,.72),vec3(.87,.98,1),density),fragmentLife.w));
          alpha.mulAssign(mix(1,smoothstep(.14,.46,n),fragmentLife.w));
        }).ElseIf(kind.lessThan(2.5),()=>{
          color.assign(mix(vec3(.08,.075,.058),vec3(.4,.39,.24),density));
          energy.assign(vec3(.14,.46,.27).mul(ridge).mul(.55).add(vec3(.3,1.15,.67).mul(current).mul(1.2)));
        }).Else(()=>{
          const breakup=flameNoise(vec2(u.mul(5.3).add(v.mul(.6)),v.mul(2.1).sub(time.mul(1.25))).add(fragmentLife.z));
          const cut=v.mul(.18).add(.1).add(breakup.sub(.5).mul(.22));
          alpha.assign(fragmentLife.y.mul(envelope).mul(smoothstep(cut,cut.add(.17),n)));
          If(fragmentProfile.y.lessThan(.99),()=>{alpha.mulAssign(arcFade);});
          const heat=clamp(n.mul(1.35).add(.05),0,1);
          color.assign(flameColor(heat,v,float(0)));
          energy.assign(flameColor(heat,v,float(1)));
        });
        return vec4(emission.greaterThan(.5).select(energy,color),alpha);
      })();
      material.userData["magicEmissionPass"]=emission;
      mesh.count=0;mesh.visible=false;mesh.frustumCulled=false;mesh.name=`elemental-flow-${shape}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.renderOrder=13;
      mesh.userData["magicGlow"]=true;parent.add(mesh);this.batches.set(shape,mesh);
    }
  }
  begin(seconds:number):void{this.clock.value=seconds;this.dropped=0;for(const m of this.batches.values())m.count=0;}
  put(shape:Shape,element:SpellElement,x:number,y:number,z:number,sx:number,sy:number,sz:number,alpha:number,seed:number,yaw=0,pitch=0,foam=0,profile:FlowProfile={}):void{
    if(alpha<.012||Math.min(sx,sy,sz)<.005)return;
    const m=this.batches.get(shape)!;if(m.count>=96){this.dropped++;return;}
    this.pose.position.set(x,y,z);this.pose.rotation.set(pitch,yaw,0);this.pose.scale.set(sx,sy,sz);this.pose.updateMatrix();
    m.setMatrixAt(m.count,this.pose.matrix);
    (m.geometry.getAttribute("flowProfile") as THREE.InstancedBufferAttribute).setXYZW(m.count,profile.foot??.09,profile.arc??1,profile.lean??0,profile.twist??1);
    (m.geometry.getAttribute("flowLife") as THREE.InstancedBufferAttribute).setXYZW(m.count++,kinds[element],alpha,seed,foam);
  }
  get instances():number{return [...this.batches.values()].reduce((n,m)=>n+m.count,0);}
  end():void{for(const m of this.batches.values()){m.visible=m.count>0;m.instanceMatrix.needsUpdate=true;m.geometry.getAttribute("flowLife").needsUpdate=true;m.geometry.getAttribute("flowProfile").needsUpdate=true;}}
  dispose():void{for(const m of this.batches.values()){m.removeFromParent();m.geometry.dispose();m.material.dispose();}}
}
