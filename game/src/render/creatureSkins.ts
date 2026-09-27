import * as THREE from "three";
import type { Node } from "three/webgpu";
import { abs, clamp, float, fract, max, min, mix, sRGBTransferEOTF, sRGBTransferOETF, step, uniform, varyingProperty, vec3, vec4 } from "three/tsl";
import { cloneNodeMaterial, composeSurface, ensureNodeMaterial } from "./nodeMaterials.js";
import type { CreatureSkin } from "../content/schema/creatureSkins.js";
import type { CreatureLookColour } from "../content/creatureVariation.js";

/**
 * A creature's look as the renderer draws it: a skin (albedo maps that replace the model's own,
 * `view.skinId`) and an individual colour shift (`view.colour`). Both are material identity for the
 * whole (model, skin) pair, never per individual: every skinned material is one clone per (material,
 * skin), and every colour-shifting material is one clone per (material, channel) whose shift is read
 * per draw, per instance or per object. A herd of forty different individuals is still one material
 * per part.
 *
 * The shift is the HSV shift devdocs' recolor bakes into a map (`recolor.ts`), done in the shader on
 * sRGB-encoded albedo, so a live individual and a baked recolor with the same numbers match.
 */

/**
 * Where a colour-shifting material reads its individual's shift:
 *
 *   batch     the `BatchedMesh` per-instance colour (baked poses and static instances)
 *   instance  the `InstancedMesh` per-instance colour (sampled skeletal actors)
 *   object    a per-object uniform from `mesh.userData.creatureLook` (live rigs)
 *
 * Three multiplies the batch and instance colours into the albedo after the material's colour node,
 * so those channels divide it back out: the encoded shift reaches the shader without Three painting
 * it on as a tint.
 */
export type CreatureLookChannel = "batch" | "instance" | "object";

/** `mesh.userData` key holding an object channel's encoded shift. */
export const CREATURE_LOOK_OBJECT_KEY = "creatureLook";
/** `material.userData` key naming a colour-shifting material's channel. */
export const CREATURE_LOOK_CHANNEL_KEY = "creatureLookChannel";

/** No shift. Also the value an unwritten batch or instance colour holds. */
export const NEUTRAL_CREATURE_LOOK: Readonly<THREE.Color> = new THREE.Color(1, 1, 1);

/**
 * The shift packed into a colour: (1 + hue / 360, saturation, value). Every component stays
 * positive for any valid roll (hue within +/-180 degrees, positive multipliers), so the batch and
 * instance channels can divide by it, and white is the identity.
 */
export function encodeCreatureLook(colour: CreatureLookColour, target = new THREE.Color()): THREE.Color {
  return target.setRGB(1 + colour.hue / 360, colour.saturation, colour.value, THREE.LinearSRGBColorSpace);
}

export function creatureLookChannelOf(material: THREE.Material): CreatureLookChannel | null {
  return (material.userData[CREATURE_LOOK_CHANNEL_KEY] as CreatureLookChannel | undefined) ?? null;
}

type Vec3 = Node<"vec3">;
type Vec4 = Node<"vec4">;
const v3 = vec3 as unknown as (...values: unknown[]) => Vec3;
const v4 = vec4 as unknown as (...values: unknown[]) => Vec4;

/** Branchless RGB -> HSV (hue in turns). */
function rgbToHsv(rgb: Vec3): Vec3 {
  const c = rgb as unknown as { r: Node<"float">; g: Node<"float">; b: Node<"float"> };
  const k = v4(0, -1 / 3, 2 / 3, -1) as unknown as Record<"x" | "y" | "z" | "w", Node<"float">>;
  const p = mix(v4(c.b, c.g, k.w, k.z), v4(c.g, c.b, k.x, k.y), step(c.b, c.g)) as unknown as Record<"x" | "y" | "z" | "w", Node<"float">>;
  const q = mix(v4(p.x, p.y, p.w, c.r), v4(c.r, p.y, p.z, p.x), step(p.x, c.r)) as unknown as Record<"x" | "y" | "z" | "w", Node<"float">>;
  const d = q.x.sub(min(q.w, q.y));
  const e = float(1e-10);
  return v3(abs(q.z.add(q.w.sub(q.y).div(d.mul(6).add(e)))), d.div(q.x.add(e)), q.x);
}

/** HSV (hue in turns) -> RGB. */
function hsvToRgb(hsv: Vec3): Vec3 {
  const c = hsv as unknown as Record<"x" | "y" | "z", Node<"float">>;
  const p = abs(fract(v3(c.x).add(v3(1, 2 / 3, 1 / 3))).mul(6).sub(3));
  return v3(mix(v3(1), clamp(p.sub(1), 0, 1), c.y).mul(c.z));
}

