import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PMREMGenerator, WebGPURenderer } from 'three/webgpu';
import { loadAssetModel } from './creature.js';
import { isActorModel, loadActorModel } from './actor.js';
import { actorSpec } from './actorEntity.js';
import { CREATURE_THUMBNAIL_KEY as CREATURE_KEY, creatureThumbnailKey } from './thumbnailKeys.js';
import { viewerRegistry } from './registry.js';
import type { ViewerModel } from './types.js';
import { RESOLVED_TABLES } from '../../../game/src/content/resolvedCatalog.js';
import type { CreatureSkin } from '../../../game/src/content/schema/creatureSkins.js';
import type { ThumbnailProvider } from '../ui/assetThumbnails.js';
import { itemIconSource } from '../ui/Thumb.js';
import { backend, can } from '../api/backend.js';
import { gameUrl } from '../model/gameUrl.js';
import { gameFileUrl } from './registry.js';

/**
 * Client-side thumbnail renderer for manifest GLBs and creatures. One shared offscreen renderer draws
 * a single frame per asset at the rest pose of its idle clip, and the PNG is kept so the next session
 * reads a file instead of loading the model. The player build never imports this.
 *
 * Where a render is kept depends on the mode (`thumbnailCache`):
 *  - the checkout (`can("assets")`) keeps its cache under `devdocs/generated/thumbnails/`, through
 *    `/__devdocs/thumbnails/<key>.png`. That folder is ignored by git and never ships, so renders
 *    stay out of `game/public` and out of the asset host's release tree;
 *  - a live server that stores files (`can("files")`) keeps them in its asset store at
 *    `assets/thumbnails/<key>.png` (`backend().putFiles`). Its index says what is there, so a stored
 *    render is shown straight from `/content-assets/` without a request to ask, to every author;
 *  - anything else renders every session.
 * A key carries a hash of what the render shows, so a changed model or look is a new file.
 */
export const THUMBNAIL_SIZE = 192;
/**
 * Transparent, not `--art-background`: theme.css swaps that colour between the dark (#272e27) and
 * light (#e6ead9) themes, and `.thumb` already paints it behind the image.
 */
export const THUMBNAIL_BACKGROUND = 0x000000;
export const THUMBNAIL_BACKGROUND_ALPHA = 0;
const MAX_CONCURRENT_RENDERS = 2;
const ASSET_ID = /^[A-Za-z0-9_-]+$/;
const THUMBNAILS_PATH = '/__devdocs/thumbnails';
/** Same 3/4 front view, slightly above, as ViewerCore.resetCamera. */
const VIEW_DIRECTION = new THREE.Vector3(1, .55, 1.65).normalize();

class ThumbnailStage {
  readonly renderer: WebGPURenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, .01, 2000);
  private readonly stage = new THREE.Group();
  private environment?: THREE.RenderTarget;
  lost = false;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = THUMBNAIL_SIZE; canvas.height = THUMBNAIL_SIZE;
    // The game's own WebGPU renderer, so node materials render as they do in play.
    this.renderer = new WebGPURenderer({ canvas, antialias: true, alpha: true });
    this.renderer.onDeviceLost = () => { this.lost = true; };
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(THUMBNAIL_BACKGROUND, THUMBNAIL_BACKGROUND_ALPHA);
    this.scene.environmentIntensity = .65;
    // Same rig as ViewerCore / production itemIconRenderer so tiles match the viewer.
    this.scene.add(new THREE.HemisphereLight(0xfff1dc, 0x302821, 1.25));
    const key = new THREE.DirectionalLight(0xffe3c2, 3); key.position.set(-3, 5, 4);
    key.castShadow = true; key.shadow.mapSize.set(512, 512);
    Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: .1, far: 14 });
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xb9d1ff, .8); rim.position.set(4, 2, -4); this.scene.add(rim);
    this.scene.add(this.stage);
  }

  async init(): Promise<void> {
    await this.renderer.init();
    const room = new RoomEnvironment();
    const pmrem = new PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room, .04);
    this.scene.environment = this.environment.texture;
    room.dispose(); pmrem.dispose();
  }

  /** Renders one frame of the model at its idle clip's first pose and returns a PNG data URL. */
  render(model: ViewerModel): string | undefined {
    // An actor is already standing in its idle; its own EntityViews owns the bones.
    const actor = isActorModel(model);
    const mixer = new THREE.AnimationMixer(model.animationRoot);
    try {
      this.stage.position.set(0, 0, 0);
      this.stage.add(model.root);
      model.root.traverse(object => { const mesh = object as THREE.Mesh; if (mesh.isMesh) { mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; } });
      const clipName = model.initialClip ?? model.clips[0]?.name;
      const clip = clipName ? model.clips.find(candidate => candidate.name === clipName) : undefined;
      if (clip && !actor) mixer.clipAction(clip).reset().play();
      mixer.update(0);
      // The shared stage still holds the previous model's offset in its world matrix; refresh it
      // before measuring, as ViewerCore does, or the camera frames empty space.
      this.stage.updateMatrixWorld(true);
      const bounds = actor ? model.bounds() : new THREE.Box3().setFromObject(model.root, true);
      if (bounds.isEmpty()) return undefined;
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      this.stage.position.set(-center.x, -bounds.min.y, -center.z);
      this.stage.updateMatrixWorld(true);
      const radius = Math.max(size.length() / 2, .05);
      const angle = THREE.MathUtils.degToRad(this.camera.fov);
      const distance = radius / Math.sin(angle / 2) * 1.08;
      const target = new THREE.Vector3(0, size.y / 2, 0);
      this.camera.near = Math.max(.001, radius / 1000);
      this.camera.far = Math.max(100, distance * 10);
      this.camera.position.copy(target).add(VIEW_DIRECTION.clone().multiplyScalar(distance));
      this.camera.lookAt(target);
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);
      // Read the canvas in the same task as the draw, before the frame is presented.
      if (this.lost || this.renderer.info.render.triangles === 0) return undefined;
      return this.renderer.domElement.toDataURL('image/png');
    } finally {
      mixer.stopAllAction();
      mixer.uncacheRoot(model.animationRoot);
      this.stage.clear();
    }
  }

  dispose(): void {
    this.scene.traverse(object => { if (object instanceof THREE.DirectionalLight) object.shadow.dispose(); });
    this.scene.clear();
    this.environment?.dispose();
    this.renderer.dispose();
  }
}

