import { assetBaseUrl } from "../app/config.js";
import * as THREE from "three";
import { normalGeometry, positionGeometry, texture as textureNode, varying, vec3 } from "three/tsl";
import { composeSurface, type SurfaceNodeMaterial } from "./nodeMaterials.js";

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
    `${assetBaseUrl()}textures/equipment/${textureFiles[surface]}`, () => resolve(), undefined, reject,
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
export function applyEquipmentSurfaceTexture(material: SurfaceNodeMaterial, assetId: string): void {
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
  // Keep the original local projection so skinned/held tools retain their authored grain.
  const tileMetres = surface === "metal" ? 1.8 : 0.075;
  const normal = varying(normalGeometry).normalize();
  const powers = normal.abs().pow(4);
  const weights = powers.div(powers.dot(vec3(1)).max(0.0001));
  const point = varying(positionGeometry).div(tileMetres);
  const sample = textureNode(texture, point.yz).rgb.mul(weights.x)
    .add(textureNode(texture, point.xz).rgb.mul(weights.y))
    .add(textureNode(texture, point.xy).rgb.mul(weights.z));
  const detail = sample.dot(vec3(0.2126, 0.7152, 0.0722)).div(0.263).sub(1).clamp(-1, 1);
  composeSurface(material, {
    color: previous => previous.mul(detail.mul(surface === "metal" ? 0.25 : 0.30).add(1)),
    roughness: previous => previous.sub(detail.mul(0.055)).clamp(0.04, 1),
  });
  material.userData.equipmentSurfaceTexture = surface;
  material.needsUpdate = true;
  applied.add(material);
}
