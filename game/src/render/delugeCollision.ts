import * as THREE from "three";
import { registerElementalRefraction } from "./elementalRefraction.js";

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
  readonly mesh:THREE.Mesh<THREE.BoxGeometry,THREE.ShaderMaterial>;
  private readonly unregister:()=>void;
  constructor(parent:THREE.Object3D){
    const material=new THREE.ShaderMaterial({
      uniforms:{sceneColor:{value:null},viewport:{value:new THREE.Vector2(1,1)},
        liquidNoise:{value:liquidNoise()},age:{value:0},opacity:{value:0}},
      transparent:true,depthWrite:false,depthTest:true,side:THREE.FrontSide,toneMapped:false,
      vertexShader:`varying vec3 vEye,vSurface;
        void main(){
          vec3 center=(modelMatrix*vec4(0.,0.,0.,1.)).xyz;
          vec3 eye=cameraPosition-center;mat3 m=mat3(modelMatrix);
          vEye=vec3(dot(eye,m[0])/dot(m[0],m[0]),dot(eye,m[1])/dot(m[1],m[1]),dot(eye,m[2])/dot(m[2],m[2]));
          vSurface=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
        }`,
      fragmentShader:`uniform sampler2D sceneColor;uniform highp sampler3D liquidNoise;
        uniform vec2 viewport;uniform float age,opacity;uniform mat4 projectionMatrix,modelViewMatrix;varying vec3 vEye,vSurface;
        float noise3(vec3 p){return texture(liquidNoise,(p+.5)/64.).r;}
        void main(){
          vec3 ray=normalize(vSurface-vEye),inv=1./ray;
          vec3 aa=(-1.-vEye)*inv,bb=(1.-vEye)*inv,lo=min(aa,bb),hi=max(aa,bb);
          float enter=max(0.,max(lo.x,max(lo.y,lo.z))),leave=min(hi.x,min(hi.y,hi.z));
          if(leave<=enter)discard;
          float stride=(leave-enter)/56.,t=max(0.,age),surge=1.-exp(-t*19.);
          float height=max(.5,1.1+surge*6.5-t*4.-t*t*3.4),radius=1.1+surge*3.+t*2.4;
          vec2 screen=gl_FragCoord.xy/viewport;vec4 sum=vec4(0.);float waterDepth=1.;
          for(int i=0;i<56;i++){
            vec3 jitter=fract(vec3(gl_FragCoord.xyx)*.1031+float(i)*.123);
            jitter+=dot(jitter,jitter.yzx+33.33);
            float offset=fract((jitter.x+jitter.y)*jitter.z);
            vec3 p=vEye+ray*(enter+(float(i)+offset)*stride);
            vec3 world=p*vec3(7.5,6.,7.5)+vec3(0.,6.,0.);
            if(world.y<.04)continue;
            float turn=world.y*.34+t*3.4,c=cos(turn),s=sin(turn);
            vec3 flow=vec3(c*world.x-s*world.z,world.y-t*7.,s*world.x+c*world.z)*1.25;
            vec3 warp=vec3(noise3(flow*.41),noise3(flow*.41+17.3),noise3(flow*.41+39.7))-.5;
            flow+=warp*2.8;
            float roll=noise3(flow*.78),detail=noise3(flow*2.17),fine=noise3(flow*5.2);
            vec3 q=world;
            q.x-=sin(world.y*.54+t*2.)*world.y*.19+warp.x*1.5;
            q.z-=cos(world.y*.41-t*1.7)*world.y*.17+warp.z*1.7;
            q=vec3(q.x/(radius*.94),(q.y-height*.31)/(height*.69),q.z/(radius*.84));
            float edge=1.-length(q)+(roll-.5)*.96+(detail-.5)*.27;
            float channels=roll*.55+detail*.33+fine*.12;
            float density=smoothstep(.015,.085,edge)*smoothstep(.28,.58,channels);
            density*=1.-smoothstep(.83,1.,max(abs(p.x),max(abs(p.y),abs(p.z))));
            if(density<.012)continue;
            if(waterDepth==1.){
              vec4 clip=projectionMatrix*modelViewMatrix*vec4(p,1.);
              waterDepth=.5+.5*clip.z/clip.w;
            }
            vec3 n=normalize(q+warp*2.2+vec3(detail-roll,fine-detail,roll-fine)*2.);
            float rim=pow(1.-abs(dot(n,ray)),2.);
            float glint=pow(max(0.,dot(n,normalize(vec3(-.45,.82,.34)-ray))),24.);
            vec2 shift=(n.xz+warp.xz)*18./viewport;
            vec3 behind=texture2D(sceneColor,clamp(screen+shift,vec2(.002),vec2(.998))).rgb;
            vec3 color=mix(behind*vec3(.52,.86,.90),vec3(.018,.22,.24),.64);
            float foam=smoothstep(.49,.72,channels)*(.40+rim*.50);
            float collision=exp(-pow((t-.11)/.17,2.));
            color=mix(color,vec3(.73,.91,.88),foam*(1.+collision*.35));
            color+=vec3(.48,.78,.77)*glint+vec3(.04,.15,.16)*rim;
            float a=(1.-exp(-density*stride*length(ray*vec3(7.5,6.,7.5))*1.25))*opacity;
            sum.rgb+=(1.-sum.a)*a*color;sum.a+=(1.-sum.a)*a;
            if(sum.a>.96)break;
          }
          if(sum.a<.008)discard;
          gl_FragDepth=waterDepth;
          gl_FragColor=vec4(sum.rgb/max(sum.a,.001),sum.a);
        }`,
    });
    this.mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),material);
    this.mesh.scale.set(7.5,6,7.5);this.mesh.visible=false;this.mesh.frustumCulled=false;
    this.mesh.name="elemental-deluge-turbulent-collision";this.mesh.renderOrder=9;
    this.mesh.userData['magicGlow']=false;this.mesh.userData['magicGlowOnly']=false;
    this.unregister=registerElementalRefraction(this.mesh);parent.add(this.mesh);
  }
  hide(){this.mesh.visible=false;}
  update(x:number,y:number,z:number,age:number,alpha:number){
    this.mesh.visible=alpha>.01;if(!this.mesh.visible)return;
    this.mesh.position.set(x,y+6,z);this.mesh.material.uniforms['age']!.value=age;
    this.mesh.material.uniforms['opacity']!.value=alpha;
  }
  dispose(){this.unregister();this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
