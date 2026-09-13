import * as THREE from 'three';
import type { ArmorMaterials, ArmorTheme } from './contracts.js';
import { armorMaps } from './materials-load.js';

const palette = {
  dragonhide: {
    lining: '#310f1b', metal: '#ecd39e', thread: '#b9a073', gem: '#5865a4',
    scutes: ['#35475f', '#45465d', '#3e4c65', '#355061', '#4c465e', '#3c5365'],
  },
  starhide: {
    lining: '#151d33', metal: '#e8e4d8', thread: '#b6b9bb', gem: '#267b91',
    scutes: ['#2d425b', '#304765', '#3a4564', '#424563', '#48425f', '#294a58'],
  },
} as const;
const cache = new Map<ArmorTheme, ArmorMaterials>();

/** Shared immutable PBR materials. Texture units match the metric garment UVs.
 * Scute hues represent pigment variation between real plates. They contain no
 * painted plate outlines, cast shadows, stars, baked folds or emission.
 */
export function createArmorMaterials(theme: ArmorTheme): ArmorMaterials {
  const existing = cache.get(theme);
  if (existing) return existing;
  const colors = palette[theme];
  const clothSource = armorMaps(theme, 'cloth');
  const clothMaps = {
    map: clothSource.map.clone(),
    normalMap: clothSource.normalMap.clone(),
    roughnessMap: clothSource.roughnessMap.clone(),
  };
  // Slightly larger yarns survive the full-set view. Keep all PBR maps aligned.
  for (const texture of Object.values(clothMaps)) texture.repeat.set(.64, .64);
  const make = (name: string, params: THREE.MeshPhysicalMaterialParameters) => {
    const Material = params.ior === undefined ? THREE.MeshStandardMaterial : THREE.MeshPhysicalMaterial;
    const material = new Material({
      name: `${theme}-${name}`, color: 0xffffff, roughness: 1, side: THREE.DoubleSide,
      emissive: 0x000000, emissiveIntensity: 0, ...params,
    });
    material.userData = {
      referenceSet: `art/item-icons/generated/${theme}_*.png`,
      materialSource: name === 'close-twill-cloth' ? 'tools/item-models/tier50-70/materials-imagegen.ts' : 'tools/item-models/tier50-70/materials-textures.ts',
      surfaceConstruction: name === 'close-twill-cloth' ? 'imagegen soft embroidered cloth, raised gold-thread normals and selective thread metalness over tailored front-panel drape' : 'original procedural fine grain over authored geometry',
    };
    return material;
  };
  // A transparent thin film produces real view-dependent blue/violet/cyan shifts.
  // Small thickness differences make adjacent real plates catch different colors.
  const filmThickness = [320, 380, 345, 410, 365, 300];
  const scutes = colors.scutes.map((color, index) => {
    const material = new THREE.MeshPhysicalMaterial({
      name: `${theme}-scute-${index + 1}-pebbled-hide`,
      ...armorMaps(theme, 'hide'), color, side: THREE.DoubleSide,
      metalness: theme === 'dragonhide' ? .52 : .70,
      roughness: theme === 'dragonhide' ? .60 : .48, normalScale: new THREE.Vector2(.72, .72),
      iridescence: theme === 'dragonhide' ? .85 : 1,
      iridescenceIOR: theme === 'dragonhide' ? 1.35 : 1.45,
      iridescenceThicknessRange: [100, filmThickness[index]!],
      clearcoat: theme === 'dragonhide' ? .38 : .42, clearcoatRoughness: .19,
    });
    material.userData = {
      referenceSet: `art/item-icons/generated/${theme}_*.png`,
      materialSource: 'tools/item-models/tier50-70/materials.ts',
      surfaceConstruction: 'overlapping pebbled plates with angle-dependent thin-film iridescence',
    };
    return material;
  });
  const result: ArmorMaterials = {
    cloth: make('close-twill-cloth', {
      ...clothMaps, metalnessMap: clothMaps.roughnessMap, color: '#ffffff', metalness: 1, roughness: 1, ior: 1.3,
      normalScale: new THREE.Vector2(1.15, 1.15),
    }),
    scales: scutes[0]!,
    scutes: Object.freeze(scutes),
    metal: make(theme === 'dragonhide' ? 'chased-antique-gold' : 'chased-ivory-silver', {
      ...armorMaps(theme, 'metal'), color: colors.metal, metalness: .78,
      normalScale: new THREE.Vector2(.45, .45),
    }),
    lining: make('soft-dark-lining', {
      ...armorMaps(theme, 'lining'), color: colors.lining, metalness: 0,
      normalScale: new THREE.Vector2(.45, .45),
    }),
    gem: make('polished-inset-stone', { color: colors.gem, metalness: .20, roughness: .2 }),
    sole: make('stacked-dark-leather-sole', {
      ...armorMaps(theme, 'sole'), color: '#252126', metalness: 0,
      normalScale: new THREE.Vector2(.6, .6),
    }),
    thread: make('fine-stitch-thread', { color: colors.thread, metalness: .16, roughness: .59 }),
  };
  cache.set(theme, result);
  return result;
}
