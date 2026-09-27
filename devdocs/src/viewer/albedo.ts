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

/** Where a model's own maps live: embedded in its GLB. Paths are repo-relative. */
export interface ModelFile { file: string; bytes?: number; sha256?: string; pack?: string }

export async function modelFile(assetId: string): Promise<ModelFile | undefined> {
  const entry = (await viewerRegistry()).entry(assetId);
  if (!entry) return undefined;
  // The manifest records each file's hash; the entry type does not name it.
  const { sha256 } = entry as { sha256?: string };
  return { file: `game/public/assets/${entry.file.replace(/^\/+/, '')}`, bytes: entry.bytes, sha256, pack: entry.pack };
}

/**
 * The UV wireframe of every mesh that draws with `material`, as a transparent PNG of `size`, for an
 * artist painting that material's map by hand. Coordinates follow the map's own orientation (a glTF
 * map is unflipped: v runs down from the image's top), so the lines sit on the pixels they sample.
 */
export async function uvLayout(assetId: string, material: string, size: { width: number; height: number }, color = 'rgba(96, 240, 210, 0.9)'): Promise<Blob> {
  const source = await (await viewerRegistry()).load(assetId);
  const { width, height } = size;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d')!;
  context.strokeStyle = color;
  context.lineWidth = Math.max(1, Math.round(Math.max(width, height) / 1024));
  context.lineJoin = 'round';
  source.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const geometry = mesh.geometry;
    const index = geometry.index;
    const count = index ? index.count : geometry.getAttribute('position').count;
    // Array materials draw by geometry group; a single material draws the whole range.
    const ranges = Array.isArray(mesh.material)
      ? geometry.groups.map(group => ({ start: group.start, end: Math.min(count, group.start + group.count), material: materials[group.materialIndex ?? 0] }))
      : [{ start: 0, end: count, material: mesh.material }];
    for (const range of ranges) {
      if (!range.material || range.material.name.split('@', 1)[0] !== material) continue;
      const map = (range.material as THREE.MeshStandardMaterial).map;
      const uv = geometry.getAttribute(map && map.channel ? `uv${map.channel}` : 'uv') ?? geometry.getAttribute('uv');
      if (!uv) continue;
      const flip = map?.flipY ?? false;
      const at = (vertex: number): [number, number] => {
        const v = uv.getY(vertex);
        return [uv.getX(vertex) * width, (flip ? 1 - v : v) * height];
      };
      const seen = new Set<number>();
      context.beginPath();
      for (let corner = range.start; corner + 2 < range.end; corner += 3) {
        const a = index ? index.getX(corner) : corner, b = index ? index.getX(corner + 1) : corner + 1, c = index ? index.getX(corner + 2) : corner + 2;
        for (const [from, to] of [[a, b], [b, c], [c, a]] as const) {
          // Shared edges are drawn once: an edge key from its two vertex indices.
          const key = from < to ? from * 0x200000 + to : to * 0x200000 + from;
          if (seen.has(key)) continue;
          seen.add(key);
          const [x1, y1] = at(from), [x2, y2] = at(to);
          context.moveTo(x1, y1);
          context.lineTo(x2, y2);
        }
      }
      context.stroke();
    }
  });
  return canvas.convertToBlob({ type: 'image/png' });
}
