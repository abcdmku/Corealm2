import { assetBaseUrl } from "../app/config.js";
import * as THREE from "three";

let texture:THREE.Texture|undefined;
/** Dedicated rising flame membranes, shared by curved fire bodies and volumes. */
export function elementalFlameTexture():THREE.Texture {
  if(!texture){
    texture=typeof document==="undefined"
      ?new THREE.DataTexture(new Uint8Array([128,128,128,255]),1,1)
      :new THREE.TextureLoader().load(`${assetBaseUrl()}vfx/elemental-flame-flow-v1.png`);
    texture.name='Authored torn flame membranes';texture.colorSpace=THREE.NoColorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
    texture.anisotropy=4;texture.needsUpdate=true;
  }
  return texture;
}
