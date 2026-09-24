import { assetBaseUrl } from "../app/config.js";
import * as THREE from "three/webgpu";
import { faceDirection, Fn, If, normalGeometry, positionGeometry, positionView, texture, uv, varying, vec2, vec3 } from "three/tsl";
import { composeSurface, surfaceNodes } from "./nodeMaterials.js";

// Accepted through the production lab; evidence: art/equipment-retexture/ornate-armor/.
const productionEnabled = true;
// Weathered plate keeps enough diffuse response for the atlas to read in shade.
// Polished raised edges still catch the existing directional light through roughness.
const tiers = {
  grithe: { metalRoughness: 0.33, leatherRoughness: 0.72, metalness: 0.60, relief: 0.0015 },
  corven: { metalRoughness: 0.32, leatherRoughness: 0.68, metalness: 0.48, relief: 0.0019 },
  kaldite: { metalRoughness: 0.30, leatherRoughness: 0.63, metalness: 0.52, relief: 0.0023 },
  emberite: { metalRoughness: 0.28, leatherRoughness: 0.58, metalness: 0.56, relief: 0.0027 },
  cindersteel: { metalRoughness: 0.27, leatherRoughness: 0.54, metalness: 0.58, relief: 0.0031 },
  nightglass: { metalRoughness: 0.25, leatherRoughness: 0.50, metalness: 0.62, relief: 0.0035 },
} as const;
type ArmorTier = keyof typeof tiers;
type ArmorMap = "albedo" | "height";
const textures = new Map<string, THREE.Texture>();
const pending = new Map<string, Promise<void>>();
const applied = new WeakSet<THREE.Material>();
const partColors: Record<ArmorTier, { metal: number; leather: number }> = {
  grithe: { metal: 0xaf7650, leather: 0x805038 },
  corven: { metal: 0x84908e, leather: 0x80614b },
  kaldite: { metal: 0x507cba, leather: 0x425e83 },
  emberite: { metal: 0xa2acb8, leather: 0x585b62 },
  cindersteel: { metal: 0x56565b, leather: 0x613746 },
  nightglass: { metal: 0x666998, leather: 0x514b76 },
};

function partTexture(kind: "padding-albedo" | "padding-height" | "metal"): THREE.Texture {
  const key = `part-${kind}`;
  const cached = textures.get(key);
  if (cached) return cached;
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  void ready.catch(() => undefined);
  pending.set(key, ready);
  const url = kind === "metal" ? `${assetBaseUrl()}textures/equipment/worked-metal.png`
    : `${assetBaseUrl()}textures/armor/${kind}.png`;
  const texture = new THREE.TextureLoader().load(url, () => resolve(), undefined, reject);
  texture.name = key;
  texture.colorSpace = kind === "padding-height" ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  textures.set(key, texture);
  return texture;
}

export function equipmentArmorTexturesEnabled(): boolean {
  return productionEnabled || (typeof location !== "undefined"
    && new URLSearchParams(location.search).get("armorDetail") === "1");
}

function armorTexture(tier: ArmorTier, kind: ArmorMap): THREE.Texture {
  const key = `${tier}-${kind}`;
  const cached = textures.get(key);
  if (cached) return cached;
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  void ready.catch(() => undefined);
  pending.set(key, ready);
  const texture = new THREE.TextureLoader().load(
    `${assetBaseUrl()}textures/armor/${key}.png`, () => resolve(), undefined, reject,
  );
  texture.name = `equipment-armor-${key}`;
  texture.colorSpace = kind === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  // The generated atlas follows the Knight glTF UV layout, including its orientation.
  texture.flipY = false;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  textures.set(key, texture);
  return texture;
}