let stage: Promise<ThumbnailStage> | undefined;
async function sharedStage(): Promise<ThumbnailStage> {
  if (stage && (await stage).lost) { (await stage).dispose(); stage = undefined; }
  return stage ??= (async () => {
    const created = new ThumbnailStage();
    await created.init();
    return created;
  })();
}

/** Bounded render queue: model loads run in parallel, but the GPU work is serialised two at a time. */
let active = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT_RENDERS) await new Promise<void>(resolve => waiting.push(resolve));
  active++;
  try { return await task(); }
  finally { active--; waiting.shift()?.(); }
}

const negative = new Set<string>();

/** Renders a manifest asset to a PNG data URL. Undefined for procedural ids, animation libraries and empty geometry. */
export async function renderAssetThumbnail(assetId: string): Promise<string | undefined> {
  if (negative.has(assetId) || !ASSET_ID.test(assetId)) return undefined;
  const assets = await viewerRegistry();
  const entry = assets.entry(assetId);
  // Procedural gear is factory-built and has no manifest entry; animation packs carry no mesh.
  if (!entry || entry.category === 'animation') { negative.add(assetId); return undefined; }
  return withSlot(async () => {
    const model = await loadAssetModel({ mode: 'asset', assetId });
    try {
      const dataUrl = (await sharedStage()).render(model);
      if (!dataUrl) negative.add(assetId);
      return dataUrl;
    } finally { model.dispose(); }
  });
}

/** The cache key carries the model's content hash, so a replaced model never shows its old render. */
async function assetKey(assetId: string): Promise<string> {
  const entry = (await viewerRegistry()).entry(assetId) as { sha256?: string; bytes?: number } | undefined;
  // Older manifest rows have no hash; their byte size still changes when the file is replaced.
  const version = entry?.sha256?.slice(0, 16) ?? (entry?.bytes ? `b${entry.bytes}` : undefined);
  return version ? `${assetId}-${version}` : assetId;
}

/** Where a rendered PNG is kept, by key: a URL that shows it now, or undefined; and a way to keep one. */
interface ThumbnailCache {
  cached(key: string): Promise<string | undefined>;
  /** Keeps the PNG, and answers the URL it is shown from once kept. */
  store(key: string, dataUrl: string): Promise<string | undefined>;
}

const REPO_CACHE: ThumbnailCache = {
  async cached(key) {
    const url = `${THUMBNAILS_PATH}/${key}.png`;
    try {
      const response = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
      return response.ok && (response.headers.get('content-type') ?? '').startsWith('image/png') ? url : undefined;
    } catch { return undefined; }
  },
  async store(key, dataUrl) {
    const url = `${THUMBNAILS_PATH}/${key}.png`;
    try {
      const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }) });
      return response.ok ? url : undefined;
    } catch { return undefined; }
  },
};

