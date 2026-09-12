import * as THREE from 'three';
import type { EquipSlot } from '../contracts.js';
import type { CharacterBody, GearAppearance } from './equipmentVisuals.js';
import { applyFabMagicSurface } from './fabMagicSurface.js';
import { applyRareMageMaterial } from './fabMageArmor.js';
import { applyMysticClothMaterial, type MysticClothPanel } from './fabMysticCloth.js';

const crafted = ['marchhide', 'bramblehide', 'cairnpelt', 'charhide', 'dragonhide', 'starhide'] as const;
const rare = ['duskguard', 'oathguard', 'frostguard', 'tideweave', 'nightweave', 'frostweave'] as const;
const slots: Record<string, EquipSlot> = {
  hood: 'head', helm: 'head', robe: 'body', plate: 'body', leggings: 'legs', greaves: 'legs',
  wraps: 'hands', gauntlets: 'hands', boots: 'feet',
};

export function fabArmorAppearance(itemId: string, body: CharacterBody): GearAppearance | null {
  const [set, suffix] = itemId.split('_');
  const slot = slots[suffix ?? ''];
  if (!slot) return null;
  if (crafted.includes(set as typeof crafted[number])) {
    return { itemId, assetId: `fab_${body}_mage_${slot}`, slot, attach: 'skin' };
  }
  if (rare.includes(set as typeof rare[number])) {
    return { itemId, assetId: `fab_${body}_${set}_${slot}`, slot, attach: 'skin' };
  }
  return null;
}

const textures = new Map<string, THREE.Texture>();
const textureLoads: Promise<Error | undefined>[] = [];
function loadTexture(name: string, extension = 'png'): THREE.Texture {
  let result!: THREE.Texture;
  textureLoads.push(new Promise(resolve => {
    result = new THREE.TextureLoader().load(`/assets/textures/fab-armor/${name}.${extension}`,
      () => resolve(undefined), undefined, () => resolve(new Error(`Cannot load Fab armor texture ${name}`)));
  }));
  return result;
}

/** Static icon captures must wait for the runtime material's external images. */
export async function awaitFabArmorTextures(): Promise<void> {
  const failed = (await Promise.all(textureLoads)).find(error => error !== undefined);
  if (failed) throw failed;
}

function texture(name: string, extension = 'png'): THREE.Texture {
  const existing = textures.get(name);
  if (existing) return existing;
  const result = loadTexture(name, extension);
  result.name = `fab-${name}`;
  result.colorSpace = THREE.SRGBColorSpace;
  result.wrapS = result.wrapT = THREE.RepeatWrapping;
  result.anisotropy = 8;
  textures.set(name, result);
  return result;
}

function scales(channel: number, linear: boolean): THREE.Texture {
  const key = `scales-${channel}-${linear}`;
  const existing = textures.get(key);
  if (existing) return existing;
  // Each UV/color-space variant needs its own upload notification after decoding.
  const result = loadTexture('scales');
  result.name = `fab-${key}`;
  result.wrapS = result.wrapT = THREE.RepeatWrapping;
  result.anisotropy = 8;
  result.channel = channel;
  result.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  result.repeat.set(0.3, 0.3);
  textures.set(key, result);
  return result;
}