/** Explicit preload keeps the first accepted lab frame deterministic. */
export async function preloadEquipmentArmorTextures(): Promise<void> {
  if (typeof document === "undefined" || !equipmentArmorTexturesEnabled()) return;
  for (const tier of Object.keys(tiers) as ArmorTier[]) {
    armorTexture(tier, "albedo");
    armorTexture(tier, "height");
  }
  await equipmentArmorTexturesReady();
}

/** Includes loads started through applyArmorTexture as well as explicit preloads. */
export async function equipmentArmorTexturesReady(): Promise<void> {
  await Promise.all(pending.values());
}

/** Apply only to an owned material clone, before legacy tint and accent treatment. */
export function applyArmorTexture(
  material: THREE.Material,
  appearance: { assetId: string; itemId?: string; partName?: string },
): boolean {
  if (!equipmentArmorTexturesEnabled() || typeof document === "undefined") return false;
  const procedural = /^proc_armour_(fauld|collar)_(1|5|10|20)$/.test(appearance.assetId);
  if (!procedural && !/^outfit_(male|female)_knight_/.test(appearance.assetId)) return false;
  const prefix = appearance.itemId?.split("_")[0];
  const tier = prefix === "nightmarshal" ? "nightglass" : prefix;
  if (!tier || !Object.prototype.hasOwnProperty.call(tiers, tier)) return false;
  const shaded = material as THREE.MeshStandardNodeMaterial;
  if (!shaded.isMeshStandardNodeMaterial || (!procedural && !shaded.metalnessMap)) return false;
  if (applied.has(material)) return true;
  const armorTier = tier as ArmorTier;
  if (procedural) return applyArmorPartTexture(shaded, armorTier, appearance.partName ?? "");
  const settings = tiers[armorTier];
  const height = armorTexture(armorTier, "height");
  shaded.map = armorTexture(armorTier, "albedo");
  shaded.color.setHex(0xffffff);
  shaded.vertexColors = false;
  shaded.emissive.setHex(0x000000);
  shaded.emissiveIntensity = 0;
  // Native ORM is the material mask. Setting both factors to one exposes its full range.
  shaded.metalness = 1;
  shaded.roughness = 1;
  const inherited = surfaceNodes(shaded);
  const metalMask = inherited.metalness.smoothstep(0.20, 0.70);
  const mapUv = uv(shaded.map.channel);
  const heightSample = texture(height, mapUv).r;
  const burnish = heightSample.smoothstep(0.55, 0.85).mul(metalMask);
  const leatherRoughness = inherited.roughness.sub(0.60).mul(0.18)
    .add(settings.leatherRoughness).clamp(0.40, 0.88);
  const metalRoughness = inherited.roughness.sub(0.40).mul(0.16)
    .add(settings.metalRoughness).sub(burnish.mul(0.065)).clamp(0.13, 0.44);
  const heightGradient = vec2(
    texture(height, mapUv.add(mapUv.dFdx())).r.sub(heightSample),
    texture(height, mapUv.add(mapUv.dFdy())).r.sub(heightSample),
  ).mul(settings.relief);
  composeSurface(shaded, {
    // ORM still separates dyed leather and worn plate; only its response is retuned.
    color: previous => previous.mul(metalMask.mix(1.20, 1.0)),
    roughness: () => metalMask.mix(leatherRoughness, metalRoughness),
    metalness: previous => metalMask.mix(previous.min(0.05), settings.metalness),
    normal: previous => reliefNormal(previous, heightGradient),
  });
  // CharacterRig batches by name/color, so mixed tiers must have distinct identities.
  material.name = `${material.name || material.type}|armor:${armorTier}`;
  material.userData.equipmentArmorTexture = armorTier;
  material.userData.equipmentArmorReliefMetres = settings.relief;
  material.needsUpdate = true;
  applied.add(material);
  return true;
}

