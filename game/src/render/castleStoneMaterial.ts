import * as THREE from "three";
import { MeshStandardNodeMaterial, type Node } from 'three/webgpu';
import {
  Fn, cameraWorldMatrix, faceDirection, float, max, min, mix, positionView, positionWorld,
  property, roughness, specularColor, specularF90, diffuseColor, metalness, texture,
  transformDirection, vec2, vec3, vertexColor,
} from 'three/tsl';
import { ensureNodeMaterial, surfaceNodes } from './nodeMaterials.js';
import { assetBaseUrl } from "../app/config.js";

export type CastleStoneStyle = "pearl" | "cinder";

export interface CastleStoneMaterialOptions {
  /** Keep warm, saturated source colours such as the T40 roofs. */
  paletteMask?: boolean;
}

const textureFiles: Readonly<Record<CastleStoneStyle, string>> = {
  pearl: "pearl-stone.png",
  cinder: "cinder-stone.png",
};

const textures = new Map<CastleStoneStyle, THREE.Texture>();
const pending = new Map<CastleStoneStyle, Promise<void>>();

function castleStoneTexture(style: CastleStoneStyle): THREE.Texture {
  const cached = textures.get(style);
  if (cached) return cached;

  // Node tests may inspect the material hook without providing a DOM image loader.
  // This placeholder performs no I/O and never reaches a rendered browser frame.
  if (typeof document === "undefined") {
    const texture = new THREE.Texture();
    texture.name = `Castle ${style} stone (unloaded)`;
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.set(style, texture);
    return texture;
  }

  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const ready = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // A material may begin loading before boot waits for the shared preload.
  void ready.catch(() => undefined);
  pending.set(style, ready);

  const texture = new THREE.TextureLoader().load(
    `${assetBaseUrl()}textures/castle-stone/${textureFiles[style]}`,
    resolve,
    undefined,
    reject,
  );
  texture.name = `Castle ${style} stone`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.userData.castleStoneStyle = style;
  textures.set(style, texture);
  return texture;
}

/** Load both generated albedos before the first accepted frame. Importing this module does no I/O. */
export async function preloadCastleStoneTextures(): Promise<void> {
  if (typeof document === "undefined") return;
  for (const style of Object.keys(textureFiles) as CastleStoneStyle[]) castleStoneTexture(style);
  await castleStoneTexturesReady();
}

/** Wait for loads started by either preload or material creation. */
export async function castleStoneTexturesReady(): Promise<void> {
  await Promise.all(pending.values());
}

/** Dispose the shared generated albedos after all derived castle materials are gone. */
export function disposeCastleStoneTextures(): void {
  for (const texture of textures.values()) texture.dispose();
  textures.clear();
  pending.clear();
}

/** Standard lighting with the authored pearl/mineral specular response. */
class CastleStoneNodeMaterial extends MeshStandardNodeMaterial {
  castleSpecularNode: Node<"vec3"> | null = null;
  castleFinalRoughnessNode: Node<"float"> | null = null;

  override setupSpecular(): void {
    if (!this.castleSpecularNode) { super.setupSpecular(); return; }
    specularColor.assign(vec3(this.castleSpecularNode));
    // Three's lighting model stores the metalness blend separately from dielectric F0.
    property('color', 'SpecularColorBlended').assign(mix(specularColor, diffuseColor.rgb, metalness));
    specularF90.assign(1);
    if (this.castleFinalRoughnessNode) roughness.assign(float(this.castleFinalRoughnessNode));
  }
}

