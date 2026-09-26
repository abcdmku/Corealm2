import { BatchedLighting } from "./batchedLighting.js";
import { usesMobileAssets } from './assetDelivery.js';
import { PlayerSilhouette } from "./playerSilhouette.js";
import { BiomeAtmosphere, type BiomeWeights } from "./biomeAtmosphere.js";
/**
 * Renderer ownership: the graphics backend, the render target size, sky, atmosphere, lighting rig,
 * and per-frame stats.
 *
 * This file owns no gameplay state. Everything it draws is a view of the canonical store.
 */
import * as THREE from "three";
import { WebGPURenderer, PMREMGenerator, MeshBasicNodeMaterial, QuadMesh } from "three/webgpu";
import { texture, fog as fogNode, rangeFogFactor, uniform } from "three/tsl";
import { inverseACES } from "./biomeSky.js";
import type { GraphicsBackendState, GraphicsPreparationState } from "../contracts.js";
import { CAMERA, RENDER_BUDGET } from "../app/config.js";
import { GpuTimer } from "./gpuTimer.js";
import { FramePacer, gameplayPixelRatio, createGpuCompletion } from "./framePacer.js";
import { ScreenAntialiasing } from "./screenAntialiasing.js";
import { MagicGlow, captureMagicGlowPreparation } from "./magicGlow.js";
import { ElementalRefraction, isElementalRefractionObject } from "./elementalRefraction.js";
import { prepareElementalFlowTexture } from "./elementalFlowTexture.js";
import { prepareElementalFlameTexture } from "./elementalFlameTexture.js";
import { TransmissionOcclusion, type TransmissionOpaqueOccluder } from "./transmissionOcclusion.js";
import { installStableShaderNames } from "./stableNodeBuilder.js";
import { isSceneryInstances } from "./sceneryInstances.js";
import { installSharedGeometryBuffers } from "./sharedGeometryBuffers.js";
import { StreamedShaderWarmup } from "./streamedShaderWarmup.js";
import { prepareShaderMeshes, shaderGeometryKey, installGraphicsValidation, graphicsValidationState,
  assertGraphicsValid, waitForGraphicsValidation, validateGraphicsWork, validateGraphicsSubmission,
  disposeGraphicsValidation, shaderPreparationState, COVERED_PIPELINE_CONCURRENCY } from "./shaderPreparation.js";

export interface RenderStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  programs: number;
  overBudget: boolean;
}

export interface TopDownTileOptions {
  centreX: number;
  centreY: number;
  centreZ: number;
  spanMetres: number;
  pixels: number;
}

/** JSON-safe description of the fixed outdoor daylight rig. */
export const DAYLIGHT_LOOK = {
  toneMappingExposure: 1.0,
  environmentSaturation: 0.40,
  environmentIntensity: 0.48,
  sunColour: 0xffd3a3,
  sunIntensity: 2.75,
  sunOffset: { x: 68, y: 38, z: 44 },
  hemisphereSky: 0xcac7c0,
  hemisphereGround: 0x66513d,
  hemisphereIntensity: 0.18,
  sunShadowIntensity: 0.7,
} as const;

/**
 * How much of the sun a cast shadow removes: 0.7 leaves 30% of the key in shade.
 *
 * The rig has no bounce light. With shadows off that never shows, because no sun-facing surface is
 * ever occluded. With shadows on, a full-strength shadow drops a sun-facing surface to the sky
 * fill alone. Under the 25-degree sun, 88% of the default view from Rootfall's respawn point is
 * out of the sun (rays cast from each visible surface toward the sun), so nearly the whole frame
 * runs on fill. Fill-only values on the town's dark planks, roofs and plate sit in the ACES toe:
 * the frame averaged (28, 37, 32) against (56, 61, 45) with shadows off, and Vellenwood's shade
 * grade then removes red from those dark pixels. At 0.7 the decking reads (17, 17, 11) in shadow
 * against (35, 31, 19) in sun, and the stair treads read (38, 53, 47) against (71, 83, 65).
 * Shadows keep a clear edge and direction, and shaded surfaces keep their material colour.
 */
const SUN_SHADOW_INTENSITY = DAYLIGHT_LOOK.sunShadowIntensity;

/**
 * The sky gradient, authored by elevation rather than by texture row.
 *
 * `e` is 1 at the zenith, 0 at the geometric horizon, -1 straight down. Sphere UV and three's
 * equirectangular mapping are the same function of the polar angle — `uv.y = 1 - phi/PI` — so
 * `e = 2 * uv.y - 1` converts one to the other exactly, and the pale band lands ON the horizon
 * instead of 0.38 of a hemisphere below it, which is where the authored "horizon at 0.88" would
 * have put it if 0.88 were read as a full-sphere v.
 *
 * The lower hemisphere is not decoration and it is not hidden either. It is the environment map, so
 * what sits below the horizon is the bounce light every roof, blade and wet surface receives from
 * the ground — which is why it ends dark at the nadir. But it is ALSO on screen: at a shot pitch of
 * 0.4 rad the camera looks 23 degrees down, so everything from the horizon to -7.5 degrees is
 * visible background wherever terrain does not cover it, and the world is only 700 x 400 m so a
 * ridge-top view runs out of terrain long before the far plane. A brown ground tone there read as a
 * desert plain filling a third of `sky-great_cairn`. The first 22 degrees below the horizon are
 * therefore haze in the fog's own tone, and only past that does it fall to ground.
 *
 * The bands are far tighter to the horizon than "warm in the lowest 12%" reads as. The eighteen
 * authored shot pitches run 0.34 to 0.62 rad, so at a 55-degree vertical FOV the top edge of the
 * frame sits between +4.6 and -8.0 degrees of elevation: this game NEVER shows sky above about 5
 * degrees. A warm band 12% of a hemisphere tall is 10.8 degrees, which made the whole sky one flat
 * tan field — measured at (217, 213, 201) to (170, 157, 129) top to bottom in `sky-great_cairn`
 * before this was tightened. All of the gradient's work now happens in the first 11 degrees, and
 * the blues above that exist for the environment map rather than for the frame.
 *
 * TWO VALUES PER STOP, because the gradient is used for two things that need opposite corrections,
 * and shipping one value for both is what turned every dark and metal surface in the game pale
 * blue-lilac.
 *
 *  - `background` is what `scene.background` samples. three tone maps any background whose colour
 *    space is not sRGB, and the PMREM target is linear, so this value is pre-compensated for ACES:
 *    it is the colour that DISPLAYS as `authored`, solved by bisecting the ACES fit at exposure
 *    1.0. Verified by running three's RRTAndODTFit forward over the table — see
 *    runs/corealm/audit/aces-fit.mjs, which reproduces the `authored` column to within 2/255.
 *  - `authored` is what the sky is supposed to look like, and it is what `scene.environment` is
 *    built from, because an environment map is a LIGHT and not an image. Pre-compensation makes a
 *    colour brighter and more saturated so that ACES can pull it back; feeding that to the
 *    lighting integral instead multiplies it into every albedo in the world and it is never pulled
 *    back, because the pixel it ends up in is at a completely different magnitude. Measured, the
 *    pre-compensated gradient integrates to a diffuse irradiance of (0.123, 0.276, 0.543) on an
 *    up-facing surface against (0.163, 0.332, 0.558) for the authored one: 25% less red for the
 *    same blue, which is a third of the mint cast on shaded grass.
 */