/** The shift itself, on linear albedo: to sRGB, HSV shift, back. `look` is the encoded colour. */
export function shiftCreatureAlbedo(linear: Vec3, look: Vec3): Vec3 {
  const encoded = look as unknown as Record<"x" | "y" | "z", Node<"float">>;
  const srgb = sRGBTransferOETF(clamp(linear, 0, 1)) as unknown as Vec3;
  const hsv = rgbToHsv(srgb) as unknown as Record<"x" | "y" | "z", Node<"float">>;
  const shifted = v3(
    fract(hsv.x.add(encoded.x).sub(1)),
    min(hsv.y.mul(encoded.y), 1),
    min(hsv.z.mul(encoded.z), 1),
  );
  return sRGBTransferEOTF(hsvToRgb(shifted)) as unknown as Vec3;
}

/** One per process: every object-channel material reads the drawn object's own value. */
let objectLook: Vec3 | null = null;
function objectLookNode(): Vec3 {
  objectLook ??= uniform(new THREE.Color(1, 1, 1)).onObjectUpdate(({ object }) =>
    (object?.userData[CREATURE_LOOK_OBJECT_KEY] as THREE.Color | undefined) ?? NEUTRAL_CREATURE_LOOK) as unknown as Vec3;
  return objectLook;
}

function lookNode(channel: CreatureLookChannel): { look: Vec3; divide: boolean } {
  switch (channel) {
    // The same varyings Three's own diffuse setup reads; property nodes are shared by name.
    case "batch": return { look: (varyingProperty("vec4", "vBatchColor") as unknown as { xyz: Vec3 }).xyz, divide: true };
    case "instance": return { look: varyingProperty("vec3", "vInstanceColor") as unknown as Vec3, divide: true };
    case "object": return { look: objectLookNode(), divide: false };
  }
}

export interface CreatureSkinOptions {
  /** The assets directory the model registry loads from, trailing slash included. */
  baseUrl: () => string;
  /** Skin rows by id. Defaults to the running catalog; devdocs may add unsaved rows. */
  skin: (id: string) => CreatureSkin | undefined;
  /** Decodes one map. Defaults to the options the model loader decodes GLB images with. */
  loadImage?: (url: string) => Promise<ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas>;
}

type MapImage = Awaited<ReturnType<NonNullable<CreatureSkinOptions["loadImage"]>>>;
interface MapLoad { image: MapImage | null; failed: boolean; pending: Promise<void> }

