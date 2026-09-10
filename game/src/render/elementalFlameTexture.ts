import * as THREE from "three";

let texture:THREE.Texture|undefined;
/** Dedicated rising flame membranes, shared by curved fire bodies and volumes. */
export function elementalFlameTexture():THREE.Texture {
  if(!texture){
    texture=typeof document==="undefined"
      ?new THREE.DataTexture(new Uint8Array([128,128,128,255]),1,1)
      :new THREE.TextureLoader().load('/assets/vfx/elemental-flame-flow-v1.png');
    texture.name='Authored torn flame membranes';texture.colorSpace=THREE.NoColorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
    texture.anisotropy=4;texture.needsUpdate=true;
  }
  return texture;
}
export const flameSampling=`
  uniform sampler2D flameTexture;
  vec2 flameHash(vec2 p){return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);}
  float flameNoise(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(flameHash(i).x,flameHash(i+vec2(1,0)).x,f.x),mix(flameHash(i+vec2(0,1)).x,flameHash(i+vec2(1,1)).x,f.x),f.y);
  }
  float flamePatch(vec2 uv,vec2 cell,float seed){
    vec2 r=flameHash(cell+seed*vec2(.73,1.19));
    float turn=(r.x-.5)*.85,c=cos(turn),s=sin(turn);
    vec2 sampleUv=mat2(c,-s,s,c)*uv*mix(.67,1.25,r.y)+r*17.3;
    return texture2D(flameTexture,sampleUv).r;
  }
  float flameDetail(vec2 uv,float clock,float seed){
    vec3 variation=fract(sin(vec3(seed+1.7,seed+19.3,seed+41.9)*vec3(12.9898,39.3468,73.156))*43758.5453);
    uv*=mix(vec2(.66,.68),vec2(1.28,1.19),variation.xy);
    uv.x+=(uv.y-.5)*(variation.z-.5)*.58;
    vec2 drift=vec2((variation.z-.5)*clock*.045,-clock*(.46+variation.x*.38));
    vec2 moving=uv+drift;
    vec2 curl=vec2(flameNoise(moving*2.3+seed),flameNoise(moving*2.1+seed+13.7))-.5;
    moving+=curl*.44;
    // Random crops meet on a triangular lattice. No mirrored pairs or whole-mask repeats.
    // The lattice travels with the flame, so patch boundaries never pop between frames.
    vec2 grid=vec2(moving.x-moving.y*.57735027,moving.y*1.15470054)*2.4;
    vec2 cell=floor(grid),f=fract(grid),b,c;vec3 weights;
    if(f.x+f.y<1.){b=cell+vec2(1,0);c=cell+vec2(0,1);weights=vec3(1.-f.x-f.y,f.x,f.y);}
    else {cell+=vec2(1);b=cell-vec2(1,0);c=cell-vec2(0,1);weights=vec3(f.x+f.y-1.,1.-f.x,1.-f.y);}
    weights=pow(max(weights,vec3(0)),vec3(3.));weights/=dot(weights,vec3(1));
    vec3 samples=vec3(flamePatch(moving,cell,seed),flamePatch(moving,b,seed),flamePatch(moving,c,seed));
    return sqrt(dot(samples*samples,weights));
  }
  vec3 flameColor(float ink,float height,float emission){
    float heat=smoothstep(.08,.62,ink)*(1.-height*.22);
    float gold=smoothstep(.48,.85,ink),hot=smoothstep(.80,.98,ink);
    vec3 body=mix(vec3(.065,.0008,.002),vec3(1.05,.018,.001),sqrt(heat));
    body=mix(body,vec3(2.35,.38,.012),heat*heat);
    body+=vec3(1.8,1.0,.12)*gold+vec3(1.8,2.0,1.1)*hot;
    vec3 energy=vec3(1.5,.075,.001)*heat*heat+vec3(2.9,1.1,.04)*gold+vec3(2.2,2.4,1.3)*hot;
    return mix(body,energy,emission);
  }
`;