const SKY_STOPS: readonly { e: number; background: number; authored: number }[] = [
  { e: 1.000, background: 0x4e79ae, authored: 0x4f83b8 },   // zenith
  { e: 0.450, background: 0x6997cb, authored: 0x7ba7cc },   // mid-sky
  { e: 0.120, background: 0x89bdee, authored: 0xa5c6dc },   // 11 degrees
  { e: 0.045, background: 0xa8d8f2, authored: 0xbed4de },   // 4 degrees
  { e: 0.012, background: 0xc1f7ff, authored: 0xcfe0e2 },   // 1 degree
  { e: 0.000, background: 0xffdf9e, authored: 0xe3d8b7 },   // the warm horizon band
  // THE HAZE PLATEAU. Two stops at the same colour, and this is what makes the fog and the sky
  // agree rather than agree at one elevation and diverge everywhere else.
  //
  // A single fog colour cannot match a ramp. The shipped table fell from 0xd4dadb at -0.012 to
  // 0x9fa699 at -0.25 — 53 levels across the 21 degrees directly under the horizon — and the fog
  // was sampled at ONE point on it, so it agreed with the sky at that point and nowhere else.
  // Measured at the sky row immediately above the terrain silhouette, fog colour against sky:
  // great_cairn was 5 levels out, vellenwood_canopy 7, march_road 2 — and palewood_copse, whose
  // 0.58 rad pitch puts its whole sky band below the horizon, was 38. That is the flat pale band.
  // After the plateau the same six shots measure 0, 0, 0, 3, 0 and 0.
  //
  // The plateau reaches -0.18. `e` is the elevation angle over 90 degrees, so that is 16.2 degrees
  // down, and it has to go that far: the eighteen shot pitches run 0.34 to 0.62 rad, so at a
  // 55-degree vertical FOV the TOP of the frame sits between +8.0 and -8.0 degrees of elevation and
  // a distant silhouette sits lower again — palewood_copse's sky band alone runs -5.7 to -19.9
  // degrees. Anywhere a hazed ridge can land in these frames now meets exactly the colour the fog
  // resolves to.
  //
  // Flat is also the physical answer. Aerial haze under the horizon is optically thick and very
  // nearly uniform through the first ten or fifteen degrees; the ramp that was there read as a
  // grey-green wash getting murkier downward, which is not what air does.
  //
  // Costed, because the lower hemisphere is a LIGHT as well as a picture: measured with
  // runs/corealm/audit/w3lit-irradiance.mjs, this leaves the irradiance on an up-facing surface
  // bit-identical, raises a down-facing one 15% and the full-sphere mean 8.1%. That is inside the
  // 0.38-0.62 band light-sweep.mjs found usable for ENVIRONMENT_INTENSITY, so 0.48 stays central.
  { e: -0.012, background: 0xcbe3f2, authored: 0xd0d9de },  // haze plateau, top
  { e: -0.180, background: 0xcbe3f2, authored: 0xd0d9de },  // haze plateau, bottom: 16 degrees down
  { e: -0.340, background: 0x8f9689, authored: 0x9fa699 },  // 31 degrees down, haze gives way to land
  { e: -1.000, background: 0x4a4436, authored: 0x403828 },  // nadir, the ground tone the hemisphere uses
];

/**
 * How far the environment map is pulled toward its own luminance before it becomes a light.
 *
 * 0.40, and this is the correction that actually fixes the mint. A physically saturated sky IS
 * blue, and its diffuse irradiance on an up-facing surface integrates to (0.163, 0.332, 0.558):
 * green is twice red and blue is three times it. Multiply that by a grass albedo, which is already
 * green over red, and the result is cyan by arithmetic — that is what shaded grass measuring
 * (138, 158, 130) in `wire-bank.png` is. Desaturating the IBL keeps the sky's DIRECTION, which is
 * the thing the environment map is here for and the thing a hemisphere light cannot give, while
 * letting each surface's own albedo decide its hue. The visible sky is untouched: only the light
 * is desaturated, so the frame still has a blue sky over neutrally-shadowed ground.
 */
const ENVIRONMENT_SATURATION = DAYLIGHT_LOOK.environmentSaturation;

/**
 * Global multiplier on `scene.environment` for every material that has no `envMap` of its own.
 *
 * 0.48. At the shipped 1.0 the environment was the brightest light in the scene by hue: measured
 * on flat lit ground the sun contributed (0.512, 0.417, 0.283) of diffuse and the environment
 * (0.123, 0.276, 0.543), so the illuminant summed BLUER THAN NEUTRAL and shaded ground got
 * (0.184, 0.373, 0.670), a 3.6:1 blue-over-red fill with only 2.19:1 of luminance separation from
 * the lit value. Every dark surface in the game floated up into it: the anvil went (54,51,57) to
 * (70,82,99), the cauldron (47,50,60) to (76,90,112) and the bank chest's steel bands (42,33,31)
 * to (89,102,127), all measured against `baseline-bank.png`.
 *
 * Real daylight puts several times more energy on a horizontal surface from the sun than from the
 * sky. 0.48 with the desaturation above lands the fill at (0.121, 0.154, 0.197). In the complete
 * afternoon rig, the direct-to-shadow luminance ratio is 2.80:1 and a neutral wall in shadow reads
 * near (81,87,91), dark enough to model the wall without turning it blue. The earlier sweep in
 * runs/corealm/audit/light-sweep.mjs covered saturation
 * 0.30-0.60 and intensity 0.38-0.62: below 0.38 the darkest shadows lose all detail, and above
 * 0.62 the lit-to-shadow ratio falls under 3:1 and the frame goes flat again.
 *
 * It has to be here, on the scene, and not on each material: three 0.185 OVERWRITES
 * `material.envMapIntensity` with `scene.environmentIntensity` for every material lit by
 * `scene.environment` rather than by its own `envMap`, which is every material in this game. See
 * `iblScale` in materials.ts for how the two classes that need a different value get one.
 */
const ENVIRONMENT_INTENSITY = DAYLIGHT_LOOK.environmentIntensity;

/**
 * Where on the sky gradient the fog colour is taken from, and how far the haze reaches.
 *
 * -0.09 is 8.1 degrees below the geometric horizon and it sits INSIDE the haze plateau, so every
 * elevation from -0.012 to -0.18 returns the identical colour and this number cannot be tuned into
 * a mismatch. That is the point of the plateau: before it existed the shipped -0.03 matched the sky
 * to within 2 levels in the shots whose silhouette happened to sit near -0.03 and was 38 levels out
 * in palewood_copse, which looks 5 degrees further down. Sampling exactly 0 would still be wrong:
 * the warm horizon streak is a 2-degree band and it would paint the whole mid-ground cream.
 *
 * The `light` column, not `background`, because that is the AUTHORED colour — see the fog comment
 * in the constructor for why the fog wants the value the sky DISPLAYS rather than the one it is
 * drawn from. `sampleSky` desaturation only happens in `createSkyGradient`, so reading the light
 * column here returns the authored hex undesaturated, which is what is wanted.
 */
const FOG_HORIZON_ELEVATION = -0.09;
const FOG_NEAR = 26;
const FOG_FAR = 210;

const DRAW_DISTANCE = {
  near: { cameraFar: 130, fogNear: 18, fogFar: 105 },
  medium: { cameraFar: 210, fogNear: 22, fogFar: 165 },
  far: { cameraFar: CAMERA.far, fogNear: FOG_NEAR, fogFar: FOG_FAR },
} as const;

