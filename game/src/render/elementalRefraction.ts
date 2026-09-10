import * as THREE from "three";
import { elementalFlowTexture, flowSampling } from "./elementalFlowTexture.js";

// A separate draw layer reuses the world depth buffer. It never changes the gameplay pose.
const REFRACTION_LAYER = 29;
const sources = new Set<THREE.Mesh>();
export function registerElementalRefraction(mesh: THREE.Mesh): () => void {
  mesh.layers.set(REFRACTION_LAYER);
  sources.add(mesh);
  return () => sources.delete(mesh);
}

/** One scene-color copy, followed by depth-tested spatial pressure and liquid surfaces. */
export class ElementalRefraction {
  enabled = true;
  private frame: THREE.FramebufferTexture | null = null;
  private readonly size = new THREE.Vector2();
  private rendered = false;
  private activeMeshes = 0;
  snapshot() {
    return { enabled: this.enabled, rendered: this.rendered, activeMeshes: this.activeMeshes,
      copies: this.rendered ? 1 : 0, width: this.frame?.image.width ?? 0, height: this.frame?.image.height ?? 0 };
  }
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    this.rendered = false;
    this.activeMeshes = 0;
    if (!this.enabled) return;
    const active: THREE.Mesh[] = [];
    for (const mesh of sources) {
      let owner: THREE.Object3D = mesh;
      let visible = true;
      while (owner.parent) { visible &&= owner.visible; owner = owner.parent; }
      if (owner !== scene || !visible || !owner.visible) continue;
      active.push(mesh);
    }
    this.activeMeshes = active.length;
    if (!active.length) return;
    renderer.getDrawingBufferSize(this.size);
    if (!this.frame || this.frame.image.width !== this.size.x || this.frame.image.height !== this.size.y) {
      this.frame?.dispose();
      this.frame = new THREE.FramebufferTexture(this.size.x, this.size.y);
      this.frame.name = "Elemental refraction scene color";
      this.frame.colorSpace = THREE.NoColorSpace;
      this.frame.minFilter = this.frame.magFilter = THREE.LinearFilter;
    }
    for (const mesh of active) {
      const uniforms = (mesh.material as THREE.ShaderMaterial).uniforms;
      uniforms["sceneColor"]!.value = this.frame;
      uniforms["viewport"]!.value.copy(this.size);
    }
    const mask = camera.layers.mask, background = scene.background,
      autoClear = renderer.autoClear, autoReset = renderer.info.autoReset,
      shadowAuto = renderer.shadowMap.autoUpdate, shadowNeeds = renderer.shadowMap.needsUpdate;
    try {
      renderer.copyFramebufferToTexture(this.frame);
      camera.layers.set(REFRACTION_LAYER);
      scene.background = null;
      renderer.autoClear = false;
      renderer.info.autoReset = false;
      renderer.shadowMap.autoUpdate = renderer.shadowMap.needsUpdate = false;
      renderer.render(scene, camera);
      this.rendered = true;
    } finally {
      camera.layers.mask = mask;
      scene.background = background;
      renderer.autoClear = autoClear;
      renderer.info.autoReset = autoReset;
      renderer.shadowMap.autoUpdate = shadowAuto;
      renderer.shadowMap.needsUpdate = shadowNeeds;
    }
  }
  dispose(): void { this.frame?.dispose(); }
}

