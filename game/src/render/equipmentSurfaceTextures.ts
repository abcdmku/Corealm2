import * as THREE from "three";

// Accepted lab captures and source hashes are recorded in art/equipment-retexture/acceptance.json.
const productionEnabled = true;
const textureFiles = {
  metal: "worked-metal.png",
  wood: "wood-grain.png",
  leather: "leather-grain.png",
} as const;
type Surface = keyof typeof textureFiles;
const textures = new Map<Surface, THREE.Texture>();
const pending = new Map<Surface, Promise<void>>();
const applied = new WeakSet<THREE.Material>();

export function equipmentSurfaceTexturesEnabled(): boolean {
  return productionEnabled || (typeof location !== "undefined"
    && new URLSearchParams(location.search).get("equipmentTextures") === "1");
}

function surfaceTexture(surface: Surface): THREE.Texture {
  const cached = textures.get(surface);
  if (cached) return cached;
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  // Callers can await the original rejecting promise without an unhandled rejection
  // when a material starts loading before the lab asks for readiness.
  void ready.catch(() => undefined);
  pending.set(surface, ready);
  const texture = new THREE.TextureLoader().load(
    `/assets/textures/equipment/${textureFiles[surface]}`, () => resolve(), undefined, reject,
  );
  texture.name = `equipment-surface-${surface}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.userData.equipmentSurface = surface;
  textures.set(surface, texture);
  return texture;
}

/** Explicit browser preload for deterministic lab captures. Importing is safe in Node. */
export async function preloadEquipmentSurfaceTextures(): Promise<void> {
  if (typeof document === "undefined") return;
  for (const surface of Object.keys(textureFiles) as Surface[]) surfaceTexture(surface);
  await equipmentSurfaceTexturesReady();
}

/** Wait for every load already requested by appearance application or explicit preload. */
export async function equipmentSurfaceTexturesReady(): Promise<void> {
  await Promise.all(pending.values());
}

/** Apply after tier treatment. No geometry, UVs, authored PBR maps or colours are changed. */
export function applyEquipmentSurfaceTexture(material: THREE.Material, assetId: string): void {
  if (!equipmentSurfaceTexturesEnabled() || typeof document === "undefined" || applied.has(material)) return;
  if (!/^corealm_(sword|dagger|axe|shield|staff|wand)_[1-4]$/.test(assetId)) return;
  const shaded = material as THREE.MeshStandardMaterial;
  if (!shaded.isMeshStandardMaterial) return;
  const role = material.userData.equipmentRole as string | undefined;
  const dagger = /^corealm_dagger_[1-4]$/.test(assetId);
  const surface: Surface | undefined = role === "blade" || role === "metal" ? "metal"
    : dagger && (role === "wood" || role === "leather") ? role : undefined;
  if (!surface) return;

  // Runtime daggers have no UV attribute on either their lofted grip or forged blade.
  // File-backed wood/leather retain their own UV textures from the asset pipeline.
  const texture = surfaceTexture(surface);
  const inheritedCompile = material.onBeforeCompile;
  const inheritedCacheKey = material.customProgramCacheKey.bind(material);
  // This metal image contains dozens of hammer marks across a tile. At .25 m,
  // those marks average away at the normal combat camera distance. A 1.8 m tile
  // puts a few marks across a blade while retaining the same restrained contrast.
  const tileMetres = surface === "metal" ? 1.8 : 0.075;
  material.onBeforeCompile = (shader, renderer): void => {
    inheritedCompile.call(material, shader, renderer);
    shader.uniforms.equipmentSurfaceMap = { value: texture };
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `
      #include <common>
      varying vec3 vEquipmentSurfacePosition;
      varying vec3 vEquipmentSurfaceNormal;
    `).replace("#include <begin_vertex>", `
      #include <begin_vertex>
      vEquipmentSurfacePosition = position;
      vEquipmentSurfaceNormal = normal;
    `);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `
      #include <common>
      uniform sampler2D equipmentSurfaceMap;
      varying vec3 vEquipmentSurfacePosition;
      varying vec3 vEquipmentSurfaceNormal;
    `).replace("#include <lights_physical_fragment>", `
      vec3 equipmentProjectionWeights = pow(abs(normalize(vEquipmentSurfaceNormal)), vec3(4.0));
      equipmentProjectionWeights /= max(dot(equipmentProjectionWeights, vec3(1.0)), 0.0001);
      vec3 equipmentSurfacePosition = vEquipmentSurfacePosition / ${tileMetres.toFixed(3)};
      vec3 equipmentSurfaceSample =
        texture2D(equipmentSurfaceMap, equipmentSurfacePosition.yz).rgb * equipmentProjectionWeights.x
        + texture2D(equipmentSurfaceMap, equipmentSurfacePosition.xz).rgb * equipmentProjectionWeights.y
        + texture2D(equipmentSurfaceMap, equipmentSurfacePosition.xy).rgb * equipmentProjectionWeights.z;
      float equipmentSurfaceValue = dot(equipmentSurfaceSample, vec3(0.2126, 0.7152, 0.0722));
      // Neutral grain multiplies the completed tier treatment around one. The PNG's
      // nominal .55 sRGB midtone is approximately .263 in linear shader space.
      float equipmentSurfaceDetail = clamp(equipmentSurfaceValue / 0.263 - 1.0, -1.0, 1.0);
      diffuseColor.rgb *= 1.0 + equipmentSurfaceDetail * ${surface === "metal" ? "0.25" : "0.30"};
      roughnessFactor = clamp(roughnessFactor - equipmentSurfaceDetail * 0.055, 0.04, 1.0);
      #include <lights_physical_fragment>
    `);
  };
  material.customProgramCacheKey = (): string => `${inheritedCacheKey()}|equipment-surface-v2:${surface}:${tileMetres}`;
  material.userData.equipmentSurfaceTexture = surface;
  material.needsUpdate = true;
  applied.add(material);
}
