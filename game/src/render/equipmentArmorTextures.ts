import * as THREE from "three";

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
  const url = kind === "metal" ? "/assets/textures/equipment/worked-metal.png"
    : `/assets/textures/armor/${kind}.png`;
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
    `/assets/textures/armor/${key}.png`, () => resolve(), undefined, reject,
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
  const shaded = material as THREE.MeshStandardMaterial;
  if (!shaded.isMeshStandardMaterial || (!procedural && !shaded.metalnessMap)) return false;
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
  const inheritedCompile = material.onBeforeCompile;
  const inheritedKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer): void => {
    inheritedCompile.call(material, shader, renderer);
    shader.uniforms.armorHeightMap = { value: height };
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `
      #include <common>
      uniform sampler2D armorHeightMap;
      // Surface-gradient bump over the already evaluated native tangent-space normal.
      // Unnormalized position derivatives retain the height's view-space metre scale.
      vec3 armorReliefNormal(vec3 positionView, vec3 surfaceNormal, vec2 heightGradient, float facing) {
        vec3 dx = dFdx(positionView);
        vec3 dy = dFdy(positionView);
        vec3 rx = cross(dy, surfaceNormal);
        vec3 ry = cross(surfaceNormal, dx);
        float determinant = dot(dx, rx) * facing;
        if (abs(determinant) < 1e-12) return surfaceNormal;
        vec3 gradient = sign(determinant) * (heightGradient.x * rx + heightGradient.y * ry);
        return normalize(abs(determinant) * surfaceNormal - gradient);
      }
    `).replace("#include <metalnessmap_fragment>", `
      #include <metalnessmap_fragment>
      float armorMetalMask = smoothstep(0.20, 0.70, metalnessFactor);
      float armorHeight = texture2D(armorHeightMap, vMapUv).r;
      float armorBurnish = smoothstep(0.55, 0.85, armorHeight) * armorMetalMask;
      // ORM variation retains the authored seams, leather grain, and worn plate detail.
      float armorNativeRoughness = roughnessFactor;
      float armorLeatherRoughness = clamp(${settings.leatherRoughness.toFixed(3)}
        + (armorNativeRoughness - 0.60) * 0.18, 0.40, 0.88);
      float armorMetalRoughness = clamp(${settings.metalRoughness.toFixed(3)}
        + (armorNativeRoughness - 0.40) * 0.16 - armorBurnish * 0.065, 0.13, 0.44);
      roughnessFactor = mix(armorLeatherRoughness, armorMetalRoughness, armorMetalMask);
      metalnessFactor = mix(min(metalnessFactor, 0.05), ${settings.metalness.toFixed(3)}, armorMetalMask);
      // Lift the atlas leather's dyed base while preserving its seams and grain.
      diffuseColor.rgb *= mix(1.20, 1.0, armorMetalMask);
    `).replace("#include <normal_fragment_maps>", `
      #include <normal_fragment_maps>
      vec2 armorUvDx = dFdx(vMapUv);
      vec2 armorUvDy = dFdy(vMapUv);
      vec2 armorHeightGradient = vec2(
        texture2D(armorHeightMap, vMapUv + armorUvDx).r - armorHeight,
        texture2D(armorHeightMap, vMapUv + armorUvDy).r - armorHeight
      ) * ${settings.relief.toFixed(4)};
      normal = armorReliefNormal(-vViewPosition, normal, armorHeightGradient, faceDirection);
    `);
  };
  material.customProgramCacheKey = (): string => `${inheritedKey()}|ornate-armor-v2:${armorTier}`;
  // CharacterRig batches by name/color, so mixed tiers must have distinct identities.
  material.name = `${material.name || material.type}|armor:${armorTier}`;
  material.userData.equipmentArmorTexture = armorTier;
  material.userData.equipmentArmorReliefMetres = settings.relief;
  material.needsUpdate = true;
  applied.add(material);
  return true;
}

