import * as THREE from "three";
import type { SpellElement } from "../contracts.js";
import { elementalFlowTexture, flowSampling } from "./elementalFlowTexture.js";
import { elementalFlameTexture, flameSampling } from "./elementalFlameTexture.js";

type Shape = "band" | "shell" | "funnel" | "plume";
export interface FlowProfile { foot?:number; arc?:number; lean?:number; twist?:number; }
const kinds: Record<SpellElement,number> = {wind:0,water:1,earth:2,fire:3};

/** Curved, eroding impact sheets and flowing envelopes. 576 triangles per surface. */
export class ElementalFlowSurfaces {
  private readonly batches = new Map<Shape,THREE.InstancedMesh<THREE.BufferGeometry,THREE.ShaderMaterial>>();
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
      const emission={value:0};
      const material=new THREE.ShaderMaterial({
        uniforms:{time:this.clock,flowTexture:{value:elementalFlowTexture()},flameTexture:{value:elementalFlameTexture()},magicEmissionPass:emission},
        defines:{FLOW_SHAPE:shapeId},transparent:true,depthWrite:false,side:THREE.DoubleSide,
        vertexShader:`attribute vec4 flowLife,flowProfile;uniform float time;
          varying vec2 vFlowUv;varying vec4 vLife,vProfile;varying vec3 vFlowNormal,vFlowView;
          void main(){
            float u=uv.x,v=uv.y,seed=flowLife.z,angle=u*6.2831853*flowProfile.y;
            float turbulent=sin(angle*5.+v*9.-time*2.3+seed)*.055+sin(angle*11.-v*7.+time*3.7+seed)*.024;
            float radius,height;
            #if FLOW_SHAPE == 0
              radius=.48+v*.52+turbulent*(.2+v*.8);height=sin(v*3.14159)*(.5+turbulent*3.);
            #elif FLOW_SHAPE == 1
              radius=sin(v*3.14159)*(1.+turbulent*1.8);height=cos(v*3.14159);
              angle+=sin(v*9.+time*1.2)*.09;
            #elif FLOW_SHAPE == 2
              radius=(flowProfile.x+(1.-flowProfile.x)*pow(v,1.15))*(1.+turbulent*1.8);height=v;
              angle+=v*7.*flowProfile.w-time*1.8;
            #else
              radius=(.23+sin(v*3.14159)*.50)*(1.-v*.7)*(1.+turbulent*2.);height=v;
              angle+=v*5.-time;
              if(flowLife.x>2.5){
                radius=(.30+sin(v*3.14159)*.13)*pow(max(.001,1.-v),.85)*(1.+turbulent*2.5);
                float flutter=.72+fract(sin(seed*31.7)*43758.5453)*.62;
                angle+=sin(v*(5.3+flutter*2.)-time*3.*flutter+seed)*.32*v;
              }
            #endif
            vec3 p=vec3(cos(angle)*radius,height,sin(angle)*radius);
            p.x+=flowProfile.z*height*height*.30;
            p.y*=1.+sin(angle*(3.+mod(seed,4.))+seed)*.13*abs(flowProfile.z);
            #if FLOW_SHAPE >= 2
              p.x+=sin(v*4.+time*1.4+seed)*v*.13;p.z+=cos(v*5.-time+seed)*v*.10;
              if(flowLife.x>2.5){
                p.x+=sin(v*5.-time*4.1+seed)*v*v*.30;
                p.z+=cos(v*7.-time*3.3+seed)*v*v*.20;
              }
            #endif
            #if FLOW_SHAPE == 3
              if(flowLife.x>2.5){
                // Open, folded flame cloth with an unequal crown, not the shared conical plume.
                float r0=fract(sin(seed*17.13+4.7)*43758.5453),r1=fract(sin(seed*43.71+1.3)*31317.31);
                float clock=time*(1.25+r0*1.4),cross=u-.5;
                float crown=.62+.23*sin(u*(3.7+r0*3.)+seed)+.15*sin(u*(8.1+r1*4.)-seed*.7);
                float bend=sin(v*3.8-clock+seed)*v*v;
                p=vec3(cross*(1.3-v*.45),v*(.78+crown*.45),0.);
                p.x+=bend*(.18+r0*.34)+flowProfile.z*v*v*.16;
                p.y-=pow(v,4.)*(.12+r1*.22);
                p.z=sin(u*(3.4+r1*3.)+v*4.1+seed)*(.13+v*.23)+bend*.27;
                p.z+=cross*cross*(r0-.5)*1.8;
              }
            #endif
            vec3 n=normalize(vec3(cos(angle),.3,sin(angle)));
            vec4 view=modelViewMatrix*instanceMatrix*vec4(p,1.);
            vFlowNormal=normalize(normalMatrix*mat3(instanceMatrix)*n);vFlowView=-view.xyz;
            vFlowUv=uv;vLife=flowLife;vProfile=flowProfile;gl_Position=projectionMatrix*view;
          }`,
        fragmentShader:`uniform float time,magicEmissionPass;${flowSampling}${flameSampling}
          varying vec2 vFlowUv;varying vec4 vLife,vProfile;varying vec3 vFlowNormal,vFlowView;
          void main(){
            float u=vFlowUv.x,v=vFlowUv.y,kind=vLife.x;
            vec2 uv=vec2(u*3.,v*1.2);
            #if FLOW_SHAPE == 0
              uv=vec2(u*4.,v*.68);
            #elif FLOW_SHAPE == 2
              uv=vec2(v*2.2,u*3.5-v*4.-time*.95);
            #endif
            float n=authoredFlow(uv,time*(kind<.5?1.9:1.),vLife.z);
            if(kind>2.5)n=flameDetail(vec2(u*1.27+sin(v*5.-time*3.+vLife.z)*.045,v*.86),time,vLife.z);
            float envelope=1.;
            #if FLOW_SHAPE == 0
              envelope=smoothstep(0.,.16,v)*(1.-smoothstep(.84,1.,v));
            #elif FLOW_SHAPE >= 2
              envelope=smoothstep(0.,.07,v)*(1.-smoothstep(.65,1.,v));
            #endif
            float density=smoothstep(.08,.52,n),ridge=smoothstep(.40,.72,n);
            float alpha=vLife.y*density*envelope;
            if(vProfile.y<.99)alpha*=smoothstep(0.,.09,u)*(1.-smoothstep(.83,1.,u));
            // Fine moving channels energize the authored detail, keeping dark body between them.
            float current=pow(.5+.5*sin(n*24.+v*8.-time*4.2+vLife.z),10.)*ridge;
            float fresnel=pow(1.-abs(dot(normalize(vFlowNormal),normalize(vFlowView))),2.);
            vec3 color,energy;
            if(kind<.5){
              color=mix(vec3(.022,.055,.095),vec3(.20,.39,.49),density);
              color=mix(color,vec3(.72,.90,.98),current*.7);
              energy=vec3(.10,.35,.82)*ridge*.5+vec3(.60,1.35,2.2)*current*1.2;
              alpha*=.54+.28*fresnel;
            }else if(kind<1.5){
              color=mix(vec3(.005,.055,.30),vec3(.045,.39,.82),density);
              color=mix(color,vec3(.62,.91,.97),ridge*.65);
              energy=vec3(.025,.24,1.2)*ridge*.8+vec3(.22,2.1,2.6)*current*1.65;
              color=mix(color,mix(vec3(.26,.63,.72),vec3(.87,.98,1.),density),vLife.w);
              alpha*=mix(1.,smoothstep(.14,.46,n),vLife.w);
            }else if(kind<2.5){
              color=mix(vec3(.08,.075,.058),vec3(.40,.39,.24),density);
              energy=vec3(.14,.46,.27)*ridge*.55+vec3(.30,1.15,.67)*current*1.2;
            }else{
              // Flame detail supplies long torn membranes and fine hot edges at every scale.
              float breakup=flameNoise(vec2(u*5.3+v*.6,v*2.1-time*1.25)+vLife.z);
              float cut=.10+v*.18+(breakup-.5)*.22;
              alpha=vLife.y*envelope*smoothstep(cut,cut+.17,n);
              if(vProfile.y<.99)alpha*=smoothstep(0.,.09,u)*(1.-smoothstep(.83,1.,u));
              float heat=clamp(n*1.35+.05,0.,1.);
              color=flameColor(heat,v,0.);energy=flameColor(heat,v,1.);

            }
            if(alpha<.012)discard;
            gl_FragColor=vec4(magicEmissionPass>.5?energy:color,alpha);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      });
      material.userData["magicEmissionPass"]=emission;
      const mesh=new THREE.InstancedMesh(g,material,96);
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
