import * as THREE from 'three';
import sharp from 'sharp';
import type { ArmorTheme } from './contracts.js';
import type { GrainKind, GrainMaps } from './materials-textures.js';

async function load(theme: ArmorTheme, kind: GrainKind, suffix: string): Promise<THREE.DataTexture> {
  const { data, info } = await sharp(`art/tier50-70/textures/${theme}/${kind}-${suffix}.png`)
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const result = new THREE.DataTexture(new Uint8Array(data), info.width, info.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  result.name = `${theme}-${kind}-${suffix}`;
  result.colorSpace = suffix === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  result.wrapS = result.wrapT = THREE.RepeatWrapping;
  result.magFilter = THREE.LinearFilter;
  result.minFilter = THREE.LinearMipmapLinearFilter;
  result.generateMipmaps = true;
  result.anisotropy = 8;
  result.needsUpdate = true;
  return result;
}

const cache = new Map<string, GrainMaps>();
await Promise.all((['dragonhide', 'starhide'] as const).flatMap(theme =>
  (['cloth', 'hide', 'metal', 'lining', 'sole'] as const).map(async kind => {
    const [map, normalMap, roughnessMap] = await Promise.all(['color', 'normal', 'roughness'].map(suffix => load(theme, kind, suffix)));
    cache.set(`${theme}-${kind}`, { map: map!, normalMap: normalMap!, roughnessMap: roughnessMap! });
  }),
));

export function armorMaps(theme: ArmorTheme, kind: GrainKind): GrainMaps {
  return cache.get(`${theme}-${kind}`)!;
}
