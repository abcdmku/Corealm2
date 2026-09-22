import * as THREE from "three";
import { MeshBasicNodeMaterial, type Node } from "three/webgpu";
import * as N from "three/tsl";
import { elementalRefractionScene, elementalRefractionViewport, registerElementalRefraction } from "./elementalRefraction.js";

let noiseTexture:THREE.Data3DTexture|undefined;
function liquidNoise(){
  if(noiseTexture)return noiseTexture;
  const data=new Uint8Array(64**3);let seed=0x72a4ec19;
  for(let i=0;i<data.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;data[i]=seed>>>24;}
  noiseTexture=new THREE.Data3DTexture(data,64,64,64);
  noiseTexture.format=THREE.RedFormat;
  noiseTexture.minFilter=noiseTexture.magFilter=THREE.LinearFilter;
  noiseTexture.wrapS=noiseTexture.wrapT=noiseTexture.wrapR=THREE.RepeatWrapping;
  noiseTexture.unpackAlignment=1;noiseTexture.needsUpdate=true;return noiseTexture;
}

/** One turbulent liquid collision, using the tornado's spatial flow approach.
 * Twelve proxy triangles contain the water; no planar splash silhouettes. */
export class DelugeCollision {
  readonly mesh:THREE.Mesh<THREE.BoxGeometry,MeshBasicNodeMaterial>;
  private readonly age=N.uniform(0);
  private readonly opacity=N.uniform(0);
  private readonly unregister:()=>void;
  constructor(parent:THREE.Object3D){
    const material=new MeshBasicNodeMaterial({
      transparent:true,depthWrite:false,depthTest:true,side:THREE.FrontSide,toneMapped:false,fog:false,
    });
    const noise=N.texture3D(liquidNoise());
    // Explicit LOD keeps sampling valid inside the raymarch's divergent early exits.
    const noise3=(p:Node<"vec3">):Node<"float">=>noise.sample(p.add(.5).div(64)).level(N.float(0)).r;
    material.fragmentNode=N.Fn(():Node<"vec4">=>{
      const eye=N.modelWorldMatrixInverse.mul(N.vec4(N.cameraPosition,1)).xyz.toVar();
      const ray=N.positionLocal.sub(eye).normalize().toVar();
      const inv=ray.reciprocal();
      const aa=N.vec3(-1).sub(eye).mul(inv),bb=N.vec3(1).sub(eye).mul(inv);
      const lo=N.min(aa,bb),hi=N.max(aa,bb);
      const enter=N.max(0,N.max(lo.x,N.max(lo.y,lo.z))).toVar();
      const leave=N.min(hi.x,N.min(hi.y,hi.z)).toVar();
      N.If(leave.lessThanEqual(enter),()=>N.Discard());
      const stride=leave.sub(enter).div(56).toVar();
      const t=this.age.max(0).toVar(),surge=t.mul(-19).exp().oneMinus();
      const height=N.max(.5,surge.mul(6.5).add(1.1).sub(t.mul(4)).sub(t.mul(t).mul(3.4)));
      const radius=surge.mul(3).add(1.1).add(t.mul(2.4));
      const sum=N.vec4(0).toVar(),waterDepth=N.float(1).toVar();
      N.Loop(56,({i})=>{
        const jitter=N.fract(N.screenCoordinate.xyx.mul(.1031).add(N.float(i).mul(.123))).toVar();
        jitter.addAssign(N.dot(jitter,jitter.yzx.add(33.33)));
        const offset=N.fract(jitter.x.add(jitter.y).mul(jitter.z));
        const p=eye.add(ray.mul(enter.add(N.float(i).add(offset).mul(stride)))).toVar();
        const world=p.mul(N.vec3(7.5,6,7.5)).add(N.vec3(0,6,0)).toVar();
        N.If(world.y.lessThan(.04),()=>N.Continue());
        const turn=world.y.mul(.34).add(t.mul(3.4)),c=turn.cos(),s=turn.sin();
        const flow=N.vec3(c.mul(world.x).sub(s.mul(world.z)),world.y.sub(t.mul(7)),s.mul(world.x).add(c.mul(world.z))).mul(1.25).toVar();
        const warp=N.vec3(noise3(flow.mul(.41)),noise3(flow.mul(.41).add(17.3)),noise3(flow.mul(.41).add(39.7))).sub(.5).toVar();
        flow.addAssign(warp.mul(2.8));
        const roll=noise3(flow.mul(.78)).toVar(),detail=noise3(flow.mul(2.17)).toVar(),fine=noise3(flow.mul(5.2)).toVar();
        const q=world.toVar();
        q.x.subAssign(world.y.mul(.54).add(t.mul(2)).sin().mul(world.y).mul(.19).add(warp.x.mul(1.5)));
        q.z.subAssign(world.y.mul(.41).sub(t.mul(1.7)).cos().mul(world.y).mul(.17).add(warp.z.mul(1.7)));
        q.assign(N.vec3(q.x.div(radius.mul(.94)),q.y.sub(height.mul(.31)).div(height.mul(.69)),q.z.div(radius.mul(.84))));
        const edge=q.length().oneMinus().add(roll.sub(.5).mul(.96)).add(detail.sub(.5).mul(.27));
        const channels=roll.mul(.55).add(detail.mul(.33)).add(fine.mul(.12));
        const density=N.smoothstep(.015,.085,edge).mul(N.smoothstep(.28,.58,channels))
          .mul(N.smoothstep(.83,1,N.max(p.x.abs(),N.max(p.y.abs(),p.z.abs()))).oneMinus()).toVar();
        N.If(density.lessThan(.012),()=>N.Continue());
        N.If(waterDepth.equal(1),()=>{
          const view=N.modelViewMatrix.mul(N.vec4(p,1));
          // The TSL conversion produces normalized depth for both rendering backends.
          waterDepth.assign(N.viewZToPerspectiveDepth(view.z,N.cameraNear,N.cameraFar));
        });
        const n=q.add(warp.mul(2.2)).add(N.vec3(detail.sub(roll),fine.sub(detail),roll.sub(fine)).mul(2)).normalize();
        const rim=N.dot(n,ray).abs().oneMinus().pow(2);
        const glint=N.dot(n,N.vec3(-.45,.82,.34).sub(ray).normalize()).max(0).pow(24);
        const shift=n.xz.add(warp.xz).mul(18).div(elementalRefractionViewport);
        const behind=elementalRefractionScene.sample(N.screenUV.add(shift.mul(N.vec2(1,-1))).clamp(.002,.998)).level(N.float(0)).rgb;
        const color=N.mix(behind.mul(N.vec3(.52,.86,.90)),N.vec3(.018,.22,.24),.64).toVar();
        const foam=N.smoothstep(.49,.72,channels).mul(rim.mul(.50).add(.40));
        const collision=t.sub(.11).div(.17).pow(2).negate().exp();
        color.assign(N.mix(color,N.vec3(.73,.91,.88),foam.mul(collision.mul(.35).add(1))));
        color.addAssign(N.vec3(.48,.78,.77).mul(glint).add(N.vec3(.04,.15,.16).mul(rim)));
        const a=density.negate().mul(stride).mul(ray.mul(N.vec3(7.5,6,7.5)).length()).mul(1.25).exp().oneMinus().mul(this.opacity);
        const contribution=sum.a.oneMinus().mul(a).toVar();
        sum.rgb.addAssign(contribution.mul(color));sum.a.addAssign(contribution);
        N.If(sum.a.greaterThan(.96),()=>N.Break());
      });
      N.If(sum.a.lessThan(.008),()=>N.Discard());
      N.depth.assign(waterDepth).toStack();
      return N.vec4(sum.rgb.div(sum.a.max(.001)),sum.a);
    })();
    this.mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),material);
    this.mesh.scale.set(7.5,6,7.5);this.mesh.visible=false;this.mesh.frustumCulled=false;
    this.mesh.name="elemental-deluge-turbulent-collision";this.mesh.renderOrder=9;
    this.mesh.userData['magicGlow']=false;this.mesh.userData['magicGlowOnly']=false;
    this.unregister=registerElementalRefraction(this.mesh);parent.add(this.mesh);
  }
  hide(){this.mesh.visible=false;}
  update(x:number,y:number,z:number,age:number,alpha:number){
    this.mesh.visible=alpha>.01;if(!this.mesh.visible)return;
    this.mesh.position.set(x,y+6,z);this.age.value=age;
    this.opacity.value=alpha;
  }
  dispose(){this.unregister();this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