export type DrawDistancePreset = keyof typeof DRAW_DISTANCE;
const MOBILE_DRAW_DISTANCE = {
  near: { cameraFar: 65, fogNear: 14, fogFar: 40 },
  medium: { cameraFar: 95, fogNear: 18, fogFar: 65 },
  far: { cameraFar: 130, fogNear: 22, fogFar: 105 },
} as const;
const distancePreset = (distance: DrawDistancePreset) => usesMobileAssets()
  ? MOBILE_DRAW_DISTANCE[distance] : DRAW_DISTANCE[distance];

/** Camera-space metres covered by one draw-distance setting. */
export function drawDistanceMetres(distance: DrawDistancePreset): number {
  return distancePreset(distance).cameraFar;
}

/**
 * Metres at which one draw-distance setting's fog becomes fully opaque.
 *
 * Residency radii should track THIS rather than the camera far plane: anything between the two
 * distances renders as pure fog colour, so keeping it resident buys draw calls and nothing else.
 * Measured at the Kilnhalt arena pose, structures held to the camera-far radius put a completely
 * fogged Emberfast into the frame for ~90 draws.
 */
export function fogOpaqueMetres(distance: DrawDistancePreset): number {
  return distancePreset(distance).fogFar;
}

/** Rows in the gradient. 256 is smooth enough that no banding survives the 8-bit output. */
const SKY_TEXTURE_HEIGHT = 256;

/**
 * Columns in the gradient. Every row is one flat colour, so this width carries no information —
 * it exists solely because `PMREMGenerator._fromTexture` derives the cube size as
 * `texture.image.width / 4`. The proposed 2 x 256 texture therefore asks for a cube of side 0.5,
 * which yields `_lodMax = -1` and a render target that comes back BLACK: measured as an exactly
 * (0, 0, 0) sky in `sky-palewood_copse` and a scene lit by nothing but the sun and a 0.55 hemisphere.
 * 1024 asks for the 256 cube the proposal costed at 1.4 MB.
 */
const SKY_TEXTURE_WIDTH = 1024;

/**
 * Where the sun sits relative to whatever `followShadow` is tracking.
 *
 * 25.1 degrees of elevation (`atan(38 / hypot(68, 44))`). The former 32-degree rig still read as
 * noon under the high game camera: broad upward-facing roofs and yards took nearly all of a 3.0
 * key, while their shadows compressed beneath them. At 25.1 degrees a vertical object throws a
 * shadow 2.13 times its height, so buildings, boulders and terrace risers carry the afternoon
 * direction even in a steep camera view.
 */
const SUN_OFFSET = DAYLIGHT_LOOK.sunOffset;

export interface WarmupOptions {
  /** Prepare the alternate blending pipeline used when an occluding roof fades. */
  transparentVariants?: readonly THREE.Object3D[];
  /** Prepare resident but hidden interiors without revealing them during asynchronous work. */
  temporarilyVisible?: readonly THREE.Object3D[];
}

export class Renderer {
  readonly magicGlow = new MagicGlow();
  readonly elementalRefraction = new ElementalRefraction();
  readonly biomeAtmosphere = new BiomeAtmosphere();
  biomeWeightsSource?: () => BiomeWeights;
  wildernessMagicSource?: () => number;
  readonly renderer: WebGPURenderer;
  readonly playerSilhouette = new PlayerSilhouette();
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  private readonly hemisphere = new THREE.HemisphereLight(
    DAYLIGHT_LOOK.hemisphereSky, DAYLIGHT_LOOK.hemisphereGround, DAYLIGHT_LOOK.hemisphereIntensity);
  private readonly daylightSun = new THREE.Color(DAYLIGHT_LOOK.sunColour);
  private readonly moonlight = new THREE.Color(0xadc0e1);
  private readonly arcaneMoonlight = new THREE.Color(0xafa0e4);
  private readonly turquoiseFairyLight = new THREE.Color(0xb8ece4);
  private readonly violetFairyLight = new THREE.Color(0xddc7f5);
  private readonly fairyLight = new THREE.Color();
  /** Prepare instance buffers after the camera settles and before Three uploads this frame. */
  prepareScene?: (camera: THREE.Camera) => void;
  transmissionCandidates?: () => readonly THREE.Mesh[];
  transmissionOpaqueOccluders?: () => readonly TransmissionOpaqueOccluder[];
  private readonly transmissionOcclusion = new TransmissionOcclusion();
  private readonly screenAntialiasing = new ScreenAntialiasing();
  private readonly frameTarget = new THREE.RenderTarget(1, 1, {
    type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true, samples: 4,
  });
  private readonly presentationMaterial = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  private readonly presentation = new QuadMesh(this.presentationMaterial);
  private gpuTimer: GpuTimer | null = null;
  private cpuPrepareMs = 0;
  private cpuSubmitMs = 0;
  private cpuShadowMs = 0;
  private framePacer!: FramePacer;
  private readonly gpuTimingEnabled = new URLSearchParams(location.search).get('gpu-timing') === '1';
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private completeGpuWork!: () => Promise<void>;
  private readonly onResize = () => this.resize();

  /** The two gradients: the one the sky is drawn from, and the one the world is lit by. */
  private readonly skyGradients: THREE.DataTexture[] = [];
  /** PMREM outputs, held so `dispose` can free them: [0] is the background, [1] the environment. */
  private readonly prefiltered: THREE.RenderTarget[] = [];
  /**
   * Transparent clones made by `warmup`, kept alive deliberately. three releases a program when the
   * last material referencing it is disposed, so an undisposed clone is what pins the variant in
   * the program cache for the life of the session.
   */
  private readonly warmupMaterials: THREE.Material[] = [];
  private streamedShaders: StreamedShaderWarmup | null = null;
  private readonly preparedInteriors = new WeakSet<THREE.Object3D>();
  private readonly interiorPreparation = new WeakMap<THREE.Object3D, Promise<void>>();
  private readonly readyInteriors = new WeakSet<THREE.Object3D>();

  startStreamingWarmup(): void {
    this.streamedShaders ??= new StreamedShaderWarmup(this.renderer, this.scene, this.camera, this.frameTarget);
  }

  streamingShaderState() { const state = this.streamedShaders?.getState() ?? null; return state ? { ...state,
    pendingKinds: this.streamedShaders!.pendingKinds(), effectsReady: this.effectsReady } : null; }

  setDestinationLoading(active: boolean): void {
    this.startStreamingWarmup();
    this.streamedShaders!.deferGameplayDraws = active;
  }

  isInteriorReady(root: THREE.Object3D): boolean {
    return !this.streamedShaders?.hasPending(root)
      && (!this.interiorPreparation.has(root) || this.readyInteriors.has(root));
  }

  /** Hidden terrain and architecture predate the streaming watcher. Prepare them once before
   * the first portal reveal; subsequent additions are already tracked by childadded. */
  async prepareInterior(root: THREE.Object3D): Promise<void> {
    this.startStreamingWarmup();
    if (!this.preparedInteriors.has(root)) {
      this.streamedShaders!.enqueue(root);
      this.preparedInteriors.add(root);
      const preparation = (async () => {
        await this.waitForInteriorMeshes(root);
        // Fallback glow uses its own depth pass. Its hidden meshes must have
        // occlusion pipelines ready before the destination becomes drawable.
        await this.magicGlow.compileOcclusion(this.renderer, this.scene, this.camera,
          root, 1, this.frameTarget);
        this.readyInteriors.add(root);
      })();
      this.interiorPreparation.set(root, preparation);
    }
    await this.waitForInterior(root);
  }

