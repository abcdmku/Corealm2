import * as THREE from 'three';
import type { Vec3 } from '../contracts.js';
import { elementalFlameTexture, flameSampling } from './elementalFlameTexture.js';

/** One 576-triangle ribbon. Its trailing edge follows the tip's actual path. */
export class FurnaceLash {
  readonly mesh:THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>;
  constructor(parent:THREE.Object3D){
    const geometry=new THREE.PlaneGeometry(1,1,72,4);
    (geometry.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    const emission={value:0};
    const material=new THREE.ShaderMaterial({
      uniforms:{time:{value:0},opacity:{value:0},flameTexture:{value:elementalFlameTexture()},magicEmissionPass:emission},
      transparent:true,depthWrite:false,side:THREE.DoubleSide,
      vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`uniform float time,opacity,magicEmissionPass;varying vec2 vUv;${flameSampling}
        void main(){
          float across=abs(vUv.y-.5)*2.;
          float ink=flameDetail(vec2(vUv.x*1.8,vUv.y*.42),time*1.3,57.);
          float edge=1.-smoothstep(.48+ink*.42,1.,across);
          float ends=smoothstep(0.,.14,vUv.x)*(1.-smoothstep(.97,1.,vUv.x));
          float alpha=opacity*edge*ends*smoothstep(.035,.25,ink);
          if(alpha<.008)discard;
          float heat=min(1.,ink+pow(1.-across,5.)*.14);
          gl_FragColor=vec4(flameColor(heat,across*.55,magicEmissionPass),alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    material.userData['magicEmissionPass']=emission;
    this.mesh=new THREE.Mesh(geometry,material);this.mesh.name='elemental-furnace-lash';
    this.mesh.visible=false;this.mesh.frustumCulled=false;this.mesh.renderOrder=13;
    this.mesh.userData['magicGlow']=true;parent.add(this.mesh);
  }
  hide(){this.mesh.visible=false;}
  get instances(){return Number(this.mesh.visible);}
  update(path:(u:number)=>Vec3,seconds:number,alpha:number,width:number){
    this.mesh.visible=alpha>.01;if(!this.mesh.visible)return;
    this.mesh.material.uniforms['time']!.value=seconds;this.mesh.material.uniforms['opacity']!.value=alpha;
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
