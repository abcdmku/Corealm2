import * as THREE from 'three';
import { ASSET_BASE_URL } from '../app/config.js';
import type { CorealmSurfaceTextures } from './corealmSurfaceMaterials.js';

let loaded: Promise<CorealmSurfaceTextures['stone']> | undefined;

/** Native Asian mountain rock is shared by both fairy palettes; other realms keep their stone. */
export function loadFairyRockSurface(): Promise<CorealmSurfaceTextures['stone']> {
  return loaded ??= (async () => {
    const root = `${ASSET_BASE_URL}textures/fairy-rock/`, loader = new THREE.TextureLoader();
    const results = await Promise.allSettled([
      ...['corealm-stone.png', 'corealm-stone-normal.png', 'corealm-stone-roughness.png'].map(file => loader.loadAsync(root + file)),
      fetch(root + 'stone-surface.json').then(async response => {
        if (!response.ok) throw Error(`Fairy rock metadata: ${response.status}`);
        return await response.json() as { meanLinearRgb: [number, number, number]; tileMetres: number };
      }),
    ]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) {
      for (const result of results) if (result.status === 'fulfilled' && result.value instanceof THREE.Texture) result.value.dispose();
      throw failure.reason;
    }
    const [albedo, normal, roughness, profile] = results.map(result => (result as PromiseFulfilledResult<any>).value) as
      [THREE.Texture, THREE.Texture, THREE.Texture, { meanLinearRgb: [number, number, number]; tileMetres: number }];
    if (!Number.isFinite(profile.tileMetres) || profile.tileMetres <= 0 || !Array.isArray(profile.meanLinearRgb)
      || profile.meanLinearRgb.length !== 3 || profile.meanLinearRgb.some(value => !Number.isFinite(value) || value <= 0)) {
      albedo.dispose(); normal.dispose(); roughness.dispose(); throw Error('Invalid fairy rock surface metadata');
    }
    for (const texture of [albedo, normal, roughness]) {
      texture.colorSpace = texture === albedo ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 8; texture.flipY = false; texture.needsUpdate = true;
    }
    return { albedo, normal, roughness, meanLinearRgb: profile.meanLinearRgb, tileMetres: profile.tileMetres };
  })().catch(error => { loaded = undefined; throw error; });
}
