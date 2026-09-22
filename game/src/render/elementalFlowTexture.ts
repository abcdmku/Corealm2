import { assetBaseUrl } from "../app/config.js";
import * as THREE from "three";
import { prepareDeferredTextureImage } from "./deferredTextureImage.js";

let flow: THREE.Texture | undefined;
/** Original authored flow mask. Shared by spatial surfaces, never drawn as a whole spell card. */
export function elementalFlowTexture(): THREE.Texture {
  if (!flow) {
    flow = typeof document === "undefined"
      ? new THREE.DataTexture(new Uint8Array([110,110,110,255]),1,1)
      : new THREE.Texture();
    flow.name = "Elemental authored turbulent flow";
    flow.wrapS = flow.wrapT = THREE.MirroredRepeatWrapping;
    flow.colorSpace = THREE.NoColorSpace;
    flow.minFilter = THREE.LinearMipmapLinearFilter;
    flow.magFilter = THREE.LinearFilter;
    flow.anisotropy = 4;
    if ((flow as THREE.DataTexture).isDataTexture) flow.needsUpdate = true;
  }
  return flow;
}

/** Start during graphics preparation, after the initial world's model downloads. */
export function prepareElementalFlowTexture(): Promise<void> {
  return prepareDeferredTextureImage(elementalFlowTexture(), `${assetBaseUrl()}vfx/elemental-flow-v2.png`);
}
