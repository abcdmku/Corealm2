import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { abs, float, pow, smoothstep, uv, vec2 } from 'three/tsl';
import type { Vec3 } from '../contracts.js';
import { clockUniform, flameColor, flameDetail } from './elementalNodes.js';

/** One 576-triangle ribbon. Its trailing edge follows the tip's actual path. */
export class FurnaceLash {
  readonly mesh:THREE.Mesh<THREE.PlaneGeometry,MeshBasicNodeMaterial>;
  private readonly clock={value:0};
  private readonly opacity={value:0};
  constructor(parent:THREE.Object3D){
    const geometry=new THREE.PlaneGeometry(1,1,72,4);
    (geometry.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    const emission={value:0};
    const material=new MeshBasicNodeMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,fog:false,alphaTest:.008});
    const coords=uv(),time=clockUniform(this.clock),across=abs(coords.y.sub(.5)).mul(2);
    const ink=flameDetail(coords.mul(vec2(1.8,.42)),time.mul(1.3),float(57));
    const edge=float(1).sub(smoothstep(ink.mul(.42).add(.48),1,across));
    const ends=smoothstep(0,.14,coords.x).mul(float(1).sub(smoothstep(.97,1,coords.x)));
    const heat=ink.add(pow(float(1).sub(across),5).mul(.14)).min(1);
    material.colorNode=flameColor(heat,across.mul(.55),clockUniform(emission));
    material.opacityNode=clockUniform(this.opacity).mul(edge).mul(ends).mul(smoothstep(.035,.25,ink));
    material.userData['magicEmissionPass']=emission;
    this.mesh=new THREE.Mesh(geometry,material);this.mesh.name='elemental-furnace-lash';
    this.mesh.visible=false;this.mesh.frustumCulled=false;this.mesh.renderOrder=13;
    this.mesh.userData['magicGlow']=true;parent.add(this.mesh);
  }
  hide(){this.mesh.visible=false;}
  get instances(){return Number(this.mesh.visible);}
  update(path:(u:number)=>Vec3,seconds:number,alpha:number,width:number){
    this.mesh.visible=alpha>.01;if(!this.mesh.visible)return;
    this.clock.value=seconds;this.opacity.value=alpha;
    const positions=this.mesh.geometry.getAttribute('position'),uv=this.mesh.geometry.getAttribute('uv');
    for(let i=0;i<positions.count;i++){
      const u=uv.getX(i),cross=(uv.getY(i)-.5)*2,p=path(u),q=path(Math.min(1,u+.008));
      const dx=q[0]-p[0],dz=q[2]-p[2],len=Math.hypot(dx,dz)||1;
      const fold=Math.sin(u*6.7-seconds*5)*.5+u*.5;
      const w=width*Math.pow(Math.max(0,Math.sin(u*Math.PI)),.6)*(1-u*.48);
      const lateral=Math.sin(fold)*w*cross;
      positions.setXYZ(i,p[0]-dz/len*lateral,p[1]+Math.cos(fold)*w*cross,p[2]+dx/len*lateral);
    }
    positions.needsUpdate=true;
  }
  dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