/** Add world-scaled generated masonry while retaining the source material's render settings. */
export function createCastleStoneMaterial(
  source: THREE.Material,
  style: CastleStoneStyle,
  options: CastleStoneMaterialOptions = {},
): THREE.Material {
  const standard = source as THREE.MeshStandardMaterial;
  if (!standard.isMeshStandardMaterial && !(source as MeshStandardNodeMaterial).isMeshStandardNodeMaterial) return source;
  const paletteMask = options.paletteMask === true;
  const albedo = castleStoneTexture(style);
  const derived = new CastleStoneNodeMaterial().copy(ensureNodeMaterial(source));
  derived.name = `${source.name || source.type}@castle-stone:${style}:${paletteMask ? "masked" : "full"}`;
  derived.userData.corealmCastleStone = { style, paletteMask, tileMetres: style === 'pearl' ? 5.8 : 5.4 };
  const previous = surfaceNodes(derived);
  const sourceVertexColors = derived.vertexColors;
  derived.vertexColors = false;
  const sourceColor = Fn(builder => sourceVertexColors && builder.geometry.hasAttribute('color')
    ? previous.color.mul(vertexColor().rgb) : previous.color)();
  const normal = previous.normal;
  const worldNormal = transformDirection(normal, cameraWorldMatrix).normalize();
  const rawWeights = worldNormal.abs().pow(5);
  const weights = rawWeights.div(max(rawWeights.dot(vec3(1)), .0001));
  const point = positionWorld.div(style === 'pearl' ? 5.8 : 5.4);
  const warp = vec3(
    point.dot(vec3(.173, .117, .071)).add(.7).sin(),
    point.dot(vec3(.091, .149, .127)).add(2.1).sin(),
    point.dot(vec3(.137, .083, .163)).add(4.3).sin(),
  ).mul(.42);
  const p = point.add(warp);
  const xUv = vec2(p.z.negate().add(.31), p.y.add(.17));
  const yUv = vec2(p.x.add(.53), p.z.negate().add(.29));
  const zUv = vec2(p.x.add(.11), p.y.add(.61));
  const sample = texture(albedo, xUv).rgb.mul(weights.x)
    .add(texture(albedo, yUv).rgb.mul(weights.y))
    .add(texture(albedo, zUv).rgb.mul(weights.z));
  const value = sample.dot(vec3(.2126, .7152, .0722));
  const broadTone = positionWorld.dot(vec3(.071, .047, .059)).add(1.9).sin()
    .mul(positionWorld.dot(vec3(-.031, .067, .043)).add(.4).sin());
  const texel = sample.mul(broadTone.mul(.055).add(.96)).mul(style === 'cinder' ? 1.55 : 1);
  const high = max(max(sourceColor.r, sourceColor.g), sourceColor.b);
  const low = min(min(sourceColor.r, sourceColor.g), sourceColor.b);
  const saturation = high.sub(low).div(max(high, .018));
  const warmth = sourceColor.r.sub(sourceColor.b).div(max(high, .018));
  const mask = paletteMask ? saturation.smoothstep(.12, .32).mul(warmth.smoothstep(.07, .24)).oneMinus() : float(1);
  const feature = style === 'pearl' ? value.sub(.62).abs().mul(1.5).oneMinus().clamp(0, 1)
    : max(max(texel.r, texel.g), texel.b).smoothstep(.055, .19);
  const stoneRoughness = style === 'pearl' ? float(.72).sub(value.mul(.13)).add(broadTone.mul(.035)).clamp(.54, .78)
    : float(.92).sub(feature.mul(.22)).add(broadTone.mul(.030)).clamp(.62, .96);
  derived.colorNode = mix(sourceColor, texel, mask);
  derived.roughnessNode = mix(previous.roughness, stoneRoughness, mask);
  derived.metalnessNode = mix(previous.metalness, 0, mask);

  // Surface-gradient relief retains its world-metre depth at every texture projection.
  const heightGradient = vec2(value.dFdx(), value.dFdy()).mul(style === 'pearl' ? .026 : .032).mul(mask);
  const dx = positionView.dFdx(), dy = positionView.dFdy();
  const rx = dy.cross(normal), ry = normal.cross(dx);
  const determinant = dx.dot(rx).mul(faceDirection);
  const reliefNormal = determinant.abs().mul(normal).sub(determinant.sign()
    .mul(heightGradient.x.mul(rx).add(heightGradient.y.mul(ry)))).normalize();
  const finalNormal = determinant.abs().greaterThan(1e-12).select(reliefNormal, normal);
  derived.normalNode = finalNormal;
  const facing = finalNormal.dot(positionView.negate().normalize()).clamp(0, 1);
  if (style === 'pearl') {
    const grazing = facing.oneMinus().pow(2.5);
    const shift = facing.mul(7).add(positionWorld.dot(vec3(.19, .11, .17))).sin().mul(.5).add(.5);
    const pearl = mix(vec3(.095, .084, .071), vec3(.072, .092, .125), shift);
    const strength = mask.mul(feature).mul(grazing.mul(.24).add(.12));
    derived.castleSpecularNode = mix(vec3(.04), pearl, strength);
    derived.castleFinalRoughnessNode = mix(roughness, max(.43, roughness.mul(.82)), strength);
  } else {
    const glint = mask.mul(feature).mul(facing.oneMinus().pow(3).mul(.78).add(.22));
    derived.castleSpecularNode = mix(vec3(.04), vec3(.12, .135, .16), glint.mul(.42));
    derived.castleFinalRoughnessNode = mix(roughness, .19, glint.mul(.68));
  }
  return derived;
}