const storePath = (key: string): string => `assets/thumbnails/${key}.png`;
/** Renders finished within this window go to the server in one `putFiles`. */
export const THUMBNAIL_STORE_BATCH_MS = 1500;
let batch: { files: Record<string, string>; sent: Promise<boolean> } | undefined;

const FILE_STORE_CACHE: ThumbnailCache = {
  async cached(key) {
    // The store's index is loaded with the backend and after every `putFiles`: a held path resolves to the store.
    const url = gameFileUrl(storePath(key));
    return url === gameUrl(storePath(key)) ? undefined : url;
  },
  async store(key, dataUrl) {
    const current = batch ??= { files: {}, sent: new Promise(resolve => setTimeout(() => {
      batch = undefined;
      backend().putFiles(current.files).then(() => resolve(true), () => resolve(false));
    }, THUMBNAIL_STORE_BATCH_MS)) };
    current.files[storePath(key)] = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return await current.sent ? FILE_STORE_CACHE.cached(key) : undefined;
  },
};

function thumbnailCache(): ThumbnailCache | undefined {
  return can('assets') ? REPO_CACHE : can('files') ? FILE_STORE_CACHE : undefined;
}

/** A kept render when there is one; otherwise render in the browser, show the data URL and keep it. */
async function cachedRender(key: string | undefined, render: () => Promise<string | undefined>): Promise<string | undefined> {
  const cache = key === undefined ? undefined : thumbnailCache();
  const kept = cache && key !== undefined ? await cache.cached(key) : undefined;
  if (kept) return kept;
  const dataUrl = await render();
  if (cache && key !== undefined && dataUrl) void cache.store(key, dataUrl);
  return dataUrl;
}

/** Renders in the browser, and keeps each render where this mode can (see the top of this file). */
export function createThumbnailProvider(): ThumbnailProvider {
  return async assetId => {
    if (assetId.startsWith(CREATURE_KEY)) {
      const creatureId = assetId.slice(CREATURE_KEY.length);
      return cachedRender(await creatureKey(creatureId).catch(() => undefined), () => renderCreatureThumbnail(creatureId));
    }
    if (!ASSET_ID.test(assetId)) return undefined;
    // An item's picture is its generated icon, never a render of the model (docs/item-icons.md).
    const itemId = ((await viewerRegistry()).entry(assetId) as { itemId?: string } | undefined)?.itemId
      ?? (assetId.startsWith('corealm_item_') ? assetId.slice('corealm_item_'.length) : undefined);
    if (itemId) return itemIconSource(itemId, true);
    return cachedRender(await assetKey(assetId), () => renderAssetThumbnail(assetId));
  };
}

function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 0x01000193);
  return (value >>> 0).toString(16).padStart(8, '0');
}

/**
 * The cached file name changes with anything that changes the drawn look: model file, scale, tier,
 * rank, dye seed, the rolled skin and colour (in `view`), the variation range, and the skin's maps.
 */
async function creatureKey(creatureId: string): Promise<string | undefined> {
  if (!ASSET_ID.test(creatureId)) return undefined;
  const { entity, variation } = actorSpec(creatureId);
  const entry = (await viewerRegistry()).entry(entity.view!.assetId) as { sha256?: string; bytes?: number } | undefined;
  const skinId = entity.view!.skinId;
  const skin = skinId ? (RESOLVED_TABLES.creatureSkins as CreatureSkin[] | undefined)?.find(row => row.id === skinId) : undefined;
  const look = JSON.stringify([entity.id, entity.archetype, entity.tier, entity.view, variation, skin?.sha256 ?? skin?.maps ?? null, entry?.sha256 ?? entry?.bytes ?? null]);
  return `actor--${creatureId}-${hash(look)}`;
}

/** Renders a creature definition as the game draws it, to a PNG data URL. */
export async function renderCreatureThumbnail(creatureId: string): Promise<string | undefined> {
  const key = creatureThumbnailKey(creatureId);
  if (negative.has(key)) return undefined;
  return withSlot(async () => {
    const model = await loadActorModel({ mode: 'actor', creatureId });
    try {
      const dataUrl = (await sharedStage()).render(model);
      if (!dataUrl) negative.add(key);
      return dataUrl;
    } finally { model.dispose(); }
  }).catch(() => { negative.add(key); return undefined; });
}

/** Forces a fresh render and returns the URL it is kept at, with a cache-busting query, once it is kept. */
export async function regenerateAssetThumbnail(assetId: string): Promise<string | undefined> {
  negative.delete(assetId);
  const dataUrl = await renderAssetThumbnail(assetId);
  if (!dataUrl) return undefined;
  const url = await thumbnailCache()?.store(await assetKey(assetId), dataUrl);
  return url ? `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}` : dataUrl;
}
