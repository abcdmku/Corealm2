import type * as THREE from 'three';
import { RESOLVED_TABLES } from '../../../game/src/content/resolvedCatalog.js';
import type { CreatureSkin } from '../../../game/src/content/schema/creatureSkins.js';
import { backend } from '../api/backend.js';
import { gameUrl } from '../model/gameUrl.js';
import { viewerRegistry } from './registry.js';

/**
 * The albedo maps a creature model draws with, as PNGs, so the browser can recolor them or send
 * them to image generation as references. Contract: the actor-stage owner implements this.
 */
export interface AlbedoMap {
  /** The model's material name; skins key their maps by it. */
  material: string;
  width: number;
  height: number;
  png: Blob;
}

/**
 * The maps of `assetId` as the game would draw them: the model's own, or `skinId`'s where that skin
 * replaces a material. Materials without a colour map are left out.
 */
export async function albedoMaps(assetId: string, skinId?: string): Promise<AlbedoMap[]> {
  const assets = await viewerRegistry();
  const [source, skin] = await Promise.all([assets.load(assetId), skinId ? creatureSkin(skinId) : undefined]);
  const own = new Map<string, THREE.Texture>();
  source.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const map = (material as THREE.MeshStandardMaterial).map;
      // The imported name, without the renderer's `@variant` suffixes: the key skins use.
      const name = material.name.split('@', 1)[0]!;
      if (map && name && !own.has(name)) own.set(name, map);
    }
  });
  const maps = await Promise.all([...own].map(async ([material, texture]): Promise<AlbedoMap | null> => {
    const path = skin?.maps[material];
    if (path) return skinMap(material, path);
    return textureMap(material, texture);
  }));
  return maps.filter((map): map is AlbedoMap => map !== null);
}

/** The skin row from the running catalog, or from the store when it was saved after this page loaded. */
async function creatureSkin(skinId: string): Promise<CreatureSkin> {
  const bundled = (RESOLVED_TABLES.creatureSkins as CreatureSkin[] | undefined)?.find(skin => skin.id === skinId);
  if (bundled) return bundled;
  const { data } = await backend().collection('creatureSkins');
  const rows = (Array.isArray(data) ? data : Object.values(data as Record<string, CreatureSkin>)) as CreatureSkin[];
  const stored = rows.find(skin => skin.id === skinId);
  if (!stored) throw new Error(`Unknown creature skin ${skinId}`);
  return stored;
}

async function skinMap(material: string, path: string): Promise<AlbedoMap> {
  const response = await fetch(gameUrl(`assets/${path}`));
  if (!response.ok) throw new Error(`Skin map ${path} failed: ${response.status}`);
  const file = await response.blob();
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  try {
    return { material, width, height, png: file.type === 'image/png' ? file : await encode(bitmap, width, height) };
  } finally { bitmap.close(); }
}

/**
 * The texture's image as the file stores it. The game's loader decodes with the file's own
 * orientation and leaves `flipY` to the upload, so drawing the image unflipped round-trips: a PNG
 * saved from this and loaded as a skin lands on the same UVs.
 */
async function textureMap(material: string, texture: THREE.Texture): Promise<AlbedoMap | null> {
  const image = texture.image as CanvasImageSource & { width?: number; height?: number } | null;
  const drawable = typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap
    || typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement
    || typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement
    || typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas;
  // Compressed or raw pixel textures have no drawable image; nothing in the creature packs uses them.
  if (!drawable || !image.width || !image.height) return null;
  return { material, width: image.width, height: image.height, png: await encode(image, image.width, image.height) };
}

async function encode(image: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}