function applyArmorPartTexture(material: THREE.MeshStandardNodeMaterial, tier: ArmorTier, partName: string): boolean {
  const padded = partName.startsWith("fauld-lame-");
  const leather = padded || material.userData.equipmentRole === "leather"
    || /belt|hanger/.test(partName);
  const settings = tiers[tier];
  const albedo = partTexture(leather ? "padding-albedo" : "metal");
  const height = leather ? partTexture("padding-height") : albedo;
  const tileMetres = leather ? 0.20 : 0.32;
  const reliefMetres = leather ? (padded ? 0.0028 : 0.0010) : 0.00065;
  material.color.setHex(partColors[tier][leather ? "leather" : "metal"]);
  if (leather && !padded) material.color.multiplyScalar(0.65);
  // Preserve the sculpted mail's dark centers, but discard leather's old baked brown tint.
  material.vertexColors = !leather;
  material.emissive.setHex(0x000000);
  material.emissiveIntensity = 0;
  material.metalness = leather ? 0 : settings.metalness;
  material.roughness = leather ? settings.leatherRoughness : settings.metalRoughness;
  // These are the authored local attributes, before skinning, as in the atlas-free
  // cloth treatment. Varyings keep the pattern attached to each moving armor part.
  const localPosition = varying(positionGeometry);
  const localNormal = varying(normalGeometry);
  const weights = localNormal.normalize().abs().pow(vec3(6));
  const blend = weights.div(weights.dot(vec3(1)).max(0.0001));
  const point = localPosition.div(tileMetres);
  const value = triplanar(albedo, point, blend).dot(vec3(0.2126, 0.7152, 0.0722));
  const heightValue = triplanar(height, point, blend).r;
  const gradient = vec2(
    triplanar(height, point.add(point.dFdx()), blend).r.sub(heightValue),
    triplanar(height, point.add(point.dFdy()), blend).r.sub(heightValue),
  ).mul(reliefMetres);
  composeSurface(material, {
    color: previous => previous.mul(value.div(0.263).clamp(0.48, 1.55)),
    roughness: previous => previous.sub(value.div(0.263).sub(1).mul(leather ? 0.07 : 0.11))
      .clamp(leather ? 0.40 : 0.14, leather ? 0.88 : 0.44),
    normal: previous => reliefNormal(previous, gradient),
  });
  const surface = padded ? "padding" : leather ? "strap" : "metal";
  material.name = `${material.name || material.type}|armor:${tier}`;
  material.userData.equipmentArmorTexture = tier;
  material.userData.equipmentArmorPartSurface = surface;
  material.userData.equipmentArmorReliefMetres = reliefMetres;
  material.needsUpdate = true;
  applied.add(material);
  return true;
}

/** View-space surface gradients retain relief in metres over the native normal map. */
function reliefNormal(surfaceNormal: THREE.Node<"vec3">, heightGradient: THREE.Node<"vec2">): THREE.Node<"vec3"> {
  return Fn(() => {
    const dx = positionView.dFdx();
    const dy = positionView.dFdy();
    const rx = dy.cross(surfaceNormal);
    const ry = surfaceNormal.cross(dx);
    const determinant = dx.dot(rx).mul(faceDirection);
    // Derivatives and implicit-LOD samples must execute outside divergent control flow.
    const sampledGradient = heightGradient.toVar();
    const result = surfaceNormal.toVar();
    // Degenerate triangles have no stable surface gradient. Preserve their native normal.
    If(determinant.abs().greaterThan(1e-12), () => {
      const gradient = sampledGradient.x.mul(rx).add(sampledGradient.y.mul(ry)).mul(determinant.sign());
      result.assign(determinant.abs().mul(surfaceNormal).sub(gradient).normalize());
    });
    return result;
  })();
}

function triplanar(map: THREE.Texture, point: THREE.Node<"vec3">, weights: THREE.Node<"vec3">): THREE.Node<"vec3"> {
  return texture(map, point.yz).rgb.mul(weights.x)
    .add(texture(map, point.xz).rgb.mul(weights.y))
    .add(texture(map, point.xy).rgb.mul(weights.z));
}
