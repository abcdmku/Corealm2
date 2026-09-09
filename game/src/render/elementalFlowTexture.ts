import * as THREE from "three";

let flow: THREE.Texture | undefined;
/** Original authored flow mask. Shared by spatial surfaces, never drawn as a whole spell card. */
export function elementalFlowTexture(): THREE.Texture {
  if (!flow) {
    flow = typeof document === "undefined"
      ? new THREE.DataTexture(new Uint8Array([110,110,110,255]),1,1)
      : new THREE.TextureLoader().load("/assets/vfx/elemental-flow-v2.png");
    flow.name = "Elemental authored turbulent flow";
    flow.wrapS = flow.wrapT = THREE.MirroredRepeatWrapping;
    flow.colorSpace = THREE.NoColorSpace;
    flow.minFilter = THREE.LinearMipmapLinearFilter;
    flow.magFilter = THREE.LinearFilter;
    flow.anisotropy = 4;
    flow.needsUpdate = true;
  }
  return flow;
}

export const flowSampling = `
  uniform sampler2D flowTexture;
  float authoredFlow(vec2 uv,float time,float seed){
    vec2 drift=vec2(seed*.137,-time*.28);
    vec2 warp=texture2D(flowTexture,uv*.47+drift*.38).rg;
    float a=texture2D(flowTexture,uv+drift+vec2(warp.x,-warp.y)*.11).r;
    float b=texture2D(flowTexture,uv*1.73+vec2(-seed*.09,time*.13)).r;
    return a*.8+b*.2;
  }
`;
