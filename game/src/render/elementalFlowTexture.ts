import { assetBaseUrl } from "../app/config.js";
import * as THREE from "three";

let flow: THREE.Texture | undefined;
/** Original authored flow mask. Shared by spatial surfaces, never drawn as a whole spell card. */
export function elementalFlowTexture(): THREE.Texture {
  if (!flow) {
    flow = typeof document === "undefined"
      ? new THREE.DataTexture(new Uint8Array([110,110,110,255]),1,1)
      : new THREE.TextureLoader().load(`${assetBaseUrl()}vfx/elemental-flow-v2.png`);
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
