import * as THREE from 'three';
import { assetBaseUrl } from '../app/config.js';

type Tier = 30 | 40 | 60;
type Surface = 'metal' | 'wood' | 'cloth' | 'leather' | 'lining';
type Treatment = Surface | 'armor-metal-mask' | 'tool-metal-mask';
type Appearance = { assetId: string; itemId?: string };
const families = {
  dewglass: 30, willow: 30, mistweave: 30,
  crownsilver: 40, maple: 40, crownhide: 40,
  staramethyst: 60, yew: 60, faesilk: 60,
} as const;
const surfaces: readonly Surface[] = ['metal', 'wood', 'cloth', 'leather', 'lining'];
const textures = new Map<string, THREE.Texture>();
const pending = new Map<string, Promise<void>>();

function regionalTier(itemId: string | undefined): Tier | undefined {
  if (!itemId || !/_(sword|shield|wand|staff|pickaxe|hatchet|rod|helm|plate|greaves|gauntlets|hood|robe|leggings|wraps|boots)$/.test(itemId)) return undefined;
  return families[itemId.split('_')[0] as keyof typeof families];
}

function texture(tier: Tier, surface: Surface): THREE.Texture {
  const key = `t${tier}-${surface}`, existing = textures.get(key);
  if (existing) return existing;
  let resolve!: () => void, reject!: (error: unknown) => void;
  const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  void ready.catch(() => undefined); pending.set(key, ready);
  const map = new THREE.TextureLoader().load(`${assetBaseUrl()}textures/regional-equipment/${key}.png`, () => resolve(), undefined, reject);
  map.name = `regional-equipment-${key}`; map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false; map.wrapS = map.wrapT = THREE.MirroredRepeatWrapping; map.anisotropy = 8;
  textures.set(key, map); return map;
}

/** Call before accepting a first worn frame. Optional item IDs restrict loading to their tiers. */
export async function preloadRegionalEquipmentTextures(itemIds?: readonly string[]): Promise<void> {
  if (typeof document === 'undefined') return;
  const tiers = itemIds ? [...new Set(itemIds.map(regionalTier).filter((tier): tier is Tier => tier !== undefined))] : [30, 40, 60] as const;
  for (const tier of tiers) for (const surface of surfaces) texture(tier, surface);
  await regionalEquipmentTexturesReady();
}

export async function regionalEquipmentTexturesReady(): Promise<void> {
  await Promise.all(pending.values());
}

function treatment(material: THREE.MeshStandardMaterial, appearance: Appearance, meshName: string): Treatment | null {
  const role = material.userData.equipmentRole as string | undefined;
  const name = material.name.split('|')[0] ?? '';
  if (/^fab_(male|female)_mage_/.test(appearance.assetId)) {
    if (name === 'fab_cloth') return 'cloth';
    if (name === 'fab_leather') return 'lining';
    return null; // Existing clasps, buckles and trim retain their native metal treatment.
  }
  if (/^outfit_(male|female)_knight_/.test(appearance.assetId)) return material.metalnessMap ? 'armor-metal-mask' : null;
  if (/^proc_armour_/.test(appearance.assetId)) {
    return role === 'leather' || /fauld-lame|belt|hanger/.test(meshName) ? 'leather' : 'metal';
  }
  if (appearance.assetId === 'pickaxe') return material.metalnessMap ? 'tool-metal-mask' : null;
  if (/^proc_rod_/.test(appearance.assetId)) {
    if (name === 'proc-rod-varnished-wood' || meshName === 'rod-shaft') return 'wood';
    // The binding draw contains line and bobber too. Preserve those vertex colors and metal reel.
    return null;
  }
  const inferred = role ?? /^corealm-weapon-(wood|leather|blade|metal|gem)$/.exec(name)?.[1];
  if (inferred === 'wood') return 'wood';
  if (inferred === 'leather') return 'leather';
  if (inferred === 'blade') return 'metal';
  if (inferred === 'metal' && appearance.assetId === 'corealm_axe_1') return 'metal';
  // A wand or staff's crystal can carry the tier's mineral image without becoming emissive.
  if (inferred === 'gem') return 'metal';
  return null;
}