function applyArmorPartTexture(material: THREE.MeshStandardMaterial, tier: ArmorTier, partName: string): boolean {
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
  const inheritedCompile = material.onBeforeCompile;
  const inheritedKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer): void => {
    inheritedCompile.call(material, shader, renderer);
    shader.uniforms.armorPartAlbedo = { value: albedo };
    shader.uniforms.armorPartHeight = { value: height };
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `
      #include <common>
      varying vec3 vArmorPartPosition;
      varying vec3 vArmorPartNormal;
    `).replace("#include <begin_vertex>", `
      #include <begin_vertex>
      vArmorPartPosition = position;
      vArmorPartNormal = normal;
    `);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `
      #include <common>
      uniform sampler2D armorPartAlbedo;
      uniform sampler2D armorPartHeight;
      varying vec3 vArmorPartPosition;
      varying vec3 vArmorPartNormal;
      vec3 armorPartSample(sampler2D tex, vec3 p, vec3 w) {
        return texture2D(tex, p.yz).rgb * w.x
          + texture2D(tex, p.xz).rgb * w.y + texture2D(tex, p.xy).rgb * w.z;
      }
    `).replace("#include <color_fragment>", `
      #include <color_fragment>
      vec3 armorPartWeights = pow(abs(normalize(vArmorPartNormal)), vec3(6.0));
      armorPartWeights /= max(dot(armorPartWeights, vec3(1.0)), 0.0001);
      vec3 armorPartPoint = vArmorPartPosition / ${tileMetres.toFixed(3)};
      float armorPartValue = dot(armorPartSample(armorPartAlbedo, armorPartPoint, armorPartWeights),
        vec3(0.2126, 0.7152, 0.0722));
      diffuseColor.rgb *= clamp(armorPartValue / 0.263, 0.48, 1.55);
      float armorPartHeightValue = armorPartSample(armorPartHeight, armorPartPoint, armorPartWeights).r;
    `).replace("#include <roughnessmap_fragment>", `
      #include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor - (armorPartValue / 0.263 - 1.0)
        * ${leather ? "0.07" : "0.11"}, ${leather ? "0.40" : "0.14"}, ${leather ? "0.88" : "0.44"});
    `).replace("#include <normal_fragment_maps>", `
      #include <normal_fragment_maps>
      // Sample along the screen derivatives of local position. No UV attributes required.
      vec2 armorPartGradient = vec2(
        armorPartSample(armorPartHeight, armorPartPoint + dFdx(armorPartPoint), armorPartWeights).r - armorPartHeightValue,
        armorPartSample(armorPartHeight, armorPartPoint + dFdy(armorPartPoint), armorPartWeights).r - armorPartHeightValue
      ) * ${reliefMetres.toFixed(5)};
      vec3 armorPartDx = dFdx(-vViewPosition);
      vec3 armorPartDy = dFdy(-vViewPosition);
      vec3 armorPartRx = cross(armorPartDy, normal);
      vec3 armorPartRy = cross(normal, armorPartDx);
      float armorPartDet = dot(armorPartDx, armorPartRx) * faceDirection;
      if (abs(armorPartDet) > 1e-12) {
        normal = normalize(abs(armorPartDet) * normal - sign(armorPartDet)
          * (armorPartGradient.x * armorPartRx + armorPartGradient.y * armorPartRy));
      }
    `);
  };
  const surface = padded ? "padding" : leather ? "strap" : "metal";
  material.customProgramCacheKey = (): string => `${inheritedKey()}|armor-part-v2:${tier}:${surface}`;
  material.name = `${material.name || material.type}|armor:${tier}`;
  material.userData.equipmentArmorTexture = tier;
  material.userData.equipmentArmorPartSurface = surface;
  material.userData.equipmentArmorReliefMetres = reliefMetres;
  material.needsUpdate = true;
  applied.add(material);
  return true;
}