  /** Keep portal loading covered while the streaming compiler still suppresses its meshes. */
  async waitForInterior(root: THREE.Object3D): Promise<void> {
    const preparation = this.interiorPreparation.get(root);
    if (preparation) await preparation;
    await this.waitForInteriorMeshes(root);
  }

  /** A mesh that failed preparation is no longer pending: it stays hidden and reported, and
   * the rest of the destination opens. */
  private async waitForInteriorMeshes(root: THREE.Object3D): Promise<void> {
    while (this.streamedShaders?.hasPending(root)) {
      assertGraphicsValid(this.renderer);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
  }

  private renderScale = 1;
  private stableShadows = true;
  private frameTimes: number[] = [];
  private lastFrameAt = 0;
  private stats: RenderStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, programs: 0, overBudget: false };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGPURenderer({
      canvas, antialias: true, stencil: true, powerPreference: "high-performance",
      alpha: false, trackTimestamp: this.gpuTimingEnabled,
    });
    this.screenAntialiasing.timingEnabled = this.gpuTimingEnabled;
    this.renderer.info.autoReset = false;
    this.renderer.lighting = new BatchedLighting();
    this.presentationMaterial.fragmentNode = texture(this.frameTarget.texture);
    this.renderer.onDeviceLost = info => {
      this.initialized = false;
      console.error("The graphics device was lost", info);
    };
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Keep 1.00. SKY_STOPS.background is pre-compensated for this exposure, while fog is applied
    // after tone mapping; changing only this number makes the sky and its own sampled fog disagree.
    this.renderer.toneMappingExposure = DAYLIGHT_LOOK.toneMappingExposure;

    this.scene = new THREE.Scene();
    // The scene root never moves; see WorldScene for why its containers are static too.
    this.scene.matrixAutoUpdate = false;

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
    this.camera.position.set(0, 14, 18);
    this.camera.lookAt(0, 1, 0);

    // The visible and illuminating gradients share their shape but retain separate colour
    // values: tone-map compensation belongs to the background, never to incoming light.
    this.skyGradients.push(createSkyGradient("background"), createSkyGradient("light"));
    this.scene.background = new THREE.Color(0xb8cfe0);
    const fog = new THREE.Fog(0xffffff, FOG_NEAR, FOG_FAR);
    // Copied rather than passed as a hex: `sampleSky` returns a linear working-space colour and the
    // Fog constructor would re-decode a hex from sRGB, which is one conversion too many.
    sampleSky(FOG_HORIZON_ELEVATION, "light", fog.color);
    this.scene.fog = fog;
    // Fog and the sky meet in display space. The HDR world is tone mapped later, so
    // compensate the fog colour once in the node graph instead of changing its public palette.
    const worldFogFactor = rangeFogFactor(uniform(fog.near).onRenderUpdate(() => fog.near),
        uniform(fog.far).onRenderUpdate(() => fog.far))
        .mul(uniform(1).onRenderUpdate(() => this.scene.fog ? 1 : 0));
    this.scene.fogNode = fogNode(
      this.biomeAtmosphere.sky.mountainFogColour(
        inverseACES(uniform(fog.color).rgb, uniform(1).onRenderUpdate(() => this.renderer.toneMappingExposure)), worldFogFactor),
      worldFogFactor,
    );

    // The lower, warmer key carries the direction. Keeping most of the old sky fill preserves
    // daylight readability in Vellenwood while reducing horizontal-surface energy by about 30%.
    this.sun = new THREE.DirectionalLight(DAYLIGHT_LOOK.sunColour, DAYLIGHT_LOOK.sunIntensity);
    this.sun.position.set(SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 220;
    // +/-48 rather than +/-70: 96 m across 2048 texels is 4.7 cm per texel against 6.8 cm before,
    // which is what lets a 0.7 m kerb or a fence post cast a shadow with an edge instead of a smear.
    this.sun.shadow.camera.left = -48;
    this.sun.shadow.camera.right = 48;
    this.sun.shadow.camera.top = 48;
    this.sun.shadow.camera.bottom = -48;
    // Depth bias spans the 219 m light frustum: -0.0004 removed 8.8 cm of contact,
    // visibly detaching low creatures from their shadows under the shallow sun.
    // Keep that offset below a centimetre; normal bias handles surface acne.
    this.sun.shadow.bias = -0.00003;
    this.sun.shadow.normalBias = 0.01;
    this.sun.shadow.intensity = SUN_SHADOW_INTENSITY;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // 0.18, down from 0.20, and warmer without turning the scene sepia.
    //
    // The environment map is the sky fill now, and it has direction, which is the whole reason it
    // exists. A hemisphere light at 0.55 in 0x9fc4dd added another (0.061, 0.097, 0.127) of pure
    // sky-blue irradiance on top of it — double-counted fill in exactly the hue that was already
    // the problem. What is left here is a small neutral lift so the very darkest interiors do not
    // crush, with a warm ground half so that a face turned away from both sun and sky picks up
    // earth bounce rather than more sky.
    this.scene.add(this.hemisphere);

    // The 0.35 back-light that used to sit at (-30, 18, -24) is deliberately gone. It was a fixed
    // fill from one direction regardless of where the geometry faced; `scene.environment` does the
    // same job from every direction at once and is directionally correct.

    this.resize();
    window.addEventListener("resize", this.onResize);
  }

  /** Backend initialization and shader preparation finish while the loading view is visible. */
  init(): Promise<void> {
    this.initializing ??= (async () => {
      await this.renderer.init();
      installSharedGeometryBuffers(this.renderer);
      installStableShaderNames(this.renderer);
      this.completeGpuWork = createGpuCompletion(this.renderer);
      this.framePacer = new FramePacer(this.completeGpuWork);
      installGraphicsValidation(this.renderer);
      await validateGraphicsWork(this.renderer, "Graphics initialization", async () => {
        const pmrem = new PMREMGenerator(this.renderer);
        try {
          await pmrem.compileEquirectangularShader();
          for (const gradient of this.skyGradients) {
            const target = pmrem.fromEquirectangular(gradient);
            target.texture.name = "sky-environment";
            this.prefiltered.push(target);
            await this.completeGpuWork();
            await new Promise<void>(resolve => setTimeout(resolve, 0));
          }
          this.scene.background = this.prefiltered[0]!.texture;
          this.scene.environment = this.prefiltered[1]!.texture;
          this.scene.environmentIntensity = ENVIRONMENT_INTENSITY;
        } finally { pmrem.dispose(); }
        // Initialization precedes the render loop; all display passes target the same HDR format.
        this.renderer.setRenderTarget(this.frameTarget);
        try {
          await this.magicGlow.compile(this.renderer, this.frameTarget);
          await this.screenAntialiasing.compile(this.renderer);
          await this.biomeAtmosphere.compile(this.renderer);
          await this.playerSilhouette.compile(this.renderer, this.camera);
        } finally { this.renderer.setRenderTarget(null); }
        const toneMapping = this.renderer.toneMapping;
        this.renderer.toneMapping = THREE.NoToneMapping;
        try { await this.renderer.compileAsync(this.presentation, this.presentation.camera); }
        finally { this.renderer.toneMapping = toneMapping; }
        await this.completeGpuWork();
      });
      this.gpuTimer = this.gpuTimingEnabled ? new GpuTimer(this.renderer) : null;
      this.initialized = true;
    })();
    return this.initializing;
  }

