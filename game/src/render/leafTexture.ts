import * as THREE from "three";
import { SRGBToLinear, LinearToSRGB } from "three/src/math/ColorManagement.js";

const preparedTextures = new Map<string, THREE.DataTexture>();
const textureResults = new WeakMap<THREE.Texture, THREE.Texture>();
const srgbToLinear = Float64Array.from({ length: 256 }, (_, i) => SRGBToLinear(i / 255));
// Quantise only at the final sRGB encoding, retaining precision in dark, partly covered texels.
const associatedColour = Uint8Array.from({ length: 65536 }, (_, i) =>
  Math.round(LinearToSRGB(srgbToLinear[i >> 8]! * (i & 255) / 255) * 255));

/** Associate linear colour with coverage before mip generation. Alpha bytes are unchanged. */
export function associateLeafColour(source: Uint8ClampedArray | Uint8Array): Uint8Array {
  const output = new Uint8Array(source.length);
  for (let i = 0; i < source.length; i += 4) {
    const alpha = source[i + 3]!;
    output[i] = associatedColour[(source[i]! << 8) | alpha]!;
    output[i + 1] = associatedColour[(source[i + 1]! << 8) | alpha]!;
    output[i + 2] = associatedColour[(source[i + 2]! << 8) | alpha]!;
    output[i + 3] = alpha;
  }
  return output;
}

/** One immutable upload per distinct embedded foliage image and sampler, shared by tree variants. */
export function prepareLeafTexture(source: THREE.Texture): THREE.Texture {
  const cached = textureResults.get(source);
  if (cached && cached.userData.leafDisposed !== true) return cached;
  const image = source.image as CanvasImageSource & { width?: number; height?: number };
  // CPU-only material tests have no decoded bitmap. No browser path uses this fallback.
  if (!image?.width || !image.height || typeof document === "undefined") return source;
  const canvas = document.createElement("canvas");
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Leaf texture preparation needs a 2D canvas");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let hashA = 2166136261, hashB = 5381;
  for (let i = 0; i < pixels.length; i++) {
    hashA = Math.imul(hashA ^ pixels[i]!, 16777619);
    hashB = Math.imul(hashB, 33) ^ pixels[i]!;
  }
  const key = [canvas.width, canvas.height, hashA >>> 0, hashB >>> 0, source.channel,
    source.wrapS, source.wrapT, source.flipY, ...source.offset.toArray(), ...source.repeat.toArray(),
    ...source.center.toArray(), source.rotation, source.matrixAutoUpdate, ...source.matrix.elements].join(",");
  let prepared = preparedTextures.get(key);
  if (!prepared) {
    prepared = new THREE.DataTexture(associateLeafColour(pixels), canvas.width, canvas.height);
    prepared.name = `${source.name || "Leaf spray"} · coverage-weighted colour`;
    prepared.channel = source.channel;
    prepared.mapping = source.mapping;
    prepared.wrapS = source.wrapS; prepared.wrapT = source.wrapT;
    prepared.offset.copy(source.offset); prepared.repeat.copy(source.repeat); prepared.center.copy(source.center);
    prepared.rotation = source.rotation; prepared.matrix.copy(source.matrix); prepared.matrixAutoUpdate = source.matrixAutoUpdate;
    prepared.flipY = source.flipY;
    prepared.colorSpace = THREE.SRGBColorSpace;
    // RGB is already associated in linear space. A second upload premultiplication is wrong.
    prepared.premultiplyAlpha = false;
    prepared.minFilter = THREE.LinearMipmapLinearFilter;
    prepared.magFilter = THREE.LinearFilter;
    prepared.generateMipmaps = true;
    prepared.anisotropy = 8;
    prepared.userData.leafAssociatedColour = true;
    prepared.needsUpdate = true;
    const owned = prepared;
    prepared.addEventListener("dispose", () => { owned.userData.leafDisposed = true; preparedTextures.delete(key); });
    preparedTextures.set(key, prepared);
  }
  textureResults.set(source, prepared);
  return prepared;
}