/** Material-only overlay. Native diffuse, UVs, vertex detail, normal and ORM maps remain attached. */
function overlay(material: THREE.MeshStandardMaterial, tier: Tier, mode: Treatment): void {
  const surface = mode.endsWith('-mask') ? 'metal' : mode as Surface;
  const generated = texture(tier, surface), wood = mode === 'tool-metal-mask' ? texture(tier, 'wood') : null;
  const hasNativeMap = Boolean(material.map);
  const uvScale = surface === 'wood' ? 2.5 : surface === 'metal' ? 2 : 3;
  const tileMetres = surface === 'wood' ? .30 : surface === 'metal' ? .48 : .20;
  const inheritedCompile = material.onBeforeCompile, inheritedKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer): void => {
    inheritedCompile.call(material, shader, renderer);
    shader.uniforms.regionalEquipmentMap = { value: generated };
    if (wood) shader.uniforms.regionalEquipmentWood = { value: wood };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
      #include <common>
      varying vec3 vRegionalEquipmentPosition;
      varying vec3 vRegionalEquipmentNormal;
      varying vec2 vRegionalEquipmentUv;
    `).replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vRegionalEquipmentPosition = position;
      vRegionalEquipmentNormal = normal;
    `).replace('#include <uv_vertex>', `
      #include <uv_vertex>
      vRegionalEquipmentUv = ${hasNativeMap ? 'vMapUv' : 'vec2(0.0)'};
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      uniform sampler2D regionalEquipmentMap;
      ${wood ? 'uniform sampler2D regionalEquipmentWood;' : ''}
      varying vec3 vRegionalEquipmentPosition;
      varying vec3 vRegionalEquipmentNormal;
      varying vec2 vRegionalEquipmentUv;
      vec3 regionalEquipmentSample(sampler2D sourceMap) {
        ${hasNativeMap ? `return texture2D(sourceMap, vRegionalEquipmentUv * ${uvScale.toFixed(2)}).rgb;` : `
          vec3 weights = pow(abs(normalize(vRegionalEquipmentNormal)), vec3(4.0));
          weights /= max(dot(weights, vec3(1.0)), .0001);
          vec3 p = vRegionalEquipmentPosition / ${tileMetres.toFixed(3)};
          return texture2D(sourceMap, p.yz).rgb * weights.x
            + texture2D(sourceMap, p.xz).rgb * weights.y + texture2D(sourceMap, p.xy).rgb * weights.z;
        `}
      }
    `).replace('#include <lights_physical_fragment>', `
      // Run after native map/color/ORM hooks. Their luminance keeps seams, wear and sculpted detail.
      float regionalNativeLuma = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
      float regionalNativeDetail = clamp(pow(max(regionalNativeLuma, .0001) / .18, .45), .38, 1.45);
      vec3 regionalGenerated = regionalEquipmentSample(regionalEquipmentMap);
      vec3 regionalColor = regionalGenerated * regionalNativeDetail;
      ${mode === 'armor-metal-mask' ? `
        float regionalMetalMask = smoothstep(.20, .70, metalnessFactor);
        diffuseColor.rgb = mix(diffuseColor.rgb, regionalColor, regionalMetalMask * .94);
      ` : mode === 'tool-metal-mask' ? `
        float regionalMetalMask = smoothstep(.20, .70, metalnessFactor);
        vec3 regionalWood = regionalEquipmentSample(regionalEquipmentWood) * regionalNativeDetail;
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(regionalWood, regionalColor, regionalMetalMask), .94);
      ` : 'diffuseColor.rgb = mix(diffuseColor.rgb, regionalColor, .94);'}
      #include <lights_physical_fragment>
    `);
  };
  material.customProgramCacheKey = () => `${inheritedKey()}|regional-equipment-v1:${tier}:${mode}:${hasNativeMap}`;
  material.name = `${material.name || material.type}|regional:${tier}:${mode}`;
  material.userData.regionalEquipmentTexture = { tier, surface, mode };
  material.needsUpdate = true;
}

/** Call before the legacy Fab/tint paths. True means this regional item owns its material treatment. */
export function applyRegionalEquipmentTextures(object: THREE.Object3D, appearance: Appearance): boolean {
  const tier = regionalTier(appearance.itemId);
  if (!tier || typeof document === 'undefined') return false;
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const apply = (source: THREE.Material): THREE.Material => {
      const shaded = source as THREE.MeshStandardMaterial;
      if (!shaded.isMeshStandardMaterial || source.userData.regionalEquipmentTexture) return source;
      const mode = treatment(shaded, appearance, child.name);
      if (!mode) return source;
      const clone = shaded.clone();
      clone.onBeforeCompile = (shader, renderer) => shaded.onBeforeCompile.call(shaded, shader, renderer);
      clone.customProgramCacheKey = shaded.customProgramCacheKey.bind(shaded);
      overlay(clone, tier, mode); return clone;
    };
    child.material = Array.isArray(child.material) ? child.material.map(apply) : apply(child.material);
  });
  return true;
}