  getBackendState(): GraphicsBackendState {
    return {
      api: (this.renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "webgpu" : "webgl2",
      thread: "main", ready: this.initialized && !graphicsValidationState(this.renderer).failed,
    };
  }

  getPreparationState(): GraphicsPreparationState {
    const streaming = this.streamedShaders?.getState();
    const validation = graphicsValidationState(this.renderer);
    const preparation = shaderPreparationState(this.renderer);
    // The active streamed batch is already enrolled in the shared preparation queue.
    const pendingMeshes = Math.max(streaming?.waiting ?? 0, preparation.pendingMeshes + (streaming?.queued ?? 0));
    const compiling = Boolean(preparation.compiling || this.preparingResident || streaming?.compiling || this.compilingEffects);
    return { pendingMeshes, pendingTextures: preparation.pendingTextures,
      failed: (streaming?.failed ?? 0) + validation.failed, compiling,
      ready: this.initialized && !pendingMeshes && !compiling && !streaming?.failed && !validation.failed && this.effectsReady };
  }

  resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setPixelRatio(gameplayPixelRatio(window.devicePixelRatio, this.renderScale));
    this.renderer.setSize(width, height, false);
    const pixels = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.frameTarget.setSize(pixels.x, pixels.y);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /** Changes the drawing-buffer resolution without changing the canvas's CSS size. */
  setRenderScale(scale: number): void {
    const next = THREE.MathUtils.clamp(scale, 0.5, 1);
    if (next === this.renderScale) return;
    this.renderScale = next;
    this.resize();
  }

  /**
   * Changes real-time shadow cost. Low uses a 1024 px map, high uses 2048 px, and off stops the
   * sun from casting. The renderer's shadow flag stays on because toggling it recompiles every lit
   * material in the scene.
   */
  setShadowQuality(quality: "off" | "low" | "high"): void {
    const enabled = quality !== "off";
    const mapSize = quality === "low" ? 1024 : 2048;

    if (enabled && this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.mapPass?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapPass = null;
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      this.sun.shadow.needsUpdate = true;
    }
    this.sun.castShadow = enabled;
  }

  /** Geometry follows the preset; distant mountains render in the sky pass. */
  setDrawDistance(distance: DrawDistancePreset): void {
    const preset = distancePreset(distance);
    this.biomeAtmosphere.sky.setFogRange(preset.fogNear, preset.fogFar);
    this.camera.far = preset.cameraFar;
    this.camera.updateProjectionMatrix();

    const fog = this.scene.fog;
    if (fog instanceof THREE.Fog) {
      fog.near = preset.fogNear;
      fog.far = preset.fogFar;
    }
  }

  /** Follow the view on a world-anchored texel grid so stationary leaves do not relight on every camera nudge. */
  followShadow(target: THREE.Vector3): void {
    const anchor = this.stableShadows ? snapShadowTargetToTexels(target, new THREE.Vector3(SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z),
      this.sun.shadow.camera, this.sun.shadow.mapSize) : target;
    this.sun.position.set(anchor.x + SUN_OFFSET.x, anchor.y + SUN_OFFSET.y, anchor.z + SUN_OFFSET.z);
    this.sun.target.position.copy(anchor);
    this.sun.target.updateMatrixWorld();
  }

  private preparingResident = 0;

  /** Prepare resident pipelines in small asynchronous batches before exposing the world. */
  async warmup(options?: WarmupOptions): Promise<void> {
    this.preparingResident = (this.preparingResident ?? 0) + 1;
    try {
      const proxies: THREE.Mesh[] = [];
      const seen = new Set<string>();
      for (const root of options?.transparentVariants ?? []) root.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const key = `${shaderGeometryKey(mesh)}:${material.uuid}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const clone = material.clone();
          clone.transparent = true; clone.depthWrite = false;
          this.warmupMaterials.push(clone);
          const instanced = mesh as THREE.InstancedMesh;
          const proxy = instanced.isInstancedMesh
            ? new THREE.InstancedMesh(mesh.geometry, clone, 1)
            : new THREE.Mesh(mesh.geometry, clone);
          if (instanced.isInstancedMesh) (proxy as THREE.InstancedMesh).instanceColor = instanced.instanceColor;
          proxy.frustumCulled = false;
          proxies.push(proxy);
        }
      });
      const objects = this.warmupObjects();
      const hidden = (options?.temporarilyVisible ?? []).filter(root => !root.visible);
      try {
        for (const root of hidden) root.visible = true;
        if (hidden.length) objects.push(...this.warmupObjects());
      } finally { for (const root of hidden) root.visible = false; }
      // No temporary mesh or visibility mutation survives an asynchronous yield.
      const preparing = [...new Set(objects), ...proxies];
      const prepared = captureMagicGlowPreparation(this.renderer, this.scene, this.camera, this.frameTarget, preparing);
      const preparation = this.residentPreparation();
      await prepareShaderMeshes(this.renderer, this.scene, this.camera, preparing, preparation);
      await validateGraphicsWork(this.renderer, "Resident glow preparation", () =>
        this.magicGlow.prepare(this.renderer, this.scene, this.camera, this.frameTarget, preparation.batchSize, prepared));
    } finally { this.preparingResident--; }
  }

  /** Before streaming starts the boot cover is up, so resident work takes covered batches. */
  private residentPreparation() {
    return this.streamedShaders
      ? { renderTarget: this.frameTarget, batchSize: 1, pipelineConcurrency: 1 }
      : { renderTarget: this.frameTarget, batchSize: 4, pipelineConcurrency: COVERED_PIPELINE_CONCURRENCY };
  }

  private warmupObjects(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [], seen = new Set<string>();
    this.scene.traverseVisible(object => {
      const drawable = object as THREE.Mesh & THREE.Points & THREE.Line & THREE.Sprite;
      const needsOwnBindings = (object as THREE.InstancedMesh).isInstancedMesh
        || (object as THREE.SkinnedMesh).isSkinnedMesh || (object as THREE.BatchedMesh).isBatchedMesh
        || (drawable.count ?? 0) > 1;
      // Scenery clusters share one lowered pipeline per layout: the first compiles it and the
      // rest upload their matrices in the first frame, which completes before the reveal.
      // Actors need their skeleton and palette bindings ready.
      if (drawable.isMesh && (!needsOwnBindings || isSceneryInstances(object))) {
        const key = `${shaderGeometryKey(drawable)}:${(Array.isArray(drawable.material) ? drawable.material : [drawable.material])
          .map(material => material.uuid).join(",")}:${drawable.castShadow}:${Boolean(drawable.userData.prepareCorpseFade)}`;
        if (seen.has(key)) return;
        seen.add(key);
      }
      if (drawable.isMesh || drawable.isPoints || drawable.isLine || drawable.isSprite) objects.push(object);
    });
    return objects;
  }

  /** Enrolled effect roots not yet compiled. Batched lighting keeps effect programs valid in
   * every region, so each root compiles exactly once, before play. */
  private readonly pendingEffectRoots = new Set<THREE.Object3D>();
  private readonly preparedEffectRoots = new WeakSet<THREE.Object3D>();
  private compilingEffects = false;
  private effectPreparation: Promise<void> = Promise.resolve();

  /** Download during world pipeline preparation; effect compilation awaits decoded images. */
  async prepareEffectTextures(): Promise<void> {
    await Promise.all([prepareElementalFlowTexture(), prepareElementalFlameTexture()]);
  }

  get effectsReady(): boolean { return !this.compilingEffects && this.pendingEffectRoots.size === 0
    && !graphicsValidationState(this.renderer).failed; }

  /** Enrollment is cheap; `prepareEffects` compiles every enrolled root. */
  compileEffects(root: THREE.Object3D): void {
    if (!this.preparedEffectRoots.has(root)) this.pendingEffectRoots.add(root);
  }

  private async submitEffects(root: THREE.Object3D): Promise<void> {
    await this.prepareEffectTextures();
    const meshes: THREE.Object3D[] = [];
    root.traverse(object => {
      if ((object as THREE.Mesh).isMesh && !isElementalRefractionObject(object)) meshes.push(object);
    });
    const options = this.residentPreparation();
    const prepared = captureMagicGlowPreparation(this.renderer, this.scene, this.camera, this.frameTarget, meshes);
    await prepareShaderMeshes(this.renderer, this.scene, this.camera, meshes, options);
    await this.elementalRefraction.compile(this.renderer, this.scene, this.camera, root, options.batchSize, this.frameTarget);
    await this.magicGlow.compileOcclusion(this.renderer, this.scene, this.camera, root, options.batchSize, this.frameTarget, prepared);
    this.preparedEffectRoots.add(root);
  }

  /** Compiles every enrolled root, serialized with earlier effect work. */
  prepareEffects(root?: THREE.Object3D): Promise<void> {
    if (root) this.compileEffects(root);
    this.effectPreparation = this.effectPreparation.then(async () => {
      this.compilingEffects = true;
      try {
        for (const effect of this.pendingEffectRoots) {
          await this.submitEffects(effect);
          this.pendingEffectRoots.delete(effect);
        }
      } finally { this.compilingEffects = false; }
    });
    return this.effectPreparation;
  }

  render(nowMs: number): void {
    if (!this.canRenderFrame()) return;
    if (this.biomeWeightsSource) this.biomeAtmosphere.setWeights(this.biomeWeightsSource());
    if (this.wildernessMagicSource) this.biomeAtmosphere.setWildernessMagic(this.wildernessMagicSource());
    this.biomeAtmosphere.updateEnvironment(this.scene, this.lastFrameAt > 0 ? (nowMs - this.lastFrameAt) / 1000 : 1 / 60);
    const night = this.biomeAtmosphere.sky.nightAmount;
    const magic = this.biomeAtmosphere.sky.magicAmount;
    const underground = this.biomeAtmosphere.sky.undergroundAmount ?? 0;
    const fairyDepth = this.biomeAtmosphere.sky.fairyDepthAmount ?? 0;
    this.sun.intensity = THREE.MathUtils.lerp(DAYLIGHT_LOOK.sunIntensity, .95 - magic * .12, night);
    this.sun.color.copy(this.daylightSun).lerp(this.moonlight, night);
    this.sun.color.lerp(this.arcaneMoonlight, magic);
    this.scene.environmentIntensity = THREE.MathUtils.lerp(DAYLIGHT_LOOK.environmentIntensity, .2, night);
    this.hemisphere.intensity = THREE.MathUtils.lerp(DAYLIGHT_LOOK.hemisphereIntensity, .12, night);
    if (underground > 0) {
      // Broad mineral light keeps the fairy map and its unusual vegetation readable under the vault.
      this.fairyLight.copy(this.turquoiseFairyLight).lerp(this.violetFairyLight, fairyDepth);
      this.sun.color.lerp(this.fairyLight, underground);
      this.sun.intensity = THREE.MathUtils.lerp(this.sun.intensity, 1.6, underground);
      this.scene.environmentIntensity = THREE.MathUtils.lerp(this.scene.environmentIntensity, .65, underground);
      this.hemisphere.intensity = THREE.MathUtils.lerp(this.hemisphere.intensity, .65, underground);
    }
    const prepareStart = performance.now();
    this.camera.updateMatrixWorld();
    this.prepareScene?.(this.camera);
    this.streamedShaders?.prepare();
    this.cpuPrepareMs = performance.now() - prepareStart;
    this.gpuTimer?.begin();
    const submitStart = performance.now();
    this.cpuShadowMs = 0;
    try {
      if (this.transmissionOcclusion.active) this.transmissionOcclusion.update(this.renderer, this.camera,
        this.scene.getObjectByName("terrain"), this.transmissionCandidates?.() ?? [], this.transmissionOpaqueOccluders?.() ?? []);
      this.drawFrame(this.lastFrameAt > 0 ? (nowMs - this.lastFrameAt) / 1000 : 1 / 60);
    } finally {
      this.streamedShaders?.restore();
      this.cpuSubmitMs = performance.now() - submitStart;
      this.gpuTimer?.end();
    }
    this.framePacer.submit(performance.now());

    if (this.lastFrameAt > 0) {
      const frameMs = nowMs - this.lastFrameAt;
      this.frameTimes.push(frameMs);
      if (this.frameTimes.length > 90) this.frameTimes.shift();
    }
    this.lastFrameAt = nowMs;

    const info = this.renderer.info.render;
    const averageMs = this.frameTimes.length
      ? this.frameTimes.reduce((sum, value) => sum + value, 0) / this.frameTimes.length
      : 0;

    this.stats = {
      fps: averageMs > 0 ? Math.round(1000 / averageMs) : 0,
      frameMs: Math.round(averageMs * 100) / 100,
      drawCalls: info.drawCalls,
      triangles: info.triangles,
      programs: this.renderer.info.memory.programs,
      overBudget: info.drawCalls > RENDER_BUDGET.maxDrawCalls,
    };
  }

  /** Draw the scene and final display treatment without advancing simulation or camera state. */
  drawFrame(deltaSeconds = 0): void {
    validateGraphicsSubmission(this.renderer, "Gameplay frame", () => {
      this.renderer.info.reset();
      const previous = this.renderer.getRenderTarget();
      const toneMapping = this.renderer.toneMapping;
      try {
        this.biomeAtmosphere.sky.renderFogBackdrop(this.renderer, this.camera);
        this.renderer.setRenderTarget(this.frameTarget);
        this.drawWorld();
        this.elementalRefraction.render(this.renderer, this.scene, this.camera);
        this.playerSilhouette.render(this.renderer, this.camera);
        // Atmosphere applies the display transform before grading. Remaining passes operate
        // on linear display values and the final output only encodes the canvas colour space.
        this.biomeAtmosphere.render(this.renderer, deltaSeconds);
        this.magicGlow.render(this.renderer, this.scene, this.camera);
        this.screenAntialiasing.render(this.renderer);
        this.renderer.setRenderTarget(previous);
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.presentation.render(this.renderer);
      } finally {
        this.renderer.setRenderTarget(previous);
        this.renderer.toneMapping = toneMapping;
      }
    });
  }

  /** Queue completion is asynchronous; no game frame waits on the CPU for the GPU. */
  async waitForFrame(afterSubmission?: number): Promise<void> {
    const deadline = performance.now() + 30_000;
    if (afterSubmission !== undefined) {
      for (;;) {
        assertGraphicsValid(this.renderer);
        const state = this.framePacer.snapshot(performance.now());
        if (state.failed || performance.now() >= deadline) throw new Error("Unable to finish the first game frame");
        if (state.submitted > afterSubmission) break;
        await new Promise<void>(resolve => setTimeout(resolve, 8));
      }
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.completeGpuWork(), new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Unable to finish the first game frame")), Math.max(0, deadline - performance.now()));
      })]);
      await waitForGraphicsValidation(this.renderer);
    } finally { clearTimeout(timeout); }
  }

  private drawWorld(): void {
    const background = this.scene.background;
    const sky = this.biomeAtmosphere.sky;
    // The procedural sky is an opaque full-screen triangle. The underlying cube is fully covered,
    // but still triggers its own shader variants whenever refraction first appears.
    if (sky?.enabled && sky.mesh.visible && sky.mesh.parent === this.scene) this.scene.background = null;
    try { this.magicGlow.renderBase(this.renderer, this.scene, this.camera); }
    finally { this.scene.background = background; }
  }

  /** Renders and reads one gameplay frame synchronously for generated documentation. */
  captureFrame(): string {
    this.transmissionOcclusion.restore();
    this.camera.updateMatrixWorld();
    this.prepareScene?.(this.camera);
    this.drawFrame();
    return (this.renderer.domElement as HTMLCanvasElement).toDataURL("image/png");
  }

  /**
   * Renders one north-up orthographic tile of the actual game scene for the build-time world map.
   *
   * This is deliberately synchronous. The normal animation frame cannot overwrite the canvas
   * between the render and `toDataURL`, and the caller can reveal streamed scatter immediately
   * before calling it. The player and transient selection overlays are omitted because the map UI
   * supplies its live player/destination markers separately.
   */
  captureTopDownTile(options: TopDownTileOptions): string {
    this.transmissionOcclusion.restore();
    const span = Math.max(1, options.spanMetres);
    const pixels = Math.max(16, Math.round(options.pixels));
    const camera = new THREE.OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2, 0.1, 500);
    // With a straight-down view, -Z as camera-up keeps +X on the image's right. The build tool
    // flips the captured pixels vertically, which then puts +Z (north) at the top as well.
    camera.up.set(0, 0, -1);
    camera.position.set(options.centreX, options.centreY + 180, options.centreZ);
    camera.lookAt(options.centreX, options.centreY, options.centreZ);
    camera.updateMatrixWorld(true);

    const previousSize = this.renderer.getSize(new THREE.Vector2());
    const previousRatio = this.renderer.getPixelRatio();
    const previousFog = this.scene.fog;
    const previousSun = this.sun.position.clone();
    const previousTarget = this.sun.target.position.clone();
    const shadowCamera = this.sun.shadow.camera;
    const previousShadowBounds = {
      left: shadowCamera.left,
      right: shadowCamera.right,
      top: shadowCamera.top,
      bottom: shadowCamera.bottom,
    };
    const previousShadowNeedsUpdate = this.sun.shadow.needsUpdate;
    const hidden = [this.scene.getObjectByName("player"), this.scene.getObjectByName("overlays"), this.scene.getObjectByName("biome-sky")]
      .filter((object): object is THREE.Object3D => object !== undefined)
      .map((object) => ({ object, visible: object.visible }));

    try {
      for (const entry of hidden) entry.object.visible = false;
      // Gameplay fog is measured from the player camera. From 180 m overhead it would flatten the
      // whole tile to the horizon colour, so map capture uses the same geometry, materials and
      // lights without that view-distance effect.
      this.scene.fog = null;
      // The gameplay shadow camera covers only 96 m. Project the complete capture square onto the
      // light camera's axes, then leave room for terrain, tree crowns and a small edge pad. This
      // keeps the bleed area in the same shadow projection as the 50 m core that survives cropping.
      const lightOffset = new THREE.Vector3().subVectors(this.sun.position, this.sun.target.position);
      const lightForward = lightOffset.clone().normalize();
      const lightRight = new THREE.Vector3(0, 1, 0).cross(lightForward);
      if (lightRight.lengthSq() < 1e-8) lightRight.set(1, 0, 0);
      else lightRight.normalize();
      const lightUp = lightForward.clone().cross(lightRight).normalize();
      const halfSpan = span / 2;
      const casterHeightMargin = 32;
      const edgePadding = 4;
      const projectedHalfExtent = (axis: THREE.Vector3): number =>
        halfSpan * (Math.abs(axis.x) + Math.abs(axis.z))
        + casterHeightMargin * Math.abs(axis.y)
        + edgePadding;
      const shadowHalfWidth = projectedHalfExtent(lightRight);
      const shadowHalfHeight = projectedHalfExtent(lightUp);
      shadowCamera.left = -shadowHalfWidth;
      shadowCamera.right = shadowHalfWidth;
      shadowCamera.top = shadowHalfHeight;
      shadowCamera.bottom = -shadowHalfHeight;
      shadowCamera.updateProjectionMatrix();
      this.sun.shadow.needsUpdate = true;
      // Anchor the shadow texel grid in the light camera's own right/up plane. World-X/Z snapping
      // only happened to work while the sun was high: under a grazing key, both light-space axes
      // contain world Y and Z, so neighbouring captures could land at a fractional texel there.
      const shadowTarget = snapShadowTargetToTexels(
        new THREE.Vector3(options.centreX, options.centreY, options.centreZ),
        lightOffset,
        shadowCamera,
        this.sun.shadow.mapSize,
      );
      this.followShadow(shadowTarget);
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(pixels, pixels, false);
      camera.updateMatrixWorld();
      this.prepareScene?.(camera);
      this.renderer.render(this.scene, camera);
      return (this.renderer.domElement as HTMLCanvasElement).toDataURL("image/png");
    } finally {
      for (const entry of hidden) entry.object.visible = entry.visible;
      this.scene.fog = previousFog;
      this.sun.position.copy(previousSun);
      this.sun.target.position.copy(previousTarget);
      this.sun.target.updateMatrixWorld(true);
      shadowCamera.left = previousShadowBounds.left;
      shadowCamera.right = previousShadowBounds.right;
      shadowCamera.top = previousShadowBounds.top;
      shadowCamera.bottom = previousShadowBounds.bottom;
      shadowCamera.updateProjectionMatrix();
      this.sun.shadow.needsUpdate = previousShadowNeedsUpdate;
      this.renderer.setPixelRatio(previousRatio);
      this.renderer.setSize(previousSize.x, previousSize.y, false);
    }
  }

  getStats(): RenderStats {
    return { ...this.stats };
  }

  getFramePressureMs(): number { return this.framePacer.pressureMs(performance.now()); }

  canRenderFrame(): boolean { return this.initialized && !this.framesSuppressed && !graphicsValidationState(this.renderer).failed
    && this.framePacer.ready(performance.now()); }

  private framesSuppressed = false;
  /** An opaque loading cover hides the canvas, which keeps showing its last frame. Drawing the
   * whole world behind it only competed with the destination's own preparation. */
  setFramesSuppressed(suppressed: boolean): void { this.framesSuppressed = suppressed; }

  /** No driver calls: safe to sample alongside input without perturbing GPU timings. */
  getPresentationState() { return this.framePacer.snapshot(performance.now()); }

  /** A stopped render loop is not a slow frame. Start a fresh window when it resumes. */
  resetFrameTiming(): void {
    this.framePacer.resetTiming();
    this.lastFrameAt = 0;
    this.frameTimes.length = 0;
  }

  getPerformanceTimings(): Record<string, unknown> {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    return {
      backend: this.getBackendState(), preparation: this.getPreparationState(),
      shaderPreparation: shaderPreparationState(this.renderer),
      validation: graphicsValidationState(this.renderer),
      cpuPrepareMs: this.cpuPrepareMs, cpuSubmitMs: this.cpuSubmitMs, cpuShadowMs: this.cpuShadowMs,
      presentation: this.getPresentationState(), gpuTimingEnabled: this.gpuTimingEnabled,
      gpu: this.gpuTimer?.snapshot() ?? { supported: false, milliseconds: null, completed: 0, pending: 0 },
      gpuShadow: { supported: false, milliseconds: null, completed: 0, pending: 0 },
      gpuAntialiasing: this.screenAntialiasing.getTiming(),
      drawingBuffer: [size.x, size.y],
      antialiasing: { samples: this.renderer.samples, finalPass: this.screenAntialiasing.enabled ? "FXAA" : null },
      renderer: this.getBackendState().api,
      transmissionOcclusion: this.transmissionOcclusion.snapshot(),
    };
  }

  setTransmissionOcclusionEnabled(enabled: boolean): void {
    this.transmissionOcclusion.setEnabled(enabled);
  }

  /** Lab comparison: the normal game always starts with the final smoothing pass enabled. */
  setScreenAntialiasingEnabled(enabled: boolean): void {
    this.screenAntialiasing.enabled = enabled;
  }

  /** Lab regression comparison for camera-dependent shadow shimmer. */
  setShadowStabilizationEnabled(enabled: boolean): void {
    this.stableShadows = enabled;
  }

  setTransmissionProbeMode(mode: "bounds" | "exact-diagnostic"): void {
    this.transmissionOcclusion.setProbeMode(mode);
  }

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.initialized = false;
    this.framePacer?.dispose();
    this.frameTarget.dispose();
    this.presentationMaterial.dispose();
    this.biomeAtmosphere.dispose();
    this.playerSilhouette.dispose();
    this.screenAntialiasing.dispose();
    this.magicGlow.dispose();
    this.elementalRefraction.dispose();
    this.transmissionOcclusion.dispose();
    this.gpuTimer?.dispose();
    this.streamedShaders?.dispose();
    for (const material of this.warmupMaterials) material.dispose();
    this.warmupMaterials.length = 0;
    for (const target of this.prefiltered) target.dispose();
    this.prefiltered.length = 0;
    for (const gradient of this.skyGradients) gradient.dispose();
    this.skyGradients.length = 0;
    disposeGraphicsValidation(this.renderer);
    this.renderer.dispose();
  }
}

/**
 * Moves a shadow target onto the directional light's global texel lattice.
 *
 * The component along the light direction is left untouched because it affects only shadow depth.
 * Snapping the two camera-plane components makes overlapping map tiles differ by whole texels, so
 * PCF samples the same shadow edge on both sides of a stitched join.
 */
export function snapShadowTargetToTexels(
  target: THREE.Vector3,
  lightOffset: THREE.Vector3,
  camera: THREE.OrthographicCamera,
  mapSize: THREE.Vector2,
): THREE.Vector3 {
  if (lightOffset.lengthSq() < 1e-8) return target.clone();
  const viewZ = lightOffset.clone().normalize();
  const viewX = new THREE.Vector3(0, 1, 0).cross(viewZ);
  if (viewX.lengthSq() < 1e-8) viewX.set(1, 0, 0);
  else viewX.normalize();
  const viewY = viewZ.clone().cross(viewX).normalize();

  const texelX = Math.abs(camera.right - camera.left) / Math.max(1, mapSize.x);
  const texelY = Math.abs(camera.top - camera.bottom) / Math.max(1, mapSize.y);
  if (texelX <= 0 || texelY <= 0) return target.clone();

  const right = Math.round(target.dot(viewX) / texelX) * texelX;
  const up = Math.round(target.dot(viewY) / texelY) * texelY;
  const depth = target.dot(viewZ);
  return new THREE.Vector3()
    .addScaledVector(viewX, right)
    .addScaledVector(viewY, up)
    .addScaledVector(viewZ, depth);
}

/** Which of the two authored columns a gradient is built from, and what happens to it after. */
type SkyPurpose = "background" | "light";

/**
 * The sky as a 1024 x 256 RGBA texture.
 *
 * A `DataTexture` rather than the proposed `CanvasTexture`: the bytes are computed here, so the
 * gradient is identical on every machine and in any environment without a DOM, and there is no
 * 2D-canvas colour-management step between the authored hex and the sampled texel.
 *
 * Called twice, once per purpose. The two differ by which column of `SKY_STOPS` they read and by
 * whether the result is desaturated; everything else about them is identical, which is what keeps
 * the sky the player sees and the sky that lights the world the same shape.
 */
function createSkyGradient(purpose: SkyPurpose): THREE.DataTexture {
  const width = SKY_TEXTURE_WIDTH;
  const height = SKY_TEXTURE_HEIGHT;
  const data = new Uint8Array(width * height * 4);
  const colour = new THREE.Color();
  const encoded = { r: 0, g: 0, b: 0 };

  for (let row = 0; row < height; row += 1) {
    // Row 0 is uv.y = 0, which is straight down; row height-1 is the zenith.
    const v = (row + 0.5) / height;
    sampleSky(2 * v - 1, purpose, colour);
    if (purpose === "light") desaturate(colour, ENVIRONMENT_SATURATION);
    // Back to sRGB before it becomes bytes. `sampleSky` works in the linear working space, and the
    // texture is tagged sRGB, so writing the linear values straight out would have the shader decode
    // them a second time — #4f83b8 would reach the frame as #163b78.
    colour.getRGB(encoded, THREE.SRGBColorSpace);
    const r = Math.round(encoded.r * 255);
    const g = Math.round(encoded.g * 255);
    const b = Math.round(encoded.b * 255);
    for (let column = 0; column < width; column += 1) {
      const offset = (row * width + column) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.name = `sky-gradient-${purpose}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Linear interpolation between the authored stops, in sRGB, which is how they were picked. */
function sampleSky(elevation: number, purpose: SkyPurpose, out: THREE.Color): THREE.Color {
  const pick = (stop: { background: number; authored: number }): number =>
    purpose === "background" ? stop.background : stop.authored;
  const e = Math.min(1, Math.max(-1, elevation));
  for (let index = 0; index < SKY_STOPS.length - 1; index += 1) {
    const upper = SKY_STOPS[index]!;
    const lower = SKY_STOPS[index + 1]!;
    if (e <= upper.e && e >= lower.e) {
      const span = upper.e - lower.e;
      const t = span <= 0 ? 0 : (e - lower.e) / span;
      const a = new THREE.Color().setHex(pick(lower), THREE.SRGBColorSpace);
      const b = new THREE.Color().setHex(pick(upper), THREE.SRGBColorSpace);
      // setHex with SRGBColorSpace converts to working (linear) space, so lerp here is a linear
      // blend of the two authored colours — which is what avoids the muddy midpoint sRGB lerps give.
      return out.copy(a).lerp(b, t);
    }
  }
  return out.setHex(pick(SKY_STOPS[e > 0 ? 0 : SKY_STOPS.length - 1]!), THREE.SRGBColorSpace);
}

/**
 * Pulls a linear colour toward its own Rec. 709 luminance, in place.
 *
 * Luminance-preserving on purpose: the environment map's LEVEL is set once, by
 * `ENVIRONMENT_INTENSITY`, and desaturation must not move it, or the two dials fight each other
 * and neither number means anything on its own.
 */
function desaturate(colour: THREE.Color, amount: number): void {
  const luminance = 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b;
  colour.setRGB(
    luminance + (colour.r - luminance) * amount,
    luminance + (colour.g - luminance) * amount,
    luminance + (colour.b - luminance) * amount,
  );
}
