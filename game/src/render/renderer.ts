import { PlayerSilhouette } from "./playerSilhouette.js";
import { BiomeAtmosphere, type BiomeWeights } from "./biomeAtmosphere.js";
/**
 * Renderer ownership: the WebGL context, the render target size, sky, atmosphere, lighting rig,
 * and per-frame stats.
 *
 * This file owns no gameplay state. Everything it draws is a view of the canonical store.
 */
import * as THREE from "three";
import { CAMERA, RENDER_BUDGET } from "../app/config.js";
import { GpuTimer } from "./gpuTimer.js";
import { ScreenAntialiasing } from "./screenAntialiasing.js";
import { MagicGlow } from "./magicGlow.js";
import { ElementalRefraction } from "./elementalRefraction.js";
import { TransmissionOcclusion, type TransmissionOpaqueOccluder } from "./transmissionOcclusion.js";
import { StreamedShaderWarmup } from "./streamedShaderWarmup.js";

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
} as const;

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

/** Camera-space metres covered by one draw-distance setting. */
export function drawDistanceMetres(distance: DrawDistancePreset): number {
  return DRAW_DISTANCE[distance].cameraFar;
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
  return DRAW_DISTANCE[distance].fogFar;
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
  /**
   * Roots whose materials should ALSO be compiled in their transparent form.
   *
   * `transparent` is part of three's program cache key (the `opaque` bit in
   * `WebGLPrograms.getProgramCacheKeyBooleans`), so the first frame the occluder fade flips a roof
   * to transparent pays a fresh shader compile — the same class of stall that measured 1130 ms
   * here. Pass the fade candidates and that cost moves to boot.
   */
  transparentVariants?: readonly THREE.Object3D[];
  /**
   * Groups that are hidden at boot but will be shown later — the dungeon interior, today.
   *
   * `loop.addInterior` hides the Gravelmaw group whenever the player is on the surface, and three
   * skips everything under an invisible ancestor, including its four lights. So a warm-up that runs
   * with the dungeon hidden compiles neither the dungeon's own materials nor the +3-point-light
   * variant of every other material, and the player pays for both in the frame they walk in.
   * These roots are shown for a second compile pass and put back exactly as they were.
   */
  temporarilyVisible?: readonly THREE.Object3D[];
}

export class Renderer {
  readonly magicGlow = new MagicGlow();
  readonly elementalRefraction = new ElementalRefraction();
  readonly biomeAtmosphere = new BiomeAtmosphere();
  biomeWeightsSource?: () => BiomeWeights;
  readonly renderer: THREE.WebGLRenderer;
  readonly playerSilhouette = new PlayerSilhouette();
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  /** Prepare instance buffers after the camera settles and before Three uploads this frame. */
  prepareScene?: (camera: THREE.Camera) => void;
  transmissionCandidates?: () => readonly THREE.Mesh[];
  transmissionOpaqueOccluders?: () => readonly TransmissionOpaqueOccluder[];
  private readonly transmissionOcclusion = new TransmissionOcclusion();
  private readonly screenAntialiasing = new ScreenAntialiasing();
  private gpuTimer: GpuTimer | null = null;
  private shadowGpuTimer: GpuTimer | null = null;
  private restoreShadowTiming: (() => void) | null = null;
  private timingRender = false;
  private cpuPrepareMs = 0;
  private cpuSubmitMs = 0;
  private cpuShadowMs = 0;

  /** The two gradients: the one the sky is drawn from, and the one the world is lit by. */
  private readonly skyGradients: THREE.DataTexture[] = [];
  /** PMREM outputs, held so `dispose` can free them: [0] is the background, [1] the environment. */
  private readonly prefiltered: THREE.WebGLRenderTarget[] = [];
  /**
   * Transparent clones made by `warmup`, kept alive deliberately. three releases a program when the
   * last material referencing it is disposed, so an undisposed clone is what pins the variant in
   * the program cache for the life of the session.
   */
  private readonly warmupMaterials: THREE.Material[] = [];
  private streamedShaders: StreamedShaderWarmup | null = null;

