import * as THREE from "three";
import sharp from "sharp";
import type { CoreArmorMaterials } from "./contracts.js";

async function albedo(file: string) {
  const { data, info } = await sharp(`art/item-models/textures/${file}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const map = new THREE.DataTexture(new Uint8Array(data), info.width, info.height);
  map.name = file; map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.needsUpdate = true;
  return map;
}
const steel = await albedo("worked-steel-albedo.png");
const leather = await albedo("neutral-leather-albedo.png");

/** Sub-millimetre surface response; the authored albedo carries the visible grain. */
function microSurface(seed: number, roughness: number) {
  const n = 128, normals = new Uint8Array(n * n * 4), rough = new Uint8Array(n * n * 4);
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < n * n; i++) {
    normals.set([128 + Math.round((random() - .5) * 12), 128 + Math.round((random() - .5) * 12), 255, 255], i * 4);
    const r = Math.round(255 * (roughness + (random() - .5) * .06));
    rough.set([255, r, 255, 255], i * 4);
  }
  const normal = new THREE.DataTexture(normals, n, n), roughMap = new THREE.DataTexture(rough, n, n);
  for (const texture of [normal, roughMap]) { texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.needsUpdate = true; }
  return { normalMap: normal, roughnessMap: roughMap, normalScale: new THREE.Vector2(.25, .25) };
}
const metalMicro = microSurface(1763, .58), hideMicro = microSurface(3872, .84);
export function coreMaterials(kind: "plate" | "hide", color: number, trim = 0x786849): CoreArmorMaterials {
  const make = (name: string, tint: number, metallic: boolean, polished = false) => {
    const result = new THREE.MeshStandardMaterial({ color: tint, map: metallic ? steel : leather,
      metalness: metallic ? .62 : 0, roughness: polished ? .64 : 1,
      ...(metallic ? metalMicro : hideMicro) });
    result.name = name; return result;
  };
  return {
    shell: make(`${kind} fitted outer shell`, color, kind === "plate"),
    edge: make(`${kind} finished edges`, kind === "plate" ? 0xe0e1df : 0xc6ad88, kind === "plate", true),
    leather: make("oiled leather straps", 0x513a29, false),
    lining: make("soft leather lining", kind === "plate" ? 0x45382e : 0xbaa991, false),
    thread: make("waxed linen thread", 0xd0b995, false),
    accent: make("restrained worked fasteners", trim, true, true),
  };
}
