import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PMREMGenerator, WebGPURenderer } from 'three/webgpu';
import { loadAssetModel } from './creature.js';
import { viewerRegistry } from './registry.js';
import type { ViewerModel } from './types.js';
import type { ThumbnailProvider } from '../ui/assetThumbnails.js';
import { itemIconSource } from '../ui/Thumb.js';

/**
 * Client-side thumbnail renderer for manifest GLBs. One shared offscreen renderer draws a single
 * frame per asset at the rest pose of its idle clip, and the PNG is handed to the dev server so the
 * next session reads a file instead of loading the model. The player build never imports this.
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
    const mixer = new THREE.AnimationMixer(model.animationRoot);
    try {
      this.stage.position.set(0, 0, 0);
      this.stage.add(model.root);
      model.root.traverse(object => { const mesh = object as THREE.Mesh; if (mesh.isMesh) { mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; } });
      const clipName = model.initialClip ?? model.clips[0]?.name;
      const clip = clipName ? model.clips.find(candidate => candidate.name === clipName) : undefined;
      if (clip) mixer.clipAction(clip).reset().play();
      mixer.update(0);
      // The shared stage still holds the previous model's offset in its world matrix; refresh it
      // before measuring, as ViewerCore does, or the camera frames empty space.
      this.stage.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model.root, true);
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
async function cachedUrl(assetId: string): Promise<string> {
  const entry = (await viewerRegistry()).entry(assetId) as { sha256?: string; bytes?: number } | undefined;
  // Older manifest rows have no hash; their byte size still changes when the file is replaced.
  const version = entry?.sha256?.slice(0, 16) ?? (entry?.bytes ? `b${entry.bytes}` : undefined);
  return `${THUMBNAILS_PATH}/${version ? `${assetId}-${version}` : assetId}.png`;
}

async function readCached(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
    return response.ok && (response.headers.get('content-type') ?? '').startsWith('image/png');
  } catch { return false; }
}

async function storeRendered(url: string, dataUrl: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }) });
    return response.ok;
  } catch { return false; }
}

/**
 * Render in the browser and show the data URL. Repository mode also reads and writes its PNG cache.
 */
export function createThumbnailProvider({ repoCache }: { repoCache: boolean }): ThumbnailProvider {
  return async assetId => {
    if (!ASSET_ID.test(assetId)) return undefined;
    // An item's picture is its generated icon, never a render of the model (docs/item-icons.md).
    const itemId = ((await viewerRegistry()).entry(assetId) as { itemId?: string } | undefined)?.itemId
      ?? (assetId.startsWith('corealm_item_') ? assetId.slice('corealm_item_'.length) : undefined);
    if (itemId) return itemIconSource(itemId, true);
    const url = repoCache ? await cachedUrl(assetId) : undefined;
    if (url && await readCached(url)) return url;
    const dataUrl = await renderAssetThumbnail(assetId);
    if (url && dataUrl) void storeRendered(url, dataUrl);
    return dataUrl;
  };
}

/** Forces a fresh render and returns the server URL with a cache-busting query once it is stored. */
export async function regenerateAssetThumbnail(assetId: string): Promise<string | undefined> {
  negative.delete(assetId);
  const dataUrl = await renderAssetThumbnail(assetId);
  if (!dataUrl) return undefined;
  const url = await cachedUrl(assetId);
  return await storeRendered(url, dataUrl) ? `${url}?v=${Date.now()}` : dataUrl;
}