  startStreamingWarmup(): void {
    this.streamedShaders ??= new StreamedShaderWarmup(this.renderer, this.scene, this.camera);
  }

  streamingShaderState() { return this.streamedShaders?.getState() ?? null; }

  isInteriorReady(root: THREE.Object3D): boolean { return !this.streamedShaders?.hasPending(root); }

  /** Keep portal loading covered while the streaming compiler still suppresses its meshes. */
  async waitForInterior(root: THREE.Object3D): Promise<void> {
    while (!this.isInteriorReady(root)) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
  }

  private renderScale = 1;
  private stableShadows = true;
  private frameTimes: number[] = [];
  private lastFrameAt = 0;
  private stats: RenderStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, programs: 0, overBudget: false };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      stencil: true,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Keep 1.00. SKY_STOPS.background is pre-compensated for this exposure, while fog is applied
    // after tone mapping; changing only this number makes the sky and its own sampled fog disagree.
    this.renderer.toneMappingExposure = DAYLIGHT_LOOK.toneMappingExposure;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
    this.camera.position.set(0, 14, 18);
    this.camera.lookAt(0, 1, 0);

    // Sky and environment: the SAME gradient shape, prefiltered twice from two different columns
    // of `SKY_STOPS`.
    //
    // Deviation from the proposal, and the reason for it: the spec asked for a BackSide sphere of
    // radius 1000 parented to the camera. Radius 1000 is beyond `CAMERA.far` (280) so it would be
    // clipped away entirely, and a sphere parented to the camera inherits camera pitch, which tilts
    // the horizon band whenever the player orbits. `scene.background` holding a PMREM cube costs
    // the same single draw call, is drawn in the correct orientation by construction, and cannot be
    // clipped or culled.
    //
    // Two prefilters and not one, at a measured cost of 1.4 MB and about 8 ms of boot. The first
    // pass used one texture for both and the ACES pre-compensation the BACKGROUND needs went
    // straight into the lighting integral, where nothing ever undoes it. `scene.background` and
    // `scene.environment` are supposed to agree about the SHAPE of the sky, which they do here,
    // and they are supposed to disagree about its numbers, because one is an image that will be
    // tone mapped and the other is a light that will not.
    //
    // An equirect DataTexture cannot be a background directly: three 0.185's `addToRenderList`
    // only routes `isCubeTexture` and `CubeUVReflectionMapping` to the sky box, and any other
    // texture becomes a flat screen-space quad instead of a sky.
    const backgroundGradient = createSkyGradient("background");
    const lightGradient = createSkyGradient("light");
    this.skyGradients.push(backgroundGradient, lightGradient);
    const background = generateEnvironment(this.renderer, backgroundGradient);
    const environment = generateEnvironment(this.renderer, lightGradient);
    if (background) {
      this.prefiltered.push(background);
      this.scene.background = background.texture;
    } else {
      // Fallback only. If PMREM fails there is no gradient, but the frame still has the flat sky it
      // had before this change rather than a black void.
      this.scene.background = new THREE.Color(0xb8cfe0);
    }
    if (environment) {
      this.prefiltered.push(environment);
      this.scene.environment = environment.texture;
      this.scene.environmentIntensity = ENVIRONMENT_INTENSITY;
    }

    // FOG IS SAMPLED FROM THE SKY, not authored beside it. Two separate corrections:
    //
    // 1. The colour. The previous value, 0x9fcdfa, was the authored 0xb8cfe0 pre-compensated for
    //    ACES on the stated grounds that "fog is mixed in linear space before tone mapping". In
    //    three 0.185 that is backwards. `ShaderLib/meshphysical.glsl.js` orders the tail of the
    //    fragment shader `<tonemapping_fragment>`, `<colorspace_fragment>`, `<fog_fragment>` — fog
    //    is the LAST thing that touches the pixel — and `WebGLMaterials.refreshFogUniforms` does
    //    `fog.color.getRGB( uniforms.fogColor.value, getUnlitUniformColorSpace( renderer ) )`,
    //    which with `outputColorSpace = SRGBColorSpace` hands the shader the sRGB-ENCODED hex.
    //    Nothing tone maps it. So the pre-compensated value went to screen raw as #9fcdfa, a
    //    saturated pale blue, while the sky it was supposed to dissolve into is tone mapped and
    //    displays its `authored` column. Measured in litb-great_cairn.png: the sky just below the
    //    horizon reads (203,209,209) and (206,212,213), against a fog colour of (159,205,250) —
    //    47 levels apart in red and 41 in blue, which is the flat pale band across the horizon.
    //    Sampling the `authored` column at the horizon makes the two agree by construction, and
    //    any future edit to SKY_STOPS carries the fog with it.
    // 2. The range. 30..300 put almost no haze anywhere a player looks. The world is 700 x 400 m
    //    and a shot camera sits 6-34 m out, so the ridges that make up the mid-ground sit at
    //    40-120 m: at 30..300 a ridge at 45 m carried 5.6% fog. Measured in litb-palewood_copse.png
    //    column 720, the sky ramps 200,207,207 down to 167,174,164 over 210 px and then the ridge
    //    below it drops 203 levels in ONE row — no aerial perspective at any distance this world
    //    actually contains. 26..210 puts 12% on 45 m, 40% on 120 m and full haze past 210, which is
    //    inside `CAMERA.far` (280) on purpose: terrain past 210 m now dissolves into the sky
    //    instead of ending at a visible edge where the heightfield runs out.
    const fog = new THREE.Fog(0xffffff, FOG_NEAR, FOG_FAR);
    // Copied rather than passed as a hex: `sampleSky` returns a linear working-space colour and the
    // Fog constructor would re-decode a hex from sRGB, which is one conversion too many.
    sampleSky(FOG_HORIZON_ELEVATION, "light", fog.color);
    this.scene.fog = fog;

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
    // Tighter texels need less bias. -0.0008 at 6.8 cm/texel was peeling contact shadows away from
    // the objects casting them, which is half of why every prop read as floating.
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
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
    this.scene.add(new THREE.HemisphereLight(
      DAYLIGHT_LOOK.hemisphereSky,
      DAYLIGHT_LOOK.hemisphereGround,
      DAYLIGHT_LOOK.hemisphereIntensity,
    ));

    // The 0.35 back-light that used to sit at (-30, 18, -24) is deliberately gone. It was a fixed
    // fill from one direction regardless of where the geometry faced; `scene.environment` does the
    // same job from every direction at once and is directionally correct.

    this.resize();
    window.addEventListener("resize", () => this.resize());

  }

  resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.renderScale);
    this.renderer.setSize(width, height, false);
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

  /** Keeps the far clip behind the fog so reduced draw distance never exposes a hard world edge. */
  setDrawDistance(distance: DrawDistancePreset): void {
    const preset = DRAW_DISTANCE[distance];
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

  /**
   * Compiles every shader the first frames would otherwise compile mid-session.
   *
   * Measured before this existed: `npm run perf` reported 19 programs at the `spawn` and
   * `town_entrance` poses and 20 at all sixteen later ones, and the frames that did the compiling
   * measured 1130.6 ms, 994.7 ms and 346.1 ms against medians of 1.2-4.2 ms. Call this once, at the
   * end of boot, after the world, the entity views, the dungeon and the overlays exist — anything
   * added to the scene afterwards is not covered.
   *
   * Cheap to call twice; three returns the cached program for anything already compiled.
   *
   * THIS METHOD CANNOT WARM EVERY LAYER, and `render/spellVfx.ts` is the counter-example worth
   * recording. Its one InstancedMesh sits hidden with `count = 0` until the player casts, and three
   * gathers materials with a plain `scene.traverse` (three.module.js:17426), so it looks like it
   * should be covered here — but measured, `getMetrics().programs` still climbed 106 -> 107 on the
   * first cast of a session, and routing the material through a one-instance proxy in this method
   * did not stop it either. That layer now compiles its own program by drawing one degenerate
   * instance on its first idle frame; see `SpellVfx.primeShader`. Prefer that shape for any future
   * layer whose real draw is unusual enough that a proxy is a guess.
   */
  warmup(options?: WarmupOptions): void {
    const holder = new THREE.Group();
    holder.name = "shader-warmup";

    const seen = new Set<THREE.Material>();
    for (const root of options?.transparentVariants ?? []) {
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh !== true) return;
        // Skinned meshes are skipped: skinning is a program parameter too, and nothing skinned is
        // ever a fade candidate — the fade exists for roofs and walls.
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh === true) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          if (seen.has(material)) continue;
          seen.add(material);
          const clone = material.clone();
          clone.onBeforeCompile = material.onBeforeCompile.bind(material);
          clone.customProgramCacheKey = material.customProgramCacheKey.bind(material);
          clone.transparent = true;
          clone.depthWrite = false;
          this.warmupMaterials.push(clone);
          // The real geometry, not a placeholder: vertex colours, vertex alphas and UV sets are all
          // program parameters read off the geometry, so a stand-in would compile a different
          // program to the one the fade actually needs.
          const instanced = mesh as THREE.InstancedMesh;
          const proxy = instanced.isInstancedMesh === true
            ? new THREE.InstancedMesh(mesh.geometry, clone, 1)
            : new THREE.Mesh(mesh.geometry, clone);
          proxy.frustumCulled = false;
          holder.add(proxy);
        }
      });
    }

    if (holder.children.length > 0) this.scene.add(holder);
    this.compileColourPasses();

    // Second pass with the interiors revealed. Both variants end up in the program cache, and
    // neither entering nor leaving the dungeon compiles anything afterwards.
    const hidden = (options?.temporarilyVisible ?? []).filter((root) => root.visible === false);
    if (hidden.length > 0) {
      for (const root of hidden) root.visible = true;
      this.compileColourPasses();
      for (const root of hidden) root.visible = false;
    }

    if (holder.children.length > 0) this.scene.remove(holder);
    holder.clear();
  }

  /** Refraction redraws opaque objects into a linear target with tone mapping disabled. */
  private compileColourPasses(): void {
    this.renderer.compile(this.scene, this.camera);
    const previous = this.renderer.getRenderTarget();
    const target = new THREE.WebGLRenderTarget(1, 1);
    try {
      this.renderer.setRenderTarget(target);
      this.renderer.compile(this.scene, this.camera);
    } finally {
      this.renderer.setRenderTarget(previous);
      target.dispose();
    }
  }

  render(nowMs: number): void {
    if (this.biomeWeightsSource) this.biomeAtmosphere.setWeights(this.biomeWeightsSource());
    this.biomeAtmosphere.updateEnvironment(this.scene, this.lastFrameAt > 0 ? (nowMs - this.lastFrameAt) / 1000 : 1 / 60);
    const context = this.renderer.getContext();
    if ("createQuery" in context && !this.gpuTimer) {
      // WebGL elapsed queries cannot overlap. Whole-frame and shadow-only samples alternate.
      this.gpuTimer = new GpuTimer(context, 20, 0);
      this.shadowGpuTimer = new GpuTimer(context, 20, 10);
      const shadowMap = this.renderer.shadowMap;
      const original = shadowMap.render;
      shadowMap.render = (...args) => {
        if (!this.timingRender || args[0].length === 0) return original.apply(shadowMap, args);
        this.shadowGpuTimer?.begin();
        const started = performance.now();
        try { return original.apply(shadowMap, args); }
        finally {
          this.cpuShadowMs = performance.now() - started;
          this.shadowGpuTimer?.end();
        }
      };
      this.restoreShadowTiming = () => { shadowMap.render = original; };
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
      this.timingRender = true;
      this.drawFrame(this.lastFrameAt > 0 ? (nowMs - this.lastFrameAt) / 1000 : 1 / 60);
    } finally {
      this.timingRender = false;
      this.streamedShaders?.restore();
      this.cpuSubmitMs = performance.now() - submitStart;
      this.gpuTimer?.end();
    }

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
      drawCalls: info.calls,
      triangles: info.triangles,
      programs: this.renderer.info.programs?.length ?? 0,
      overBudget: info.calls > RENDER_BUDGET.maxDrawCalls,
    };
  }

  /** Draw the scene and final display treatment without advancing simulation or camera state. */
  drawFrame(deltaSeconds = 0): void {
    this.drawWorld();
    this.elementalRefraction.render(this.renderer, this.scene, this.camera);
    this.playerSilhouette.render(this.renderer, this.camera);
    this.biomeAtmosphere.render(this.renderer, deltaSeconds);
    this.magicGlow.render(this.renderer, this.scene, this.camera);
    this.screenAntialiasing.render(this.renderer);
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
    return this.renderer.domElement.toDataURL("image/png");
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
    const previousShadowMapNeedsUpdate = this.renderer.shadowMap.needsUpdate;
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
      this.renderer.shadowMap.needsUpdate = true;
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
      return this.renderer.domElement.toDataURL("image/png");
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
      this.renderer.shadowMap.needsUpdate = previousShadowMapNeedsUpdate;
      this.renderer.setPixelRatio(previousRatio);
      this.renderer.setSize(previousSize.x, previousSize.y, false);
    }
  }

  getStats(): RenderStats {
    return { ...this.stats };
  }

  /** A stopped render loop is not a slow frame. Start a fresh window when it resumes. */
  resetFrameTiming(): void {
    this.lastFrameAt = 0;
    this.frameTimes.length = 0;
  }

  getPerformanceTimings(): Record<string, unknown> {
    const gl = this.renderer.getContext();
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      cpuPrepareMs: this.cpuPrepareMs, cpuSubmitMs: this.cpuSubmitMs, cpuShadowMs: this.cpuShadowMs,
      gpu: this.gpuTimer?.snapshot() ?? { supported: false, milliseconds: null, completed: 0, pending: 0 },
      gpuShadow: this.shadowGpuTimer?.snapshot() ?? { supported: false, milliseconds: null, completed: 0, pending: 0 },
      gpuAntialiasing: this.screenAntialiasing.getTiming(),
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      antialiasing: { samples: Number(gl.getParameter(gl.SAMPLES)), finalPass: this.screenAntialiasing.enabled ? "FXAA" : null },
      renderer: info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null,
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
    this.biomeAtmosphere.dispose();
    this.playerSilhouette.dispose();
    this.screenAntialiasing.dispose();
    this.magicGlow.dispose();
    this.elementalRefraction.dispose();
    this.transmissionOcclusion.dispose();
    this.gpuTimer?.dispose();
    this.shadowGpuTimer?.dispose();
    this.restoreShadowTiming?.();
    this.streamedShaders?.dispose();
    for (const material of this.warmupMaterials) material.dispose();
    this.warmupMaterials.length = 0;
    for (const target of this.prefiltered) target.dispose();
    this.prefiltered.length = 0;
    for (const gradient of this.skyGradients) gradient.dispose();
    this.skyGradients.length = 0;
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

/**
 * Prefilters the gradient into an environment map.
 *
 * There was no `scene.environment` anywhere in this game before this: grep for `envMap`, `PMREM`
 * or `scene.environment` across game/src returned nothing. That is why nothing metallic reads as
 * metal, and why a roughness-0.1 water surface would have rendered black — a smooth surface with
 * nothing to reflect reflects nothing. About 1.4 MB for a 256 cube and roughly 8 ms at boot.
 */
function generateEnvironment(
  renderer: THREE.WebGLRenderer,
  gradient: THREE.DataTexture,
): THREE.WebGLRenderTarget | null {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromEquirectangular(gradient);
    pmrem.dispose();
    target.texture.name = "sky-environment";
    return target;
  } catch {
    // A missing environment map is a look regression, not a crash. Boot continues without it.
    return null;
  }
}