async function decodeLikeModels(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  // `AssetTextureCache`'s GLB image options: file orientation, no premultiply, no colour conversion.
  return createImageBitmap(await response.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
}

/** Skinned and colour-shifting materials, shared per (material, skin) and (material, channel). */
export class CreatureLooks {
  private readonly loads = new Map<string, MapLoad>();
  /** (map url, original map) -> the configured replacement. One upload per pair. */
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly skinned = new Map<string, THREE.Material>();
  private readonly shifted = new Map<string, THREE.Material>();
  private readonly warned = new Set<string>();

  constructor(private readonly options: CreatureSkinOptions) {}

  /**
   * The skin `assetId` draws with for `skinId`, or null for none. An unknown id, a skin authored
   * for another model, or a map that failed to load draws the model's own maps, and warns once.
   */
  resolve(assetId: string, skinId: string | undefined): CreatureSkin | null {
    if (!skinId) return null;
    const skin = this.options.skin(skinId);
    if (!skin) { this.warn(`unknown:${skinId}`, `Unknown creature skin ${skinId}; drawing ${assetId} with its own maps.`); return null; }
    if (skin.assetId !== assetId) {
      this.warn(`model:${skinId}:${assetId}`, `Creature skin ${skinId} is for ${skin.assetId}, not ${assetId}; drawing its own maps.`);
      return null;
    }
    if (Object.values(skin.maps).some(path => this.loads.get(this.urlOf(path))?.failed)) return null;
    return skin;
  }

  /** True once every map of `skin` has decoded. Starts any load not yet started. */
  ready(skin: CreatureSkin): boolean {
    return Object.values(skin.maps).every(path => this.load(path).image !== null);
  }

  /** Settles once every map of `skin` has decoded or failed. */
  async whenLoaded(skin: CreatureSkin): Promise<void> {
    await Promise.all(Object.values(skin.maps).map(path => this.load(path).pending));
  }

  /**
   * `material` with its albedo map replaced when `skin` covers its source name, else `material`.
   * Everything but the map is the material's own, so the clone shares its node graph and pipeline.
   * The replacement takes the original map's colour space, orientation, wrapping and sampling.
   */
  skin(material: THREE.Material, skin: CreatureSkin | null): THREE.Material {
    if (!skin) return material;
    const path = skin.maps[material.name.split("@", 1)[0]!];
    if (!path) return material;
    const key = `${material.uuid}|${skin.id}`;
    const cached = this.skinned.get(key);
    if (cached) return cached;
    const url = this.urlOf(path);
    const image = this.loads.get(url)?.image;
    if (!image) return material;
    const standard = ensureNodeMaterial(material) as unknown as THREE.MeshStandardMaterial;
    const clone = cloneNodeMaterial(material) as unknown as THREE.MeshStandardMaterial;
    clone.map = this.texture(url, image, standard.map);
    clone.userData.creatureSkinId = skin.id;
    this.skinned.set(key, clone);
    return clone;
  }

  /** `material` with the individual colour shift read from `channel`. Unlit and basic materials included. */
  look(material: THREE.Material, channel: CreatureLookChannel): THREE.Material {
    if (creatureLookChannelOf(material) === channel) return material;
    const key = `${material.uuid}|${channel}`;
    const cached = this.shifted.get(key);
    if (cached) return cached;
    const clone = cloneNodeMaterial(material);
    // The suffix keeps a shifting material out of its plain twin's batch, which keys on the name.
    clone.name = `${material.name}@look`;
    clone.userData[CREATURE_LOOK_CHANNEL_KEY] = channel;
    const { look, divide } = lookNode(channel);
    composeSurface(clone, {
      color: previous => {
        const shifted = shiftCreatureAlbedo(previous, look);
        return divide ? shifted.div(max(look, v3(1e-4))) as unknown as Vec3 : shifted;
      },
    });
    this.shifted.set(key, clone);
    return clone;
  }

  /** Counts for diagnostics and tests. */
  stats(): { skinnedMaterials: number; lookMaterials: number; maps: number } {
    return { skinnedMaterials: this.skinned.size, lookMaterials: this.shifted.size, maps: this.textures.size };
  }

  dispose(): void {
    for (const material of this.skinned.values()) material.dispose();
    for (const material of this.shifted.values()) material.dispose();
    for (const texture of this.textures.values()) texture.dispose();
    for (const load of this.loads.values()) if (typeof ImageBitmap !== "undefined" && load.image instanceof ImageBitmap) load.image.close();
    this.skinned.clear();
    this.shifted.clear();
    this.textures.clear();
    this.loads.clear();
  }

  private urlOf(path: string): string {
    return `${this.options.baseUrl()}${path.replace(/^\/+/, "")}`;
  }

  private load(path: string): MapLoad {
    const url = this.urlOf(path);
    const existing = this.loads.get(url);
    if (existing) return existing;
    const load: MapLoad = { image: null, failed: false, pending: Promise.resolve() };
    load.pending = (this.options.loadImage ?? decodeLikeModels)(url).then(image => { load.image = image; }, (error: unknown) => {
      load.failed = true;
      this.warn(`map:${url}`, `Creature skin map ${url} failed to load (${error instanceof Error ? error.message : String(error)}); drawing the model's own maps.`);
    });
    this.loads.set(url, load);
    return load;
  }

  private texture(url: string, image: MapImage, original: THREE.Texture | null): THREE.Texture {
    const key = `${url}|${original?.uuid ?? "-"}`;
    const cached = this.textures.get(key);
    if (cached) return cached;
    const texture = new THREE.Texture(image as unknown as HTMLImageElement);
    texture.name = url.slice(url.lastIndexOf("/", url.lastIndexOf("/") - 1) + 1);
    // A glTF colour map is sRGB, unflipped (its UV origin is the image's top left).
    texture.colorSpace = original?.colorSpace ?? THREE.SRGBColorSpace;
    texture.flipY = original?.flipY ?? false;
    if (original) {
      texture.wrapS = original.wrapS;
      texture.wrapT = original.wrapT;
      texture.anisotropy = original.anisotropy;
      texture.magFilter = original.magFilter;
      texture.minFilter = original.minFilter;
      texture.generateMipmaps = original.generateMipmaps;
      texture.premultiplyAlpha = original.premultiplyAlpha;
      texture.channel = original.channel;
      texture.offset.copy(original.offset);
      texture.repeat.copy(original.repeat);
      texture.center.copy(original.center);
      texture.rotation = original.rotation;
      texture.matrixAutoUpdate = original.matrixAutoUpdate;
      texture.matrix.copy(original.matrix);
    } else {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    }
    texture.needsUpdate = true;
    this.textures.set(key, texture);
    return texture;
  }

  private warn(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(message);
  }
}