/** Shared scene refraction. Geometry supplies moving view normals, local coordinates and opacity. */
export const elementalRefractionFragment = `
  ${flowSampling}
  uniform sampler2D sceneColor;uniform vec2 viewport;uniform float time,liquid,strength,flowMode;
  varying vec3 vRefNormal,vRefView,vRefLocal;varying float vRefAlpha,vRefSeed;
  float refHash(vec3 p){p=fract(p*.3183099+.17);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
  float refNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(refHash(i),refHash(i+vec3(1,0,0)),f.x),mix(refHash(i+vec3(0,1,0)),refHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(refHash(i+vec3(0,0,1)),refHash(i+vec3(1,0,1)),f.x),mix(refHash(i+vec3(0,1,1)),refHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
  void main(){
    vec3 p=vRefLocal*3.2+vec3(vRefSeed,-time*(liquid>.5?2.7:1.6),time*.3);
    if(abs(flowMode-2.)<.1) p=vec3(length(vRefLocal.xz)*9.0,atan(vRefLocal.z,vRefLocal.x)*2.0-time*4.0,vRefLocal.y*7.0);
    vec2 flowingUv=vec2(atan(vRefLocal.z,vRefLocal.x)/6.2831853*2.,vRefLocal.y*1.4);
    if(abs(flowMode-2.)<.1)flowingUv=vec2(length(vRefLocal.xz)*2.-time*.16,atan(vRefLocal.z,vRefLocal.x)/6.2831853*3.+length(vRefLocal.xz)*1.8);
    if(liquid<.5&&flowMode>.5)flowingUv=vec2(vRefLocal.y*2.,atan(vRefLocal.z,vRefLocal.x)*.65-vRefLocal.y*4.0-time*.35);
    float n=authoredFlow(flowingUv,time*1.5,vRefSeed),n2=refNoise(p*2.03+4.1);
    vec3 normal=normalize(vRefNormal);vec3 view=normalize(vRefView);
    float face=abs(dot(normal,view)),edge=pow(1.0-face,2.0);
    float wave=sin(vRefLocal.y*18.0+vRefLocal.x*5.0-time*8.0+n*4.0);
    vec2 flow=vec2(n-.5,n2-.5);
    vec2 bend=normal.xy*(.3+wave*.7)+flow*(liquid>.5?2.6:1.4);
    float coverage=vRefAlpha*smoothstep(0.0,.15,face);
    if(liquid>.5&&flowMode>2.5)coverage*=mix(1.,smoothstep(.10,.46,n),smoothstep(.28,.76,vRefLocal.y))*(1.-smoothstep(.80,.98,vRefLocal.y));
    if(liquid>.5&&abs(flowMode-1.)<.1)coverage*=1.-smoothstep(.88,1.03,abs(vRefLocal.x))*(1.-smoothstep(.05,.45,n));
    vec2 uv=gl_FragCoord.xy/viewport;
    vec2 shift=bend*strength*coverage/viewport;
    vec3 refracted=texture2D(sceneColor,clamp(uv+shift,vec2(.002),vec2(.998))).rgb;
    if(liquid>.5){
      float crest=smoothstep(.32,.85,vRefLocal.y)*smoothstep(.32,.66,n);
      vec3 flowingNormal=normalize(normal+vec3(sin(vRefLocal.y*15.-time*6.+n*5.),cos(vRefLocal.x*12.+time*4.+n*3.),sin(vRefLocal.z*13.-time*5.))* .14);
      float glint=pow(max(0.0,dot(flowingNormal,normalize(vec3(-.3,.8,.5)))),22.0);
      vec3 water=mix(vec3(.012,.065,.29),vec3(.04,.42,.78),smoothstep(.05,.7,n)*.7+face*.15);
      refracted=mix(refracted*vec3(.45,.84,1.),water,.58+edge*.18);
      refracted+=vec3(.04,.19,.23)*smoothstep(.35,.68,n)*(.35+face*.65);
      refracted+=vec3(.63,.86,.95)*glint*.8;
      float caustic=pow(.5+.5*sin(n*32.+vRefLocal.y*9.-time*5.),16.);
      refracted+=vec3(.035,.20,.24)*caustic*(.35+face*.5);
      refracted=mix(refracted,vec3(.73,.93,.97),crest*.8);
      if(flowMode>2.5)refracted=mix(refracted,vec3(.77,.94,.97),smoothstep(.50,.94,vRefLocal.y)*smoothstep(.13,.5,n)*.85);
    }else{
      float leading=pow(1.0-face,2.7)*(.35+.65*smoothstep(-.25,.65,vRefLocal.z));
      float vapor=flowMode>.5?smoothstep(.1,.62,n)*.55:0.0;
      refracted=mix(refracted,vec3(.045,.065,.095),vapor);
      refracted=mix(refracted,vec3(.79,.91,.96),leading*(.10+n*.24));
      refracted+=vec3(.018,.023,.024)*edge*(.25+.75*n);
    }
    gl_FragColor=vec4(refracted,coverage);
  }`;

export function refractionUniforms(clock: { value: number }, liquid: boolean, strength: number, flowMode = 0) {
  return { sceneColor: { value: null }, viewport: { value: new THREE.Vector2(1,1) },
    flowTexture:{value:elementalFlowTexture()},
    time: clock, liquid: { value: liquid ? 1 : 0 }, strength: { value: strength }, flowMode: { value: flowMode } };
}
