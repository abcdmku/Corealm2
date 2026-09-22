import { assetBaseUrl } from "../app/config.js";
import * as THREE from 'three';
import { float, mix, smoothstep, vec3, vertexColor } from 'three/tsl';
import { cloneNodeMaterial, composeSurface } from './nodeMaterials.js';
import type { EquipSlot } from '../contracts.js';
import type { CharacterBody, GearAppearance } from './equipmentVisuals.js';
import { applyFabMagicSurface } from './fabMagicSurface.js';
import { applyRareMageMaterial } from './fabMageArmor.js';
import { applyMysticClothMaterial, type MysticClothPanel } from './fabMysticCloth.js';

const crafted = ['marchhide', 'bramblehide', 'cairnpelt', 'charhide', 'dragonhide', 'starhide'] as const;
/** Tier 0 salvage: the tier-1 mage kit's own textures in undyed linen, hide and horn. */
const SALVAGE = { set: 'worn', cloth: 0xd9a46a, leather: 0xbdb3a6, trim: 0xa8906a } as const;
const rare = ['duskguard', 'oathguard', 'frostguard', 'tideweave', 'nightweave', 'frostweave'] as const;
const slots: Record<string, EquipSlot> = {
  hood: 'head', helm: 'head', robe: 'body', plate: 'body', leggings: 'legs', greaves: 'legs',
  wraps: 'hands', gauntlets: 'hands', boots: 'feet',
};

export function fabArmorAppearance(itemId: string, body: CharacterBody): GearAppearance | null {
  const segments = itemId.split('_');
  const set = segments[0];
  const slot = slots[segments[segments.length - 1] ?? ''];
  if (!slot) return null;
  // The tier 0 hide set is salvaged from the tier-1 kit and wears the same imported mage parts.
  // Resolving it against the retired ranger outfit instead would dress it in bare hands.
  if (set === SALVAGE.set && segments[1] === 'hide') {
    return { itemId, assetId: `fab_${body}_mage_${slot}`, slot, attach: 'skin' };
  }
  if (crafted.includes(set as typeof crafted[number])) {
    return { itemId, assetId: `fab_${body}_mage_${slot}`, slot, attach: 'skin' };
  }
  if (rare.includes(set as typeof rare[number])) {
    // The new authored Aurora hood needs a real fitted fallback for other bodies.
    if (itemId === 'frostweave_hood') return { itemId, assetId: `fab_${body}_mage_head`, slot, attach: 'skin' };
    return { itemId, assetId: `fab_${body}_${set}_${slot}`, slot, attach: 'skin' };
  }
  return null;
}

const textures = new Map<string, THREE.Texture>();
const textureLoads: Promise<Error | undefined>[] = [];
function loadTexture(name: string, extension = 'png'): THREE.Texture {
  let result!: THREE.Texture;
  textureLoads.push(new Promise(resolve => {
    result = new THREE.TextureLoader().load(`${assetBaseUrl()}textures/fab-armor/${name}.${extension}`,
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
  // Tier 0 salvage wears the tier-1 mage kit with its own textures and no dye. Without this it
  // falls through undyed, which leaves the glove's hand region reading as bare skin.
  const salvage = set === SALVAGE.set;
  const tier = salvage ? 0 : crafted.indexOf(set as typeof crafted[number]);
  object.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const apply = (source: THREE.Material): THREE.Material => {
      const material = cloneNodeMaterial(source);
      if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return material;
      const shaded = material as THREE.MeshStandardMaterial;
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
        shaded.map = texture(`fabric-${[1, 5, 10, 20, 50, 70][tier]}`);
        material.color.setHex(salvage ? SALVAGE.cloth : 0xffffff);
        shaded.metalness = 0;
        shaded.roughness = tier < 4 ? 0.9 : 0.72;
      } else if (tier >= 0 && role === 'fab_leather') {
        // Salvage wears plain brown leather. The dyed scale sheet is a crafted-tier treatment, and
        // its teal albedo cannot be tinted back to undyed hide.
        shaded.map = salvage ? texture('leather') : scales(0, false);
        material.color.setHex(salvage ? SALVAGE.leather : [0xa8b4c8, 0x8fbd9c, 0xa8a3c9, 0xbba89c, 0xb9a2c7, 0xc3d5ef][tier]!);
        material.color.multiplyScalar(salvage ? 1 : 1.5);
        shaded.metalness = 0;
        shaded.roughness = 0.8;
      } else if (tier >= 0 && role === 'fab_trim') {
        material.color.setHex(salvage ? SALVAGE.trim : [0x9a8771, 0xaaa393, 0xaeb8c6, 0xc18b59, 0xc3a471, 0xc4d2e7][tier]!);
        shaded.metalness = 0.35;
        shaded.roughness = 0.52;
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
        const dye = rareTier === 50 ? vec3(0.10, 0.42, 0.95)
          : rareTier === 70 ? vec3(0.12, 0.055, 0.25) : vec3(0.35, 0.85, 0.78);
        if (material.vertexColors) {
          composeSurface(material, {
            color: previous => previous.mul(vertexColor().rgb),
            opacity: previous => previous.mul(vertexColor().a),
          });
          material.vertexColors = false;
        }
        composeSurface(material, {
          color: previous => {
            const luminance = previous.dot(vec3(0.2126, 0.7152, 0.0722));
            const warm = smoothstep(0.015, 0.10, previous.r.sub(previous.b))
              .mul(smoothstep(0.035, 0.16, luminance));
            const silver = smoothstep(0.32, 0.65, luminance);
            const dark = float(1).sub(smoothstep(0.004, 0.025, luminance));
            const dyed = dye.mul(0.92).mul(luminance.max(0).pow(0.62));
            const preserve = warm.mul(0.92).max(silver.mul(0.82)).max(dark.mul(rareTier === 50 ? 0.15 : 0.85));
            return mix(mix(previous, dyed, 0.78), previous.mul(0.94), preserve);
          },
        });
      }
      material.name = `${source.name}|fab:${set}`;
      material.needsUpdate = true;
      // Salvage keeps the plain standard material. The magic surface's shimmer and iridescence are
      // what make a crafted mage set read as enchanted, which tier 0 gear has no business doing.
      if (tier >= 0 && !salvage && ['cloth', 'leather', 'trim'].includes(magicRole)) {
        const detail = scales(0, true);
        if (magicRole === 'leather' && !shaded.normalMap) {
          shaded.bumpMap = detail;
          shaded.bumpScale = 0.004;
        }
        const physical = applyFabMagicSurface(shaded, {
          tier: [1, 5, 10, 20, 50, 70][tier]!, role: magicRole,
          detailTexture: detail,
        });
        material.dispose();
        return physical;
      }
      if (tierSurface && rareTier === 90) {
        const physical = applyFabMagicSurface(shaded, { tier: 90, role: 'trim' });
        physical.metalness = shaded.metalness;
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
