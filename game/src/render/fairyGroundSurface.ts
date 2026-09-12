import * as THREE from 'three';
import { ASSET_BASE_URL } from '../app/config.js';

export interface FairyGroundSurface {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  meanLinearRgb: readonly [number, number, number];
  tileMetres: number;
}

let loaded: Promise<FairyGroundSurface> | undefined;

/** Native grass detail is shared by the realm and its compact material fixture. */
export function loadFairyGroundSurface(): Promise<FairyGroundSurface> {
  return loaded ??= (async () => {
    const root = `${ASSET_BASE_URL}textures/fairy-ground/`;
    const loader = new THREE.TextureLoader();
    const results = await Promise.allSettled([
      loader.loadAsync(`${root}grass-albedo.webp`),
      loader.loadAsync(`${root}grass-normal.webp`),
      fetch(`${root}grass-surface.json`).then(async response => {
        if (!response.ok) throw Error(`Fairy grass metadata: ${response.status}`);
        return await response.json() as Pick<FairyGroundSurface, 'meanLinearRgb' | 'tileMetres'>;
      }),
    ]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) {
      for (const result of results) if (result.status === 'fulfilled' && result.value instanceof THREE.Texture) result.value.dispose();
      throw failure.reason;
    }
    const [albedo, normal, profile] = results.map(result => (result as PromiseFulfilledResult<any>).value) as
      [THREE.Texture, THREE.Texture, Pick<FairyGroundSurface, 'meanLinearRgb' | 'tileMetres'>];
    if (!Number.isFinite(profile.tileMetres) || profile.tileMetres <= 0
      || profile.meanLinearRgb.length !== 3 || profile.meanLinearRgb.some(value => !Number.isFinite(value) || value <= 0)) {
      albedo.dispose(); normal.dispose(); throw Error('Invalid fairy grass surface metadata');
    }
    for (const texture of [albedo, normal]) {
      texture.colorSpace = texture === albedo ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 8;
      texture.flipY = false;
      texture.needsUpdate = true;
    }
    return { albedo, normal, meanLinearRgb: profile.meanLinearRgb, tileMetres: profile.tileMetres };
  })().catch(error => { loaded = undefined; throw error; });
}
