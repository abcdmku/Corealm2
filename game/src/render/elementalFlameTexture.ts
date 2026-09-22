import { assetBaseUrl } from "../app/config.js";
import * as THREE from "three";
import { prepareDeferredTextureImage } from "./deferredTextureImage.js";

let texture:THREE.Texture|undefined;
/** Dedicated rising flame membranes, shared by curved fire bodies and volumes. */
export function elementalFlameTexture():THREE.Texture {
  if(!texture){
    texture=typeof document==="undefined"
      ?new THREE.DataTexture(new Uint8Array([128,128,128,255]),1,1)
      :new THREE.Texture();
    texture.name='Authored torn flame membranes';texture.colorSpace=THREE.NoColorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
    texture.anisotropy=4;
    if((texture as THREE.DataTexture).isDataTexture)texture.needsUpdate=true;
  }
  return texture;
}

/** Decode fully before any elemental effect pipeline or readiness publication. */
export function prepareElementalFlameTexture():Promise<void> {
  return prepareDeferredTextureImage(elementalFlameTexture(),`${assetBaseUrl()}vfx/elemental-flame-flow-v1.png`);
}
