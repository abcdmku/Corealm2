import * as THREE from 'three';
import sharp from 'sharp';
import type { StarhideMaterials } from './contracts.js';

async function loadMap(name: string, color = false): Promise<THREE.DataTexture> {
  const { data, info } = await sharp(`art/starhide/textures/${name}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const texture = new THREE.DataTexture(new Uint8Array(data), info.width, info.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = `starhide-${name}`;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}
async function maps(name: string) {
  const [map, normalMap, roughnessMap] = await Promise.all([loadMap(`${name}-color`, true), loadMap(`${name}-normal`), loadMap(`${name}-roughness`)]);
  return { map, normalMap, roughnessMap };
}
const [clothMaps, scaleMaps, silverMaps, liningMaps, soleMaps] = await Promise.all(['cloth', 'scales-reference', 'silver', 'lining', 'sole'].map(maps));

/** Immutable shared inputs. Scale tile: 8 columns, 12 staggered rows; tips face decreasing V.
 * Set each patch's UV extent to desired column count / 8 and desired row count / 12.
 * Cloth is a dense satin weave: UV 0..1 is suitable for a 20–50 cm panel.
 */
export function createStarhideMaterials(): StarhideMaterials {
  const make = (name: string, params: THREE.MeshStandardMaterialParameters) => {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 1, ...params });
    material.name = `Starhide ${name}`;
    material.userData = { referenceSet: 'starhide-approved-icons', materialSource: 'art/starhide/textures/provenance.json' };
    return material;
  };
  return {
    cloth: make('indigo satin hide', { ...clothMaps, metalness: 0, roughness: .85, normalScale: new THREE.Vector2(.8, .8) }),
    scales: make('iridescent overlapping hide scales', { ...scaleMaps, metalness: .18, roughness: .9, normalScale: new THREE.Vector2(1, 1) }),
    silver: make('narrow polished silver', { ...silverMaps, metalness: .62, normalScale: new THREE.Vector2(.25, .25) }),
    lining: make('dark soft lining', { ...liningMaps, metalness: 0, normalScale: new THREE.Vector2(.30, .30) }),
    gem: make('deep teal inset stone', { color: 0x1c667d, metalness: .24, roughness: .24 }),
    sole: make('dark leather sole', { ...soleMaps, metalness: 0, normalScale: new THREE.Vector2(.32, .32) }),
    thread: make('fine silver grey embroidery', { color: 0xbec1b8, metalness: .30, roughness: .48 }),
  };
}
