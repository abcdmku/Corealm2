import * as THREE from "three";

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
    `/assets/textures/castle-stone/${textureFiles[style]}`,
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

const VERTEX_ANCHOR = "#include <project_vertex>";
const NORMAL_ANCHOR = "#include <normal_fragment_maps>";
const LIGHTING_ANCHOR = "#include <lights_physical_fragment>";
const COMMON_ANCHOR = "#include <common>";

const castleStoneHeader = /* glsl */ `
uniform sampler2D castleStoneAlbedo;
varying vec3 vCastleStoneWorld;
float gCastleStoneMask = 0.0;
float gCastleStoneFeature = 0.0;

vec3 castleStoneSample( vec3 point, vec3 weights ) {
  // The continuous warp breaks long, identical repetitions without another texture lookup.
  vec3 warp = vec3(
    sin( dot( point, vec3( 0.173, 0.117, 0.071 ) ) + 0.7 ),
    sin( dot( point, vec3( 0.091, 0.149, 0.127 ) ) + 2.1 ),
    sin( dot( point, vec3( 0.137, 0.083, 0.163 ) ) + 4.3 )
  ) * 0.42;
  vec3 p = point + warp;
  vec2 xUv = vec2( -p.z + 0.31, p.y + 0.17 );
  vec2 yUv = vec2( p.x + 0.53, -p.z + 0.29 );
  vec2 zUv = vec2( p.x + 0.11, p.y + 0.61 );
  return texture2D( castleStoneAlbedo, xUv ).rgb * weights.x
    + texture2D( castleStoneAlbedo, yUv ).rgb * weights.y
    + texture2D( castleStoneAlbedo, zUv ).rgb * weights.z;
}
`;

const castleStoneVertex = /* glsl */ `
vec4 castleStonePosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  castleStonePosition = batchingMatrix * castleStonePosition;
#endif
#ifdef USE_INSTANCING
  castleStonePosition = instanceMatrix * castleStonePosition;
#endif
vCastleStoneWorld = ( modelMatrix * castleStonePosition ).xyz;
`;

function surfaceBody(style: CastleStoneStyle, paletteMask: boolean): string {
  const tileMetres = style === "pearl" ? 5.8 : 5.4;
  const reliefMetres = style === "pearl" ? 0.026 : 0.032;
  const masked = paletteMask ? `
  float castleSourceHigh = max( max( castleSource.r, castleSource.g ), castleSource.b );
  float castleSourceLow = min( min( castleSource.r, castleSource.g ), castleSource.b );
  float castleSourceSaturation = ( castleSourceHigh - castleSourceLow )
    / max( castleSourceHigh, 0.018 );
  float castleSourceWarmth = ( castleSource.r - castleSource.b )
    / max( castleSourceHigh, 0.018 );
  float castleWarmPaint = smoothstep( 0.12, 0.32, castleSourceSaturation )
    * smoothstep( 0.07, 0.24, castleSourceWarmth );
  gCastleStoneMask = 1.0 - castleWarmPaint;`
    : "  gCastleStoneMask = 1.0;";
  const roughness = style === "pearl"
    ? "clamp( 0.72 - castleValue * 0.13 + castleBroadTone * 0.035, 0.54, 0.78 )"
    : "clamp( 0.92 - gCastleStoneFeature * 0.22 + castleBroadTone * 0.030, 0.62, 0.96 )";
  const feature = style === "pearl"
    ? "clamp( 1.0 - abs( castleValue - 0.62 ) * 1.5, 0.0, 1.0 )"
    : "smoothstep( 0.055, 0.19, max( max( castleTexel.r, castleTexel.g ), castleTexel.b ) )";

  return /* glsl */ `
{
  vec3 castleSource = diffuseColor.rgb;
  vec3 castleWeights = pow( abs( normalize( inverseTransformDirection( normal, viewMatrix ) ) ), vec3( 5.0 ) );
  castleWeights /= max( dot( castleWeights, vec3( 1.0 ) ), 0.0001 );
  vec3 castleTexel = castleStoneSample( vCastleStoneWorld / ${tileMetres.toFixed(1)}, castleWeights );
  float castleValue = dot( castleTexel, vec3( 0.2126, 0.7152, 0.0722 ) );
  float castleBroadTone = sin( dot( vCastleStoneWorld, vec3( 0.071, 0.047, 0.059 ) ) + 1.9 )
    * sin( dot( vCastleStoneWorld, vec3( -0.031, 0.067, 0.043 ) ) + 0.4 );
  castleTexel *= (0.96 + castleBroadTone * 0.055) * ${style === 'cinder' ? '1.55' : '1.0'};
${masked}
  gCastleStoneFeature = ${feature};
  diffuseColor.rgb = mix( castleSource, castleTexel, gCastleStoneMask );
  roughnessFactor = mix( roughnessFactor, ${roughness}, gCastleStoneMask );
  metalnessFactor = mix( metalnessFactor, 0.0, gCastleStoneMask );

  // Dark mortar in the albedo becomes a recessed surface-gradient bump in view-space metres.
  vec2 castleHeightGradient = vec2( dFdx( castleValue ), dFdy( castleValue ) )
    * ${reliefMetres.toFixed(3)} * gCastleStoneMask;
  vec3 castleDx = dFdx( -vViewPosition );
  vec3 castleDy = dFdy( -vViewPosition );
  vec3 castleRx = cross( castleDy, normal );
  vec3 castleRy = cross( normal, castleDx );
  float castleDeterminant = dot( castleDx, castleRx ) * faceDirection;
  if ( abs( castleDeterminant ) > 1e-12 ) {
    normal = normalize( abs( castleDeterminant ) * normal - sign( castleDeterminant )
      * ( castleHeightGradient.x * castleRx + castleHeightGradient.y * castleRy ) );
  }
}
`;
}