/** Materials are cloned per equipped tier so mixed sets retain their own finish. */
export function applyFabArmorMaterials(object: THREE.Object3D, appearance: GearAppearance): boolean {
  if (!appearance.assetId.startsWith('fab_')) return false;
  const set = appearance.itemId?.split('_')[0] ?? '';
  const tier = crafted.indexOf(set as typeof crafted[number]);
  object.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const apply = (source: THREE.Material): THREE.Material => {
      const material = source.clone() as THREE.MeshStandardMaterial;
      if (!material.isMeshStandardMaterial) return material;
      material.onBeforeCompile = (shader, renderer) => source.onBeforeCompile.call(source, shader, renderer);
      material.customProgramCacheKey = source.customProgramCacheKey.bind(source);
      const role = source.name.split('|')[0];
      const rareMagicTier = set === 'tideweave' ? 50 : set === 'nightweave' ? 70 : set === 'frostweave' ? 90 : null;
      const magicRole = tier >= 0 ? role?.replace('fab_', '') : source.userData.fabRole;
      if (rareMagicTier !== null && ['cloth', 'leather', 'trim'].includes(magicRole)) {
        material.dispose();
        const textile = texture(rareMagicTier === 50 ? 'mage-chitin-jacquard'
          : rareMagicTier === 70 ? 'mage-void-damask' : 'mage-aurora-brocade', 'webp');
        textile.wrapS = textile.wrapT = THREE.MirroredRepeatWrapping;
        const panel = source.userData.fabMysticPanel as MysticClothPanel | undefined;
        if (panel) return applyMysticClothMaterial(source as THREE.MeshStandardMaterial, rareMagicTier, panel, textile);
        return applyRareMageMaterial(source as THREE.MeshStandardMaterial, rareMagicTier, magicRole, textile);
      }
      if (tier >= 0 && role === 'fab_cloth') {
        material.map = texture(`fabric-${[1, 5, 10, 20, 50, 70][tier]}`);
        material.color.setHex(0xffffff);
        material.metalness = 0;
        material.roughness = tier < 4 ? 0.9 : 0.72;
      } else if (tier >= 0 && role === 'fab_leather') {
        material.map = scales(0, false);
        material.color.setHex([0xa8b4c8, 0x8fbd9c, 0xa8a3c9, 0xbba89c, 0xb9a2c7, 0xc3d5ef][tier]!);
        material.color.multiplyScalar(1.5);
        material.metalness = 0;
        material.roughness = 0.8;
      } else if (tier >= 0 && role === 'fab_trim') {
        material.color.setHex([0x9a8771, 0xaaa393, 0xaeb8c6, 0xc18b59, 0xc3a471, 0xc4d2e7][tier]!);
        material.metalness = 0.35;
        material.roughness = 0.52;
      }
      const rareTier = ['duskguard', 'tideweave'].includes(set) ? 50
        : ['oathguard', 'nightweave'].includes(set) ? 70
        : ['frostguard', 'frostweave'].includes(set) ? 90 : null;
      // Retain authored trim, leather and texture variation around the tier dye.
      // Exposed skin, hair and fur retain their original material colors.
      const tierSurface = rareTier !== null && (rareMagicTier !== null
        ? ['cloth', 'leather', 'trim'].includes(magicRole)
        : !/Flesh|Skin|Hair|Fur/i.test(source.name));
      if (tierSurface) {
        const authored = material.onBeforeCompile;
        const cacheKey = material.customProgramCacheKey();
        const dye = rareTier === 50 ? 'vec3(0.10, 0.42, 0.95)'
          : rareTier === 70 ? 'vec3(0.12, 0.055, 0.25)' : 'vec3(0.35, 0.85, 0.78)';
        material.onBeforeCompile = (shader, renderer) => {
          authored.call(material, shader, renderer);
          shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
            `#include <color_fragment>
            vec3 armorAuthored = diffuseColor.rgb;
            float armorDyeLuma = dot(armorAuthored, vec3(0.2126, 0.7152, 0.0722));
            float armorWarmTrim = smoothstep(0.015, 0.10, armorAuthored.r - armorAuthored.b)
              * smoothstep(0.035, 0.16, armorDyeLuma);
            float armorSilverTrim = smoothstep(0.32, 0.65, armorDyeLuma);
            float armorDarkBacking = 1.0 - smoothstep(0.004, 0.025, armorDyeLuma);
            vec3 armorDyed = ${dye} * 0.92 * pow(max(armorDyeLuma, 0.0), 0.62);
            float armorPreserve = max(armorWarmTrim * 0.92, max(armorSilverTrim * 0.82, armorDarkBacking * ${rareTier === 50 ? '0.15' : '0.85'}));
            diffuseColor.rgb = mix(mix(armorAuthored, armorDyed, 0.78), armorAuthored * 0.94, armorPreserve);`);
        };
        material.customProgramCacheKey = () => `${cacheKey}|armor-tier-${rareTier}-v3`;
      }
      material.name = `${source.name}|fab:${set}`;
      material.needsUpdate = true;
      if (tier >= 0 && ['cloth', 'leather', 'trim'].includes(magicRole)) {
        const detail = scales(0, true);
        if (magicRole === 'leather' && !material.normalMap) {
          material.bumpMap = detail;
          material.bumpScale = 0.004;
        }
        const physical = applyFabMagicSurface(material, {
          tier: [1, 5, 10, 20, 50, 70][tier]!, role: magicRole,
          detailTexture: detail,
        });
        material.dispose();
        return physical;
      }
      if (tierSurface && rareTier === 90) {
        const physical = applyFabMagicSurface(material, { tier: 90, role: 'trim' });
        physical.metalness = material.metalness;
        physical.iridescence = 0.9;
        material.dispose();
        return physical;
      }
      return material;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(apply) : apply(mesh.material);
  });
  return true;
}
