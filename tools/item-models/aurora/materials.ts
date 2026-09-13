import * as THREE from 'three';
import sharp from 'sharp';
import type { ArmorMaterials } from '../tier50-70/contracts.js';
import { armorMaps } from '../tier50-70/materials-load.js';

async function loadCloth(suffix: string): Promise<THREE.DataTexture> {
  const { data, info } = await sharp(`art/aurora/textures/cloth-${suffix}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const texture = new THREE.DataTexture(new Uint8Array(data), info.width, info.height, THREE.RGBAFormat);
  texture.name = `aurora-ivory-celestial-cloth-${suffix}`;
  texture.colorSpace = suffix === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(.64, .64);
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 8; texture.needsUpdate = true;
  return texture;
}
const [clothColor, clothNormal, clothRoughness] = await Promise.all(['color', 'normal', 'roughness'].map(loadCloth));
let cached: ArmorMaterials | undefined;

/** Aurora uses ivory woven body cloth, selective gold embroidery and nacre
 * plates. All highlight color is physically lit; no surface emits light. */
export function createAuroraMaterials(): ArmorMaterials {
  if (cached) return cached;
  const make = (name: string, params: THREE.MeshPhysicalMaterialParameters) => {
    const material = new THREE.MeshPhysicalMaterial({
      name: `aurora-${name}`, color: 0xffffff, roughness: 1, side: THREE.DoubleSide,
      emissive: 0x000000, emissiveIntensity: 0, ...params,
    });
    material.userData = {
      referenceSet: 'art/aurora/textures/imagegen-r1/aurora-embroidered-source.png',
      materialSource: 'tools/item-models/aurora/materials.ts',
      surfaceConstruction: name === 'pearl-ivory-celestial-brocade'
        ? 'imagegen woven ivory, raised warm gold celestial stitches with isolated thread metallic response and restrained pearlescent fabric sheen'
        : 'authored overlapping plate or ornament geometry with fine material grain and view-dependent reflection',
    };
    return material;
  };
  const tones = ['#bec9c6', '#c4c5d0', '#d0cac0', '#b6c8cf', '#ccbecb', '#cad0c3'];
  const film = [290, 325, 350, 375, 310, 340];
  const scutes = tones.map((color, index) => make(`opal-scute-${index + 1}`, {
    ...armorMaps('dragonhide', 'hide'), color, metalness: .43, roughness: .92,
    normalScale: new THREE.Vector2(.52, .52), ior: 1.48,
    iridescence: .78, iridescenceIOR: 1.32, iridescenceThicknessRange: [120, film[index]!],
    clearcoat: .30, clearcoatRoughness: .25,
  }));
  cached = {
    cloth: make('pearl-ivory-celestial-brocade', {
      map: clothColor!, normalMap: clothNormal!, roughnessMap: clothRoughness!, metalnessMap: clothRoughness!,
      color: '#ffffff', metalness: 1, roughness: 1, ior: 1.34,
      normalScale: new THREE.Vector2(.85, .85),
      sheen: .28, sheenColor: new THREE.Color('#d0d4e0'), sheenRoughness: .82,
      iridescence: .10, iridescenceIOR: 1.22, iridescenceThicknessRange: [100, 265],
    }),
    scales: scutes[0]!, scutes: Object.freeze(scutes),
    metal: make('warm-chased-gold', {
      ...armorMaps('dragonhide', 'metal'), color: '#d9bd79', metalness: .85, roughness: 1,
      normalScale: new THREE.Vector2(.40, .40), clearcoat: .08, clearcoatRoughness: .3,
    }),
    lining: make('cool-pearl-shadow-lining', {
      ...armorMaps('dragonhide', 'lining'), color: '#525c65', metalness: 0, roughness: 1,
      normalScale: new THREE.Vector2(.38, .38), sheen: .10, sheenColor: new THREE.Color('#adb8c4'), sheenRoughness: .9,
    }),
    gem: make('aurora-opal-inset', {
      color: '#c2dfdc', metalness: .14, roughness: .19, ior: 1.50,
      iridescence: .72, iridescenceIOR: 1.36, iridescenceThicknessRange: [100, 335],
      clearcoat: .48, clearcoatRoughness: .15,
    }),
    sole: make('pearl-gray-leather-sole', {
      ...armorMaps('dragonhide', 'sole'), color: '#555763', metalness: 0, roughness: 1,
      normalScale: new THREE.Vector2(.5, .5),
    }),
    thread: make('pale-gold-embroidery-thread', { color: '#e0c994', metalness: .49, roughness: .48 }),
  };
  return cached;
}