function lightingBody(style: CastleStoneStyle): string {
  if (style === "pearl") {
    return /* glsl */ `
{
  float castleFacing = saturate( dot( normal, normalize( vViewPosition ) ) );
  float castleGrazing = pow( 1.0 - castleFacing, 2.5 );
  float castlePearlShift = 0.5 + 0.5 * sin( castleFacing * 7.0
    + dot( vCastleStoneWorld, vec3( 0.19, 0.11, 0.17 ) ) );
  vec3 castlePearl = mix( vec3( 0.095, 0.084, 0.071 ), vec3( 0.072, 0.092, 0.125 ), castlePearlShift );
  float castlePearlStrength = gCastleStoneMask * gCastleStoneFeature * ( 0.12 + castleGrazing * 0.24 );
  material.specularColor = mix( material.specularColor, castlePearl, castlePearlStrength );
  material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
  material.roughness = mix( material.roughness, max( 0.43, material.roughness * 0.82 ),
    castlePearlStrength );
}
`;
  }
  return /* glsl */ `
{
  float castleFacing = saturate( dot( normal, normalize( vViewPosition ) ) );
  float castleGlintAngle = pow( 1.0 - castleFacing, 3.0 );
  float castleGlint = gCastleStoneMask * gCastleStoneFeature * ( 0.22 + castleGlintAngle * 0.78 );
  // Only bright mineral flecks tighten the reflected-light lobe. They add no emission.
  material.roughness = mix( material.roughness, 0.19, castleGlint * 0.68 );
  material.specularColor = mix( material.specularColor, vec3( 0.12, 0.135, 0.16 ), castleGlint * 0.42 );
  material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
}
`;
}

function requireAnchor(shader: string, anchor: string, source: THREE.Material): void {
  if (!shader.includes(anchor)) {
    throw new Error(`Castle stone material has no ${anchor} insertion point: ${source.name || source.type}`);
  }
}

/** Add world-scaled generated masonry while retaining the source material's render settings. */
export function createCastleStoneMaterial(
  source: THREE.Material,
  style: CastleStoneStyle,
  options: CastleStoneMaterialOptions = {},
): THREE.Material {
  const standard = source as THREE.MeshStandardMaterial;
  if (!standard.isMeshStandardMaterial) return source;

  const paletteMask = options.paletteMask === true;
  const albedo = castleStoneTexture(style);
  const derived = standard.clone();
  const inheritedCompile = source.onBeforeCompile;
  const inheritedProgramKey = source.customProgramCacheKey.bind(source);
  derived.name = `${source.name || source.type}@castle-stone:${style}:${paletteMask ? "masked" : "full"}`;
  derived.userData.corealmCastleStone = { style, paletteMask, tileMetres: style === "pearl" ? 5.8 : 5.4 };
  derived.onBeforeCompile = (shader, renderer) => {
    inheritedCompile.call(source, shader, renderer);
    requireAnchor(shader.vertexShader, COMMON_ANCHOR, source);
    requireAnchor(shader.vertexShader, VERTEX_ANCHOR, source);
    requireAnchor(shader.fragmentShader, COMMON_ANCHOR, source);
    requireAnchor(shader.fragmentShader, NORMAL_ANCHOR, source);
    requireAnchor(shader.fragmentShader, LIGHTING_ANCHOR, source);
    shader.uniforms.castleStoneAlbedo = { value: albedo };
    shader.vertexShader = shader.vertexShader
      .replace(COMMON_ANCHOR, `${COMMON_ANCHOR}\nvarying vec3 vCastleStoneWorld;`)
      .replace(VERTEX_ANCHOR, `${VERTEX_ANCHOR}\n${castleStoneVertex}`);
    shader.fragmentShader = shader.fragmentShader
      .replace(COMMON_ANCHOR, `${COMMON_ANCHOR}\n${castleStoneHeader}`)
      .replace(NORMAL_ANCHOR, `${NORMAL_ANCHOR}\n${surfaceBody(style, paletteMask)}`)
      .replace(LIGHTING_ANCHOR, `${LIGHTING_ANCHOR}\n${lightingBody(style)}`);
  };
  derived.customProgramCacheKey = () => `${inheritedProgramKey()}|corealm-castle-stone-v1:${style}:${Number(paletteMask)}`;
  derived.needsUpdate = true;
  return derived;
}
