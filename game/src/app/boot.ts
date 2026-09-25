import { assetBaseUrl, generatedUrl, publicUrl, setPublicBaseUrl } from "./config.js";
import { playTargetOf, takePendingLaunch } from "../multiplayer/playIntent.js";
import { registerDisplayFont } from "../ui/displayFont.js";
import { prepareUiFirstPaint } from "../ui/firstPaint.js";
import { runtimeTables } from '../content/runtimeCatalog.js';
import { CROWNWARD_RIVER_LAB_CHANNELS } from '../content/crownwardRiver.js';
import { createRiverSurface } from '../render/riverSurface.js';
import { isFairyRegion, worldMapForRegion } from '../contracts.js';
import { createRealmTerrain, createRealmScatter, type RealmTerrain } from './realmTerrain.js';
import { resolveFairyDressing } from './fairyDressing.js';
import { cachedWorldValue } from '../world/cachedWorldValue.js';
import releaseNavigation from 'virtual:corealm-release-navigation';
import { loadArtifactBytes } from '../systems/navigation.js';
import { buildFairyTerrainSpec } from './worldSpec.js';
import { FAIRY_PORTAL_LAB_TERRAIN, assembleFairyPortalFixture, createFairyPortalWorkbench } from '../featureLab/fairyPortal.js';
import { immediatePlayerItems, PlayerEntitySelector, type PlayerAssetArea } from '../render/playerAssetPlan.js';
import { WorldSiteStreaming } from '../world/worldSiteStreaming.js';
import generationRevision from "virtual:corealm-generation-revision";
import { GenerationCache } from "../world/generationCache.js";
import { generationScope } from "../world/worldDataFormat.js";
import { ShippedWorldData } from "../world/shippedWorldData.js";
import { mobSpawnPlacementPorts } from "./mobSpawns.js";
import { registerExclusions } from "./worldExclusions.js";
import { buildDungeonSpec } from "./dungeonSpec.js";
/**
 * Boot sequence. The order is fixed because two WASM modules and the navmesh have hard ordering
 * (runs/corealm/architecture.md section 3, verified in stack-findings.md section 1).
 *
 * `getState().ready` only flips true at the very end, which is what the Playwright driver polls.
 *
 * This file is where the round-1 workers' output is composed: A1's semantic world, A2's terrain and
 * views, A4's input. Each depends only on frozen contracts, so no worker had to know about another.
 */
import * as THREE from "three";
import { WILDERNESS_LAVA_LAB_CHANNELS, DEEP_WILDERNESS_LAVA_LAB_CHANNELS } from "../content/wildernessLava.js";
import { WildernessEffects, wildernessEffectsLabTorches, deepWildernessEffectsLabTorches, torchFlameOrigin, type WildernessTorch } from "../render/wildernessEffects.js";
import { WildernessCreatureEffects, type WildernessCreatureEmitter } from '../render/wildernessCreatureEffects.js';
import { assertCreatureCatalog } from '../content/creatureCatalog.js';
import { wildernessMagicAt } from '../content/wildernessDepth.js';
import { DEEP_WILDERNESS_STRUCTURES, type DeepWildernessStructureId } from '../render/compositions/deepWildernessStructures.js';
import { coastalBodyOnSafeGround } from '../content/coastalEncounterFormation.js';
import { lavaObstacles } from "../world/lavaObstacles.js";
import { WILDERNESS_ROAD_BRAZIERS } from "../content/wildernessLandmarks.js";
import type { ForestTreeDescriptor } from "../world/forestResources.js";
import { ForestPresentation } from "../render/forestPresentation.js";
import { ForestObstacles } from "../world/forestObstacles.js";
import { WORLD_SITES, type WorldSite } from "../content/worldSites.js";
import { WORLD_HABITATS, habitatContains, type HabitatDef } from "../content/worldHabitats.js";
import { habitatIdleTargets } from "../world/habitatMovement.js";
import { resolveWorldSiteDressing, type ResolvedWorldSiteDressing } from "../render/worldSiteDressing.js";
import type {
  EntityId,
  FeatureLabApi,
  FeatureLabStructureSelection,
  FeatureLabStructureView,
  LootContainerView,
  RegionId,
  SemanticEntity,
  SkillId,
  SolidVolume,
  Vec3,
} from "../contracts.js";
import { SKILL_IDS } from "../contracts.js";
import { Store } from "../state/store.js";
import { EventBus } from "../core/events.js";
import { SimClock } from "../core/time.js";
import { fogOpaqueMetres, Renderer } from "../render/renderer.js";
import { OrbitCamera } from "../render/camera.js";
import { AssetRegistry } from "../render/assets.js";
import { registerProceduralGear } from "../render/proceduralGearFactories.js";
import { WorldScene } from "../render/scene.js";
import { EntityViews } from "../render/entityViews.js";
import { buildStructureNavigationSources } from "../render/structureNavigation.js";
import { RoofVisibility } from "../render/roofVisibility.js";
import { buildStructureCameraSources, StructureCameraStreaming } from "../render/structureCameraSources.js";
import { STOREY_METRES } from "../render/buildings.js";
import { StaticCameraQueries } from "../systems/staticCameraQueries.js";
import { Navigation } from "../systems/navigation.js";
import { solidObstacleMeshes } from "../systems/navigationObstacles.js";
import { dryNavigationMeshes } from "../world/waterNavigation.js";
import { Movement } from "../systems/movement.js";
import { Solids } from "../systems/solids.js";
import { CorealmGameApi } from "../api/gameApi.js";
import { loadSerializedSave } from "../persistence/storage.js";
import type { RecordedError } from "../debug/gameDebug.js";
import { installBootPlaceholder } from "../debug/bootPlaceholder.js";
import { GameLoop } from "./loop.js";
import { formatBootAssetProgress } from "./bootStatus.js";
import { InputController } from "../input/mouse.js";
import { prepareWorldSurface } from "./worldSurface.js";
import { fishingSiteAnchors } from "./fishingAccess.js";
import { miningAccessPositions } from "./miningAccess.js";
import { CAMERA } from "./config.js";
import { EntityStore, straightLineDistance } from "../world/entities.js";
import { InteractionDispatcher } from "../world/interactions.js";
import { InventorySystem } from "../systems/inventory.js";
import { BankSystem } from "../systems/bank.js";
import { EconomySystem } from "../systems/economy.js";
import { activitySummary } from "../systems/activity.js";
import { TraversalPresentation } from "../render/traversalPresentation.js";
import { huntContractsView } from "../ui/huntContracts.js";
import { HuntContractsSystem } from "../systems/huntContracts.js";
import { deriveHuntTargets } from "../content/huntContracts.js";
import { coastalSpawnSites } from "./coastalSpawns.js";
import { QuestSystem } from "../systems/quests.js";
import { PortalTransition } from "../ui/portalTransition.js";
import { INTERACT_RANGE } from "./config.js";
import { distanceXZ } from "../core/math.js";
import {
  
  REGIONS,
  getRegion } from "../content/regions.js";
import { content } from "../content/index.js";
import { worldExclusions, type ScatterResult } from "../world/scatter.js";
import { ScatterStreamingController } from "../world/scatterStreaming.js";
import { findShot, shotIds, SHOTS } from "../debug/shots.js";
import { createUi } from "../ui/panels.js";
import { MobileLayout } from "../ui/mobileLayout.js";
import { preloadFeatureLabPanel } from "../ui/lazyPanelRegistry.js";
import { SettingsStore, type UiSettings } from "../ui/settings.js";
import { keybindings } from "../input/keyboard.js";
import { CharacterRig } from "../render/characterRig.js";
import {
  addChamberLights, buildDungeon, dungeonFloorHeight, dungeonNavigationBlockers, loadCaveRockSource, type BuiltDungeon } from "../render/dungeon.js";
import { DeferredDungeonFacing } from "../render/deferredDungeonFacing.js";
import { Ambience, Vfx, type AmbienceEmitter, type AmbienceKind } from "../render/vfx.js";
import { SpellVfx } from "../render/spellVfx.js";
import { AimReticle } from "../render/aimReticle.js";
import { HealthBars } from "../render/healthBars.js";
import {
  AudioDirector, AudioEngine, COREALM_AUDIO_CATALOG, CorealmAudioBridge,
  footstepSurfaceAt, type AudioDiagnostic,
} from "../audio/index.js";
import { GAME_BOOT_PROFILE, type BootProfile } from "./bootProfile.js";
/** Re-exported so the entry reaches the whole app through this one module. */
export { bootProfileFor } from "./bootProfile.js";
import type { FeatureLabStructureAssembly } from "../featureLab/structures.js";
import { isStaticScenery } from "../multiplayer/replicatedEntities.js";
import { sendGameCommand } from "../api/commands.js";
import { BOOT_MILESTONES, BOOT_SPANS, bootTelemetry } from "../perf/bootTelemetry.js";
import { AdaptiveDrawDistance } from "../render/adaptiveDrawDistance.js";

export interface BootResult {
  loop: GameLoop;
  api: CorealmGameApi;
  featureLab?: FeatureLabApi;
}

// Resources use the same working set at boot and during play. Actors and structures reach the fog.
const ENTITY_ACTIVE_RADIUS = 64;
const ENTITY_ACTIVE_REPOSITION_DISTANCE = 8;
// The active-set centre may trail the player by 8 m and the camera may sit another 11 m away.
// Four more metres cover a structure part whose pivot is just outside the clip while its wall is in.
const STRUCTURE_RESIDENCY_MARGIN = ENTITY_ACTIVE_REPOSITION_DISTANCE + CAMERA.maxDistance + 4;

function structureResidencyRadius(distance: UiSettings["drawDistance"]): number {
  // Fog-opaque rather than camera-far: a structure between the two renders as solid fog colour,
  // so residency past the fog wall spends draw calls on an invisible building.
  return fogOpaqueMetres(distance) + STRUCTURE_RESIDENCY_MARGIN;
}

export interface BootOptions {
  profile?: BootProfile;
  /** What the entry fetched and installed before this module was imported, for the boot timeline. */
  catalog?: import("../content/catalogEntry.js").InstalledPageCatalog;
}

export async function boot(canvas: HTMLCanvasElement, options: BootOptions = {}): Promise<BootResult> {
  const profile = options.profile ?? GAME_BOOT_PROFILE;
  const performanceLab = profile.kind === "feature-lab" && new URLSearchParams(location.search).get("performance") === "1";
  const multiplayerFixture = profile.kind === "feature-lab" && new URLSearchParams(location.search).get("multiplayer") === "1";
  const runtimePerformanceEnabled = profile.kind === "game" || performanceLab || multiplayerFixture;
  // The lab workbench is the primary interface for this profile, so fetch its deferred chunk while
  // terrain, assets, and WASM initialize. Normal game boot never requests it.
  if (profile.kind === "feature-lab") preloadFeatureLabPanel();
  const bootTotalSpan = bootTelemetry.startSpan(BOOT_SPANS.TOTAL, { startMs: 0 });
  let debugReady = false;
  const bootEntryMs = bootTelemetry.elapsedMs();
  const navigationTiming = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  bootTelemetry.recordSpan({
    name: BOOT_SPANS.JS_EVALUATION,
    startMs: Math.max(0, navigationTiming?.responseEnd ?? 0),
    endMs: bootEntryMs,
  });
  if (options.catalog) {
    const { startedAtMs, manifestMs, catalogMs, kind, bytes } = options.catalog;
    bootTelemetry.recordSpan({ name: "boot.catalog.install", startMs: startedAtMs, endMs: startedAtMs + manifestMs + catalogMs, detail: { kind, bytes, manifestMs: Math.round(manifestMs) } });
  }
  bootTelemetry.milestone(BOOT_MILESTONES.JS_EVALUATED);

  const errors: RecordedError[] = [];
  const worldMapCapture = new URLSearchParams(window.location.search).get("world-map-capture") === "1";
  const worldBake = import.meta.env.DEV && new URLSearchParams(location.search).get("world-bake") === "1";
  const navigationBake = import.meta.env.DEV && new URLSearchParams(location.search).get("navmesh-bake") === "1";
  const offlineAuthoring = worldBake || navigationBake || worldMapCapture;
  const startedAt = performance.now();
  const atMs = (): number => performance.now() - startedAt;

  // 1. Placeholder debug surface, before anything can fail.
  installBootPlaceholder();
  captureErrors(errors, atMs);

  let statusPhase = "Loading the game…";
  let statusAssets: AssetRegistry | null = null;
  let statusAssetTarget: number | null = null;
  const refreshStatus = (): void => {
    const node = document.querySelector(".boot-status");
    if (!node) return;
    const stats = statusAssets?.getLoadStats();
    const assetProgress = stats ? formatBootAssetProgress(stats, statusAssetTarget) : "";
    const text = `${statusPhase}${assetProgress}`;
    if (node.textContent !== text) node.textContent = text;
  };
  const setStatus = (message: string, phase: number): void => {
    statusPhase = message;
    const progress = document.querySelector<HTMLProgressElement>('.boot-progress');
    if (progress) {
      progress.value = Math.max(progress.value, phase);
    }
    refreshStatus();
  };
  const refreshStatusFrame = (): void => {
    if (!document.getElementById("boot-screen")) return;
    refreshStatus();
    requestAnimationFrame(refreshStatusFrame);
  };
  requestAnimationFrame(refreshStatusFrame);

  // 1b. The asset host, settled here and nowhere else, because `app/config.ts` locks the answer as
  //     soon as the first URL is built. There are exactly two answers: this page's own deployment
  //     directory, or the host a previous boot wrote down on its way to a world that names another
  //     one. Both are known now, so nothing below waits on the network to start fetching.
  //
  //     Preloading therefore runs behind the picker rather than after it. A world on a foreign
  //     asset host is reached by writing the choice to session storage and reloading, which is the
  //     only way to change the base without re-pointing a live `AssetRegistry` mid-session.
  const pendingLaunch = takePendingLaunch();
  const playTarget = playTargetOf(location.search);
  bootTelemetry.measureSync(BOOT_SPANS.ASSET_BASE_RESOLVE, () => { setPublicBaseUrl(pendingLaunch?.assetBaseUrl); });

  // World selection runs beside loading rather than after it. Discovery is network work that needs
  // nothing from the engine, so the panel goes on the loading screen and the player picks a world,
  // adds a host or types a character name while the scene is still being built. Joining stays shut
  // until the first frame is drawn; a choice made before then is honoured the moment it opens.
  //
  // "Play local" is a world like the others: `HeadlessWorld` in a Web Worker, joined through the
  // same session code a socket uses. Only the published manifest is read here, to settle the seed
  // before the scene is built. The worker starts once local play is the known target, so its world
  // boots beside the scene.
  //
  // `?local=memory` is the worker with nothing stored, for a harness that opens several pages at
  // once: the stored world belongs to one tab at a time.
  const localMode = new URLSearchParams(location.search).get("local");
  // A feature lab is a lab worker: the same worker, started with the lab fixture and a spec read from
  // the URL. This page draws the lab scene and describes it to the worker once it is drawn (see
  // `describeLabWorld` below); it never simulates. The multiplayer lab joins a server's lab world
  // instead, and the bake and capture modes draw a scene and leave.
  const labSpec = profile.kind === "feature-lab" && !multiplayerFixture && !worldMapCapture && !worldBake
    && new URLSearchParams(location.search).get("navmesh-bake") !== "1"
    ? (await import("../featureLab/labSpec.js")).labFixtureSpec(location.search) : null;
  const localLaunch = labSpec
    ? await bootTelemetry.measureAsync("boot.labWorker.prepare", async () =>
      (await import("../multiplayer/localLaunch.js")).prepareLocalLaunch({ fixture: "lab", memory: true, lab: labSpec }))
    : profile.kind === "game" && !offlineAuthoring
    ? await bootTelemetry.measureAsync("boot.localWorker.prepare", async () =>
      (await import("../multiplayer/localLaunch.js")).prepareLocalLaunch({ fixture: "authored", memory: !profile.persistent || localMode === "memory" }))
      // Without the published manifest there is no local world to offer. The picker still lists servers, and says why.
      .catch((error: unknown) => { console.warn("[corealm] Local play is unavailable: its world files could not be read.", error); return null; })
    : null;
  const worldSelection = !offlineAuthoring && (profile.kind === "game" || labSpec)
    ? import("../multiplayer/browserSession.js")
      // A lab has one world to join and nobody to ask, so it is `?play=local` without the flag.
      .then(({ startWorldSelection }) => startWorldSelection(labSpec ? { play: { kind: "local" }, local: localLaunch }
        : { play: playTarget, launch: pendingLaunch, local: localLaunch }))
      .catch(() => null)
    : Promise.resolve(null);
  // Set when the player answers "Play local" on the loading screen, or when `?play=local` answered
  // for them: the menu must not then open over the game they just asked to start.
  let choseLocalPlay = false;
  /** Local play started because nobody chose and the page had no server to offer. */
  let localDefaulted = false;
  let worldSelectionResult: Awaited<typeof worldSelection> = null;
  void worldSelection.then((selection) => {
    worldSelectionResult = selection;
    const screen = document.getElementById("boot-screen");
    if (!selection) return;
    selection.panel.addEventListener("worldsdismiss", () => { choseLocalPlay = true; });
    selection.panel.addEventListener("worldschosen", (event) => {
      bootTelemetry.instant("boot.picker.chosen", { play: String((event as CustomEvent<{ play: string | null }>).detail?.play ?? "") });
    });
    if (selection.autoLocal) { choseLocalPlay = true; return; }
    if (!screen) return;
    selection.panel.classList.add("worlds--boot");
    screen.append(selection.panel);
    selection.mounted();
    bootTelemetry.instant("boot.picker.shown");
  });

  const navigationLibrary = bootTelemetry.measureAsync(BOOT_SPANS.NAVIGATION_WASM_INIT, () => Navigation.initLibrary());
  void navigationLibrary.catch(() => {}); // The awaited use below owns the failure screen.
  registerDisplayFont();

  // 2. Core services. The seed is settled first, because the scene and the host's world must be one seed.
  const armorSeedText = profile.kind === 'feature-lab' && new URLSearchParams(location.search).get('fabArmor') === '1'
    ? new URLSearchParams(location.search).get('fabLootSeed') : null;
  const armorSeed = armorSeedText !== null && /^\d+$/.test(armorSeedText) ? Number(armorSeedText) : 1337;
  if (!Number.isSafeInteger(armorSeed) || armorSeed < 0 || armorSeed > 0xffffffff) throw new Error('Invalid armor lab loot seed');
  // The store is a replica: a session fills it, and until one does it holds a blank character at the
  // spawn. A character lives with its host, so this thread neither loads nor writes a save. The old
  // main-thread save is read once by `localLaunch`, which hands it to the worker to import.
  const store = new Store(localLaunch?.seed ?? armorSeed, Date.now());
  const events = new EventBus();
  // Quests, contracts and the rest below are built over the replica to answer reads. None of them may react to a replicated event as if it had happened here.
  events.setSimulationEnabled(false);
  const clock = new SimClock();
  const clientSettings = new SettingsStore();
  const initialSettings = clientSettings.get();
  const adaptiveDistance = new AdaptiveDrawDistance(initialSettings.drawDistance);
  const audioDiagnostics: AudioDiagnostic[] = [];
  const musicLab = profile.kind === "feature-lab" && new URLSearchParams(location.search).get("music") === "1"
    ? await import("../featureLab/music.js") : null;
  const audioCatalog = musicLab ? musicLab.musicLabCatalog(COREALM_AUDIO_CATALOG) : COREALM_AUDIO_CATALOG;
  const audioEngine = new AudioEngine(audioCatalog, {
    // Sound files live on the asset host with everything else. The catalogue keeps its paths
    // relative to the public tree, so this is the one place they become URLs.
    fetcher: (input, init) => fetch(publicUrl(String(input)), init),
    initialVolumes: {
      music: initialSettings.music,
      ambient: initialSettings.ambient,
      sfx: initialSettings.sfx,
    },
    onDiagnostic: (diagnostic) => {
      audioDiagnostics.push(diagnostic);
      if (audioDiagnostics.length > 64) audioDiagnostics.shift();
    },
  });
  const levelUpVariant = COREALM_AUDIO_CATALOG.cues["ui.level_up"].variants[0]!;
  // Decode the level-up sting on the first audio-unlocking gesture. Without this, its first use
  // waits on fetch + Vorbis decode while the visual starts immediately.
  audioEngine.installGestureUnlock(window, [levelUpVariant]);
  const audioDirector = new AudioDirector(audioEngine, audioCatalog, {
    regionFadeMs: 1400,
  });

  // Canonical content is registered before anything can ask for it. Systems and the docs index all
  // read through `content`, so this has to happen before the first tick and before buildDocs().
  const packId = profile.kind === "feature-lab" ? new URLSearchParams(location.search).get("pack") : null;
  const packContent = packId ? await import("../content/regionalPacks.js") : null;
  assertCreatureCatalog();
  const catalog = runtimeTables(profile.kind === 'feature-lab');
  content.register(packContent
    ? { ...catalog, enemies: [...catalog.enemies, ...packContent.REGIONAL_PACK_VARIANTS.map(variant => variant.stats)] }
    : catalog);

  // 3 + 4. Start the manifest beside navigation initialization. These requests are independent; making
  // them serial put an entire network round trip on the critical path before any world work began.
  const assets = new AssetRegistry();
  const playerRig = new CharacterRig(assets);
  const playerBody = profile.kind === "feature-lab" && new URLSearchParams(location.search).get("body") === "female" ? "female" : "male";
  const buildPlayerRig = () => bootTelemetry.measureAsync(BOOT_SPANS.PLAYER_CONSTRUCTION,()=>playerRig.build({
    bodyAssetId:`base_${playerBody}`,
    outfitAssetIds:[`outfit_${playerBody}_peasant_chest`,`outfit_${playerBody}_peasant_legs`,`outfit_${playerBody}_peasant_boots`],
    preloadGear:false,playerLocomotion:true,
  }));
  statusAssets = assets;
  registerProceduralGear(assets);
  // Surface maps do not depend on navigation or the asset manifest.
  const manifestBootstrap = bootTelemetry.measureAsync(BOOT_SPANS.MANIFEST_LOAD, () => assets.loadManifest());
  // Both scatter controllers need this tiny source before they can prepare nearby scenery.
  // Queue it before the regional model batch so it cannot spend seconds behind that traffic.
  if (profile.scatter) void manifestBootstrap.then(() => assets.load('corealm_grass_1',
    { priority: 'visible-spawn', primary: true })).catch(() => {});
  const navigationDownload = import.meta.env.PROD && profile.kind === 'game'
    ? loadArtifactBytes(generatedUrl('corealm-navmesh.nav'),
      {worldSeed:store.get().meta.seed,signal:AbortSignal.timeout(30_000)}) : undefined;
  void navigationDownload?.catch(()=>{}); // Import validation below owns the failure screen.
  const surfaceBootstrap = manifestBootstrap.then(() => import("../render/corealmSurfaceMaterials.js"))
    .then(module => module.loadCorealmSurfaceTextures());
  const fairySurfaceBootstrap = profile.kind === 'game' || new URLSearchParams(location.search).get('fairy') === '1'
    ? manifestBootstrap.then(() => Promise.all([
      import('../render/fairyGroundSurface.js').then(module=>module.loadFairyGroundSurface()),
      import('../render/fairyRockSurface.js').then(module=>module.loadFairyRockSurface()),
    ])) : undefined;
  void fairySurfaceBootstrap?.catch(()=>{});
  const castleSurfaceBootstrap = manifestBootstrap.then(()=>import('../render/castleStoneMaterial.js'))
    .then(module=>module.preloadCastleStoneTextures());
  void castleSurfaceBootstrap.catch(()=>{});
  void surfaceBootstrap.catch(() => {}); // The awaited use below reports a boot failure.
  const assetBootstrap = manifestBootstrap
    .then(async () => {
      bootTelemetry.milestone(BOOT_MILESTONES.MANIFEST_READY);
      await bootTelemetry.measureAsync(BOOT_SPANS.ANIMATION_LOAD, () => assets.loadAnimationLibraries());
      bootTelemetry.milestone(BOOT_MILESTONES.ANIMATIONS_READY);
    })
    .catch((cause: unknown) => {
      errors.push({ atMs: atMs(), source: "assets", message: describeError(cause) });
    });
  const playerBootstrap = worldBake || new URLSearchParams(location.search).get('navmesh-bake') === '1' ? undefined
    : assetBootstrap.then(async()=>{
      const ready=await buildPlayerRig();
      if(ready) await playerRig.prepareItems(immediatePlayerItems(store.get()));
      return ready;
    });
  void playerBootstrap?.catch(()=>{});
  const guidanceModule=import('./guidance.js');
  const agentModule=import('../agent/index.js');
  const debugModule=import('../debug/gameDebug.js');
  for(const pending of [guidanceModule,agentModule,debugModule]) void pending.catch(()=>{});
  // Tiny boot modules must not queue behind megabytes of model traffic on a slow connection.
  // Their normal awaited imports below still report failures and control when code is used.
  if (profile.kind === 'game') for (const pending of [
    import('../render/playerLocomotion.js'),
    import('../world/dungeonDoors.js'), import('../render/dungeonGate.js'),
    import('../render/traversalContactAssets.js'), import('../world/regionalPackEntities.js'),
    import('../world/regionalPackDressing.js'), import('../render/mineCutFace.js'),
    import('../render/dungeonMouth.js'), import('../world/mobSpawnSpacing.js'),
    import('../world/mobSpawnCache.js'), import('../world/creaturePopulation.js'),
  ]) void pending.catch(()=>{});

  // The saved position is already known. Download its world data while WASM, textures and graphics initialize.
  const cacheQuery = new URLSearchParams(location.search);
  const cacheScope = generationScope(profile.kind, store.get().meta.seed, location.search);
  const bakeWriter = worldBake ? new (await import('../world/worldBake.js')).WorldBakeWriter() : null;
  const localCache = !worldMapCapture && cacheQuery.get("navmesh-bake") !== "1"
    && (profile.kind === "game" ? cacheQuery.get("startup-cache") !== "0" : cacheQuery.get("startup-cache") === "1")
    ? new GenerationCache(generationRevision, cacheScope) : null;
  const fixtureWorldData = import.meta.env.DEV ? cacheQuery.get('world-data') : null;
  const releaseWorldData = profile.kind === 'game' && (import.meta.env.PROD
    || !worldMapCapture && cacheQuery.get('navmesh-bake') !== '1' && cacheQuery.get('startup-cache') !== '0');
  const generationCache = bakeWriter ?? (fixtureWorldData
    ? new ShippedWorldData(localCache ?? new GenerationCache(generationRevision, cacheScope), fixtureWorldData, true)
    : releaseWorldData ? new ShippedWorldData(localCache ?? new GenerationCache(generationRevision, cacheScope),
      generatedUrl('world/manifest.json'), import.meta.env.PROD) : localCache);
  (window as any).__corealmGenerationCache = generationCache;
  const initialAreaPosition = [profile.spawn.x,0,profile.spawn.z];
  // The world records and models around the spawn, from this page's own asset base, started while
  // the picker is still on screen. Its own span, to read how much of the wait for a
  // choice was already paid for.
  const earlyAssets = generationCache instanceof ShippedWorldData && store.get().player.regionId !== 'gravelmaw'
    ? bootTelemetry.measureAsync('boot.preload.behindPicker', () => generationCache.preloadArea(initialAreaPosition[0]!,initialAreaPosition[2]!,
      structureResidencyRadius(initialSettings.drawDistance),
      async id=>{ await manifestBootstrap; if(assets.entry(id)) await assets.load(id,{priority:'visible-spawn',primary:true}); })) : Promise.resolve();
  void earlyAssets.catch(()=>{}); // Normal residency preparation reports failures and offers retry.

  setStatus("Loading the game…",1);
  await Promise.all([navigationLibrary, assetBootstrap]);
  bootTelemetry.milestone(BOOT_MILESTONES.WASM_READY);
  const cameraQueries = new StaticCameraQueries();
  const nav = new Navigation();

  // 5. Renderer.
  setStatus("Starting graphics…",1);
  const renderer = new Renderer(canvas);
  await renderer.init();
  renderer.setRenderScale(initialSettings.renderScale);
  renderer.setShadowQuality(initialSettings.shadowQuality);
  renderer.setDrawDistance(initialSettings.drawDistance);
  const camera = new OrbitCamera(renderer.camera);
  camera.fixedFollow = true;
  const scene = new WorldScene(renderer.scene);
  let fairyRealm: RealmTerrain | null = null;
  const fairyLab = profile.kind === "feature-lab" && new URLSearchParams(location.search).get("fairy") === "1";
  const terrainAt = (x: number, z: number): WorldScene => fairyRealm?.contains(x, z) ? fairyRealm.scene : scene;
  renderer.prepareScene = (viewCamera) => {
    const fogFar = renderer.scene.fog instanceof THREE.Fog ? renderer.scene.fog.far : undefined;
    scene.scatterVisibility.prepare(viewCamera, fogFar);
    fairyRealm?.scene.scatterVisibility.prepare(viewCamera, fogFar);
    fairyRealm?.scene.materials.setTime(performance.now() / 1000);
  };
  scene.materials.setFoliageOcclusionEnabled(false);
  if (profile.kind === "game" || fairyLab) {
    renderer.biomeAtmosphere.sky.enabled = true;
    renderer.biomeWeightsSource = () => {
      const player = store.get().player;
      if (player.regionId === "gravelmaw") return { gravelmaw: 1 };
      if (isFairyRegion(player.regionId)) return { [player.regionId]: 1 };
      return Object.fromEntries(scene.biomeWeightsAt(player.position[0], player.position[2])
        .map(({ id, weight }) => [id, weight]));
    };
    renderer.wildernessMagicSource = () => {
      const player = store.get().player;
      return worldMapForRegion(player.regionId) !== 'surface' ? 0 : wildernessMagicAt(player.position[0], player.position[2]);
    };
  }

  // 6. Assets. Animation libraries load once as a shared clip library; every rig plays from it.
  setStatus("Loading shared textures…",1);
  // The staff meshes, built rather than loaded. There is no staff anywhere in the 213-asset library,
  // so without this line all four staffs resolve to an asset id that `AssetRegistry.load` rejects,
  // `characterRig.attachBoneSlot` swallows the rejection, and a mage holds empty air — which is
  // exactly the state this wave set out to fix. Registered BEFORE the manifest loads and before the
  // player rig is built, because `CharacterRig` warms gear through the same `load()` path.
  // Manifest and startup clips were already requested beside the WASM libraries above.

  // 7. Terrain, derived from canonical region data so there is one source of truth for where the
  //    world is. See app/worldSpec.ts for why this is derived rather than authored twice.
  setStatus("Loading terrain…",2);
  // Flat pads are registered before the terrain mesh is generated, or the ground under a
  // settlement stays as noisy as the moor around it — Coldbrace square measured a metre of tilt
  // across 33 m before this. worldSpec derives the pads from the authored settlement data.
  const crownwardFishingLab = profile.kind === 'feature-lab' && new URLSearchParams(location.search).get('fishing') === 'crownward';
  const fishingLab = profile.kind === "feature-lab" && (new URLSearchParams(location.search).get("fishing") === "1" || crownwardFishingLab)
    ? await import("../featureLab/fishing.js") : undefined;
  const pavingLab = profile.kind === "feature-lab" && new URLSearchParams(location.search).get("paving") === "1"
    ? await import("../featureLab/paving.js") : undefined;
  const surfaceTextures = await surfaceBootstrap;
  scene.materials.setGroundStoneSurface(surfaceTextures);
  if (profile.kind === 'feature-lab' && new URLSearchParams(location.search).get('fairy-ground') === '1') {
    scene.materials.setFairyGroundSurface(await (await import('../render/fairyGroundSurface.js')).loadFairyGroundSurface());
  }
  await castleSurfaceBootstrap;
  scene.materials.setCastleStoneEnabled(true);
  const terrainSpec = profile.terrain();
  const agilityLabModule = profile.kind === "feature-lab" && new URLSearchParams(window.location.search).get("agility") === "1"
    ? await import("../featureLab/agility.js") : null;
  agilityLabModule?.configureAgilityLabTerrain(terrainSpec);

  const deepWildernessEffectsLab = profile.kind === 'feature-lab' && new URLSearchParams(location.search).get('wildernessEffects') === 'deep';
  const wildernessEffectsLab = deepWildernessEffectsLab || profile.kind === "feature-lab" && new URLSearchParams(location.search).get("wildernessEffects") === "1";
  const wildernessCreaturesLab = profile.kind === 'feature-lab' && new URLSearchParams(location.search).get('wildernessCreatures') === '1';
  const wildernessTorchesLab = profile.kind === "feature-lab" && new URLSearchParams(location.search).get("wildernessTorches") === "1";
  if (wildernessEffectsLab) terrainSpec.lavaChannels = deepWildernessEffectsLab ? DEEP_WILDERNESS_LAVA_LAB_CHANNELS : WILDERNESS_LAVA_LAB_CHANNELS;
  const riverLab = profile.kind === 'feature-lab' && (cacheQuery.get('river') === '1' || crownwardFishingLab);
  if (riverLab) terrainSpec.waterChannels = CROWNWARD_RIVER_LAB_CHANNELS;
  if (fishingLab && !crownwardFishingLab) terrainSpec.basins = [fishingLab.FISHING_LAB_BASIN];
  await bootTelemetry.measureAsync(BOOT_SPANS.TERRAIN_BUILD, async () => {
    const prepareSurface = profile.worldSurface
      ? (preparedScene: WorldScene) => {
          // The telemetry name stays stable for baseline comparison, but this is now preparation
          // before the first chunk vertex is shaded.
          bootTelemetry.measureSync(
            BOOT_SPANS.TERRAIN_RESTAMP,
            () => prepareWorldSurface(preparedScene, store.get().meta.seed),
          );
        }
      : pavingLab?.preparePavingLabSurface ?? fishingLab?.prepareFishingLabSurface;
    if (generationCache) await scene.buildWorldCached(generationCache, "world", terrainSpec, prepareSurface);
    else await scene.buildWorldYielding(terrainSpec, prepareSurface);
    // One heightfield collider rather than 28 terrain trimeshes: same ground answers, 24 ms instead
    // of a per-chunk trimesh build, and a single collider for the ray queries to walk.
    cameraQueries.addHeightfield(scene.heightfieldSamples());
  });

  if (profile.kind === 'game' || fairyLab) {
    const fairyTerrainSpan = bootTelemetry.startSpan("boot.terrain.fairy");
    const [fairyGrassSurface,fairyRockSurface] = await fairySurfaceBootstrap!;
    fairyRealm = await createRealmTerrain(renderer.scene, fairyLab ? FAIRY_PORTAL_LAB_TERRAIN : buildFairyTerrainSpec(), {
      cache: generationCache, cacheKey: 'fairy',
      configure: other => { other.materials.setGroundStoneSurface({ ...surfaceTextures, stone: fairyRockSurface }); other.materials.setFairyGroundSurface(fairyGrassSurface); },
      ...(fairyLab ? {} : { prepareSurface: (other: WorldScene) => { prepareWorldSurface(other, store.get().meta.seed); } }),
    });
    cameraQueries.addHeightfield(fairyRealm.heightfieldSamples(1));
    fairyTerrainSpan.end();
  }
  const heightAt = (regionId: RegionId, x: number, z: number): number => terrainAt(x, z).heightAt(regionId, x, z);
  const fairyPortalFixture = fairyLab ? assembleFairyPortalFixture(heightAt, id => assets.baseY(id)) : null;
  const authoredDungeonSpec = profile.dungeon ? buildDungeonSpec(scene) : null;
  const denseCaveLab = profile.kind === 'feature-lab' && new URLSearchParams(location.search).get('denseCave') === '1'
    ? await import('../featureLab/denseCave.js') : null;
  const denseCavePopulation = denseCaveLab?.assembleDenseCavePopulation(id => assets.baseY(id), id => assets.assetSize(id));
  const doorLab = profile.kind === "feature-lab" && (new URLSearchParams(window.location.search).get("doors") === "1" || denseCaveLab)
    ? await import("../featureLab/dungeonDoors.js") : null;
  const doorFixture = denseCavePopulation ?? doorLab?.assembleDungeonDoorFixture((x, z) => terrainAt(x, z).meshHeightAt(x, z));
  const agilityFixture = agilityLabModule?.assembleAgilityFixture((x, z) => terrainAt(x, z).meshHeightAt(x, z),
    (id) => assets.baseY(id), (id) => assets.assetSize(id), (id) => assets.assetCenterXZ(id));
  const dungeonRegion = profile.dungeon ? REGIONS.find((region) => region.dungeon) : undefined;
  const doorLogic = doorFixture || dungeonRegion ? await import("../world/dungeonDoors.js") : null;
  const worldDoorThresholds = dungeonRegion?.dungeon ? doorLogic!.authoredThresholds(
    dungeonRegion.dungeon, heightAt(dungeonRegion.id, ...dungeonRegion.dungeon.entrance),
  ) : [];
  const doorThresholds = doorFixture?.thresholds ?? worldDoorThresholds;
  const gates = doorThresholds.length || agilityFixture || multiplayerFixture || profile.kind === 'game' ? await import("../render/dungeonGate.js") : null;
  let gateMaterials: import("../render/dungeonGate.js").DungeonGateMaterials | null = null;
  if (gates) {
    gateMaterials = gates.createDungeonGateMaterials(surfaceTextures, scene.materials.metal(1));
    await gates.registerDungeonGateAssets(assets, gateMaterials);
    if (profile.kind === 'game' || agilityFixture || multiplayerFixture) {
      const { registerTraversalContactAssets } = await import('../render/traversalContactAssets.js');
      registerTraversalContactAssets(assets, gateMaterials);
    }
  }
  if (doorFixture && gates && gateMaterials) {
    for (const threshold of doorFixture.thresholds) {
      for (const wall of threshold.walls) {
        const object = gates.buildDungeonGateMasonryWall({ ...wall, bottomAt: (x) => wall.bottomAt(x) }, gateMaterials);
        object.position.set(...threshold.origin);
        object.rotation.y = threshold.rotationY;
        scene.entityGroup.add(object);
      }
    }
    for (const wall of doorFixture.enclosure) {
      const object = gates.buildDungeonGateMasonryWall(wall, gateMaterials);
      object.position.set(...wall.origin);
      object.rotation.y = wall.rotationY;
      scene.entityGroup.add(object);
    }
  }
  if (agilityFixture && gates && gateMaterials) {
    for (const wall of agilityFixture.enclosure) {
      const object = gates.buildDungeonGateMasonryWall(wall, gateMaterials);
      object.position.set(...wall.origin);
      object.rotation.y = wall.rotationY;
      scene.entityGroup.add(object);
    }
  }

  // 7b. Roads, paving and shorelines are stamped INTO the ground rather than laid on top of it.
  //
  //     Roads used to be 42 transparent depth-write-off ribbons: the frame's largest overdraw
  //     source and its largest single draw-call block, with an unpainted hole at every junction
  //     where the two ribbons' end fades met, and 10% of their vertices below the terrain mesh so
  //     the road vanished in patches. Stamped into the terrain's own vertex colours and splat
  //     weights the corridor is mip-correct, shadow-correct and z-fight-free by construction, and
  //     it costs nothing to draw. Paving and the wet band at a waterline ride the same mechanism.
  //
  //     Surface preparation now runs inside `buildWorld`, after the shared height lattice resolves
  //     roads and organic shorelines but before any chunk is shaded. Every vertex therefore consumes
  //     the final surface exactly once; there is no post-build restamp or second height authority.
  bootTelemetry.milestone(BOOT_MILESTONES.TERRAIN_READY);
  const riverSurface = terrainSpec.waterChannels?.length ? createRiverSurface(terrainSpec.waterChannels, scene.materials,
    (x, z) => scene.meshHeightAt(x, z), {stream:!worldMapCapture && (profile.kind === 'game' || riverLab)}) : null;
  if (riverSurface) scene.terrainGroup.add(riverSurface.group);

  // 7c. Water. Fishing spots were authored as interaction markers with a note that the water itself
  //     is the render layer's job — and nothing was building it, so every fishing spot sat on dry
  //     grass. Each `kind: "water"` location gets a surface sunk just below the local ground.

  // 8. Semantic world. Data in, entities out, deterministic from the seed.
  setStatus("Loading the world…",3);
  //
  // The ports are what stop the world being placed by accident. `baseY` is the measured bbox
  // minimum of each GLB, so an entity is placed by its FEET rather than by its origin: without it
  // the visible gap is exactly `glbMinY * scale * tierSilhouetteScale(tier)`, which is why the
  // Fallen Duskoak hovered 5.77 m and the Coldbrace fletching bench 1.41 m, and why 74 of 151
  // measured entities sat more than 5 cm off the ground. `assetSize` sizes the collision volumes
  // that make the world solid at all.
  const roadPolylines = [...scene.getRoadPolylines(), ...(fairyRealm?.scene.getRoadPolylines() ?? [])];
  const roadDistance = (x: number, z: number): number => {
    let best = Infinity;
    for (const line of roadPolylines) {
      for (let index = 0; index < line.length - 1; index += 1) {
        const a = line[index]!;
        const b = line[index + 1]!;
        const dx = b[0] - a[0];
        const dz = b[2] - a[2];
        const lengthSq = dx * dx + dz * dz;
        const t = lengthSq <= 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / lengthSq));
        best = Math.min(best, Math.hypot(x - (a[0] + dx * t), z - (a[2] + dz * t)));
      }
    }
    return best;
  };
  // One pass over the solved water bodies yields both halves of a fishery: the dry stance and the
  // school it faces. They have to come from the same solved contour or they drift apart.
  let fishingAnchors: ReturnType<typeof fishingSiteAnchors> | undefined;
  const getFishingAnchors = () => fishingAnchors ??= fishingSiteAnchors(WORLD_SITES, scene.getWaterBodies(),
    (x, z) => terrainAt(x, z).meshHeightAt(x, z));
  const worldPorts = {
    heightAt,
    dungeonGates: worldDoorThresholds.length > 0,
      get accessPositions() { return profile.kind === 'game' ? new Map([
        ...getFishingAnchors().banks,
        ...miningAccessPositions(WORLD_SITES, (x, z) => terrainAt(x, z).meshHeightAt(x, z), {
          assetSize: (id) => assets.assetSize(id), assetCenterXZ: (id) => assets.assetCenterXZ(id),
        }),
      ]) : undefined; },
      get fishingSchools() { return profile.kind === 'game' ? getFishingAnchors().schools : undefined; },
    baseY: (assetId: string): number => assets.baseY(assetId),
    assetSize: (assetId: string): { x: number; y: number; z: number } | null => assets.assetSize(assetId),
    assetCenterXZ: (assetId: string): { x: number; z: number } | null => assets.assetCenterXZ(assetId),
    roadDistance,
    get coastalSpawns() { return profile.worldSurface ? coastalSpawnSites(scene, store.get().meta.seed) : []; },
    coastalAccepts: (spot: readonly [number, number], radius: number) =>
      coastalBodyOnSafeGround((x, z) => terrainAt(x, z).sampleWorld(x, z), spot, radius),
    minibossCanStand: (regionId: RegionId, x: number, z: number) => {
      const sample = terrainAt(x, z).sampleWorld(x, z);
      return sample.playable && sample.semanticRegion === regionId && sample.waterBodyId === null
        && sample.slope !== null && sample.slope <= .5;
    },
  };
  const shopLab = profile.kind === "feature-lab" && new URLSearchParams(window.location.search).get("shop") === "1"
    ? await import("../featureLab/shop.js") : null;
  const shopFixture = shopLab?.assembleShopFixture((x, z) => terrainAt(x, z).meshHeightAt(x, z), worldPorts);
  const portalLab = profile.kind === "feature-lab" && new URLSearchParams(location.search).get("portal") === "1"
    ? await import("../featureLab/portal.js") : null;
  const portalFixture = portalLab?.assemblePortalFixture((x, z) => terrainAt(x, z).meshHeightAt(x, z), (id) => assets.baseY(id));
  const packLab = packId ? await import("../featureLab/regionalPacks.js") : null;
  const rpgPackCatalogue = packId && new URLSearchParams(location.search).get("rpg") === "1"
    ? (await import("../content/rpgRegionalPacks.js")).createRpgRegionalPackCatalogue((id) => {
      const entry = assets.entry(id);
      return entry?.base ? { size: entry.size, base: entry.base } : null;
    }, [packId]) : undefined;
  if (rpgPackCatalogue) content.register({ enemies: [...content.allEnemies(), ...rpgPackCatalogue.variants.map((variant) => variant.stats)] });
  const packFixture = packLab && packId ? packLab.assembleRegionalPackFixture(packId, {
    heightAt: (x, z) => terrainAt(x, z).meshHeightAt(x, z), baseY: worldPorts.baseY, assetSize: worldPorts.assetSize,
  }, rpgPackCatalogue) : null;
  const worldHabitats: HabitatDef[] = [...WORLD_HABITATS];
  const worldPackHabitats = new Map<string, HabitatDef>();
  type BuiltWorld = ReturnType<typeof profile.buildSemanticWorld>;
  const built = await bootTelemetry.measureAsync("boot.world.semantic", () => cachedWorldValue(generationCache,
    'assembly/semantic', () => profile.buildSemanticWorld(store.get().meta.seed, heightAt, worldPorts),
    (v): v is BuiltWorld => !!v && typeof v === 'object' && ['entities','buildings','solids','routeNodes','routeEdges','knownLocations']
      .every(key => Array.isArray((v as Record<string, unknown>)[key]))));
  const mobSpacingLab = profile.kind === 'feature-lab' && new URLSearchParams(location.search).get('spawnSpacing') === '1';
  const mobSpacingFixture: SemanticEntity[] = [];
  if (mobSpacingLab) {
    const { createMobSpacingFixture } = await import('../featureLab/mobSpawnSpacing.js');
    const ports = { heightAt: (x: number, z: number) => terrainAt(x, z).meshHeightAt(x, z),
      baseY: worldPorts.baseY!, assetSize: worldPorts.assetSize! };
    const population = new URLSearchParams(location.search).get('population');
    if (population === 'worms') {
      const { createRedWormFixture } = await import('../featureLab/redWorms.js');
      const fixture = createRedWormFixture(ports);
      mobSpacingFixture.push(...fixture.actors);
      worldHabitats.push(fixture.habitat);
    } else if (population === 'fairy') {
      const { createFairyPopulationFixture } = await import('../featureLab/fairyPopulation.js');
      mobSpacingFixture.push(...createFairyPopulationFixture(ports));
    } else mobSpacingFixture.push(...createMobSpacingFixture(ports, population === 'stone'));
    built.entities.push(...structuredClone(mobSpacingFixture));
  }
  worldHabitats.push(...(built.coastalHabitats ?? []));
  for (const habitat of built.coastalHabitats ?? []) worldPackHabitats.set(habitat.groupId, habitat);
  // The authored game page has no habitat content: its catalog is the client projection. Habitats still decide two things it
  // draws, the dressing around them and the trees scatter leaves out of creature corridors, and the shipped scatter tiles are
  // accepted only if the page reproduces the bake's exclusions exactly. So it takes both from the baked placement record, which
  // is world data on the asset host: the habitats as the bake dressed them here, and the spread placement further down.
  const thinGame = profile.kind === "game" && !worldBake && !worldMapCapture;
  const bakedSiteHabitats = thinGame && generationCache ? await (await import("../world/mobSpawnCache.js")).readBakedSiteHabitats(generationCache) : null;
  if (bakedSiteHabitats) worldHabitats.splice(0, worldHabitats.length, ...bakedSiteHabitats);
  const huntLab = profile.kind === "feature-lab" && new URLSearchParams(location.search).get("hunt") === "1"
    ? await import("../featureLab/huntContracts.js") : null;
  const huntFixture = huntLab?.assembleHuntContractsFixture((x, z) => terrainAt(x, z).meshHeightAt(x, z), worldPorts.baseY, worldPorts.assetSize);
  const motionCohort = new URLSearchParams(location.search).get("motion");
  const groundMotionLab = profile.kind === "feature-lab" && (motionCohort === "1" || motionCohort === "legacy")
    ? await import("../featureLab/groundMotion.js") : null;
  const motionActors = new URLSearchParams(location.search).get("motionActors");
  const groundMotionFixture = groundMotionLab?.createGroundMotionFixture({ heightAt: (x, z) => terrainAt(x, z).meshHeightAt(x, z), baseY: worldPorts.baseY, assetSize: worldPorts.assetSize,
    ...(motionCohort === "legacy" ? { cohort: "legacy" as const } : {}),
    ...(motionActors === null ? {} : { assetIds: motionActors.split(",").map((id) => id.trim()) }),
  });
  if (groundMotionFixture) {
    built.entities.push(...structuredClone(groundMotionFixture.entities));
    (window as Window & { __groundMotionLab?: unknown }).__groundMotionLab = { actors: groundMotionFixture.actors, habitats: groundMotionFixture.habitats, spawn: groundMotionFixture.spawn };
  }
  if (huntFixture) built.entities.push(...structuredClone(huntFixture.entities));
  if (terrainSpec.lavaChannels?.length) built.solids.push(...lavaObstacles(terrainSpec.lavaChannels, (x, z) => terrainAt(x, z).meshHeightAt(x, z)));
  if (packFixture) built.entities.push(...structuredClone(packFixture.entities));

  if (fairyPortalFixture) {
    built.entities.push(...structuredClone(fairyPortalFixture.entities));
    built.solids.push(...fairyPortalFixture.solids);
    built.routeNodes.push(...fairyPortalFixture.routeNodes);
    built.routeEdges.push(...fairyPortalFixture.routeEdges);
    built.knownLocations.push(...fairyPortalFixture.knownLocations);
  }
  if (portalFixture) {
    built.entities.push(...structuredClone(portalFixture.entities));
    built.solids.push(...portalFixture.solids);
    built.routeNodes.push(...portalFixture.routeNodes);
    built.routeEdges.push(...portalFixture.routeEdges);
  }
  if (shopFixture) {
    built.entities.push(...structuredClone(shopFixture.entities));
    built.solids.push(...shopFixture.solids);
  }
  if (doorFixture) {
    built.entities.push(...structuredClone(doorFixture.entities));
    built.solids.push(...doorFixture.solids);
    built.routeNodes.push(...doorFixture.routeNodes);
    built.routeEdges.push(...doorFixture.routeEdges);
  }
  if (agilityFixture) {
    built.entities.push(...structuredClone(agilityFixture.entities));
    built.solids.push(...agilityFixture.solids);
    built.routeNodes.push(...agilityFixture.routeNodes);
    built.routeEdges.push(...agilityFixture.routeEdges);
  }
  const fishingEntities = fishingLab?.createFishingLabEntities(scene, assets) ?? [];
  built.entities.push(...fishingEntities);
  const sitesSpan = bootTelemetry.startSpan("boot.world.sites");
  const sitePlacements: ResolvedWorldSiteDressing[] = [];
  const siteStreaming = new WorldSiteStreaming(scene, assets, site => terrainAt(site.centre[0], site.centre[1]));
  const encounterNavSolids = new Map<string, SolidVolume>();
  if (packFixture?.habitat.dressing.length) {
    const { buildRegionalPackDressing } = await import("../world/regionalPackDressing.js");
    const result = await buildRegionalPackDressing(scene, assets, packFixture.habitat,
      Math.max(0, ...packFixture.entities.map((entity) => entity.combat?.bodyRadius ?? 0)));
    sitePlacements.push(...result.placements);
    built.solids.push(...result.solids);
    for (const solid of result.navigationSolids) encounterNavSolids.set(solid.id, solid);
  }
  if (profile.kind === "game") {
    const { buildMineCutFace } = await import("../render/mineCutFace.js");
    // These are authored settings, loaded before navigation so visible rock faces and work
    // furniture have the same footprints in rendering, pathfinding and direct movement.
    const settings: WorldSite[] = [...WORLD_SITES, ...worldHabitats.map((habitat): WorldSite => ({
      id: habitat.id,
      locationId: habitat.groupId,
      regionId: habitat.regionId,
      centre: [0, 0],
      rotationY: 0,
      kind: "habitat",
      workRadius: 0,
      extent: [0, 0],
      terrain: { floorRadius: 0, backRise: 0, backDistance: 0, bermWidth: 0, approachAngle: 0 },
      resourceSlots: [],
      dressing: habitat.dressing,
    }))];
    for (const setting of settings) {
      if (!setting.dressing.length) continue;
      const packHabitat = worldPackHabitats.get(setting.locationId);
      if (packHabitat) {
        // Same builder as the compact pack lab: measured physical boxes for collision, and
        // navigation-only boxes grown by the pack's largest resident so full bodies clear corners.
        const { buildRegionalPackDressing } = await import("../world/regionalPackDressing.js");
        const largestBody = Math.max(0, ...built.entities
          .filter((entity) => entity.meta?.groupId === packHabitat.groupId)
          .map((entity) => entity.combat?.bodyRadius ?? 0));
        const result = await buildRegionalPackDressing(terrainAt(setting.centre[0], setting.centre[1]), assets, packHabitat, largestBody, false);
        siteStreaming.register(setting, result);
        sitePlacements.push(...result.placements);
        built.solids.push(...result.solids);
        for (const solid of result.navigationSolids) encounterNavSolids.set(solid.id, solid);
        continue;
      }
      const settingScene = terrainAt(setting.centre[0], setting.centre[1]);
      const result = resolveWorldSiteDressing(settingScene, assets, setting);
      siteStreaming.register(setting, result);
      sitePlacements.push(...result.placements);
      built.solids.push(...result.solids);
      if (setting.cutFace) {
        const cut = await buildMineCutFace(settingScene, assets, setting, built.entities, generationCache);
        for (const object of cut.objects) settingScene.scatterGroup.add(object);
        if (cut.prepare) siteStreaming.attach(setting.id, async () => {
          settingScene.scatterGroup.add(...await cut.prepare!());
        },cut.bounds);
        built.solids.push(...cut.solids);
      }
    }
  }


  sitesSpan.end();
  const fairyDressing = fairyRealm ? await bootTelemetry.measureAsync("boot.world.fairyDressing", () => cachedWorldValue(
    generationCache, 'assembly/fairyDressing', () => resolveFairyDressing(fairyRealm!.scene),
    (v): v is ReturnType<typeof resolveFairyDressing> => !!v && typeof v === 'object'
      && Array.isArray((v as any).points) && Array.isArray((v as any).solids) && !!(v as any).specs)) : null;
  if (fairyDressing) built.solids.push(...fairyDressing.solids);

  // The fitted stone recess gives the existing portal visible depth beyond its masonry arch.
  const portalMouths = portalFixture?.entities ?? built.entities.filter((entity) => entity.id === "gravelmaw_mouth_portal" || entity.id === "gravelmaw_exit_portal");
  const portalPickMeshes: THREE.Object3D[] = [];
  for (const portal of portalMouths) {
    const { buildDungeonMouth } = await import("../render/dungeonMouth.js");
    const { applyCorealmSurfaceMaterials } = await import("../render/corealmSurfaceMaterials.js");
    const mouth = buildDungeonMouth(portal);
    mouth.userData["portalEntityId"] = portal.id;
    portalPickMeshes.push(mouth);
    applyCorealmSurfaceMaterials(mouth, surfaceTextures);
    if (portal.regionId === "gravelmaw") {
      mouth.userData["portalInterior"] = true;
      scene.root.add(mouth);
    } else scene.scatterGroup.add(mouth);
  }

  const skillLevels = (): Record<SkillId, number> => {
    const levels = {} as Record<SkillId, number>;
    const skills = store.get().skills;
    for (const id of SKILL_IDS) levels[id] = skills[id].level;
    return levels;
  };

  // PRD F12's discovery gate, finally connected. `EntityStore` has always accepted this port and
  // boot has always constructed the store without one, which made it return null — and null means
  // "discovery is not gating anything", so `observe({ scope: "known" })` handed a character who had
  // never left the spawn square all forty named places in the world. The system that answers it is
  // built below, once there are locations to sweep; the closure defers to it.
  const entityStore = new EntityStore({
    skillLevels,
    discoveredLocationIds: () => new Set(Object.keys(store.get().discovery.locations)),
  });
  // The authored game draws its own scenery and nothing else: creatures, characters, nodes and doors are the host's, and
  // arrive by replication. A lab assembles its world here and describes it to the lab worker, so it keeps everything until the join.
  const loadedEntities = (entities: readonly SemanticEntity[]): SemanticEntity[] =>
    profile.kind === "game" && !worldBake && !worldMapCapture ? entities.filter(isStaticScenery) : [...entities];
  entityStore.load(loadedEntities(built.entities));
  const dungeonDoors = doorLogic && doorThresholds.length
    ? new doorLogic.DungeonDoors(doorThresholds.map((entry) => entry.barrier), (id) => entityStore.get(id))
    : null;
  if (dungeonDoors) nav.setPathConstraint((path) => dungeonDoors.clipPath(path));
  entityStore.registerLocations(built.knownLocations);
  const forestObstacles = new ForestObstacles();
  const forestInstances = new Map<string, { descriptor: ForestTreeDescriptor; setVisible: (visible: boolean) => void }>();
  const forestPresentation = new ForestPresentation();
  /**
   * Scatter draws every tree. The host makes an entity of the ones near the player and replicates them, and only those can
   * be chopped or collided with: a replicated tree is drawn by its entity view, and its trunk joins movement prediction.
   */
  const registerForestTree = (descriptor: ForestTreeDescriptor, setVisible: (visible: boolean) => void): void => {
    forestInstances.set(descriptor.id, { descriptor, setVisible });
    const excluded = () => worldExclusions.blocksTreeClearance(descriptor.position[0], descriptor.position[2], descriptor.trunkRadius);
    forestPresentation.register(descriptor.id, visible => setVisible(visible && !excluded()));
    if (excluded()) setVisible(false);
    const entity = entityStore.get(descriptor.id);
    if (entity) forestPresentation.activate(descriptor.id, entity.state === "depleted"); else forestPresentation.deactivate(descriptor.id);
  };
  /** Trees the host has replicated here, with how many of them are stumps. */
  const labForestStats = (): { registered: number; resident: number; depleted: number } => {
    let resident = 0, depleted = 0;
    for (const id of forestInstances.keys()) { const entity = entityStore.get(id); if (entity) { resident += 1; if (entity.state === "depleted") depleted += 1; } }
    return { registered: forestInstances.size, resident, depleted };
  };
  /** Follows one update from the host: which scatter trees are entities now, and which trunks prediction walks around. */
  const forestApplied = (update: import("../contracts.js").WorldUpdate): void => {
    if (update.snapshot) for (const id of forestInstances.keys()) { forestPresentation.deactivate(id); forestObstacles.remove(id); }
    for (const entity of update.entities) {
      const tree = forestInstances.get(entity.id); if (!tree) continue;
      forestPresentation.activate(entity.id, entity.state === "depleted");
      if (entity.state === "depleted") forestObstacles.remove(entity.id); else forestObstacles.upsert(tree.descriptor);
    }
    for (const id of update.removedEntities) if (forestInstances.has(id)) { forestPresentation.deactivate(id); forestObstacles.remove(id); }
  };
  const audioForward = new THREE.Vector3();
  const gameAudio = new CorealmAudioBridge({
    store,
    engine: audioEngine,
    director: audioDirector,
    listenerForward: () => {
      renderer.camera.getWorldDirection(audioForward);
      return [audioForward.x, audioForward.y, audioForward.z];
    },
    entity: (entityId) => entityStore.get(entityId),
    surfaceAt: (position, regionId) => footstepSurfaceAt(
      regionId,
      position,
      scene.groundSurfaceAt(position[0], position[2]),
    ),
    // The nearest LIVING animal, for idle voices. Dead ones are excluded because a corpse that
    // keeps lowing is the kind of bug a player hears long before they see it, and the two humanoid
    // families are filtered by `cueForCreature` returning null rather than here, so this stays a
    // pure "what is near me" query with no audio policy in it.
    nearestCreature: (position, radius) => {
      const found = entityStore.nearest(position, radius, (candidate) => (
        (candidate.archetype === "enemy" || candidate.archetype === "boss")
        && candidate.state === "alive"
        && candidate.regionId === store.get().player.regionId
        && typeof candidate.meta?.family === "string"
      ));
      if (!found) return undefined;
      return {
        entityId: found.id,
        family: String(found.meta!.family),
        distance: straightLineDistance(position, found.position),
      };
    },
  });

  // 8a. Dungeon interiors. The Gravelmaw was authored as chamber centres with floor offsets and
  //     nothing underneath, so everything in it hung in mid-air over the moor: entering snapped the
  //     player back to the surface and the boss chased, leashed, and walked home. Built before the
  //     navmesh so the chambers are genuinely walkable.
  const caveLabModule = profile.kind === "feature-lab" && (new URLSearchParams(location.search).get("cave") === "1" || portalFixture)
    ? await import("../featureLab/cave.js") : null;
  // The scanned facing is the accepted cave surface, so the authored Gravelmaw uses it too. The lab
  // keeps its explicit switch for candidate review. It shapes ceilings and the shell only; the
  // walkable floor is unchanged, so navigation is not affected.
  const wantsCaveRock = ((caveLabModule || denseCaveLab) && new URLSearchParams(location.search).get("caveSource") === "1")
    || (profile.kind === "game" && authoredDungeonSpec !== null);
  const deferCaveRock = wantsCaveRock && runtimePerformanceEnabled;
  const caveRockSource = wantsCaveRock && !deferCaveRock
    ? await (await import("../render/dungeon.js")).loadCaveRockSource(`${assetBaseUrl()}models/cave/rock-face-01.glb`)
    : undefined;
  const { caveFixture, dungeonSpec, dungeon } = bootTelemetry.measureSync(BOOT_SPANS.DUNGEON_BUILD, () => {
    const caveFixture = denseCaveLab?.createDenseCaveLabFixture({ scene, surfaceTextures, rockSource: caveRockSource, rockEnvelope: !!wantsCaveRock })
      ?? caveLabModule?.createCaveLabFixture({ scene, surfaceTextures, rockSource: caveRockSource, rockEnvelope: !!wantsCaveRock }) ?? null;
    const dungeonSpec = caveFixture?.spec ?? authoredDungeonSpec;
    const dungeon = caveFixture ?? (dungeonSpec
      ? buildDungeon(dungeonSpec, scene.materials, { surfaceTextures, rockEnvelope: !!wantsCaveRock, ...(caveRockSource ? { rockSource: caveRockSource } : {}) })
      : null);
    return { caveFixture, dungeonSpec, dungeon };
  });
  const deferredCave = deferCaveRock && dungeon && dungeonSpec
    ? new DeferredDungeonFacing(caveFixture?.built ?? dungeon as BuiltDungeon, dungeonSpec, { surfaceTextures },
      () => loadCaveRockSource(`${assetBaseUrl()}models/cave/rock-face-01.glb`), (mesh, source) => {
        mesh.userData["cameraHardBlocker"] = true;
        cameraQueries.addStaticMesh(mesh);
        caveFixture?.facingAttached(source);
      }) : null;
  if (dungeon && dungeonSpec) {
    if (gates && gateMaterials) {
      for (const threshold of worldDoorThresholds) {
        for (const wall of threshold.walls) {
          const object = gates.buildDungeonGateMasonryWall({ ...wall, bottomAt: (x) => wall.bottomAt(x) }, gateMaterials);
          object.position.set(...threshold.origin);
          object.rotation.y = threshold.rotationY;
          dungeon.group.add(object);
        }
      }
    }
    scene.root.add(dungeon.group);
    if (!caveFixture) addChamberLights(dungeonSpec, dungeon.group);
    // Camera collision uses the rendered shell, including the roof, without adding roof
    // volumes to navigation and deleting the walkable chamber underneath them. The shell is also
    // a hard blocker: no cutaway opens it, so fixed follow has to pull in rather than sit outside.
    bootTelemetry.measureSync(BOOT_SPANS.CAMERA_DUNGEON, () => {
      for (const mesh of dungeon.blockers) {
        mesh.userData["cameraHardBlocker"] = true;
        cameraQueries.addStaticMesh(mesh);
      }
    });
  }

  // Imported altar ruins are not one solid box. Their authored triangles preserve the walkable
  // circular platform and every arch opening while keeping columns, walls, and the central stone
  // monument solid. Loading here also warms the same cached GLB EntityViews uses below.
  let structureNavigation = { roots: [] as THREE.Group[], meshes: [] as THREE.Mesh[] };
  try {
    if (!(import.meta.env.PROD && profile.kind === 'game'))
      structureNavigation = await bootTelemetry.measureAsync("boot.navigation.structures", () => buildStructureNavigationSources(assets, built.entities));
  } catch (cause) {
    errors.push({ atMs: atMs(), source: "structure.navigation", message: describeError(cause) });
  }

  // 8b. Buildings become solid before the navmesh is generated, so paths route around them
  //     instead of through a wall. Gatehouses emit two pier boxes with the gate gap left open.
  const collisionSpan = bootTelemetry.startSpan("boot.navigation.colliders");
  for (const box of built.buildings) {
    cameraQueries.addStaticBox(box.position, box.halfExtents as unknown as Vec3, box.rotationY, box.buildingId);
  }
  for (const mesh of structureNavigation.meshes) cameraQueries.addStaticMesh(mesh);
  const roofVisibility = new RoofVisibility();
  const structureCameraStreaming = new StructureCameraStreaming(assets, sources => {
    for (const mesh of sources.meshes) cameraQueries.addStaticMesh(mesh);
  });
  const structureCamera = structureCameraStreaming.sources;
  // Recast reads raw geometry, so the cheapest way to make something block a path is to hand the
  // navmesh an invisible carve for it.
  //
  // Two things changed here and both were measured. The carve source is now `built.solids` rather
  // than `built.buildings`: solids is a documented SUPERSET (a consumer takes one or the other,
  // never both, or every building is carved twice), and it is the only list that contains the bank
  // chest, the anvil, the market stalls, the trees and the ore rocks the player used to walk
  // straight through. And the geometry is an open-topped ring rather than a closed box, because a
  // box top rasterises into a WALKABLE ROOF: (-160, 6, -60) snapped to y = 9.041 on the March
  // Company Hall ridge and the player could stroll five metres along it, and every teleport in the
  // game — region travel, debug teleport, focusCamera, death respawn — routes through
  // `nav.closestPoint`, so those polygons were reachable. A ring generates no roof polygon at all.
  const releasedNavigation = import.meta.env.PROD && profile.kind === 'game';
  let navCarves = releasedNavigation ? [] : solidObstacleMeshes(built.solids.map((solid) => encounterNavSolids.get(solid.id) ?? solid));
  const navCarveGroup = new THREE.Group();
  navCarveGroup.name = "nav-obstacles";
  navCarveGroup.visible = false;
  for (const mesh of navCarves) navCarveGroup.add(mesh);
  navCarveGroup.updateMatrixWorld(true);
  renderer.scene.add(navCarveGroup);
  collisionSpan.end();

  // 9. Navmesh over the walkable terrain, then the route graph above it.
  setStatus("Loading paths…",3);
  const navigationTerrain = releasedNavigation ? [] : riverLab || fishingLab || profile.kind === "game"
    ? dryNavigationMeshes(scene.getWalkableMeshes(), scene.getWaterBodies()).meshes
    : scene.getWalkableMeshes();
  const navigationInput = releasedNavigation ? [] : [
    ...navigationTerrain,
    ...(fairyRealm?.getWalkableMeshes() ?? []),
    ...(dungeon?.walkable ?? []),
    ...dungeonNavigationBlockers(dungeon?.blockers ?? []),
    ...structureNavigation.meshes,
    ...navCarves,
  ];
  const navigationBuilt = await bootTelemetry.measureAsync(
    BOOT_SPANS.NAVIGATION_BUILD,
    () => nav.buildOrImport(navigationInput, { worldSeed: store.get().meta.seed,
      ...(releasedNavigation ? {release:releaseNavigation,loadArtifact:()=>navigationDownload!} : {}),
      allowRuntimeGeneration: !(import.meta.env.PROD && profile.kind === 'game') }),
  );
  if (!navigationBuilt) {
    const failure = nav.snapshot(null, null, 0).error ?? "unknown";
    errors.push({ atMs: atMs(), source: "navigation", message: `Navmesh build failed: ${failure}` });
    if (import.meta.env.PROD && profile.kind === 'game') throw new Error(`Unable to load released navigation: ${failure}`);
  } else {
    const artifact = nav.getDiagnostics().artifact;
    bootTelemetry.milestone(BOOT_MILESTONES.NAVIGATION_READY, { artifact: artifact.status, reason: artifact.reason });
  }
  nav.setRouteGraph(built.routeNodes, built.routeEdges);

  if (navigationBake) {
    if (!navigationBuilt || errors.length) throw new Error(`Navigation bake failed: ${errors.map(error => error.message).join('; ')}`);
    // The offline builder exports the completed geometry directly. It has no session to join
    // and needs no gameplay pipelines, actors or UI before collecting the artifact.
    bootTotalSpan.end();
    return new Promise<BootResult>(() => {});
  }

  const { spreadMobSpawns } = await import('../world/mobSpawnSpacing.js');
  const { spreadMobSpawnsCached } = await import('../world/mobSpawnCache.js');
  const { refineCreaturePopulation } = await import('../world/creaturePopulation.js');
  const applyMobSpacing = (actors: SemanticEntity[], cached = false): void | Promise<void> => {
    if (profile.kind === 'game') {
      const residents = refineCreaturePopulation(actors, undefined, worldPorts.assetSize);
      actors.splice(0, actors.length, ...residents);
    }
    const ports = mobSpawnPlacementPorts(worldHabitats, { solids: built.solids, scene, nav, dungeonSpec, doorThresholds, profile, terrainAt });
    const apply = (habitats: HabitatDef[]): void => {
      worldHabitats.splice(0, worldHabitats.length, ...habitats.filter(habitat => habitat.regionId !== dungeonSpec?.regionId));
      for (const habitat of habitats) worldPackHabitats.set(habitat.groupId, habitat);
    };
    if (cached && generationCache) return spreadMobSpawnsCached(generationCache, actors, worldHabitats, ports, { trustBaked: thinGame }).then(apply);
    apply(spreadMobSpawns(actors, worldHabitats, ports));
  };
  // The spacing lab spreads its creatures here because it tells its worker where everything stands, and the bake because it
  // writes the placement record. The authored game page only reads that record: it draws no creature from it, and needs where
  // they stand for the tree clearances below.
  //
  // The dense cave lab is deliberately NOT in that list. Its packs are the legacy encounter record
  // (`featureLab/denseCave.ts` -> `content/legacyEncounterPlacements.ts`), already laid out against the cave's own receiving
  // floor and door partitions. Running the habitat pass over them a second time re-places the same bodies with the generic
  // minimum gap, and the Cairn Hall compartment between the stone door and Ordrun's gate has no room for the seventh
  // Vault Custodian once that gap applies: boot threw "No spaced, walkable spawn for lab:dense-cave:gravelmaw_ch3_bears_7".
  // The authored world keeps its own gravelmaw placement and still goes through spacing below.
  if (mobSpacingLab || profile.kind === 'game') {
    await bootTelemetry.measureAsync("boot.spawns", async () => { await applyMobSpacing(built.entities, true); });
    entityStore.load(loadedEntities(built.entities));
  }

  // Path distance, not straight line: `ObservedEntity.distance` is documented as walking distance,
  // and across Karrowmoor's terraces the difference is large enough to change an agent's choice.
  entityStore.setDistanceFunction((from, to) => nav.pathDistance(from, to) ?? straightLineDistance(from, to));

  if (bakeWriter) {
    const tiles: string[] = [];
    if (profile.scatter) {
      await assets.load('corealm_grass_1');
      scene.setGrassSource(assets.instance('corealm_grass_1'));
      registerExclusions(scene, built.solids, sitePlacements, fairyRealm?.scene);
      registerHabitatTreeClearance(built.entities);
      const { scatterTilesForBounds, scatterWorldTile } = await import('../world/scatter.js');
      for (const mapScene of [scene, ...(fairyRealm ? [fairyRealm.scene] : [])]) {
        if (!mapScene.hasNativeGrass()) mapScene.setGrassSource(assets.instance('corealm_grass_1'));
        for (const tile of scatterTilesForBounds(mapScene.getScatterBounds(Infinity))) {
        const result = await scatterWorldTile(mapScene, assets, store.get().meta.seed, tile,
          mapScene === fairyRealm?.scene ? fairyDressing?.specs : undefined,
          { cache: bakeWriter, render: false });
        if (result.some(region => region.missingAssets.length)) throw new Error(`Cannot bake incomplete tile ${tile.id}`);
        tiles.push(tile.id);
        }
      }
    }
    window.__corealmWorldBake = { revision: generationRevision, scope: cacheScope, tiles, records: bakeWriter.records };
    // The build driver closes this page after collecting the completed records.
    return new Promise<BootResult>(() => {});
  }

  const effectsConstructionSpan = bootTelemetry.startSpan("boot.effects.construct");
  let wildernessEffects: WildernessEffects | null = null;
  const refreshWildernessEffects = (structureEntities: readonly SemanticEntity[] = []): void => {
    if (profile.kind !== 'game' && !wildernessEffectsLab && !wildernessTorchesLab) return;
    wildernessEffects?.dispose();
    const groundHeightAt = (x: number, z: number) => terrainAt(x, z).meshHeightAt(x, z);
    const torches: WildernessTorch[] = wildernessEffectsLab
      ? (deepWildernessEffectsLab ? deepWildernessEffectsLabTorches : wildernessEffectsLabTorches)(groundHeightAt) : [];
    if (profile.kind === 'game') for (const [index, [x, z]] of WILDERNESS_ROAD_BRAZIERS.entries()) {
      torches.push({id:`wilderness-road-brazier-${index}`,position:[x,groundHeightAt(x,z)+1.3,z],scale:1,support:'brazier', magic:wildernessMagicAt(x,z)});
    }
    for (const entity of structureEntities) {
      if (entity.view?.assetId !== 'torch') continue;
      const scale = entity.view.scale ?? 1;
      const structureId = String(entity.meta?.structureId ?? entity.id.split('#')[0]);
      const mountIndex = /#mounted_torch_(\d+)$/.exec(entity.id)?.[1];
      const theme = mountIndex === undefined ? undefined
        : DEEP_WILDERNESS_STRUCTURES[structureId as DeepWildernessStructureId]?.torches[Number(mountIndex)]?.theme;
      torches.push({ id: entity.id, position: torchFlameOrigin(entity.position, scale, entity.view.rotationY ?? 0),
        scale, support: 'none', theme, magic: wildernessMagicAt(entity.position[0],entity.position[2]) });
    }
    // Permanent banks and molten ground belong to the world and must also appear on its map.
    wildernessEffects = new WildernessEffects(profile.kind === 'game' ? scene.terrainGroup : scene.overlayGroup, { groundHeightAt, torches,
      lightParent: renderer.scene,
      channels: terrainSpec.lavaChannels ?? [], maxLights: 6, surfaceTextures,
      streamChannels: !worldMapCapture && (profile.kind === 'game' || wildernessEffectsLab) });
    (window as any).__wildernessEffects = wildernessEffects;
  };
  refreshWildernessEffects(profile.kind === 'game' ? built.entities.filter(entity => entity.regionId === 'wilderness') : []);
  if (dungeon && !caveFixture) dungeon.group.visible = store.get().player.regionId === "gravelmaw";
  // Pools and their lights are stable throughout play. Compile their programs while the CPU
  // generates vegetation and loads models, then wait for completion at the final reveal gate.
  const spellVfx = new SpellVfx({
    multiplayer: multiplayerFixture || Boolean(window.__COREALM_MULTIPLAYER__),
    parent: scene.overlayGroup,
    camera: renderer.camera,
    groundHeightAt: (x, z) => terrainAt(x, z).meshHeightAt(x, z),
    castingFocus: () => rigged ? playerRig.castingFocus() : undefined,
    ready: () => renderer.effectsReady,
  });
  effectsConstructionSpan.end();
  if (!worldMapCapture) renderer.compileEffects(spellVfx.preparationRoot());

  // 10. Procedural dressing, kept clear of anything authored.
  setStatus("Loading nearby scenery…",4);
  const fixtureSpawn = groundMotionFixture?.spawn ?? packFixture?.spawn;
  const spawnSpec = fixtureSpawn ? { ...profile.spawn, x: fixtureSpawn[0], z: fixtureSpawn[2], regionId: "fallowmarch" as const } : profile.spawn;
  const loadPosition: Vec3 = [spawnSpec.x, 0, spawnSpec.z];
  const loadRegion = spawnSpec.regionId;
  const initialTerrainPreparation = terrainAt(loadPosition[0],loadPosition[2])
    .prepareTerrainArea(loadPosition[0],loadPosition[2],structureResidencyRadius(initialSettings.drawDistance));
  void initialTerrainPreparation.catch(()=>{});
  assets.setActiveRegion(loadRegion);
  const scatterStreaming = new ScatterStreamingController(scene, assets, store.get().meta.seed, { onTree: registerForestTree, cache: generationCache ?? undefined });
  const fairyScatter = fairyRealm ? await createRealmScatter(fairyRealm, assets, store.get().meta.seed, {
    onTree: registerForestTree, cache: generationCache ?? undefined, specs: fairyDressing?.specs,
  }) : null;
  const scatterForRegion = (regionId: RegionId) => isFairyRegion(regionId) && fairyScatter ? fairyScatter : scatterStreaming;
  let scatterResults: ScatterResult[] = [];
  function registerHabitatTreeClearance(entities: readonly SemanticEntity[]): void {
    const byGroup = new Map<unknown, SemanticEntity[]>();
    for (const entity of entities) {
      const group = entity.meta?.groupId;
      if (group === undefined) continue;
      const members = byGroup.get(group) ?? [];
      members.push(entity);
      byGroup.set(group, members);
    }
    for (const habitat of worldHabitats) {
      const inside = (point: Vec3) => habitatContains(habitat, point);
      for (const entity of byGroup.get(habitat.groupId) ?? []) {
        const spawn = entity.position;
        const targets = habitatIdleTargets(entity.id, spawn, habitat);
        const valid: Vec3[] = [];
        for (const candidate of targets.candidates) {
          const anchor = habitat.anchors[candidate.anchorIndex]!;
          if (!inside([anchor[0], spawn[1], anchor[1]]) || !inside(candidate.position)) continue;
          const snapped = nav.nearestWalkable(candidate.position, 0.1);
          if (snapped && inside(snapped)) valid.push(snapped);
        }
        const radius = entity.combat?.bodyRadius ?? 0.4;
        worldExclusions.addTreeClearance([spawn], radius, entity.id);
        if (!targets.ranging) {
          worldExclusions.addTreeClearance([spawn, ...valid], radius, `${entity.id}:browsing`);
        } else if (valid.length) {
          for (let i = 0; i < valid.length; i++) {
            // Patrols can resume at their next valid circuit point after combat or a blocked target.
            worldExclusions.addTreeClearance([spawn, valid[i]!], radius, `${entity.id}:return:${i}`);
            worldExclusions.addTreeClearance([valid[i]!, valid[(i + 1) % valid.length]!], radius, `${entity.id}:patrol:${i}`);
          }
        }
      }
    }
  }
  const scatterPreparation = (async () => {
    if (profile.scatter) {
      await assets.load("corealm_grass_1", { priority: "visible-spawn", primary: true });
      scene.setGrassSource(assets.instance("corealm_grass_1"));
      registerExclusions(scene, built.solids, sitePlacements, fairyRealm?.scene);
      registerHabitatTreeClearance(built.entities);
      // A cave resume still needs the grass source and exclusions ready for its eventual exit.
      if (!worldMapCapture && loadRegion === "gravelmaw") return;
      try {
        scatterResults = await bootTelemetry.measureAsync(
          "boot.scatter.total",
          () => worldMapCapture
            ? scatterStreaming.forceFullResidency()
            : scatterForRegion(loadRegion).loadView(loadPosition[0], loadPosition[2],
              fogOpaqueMetres(initialSettings.drawDistance) + CAMERA.maxDistance + ENTITY_ACTIVE_REPOSITION_DISTANCE),
        );
        bootTelemetry.milestone(BOOT_MILESTONES.SCATTER_SPAWN_READY, {
          regions: scatterResults.length,
          layers: scatterResults.reduce((total, result) => total + Object.keys(result.byLayer).length, 0),
        });
      } catch (cause) {
        errors.push({ atMs: atMs(), source: "scatter", message: describeError(cause) });
        if (import.meta.env.PROD || fixtureWorldData) throw cause;
      }
    }
  })();
  void scatterPreparation.catch(() => {}); // Awaited before any scene is revealed.

  // 11. Entity views. The render layer reads `SemanticEntity.view`; it never invents an appearance.
  // Rigged characters bypass instancing, so they are the single largest draw-call line item: ten
  // full rigs in the Highcairn frame put that pose 6 calls over the 400 budget. 64 leaves room for
  // the settlement geometry while still dressing every NPC a player is close enough to talk to.
  // 96 rather than 64. The old number was chosen when a dressed NPC cost 10 skinned meshes; the
  // characters are now assembled through `render/skinning.ts` and cost 5-6, and the worst measured
  // pose sits at 322 of the 400 draw-call budget with 78 calls of headroom where it used to have 3.
  // The pool is split internally between named characters and everything else — as one counter, a
  // reserve equal to the whole budget left the enemy ceiling at exactly zero and no enemy in the
  // game had ever animated.
  const entityViews = new EntityViews(scene, assets, scene.materials, {
    groundHeightAt: (x, z, y) => groundIndicatorHeight(x, z, y),
    isViewReady: root => renderer.isInteriorReady(root),
    schedulePreparation: work => debugReady && runtimePerformanceEnabled ? assets.prepareGameplayView(work) : undefined,
    maxUniqueDrawCalls: profile.kind === 'feature-lab' && new URLSearchParams(location.search).get('rigBudget') === 'tiny' ? 8 : 96,
    maxUniqueViews: profile.kind === 'feature-lab' && new URLSearchParams(location.search).get('sampledActors') === '1' ? 0 : 16,
    // Equal to `maxUniqueViews`, because a mixer budget UNDER the rig ceiling is where the herd
    // jitter lived: at the default 10, a field with all 16 rigs alive handed the far eleven a
    // rotating five slots, so every walking cow in the group advanced its cycle in uneven 33-50 ms
    // steps instead of one per frame. Sixteen small quadruped mixers are well under a millisecond;
    // the rotation in `orderAnimationBudget` stays as the safety net rather than the steady state.
    maxAnimatedViews: 16,
  });
  renderer.transmissionCandidates = () => entityViews.transmissiveMeshes();
  renderer.transmissionOpaqueOccluders = () => entityViews.staticOccluderMeshes();
  const spawnPosition = loadPosition;
  let surfaceEntities = entityStore.all().filter((entity) =>
    worldMapForRegion(entity.regionId) === worldMapForRegion(loadRegion));
  entityViews.updateActiveArea(
    spawnPosition,
    profile.kind === "feature-lab" ? 220 : ENTITY_ACTIVE_RADIUS,
    structureResidencyRadius(initialSettings.drawDistance),
  );
  if (runtimePerformanceEnabled) entityViews.updateActorRadius(structureResidencyRadius(initialSettings.drawDistance));
  const playerAssetArea = (position: Vec3, regionId: RegionId, ahead = 0): PlayerAssetArea => ({
    position, regionId,
    resourceRadius: (profile.kind === 'feature-lab' ? 220 : ENTITY_ACTIVE_RADIUS) + ahead,
    viewRadius: structureResidencyRadius(clientSettings.get().drawDistance) + ahead,
  });
  const playerEntitySelector = new PlayerEntitySelector();
  /**
   * `hints` are entities this page does not hold but expects to be sent: at boot, the baked creatures and characters
   * around the spawn, so their models are loaded by the time the first snapshot names them.
   */
  const preparePlayerArea = async (area: PlayerAssetArea, prefetch = false, hints: readonly SemanticEntity[] = []): Promise<void> => {
    const selected = playerEntitySelector.select(hints.length ? [...entityStore.renderSnapshot(), ...hints] : entityStore.renderSnapshot(), area);
    const options = { priority: prefetch ? 'travel-prefetch' as const : 'visible-spawn' as const,
      regionId: area.regionId, primary: !prefetch };
    const cameraCount = structureCamera.meshes.length;
    const [prepared] = await Promise.all([
      entityViews.prepare(selected, options), siteStreaming.prepare(area, options),
      structureCameraStreaming.prepare(selected, options),
      terrainAt(area.position[0], area.position[2]).prepareTerrainArea(area.position[0], area.position[2], area.viewRadius),
      wildernessEffects?.prepareArea(area.position[0], area.position[2], area.viewRadius),
      riverSurface?.prepareArea(area.position[0], area.position[2], area.viewRadius),
    ]);
    if (prepared.missing.length) throw new Error(`Could not load nearby objects: ${prepared.missing.join(', ')}`);
    if (structureCamera.meshes.length !== cameraCount) roofVisibility.setSources(structureCamera.meshes);
  };
  (window as any).__corealmPlayerAssets = {
    selectArea: (area: PlayerAssetArea) => playerEntitySelector.select(entityStore.renderSnapshot(), area).map(entity => entity.id),
    snapshot: () => ({
    area: playerAssetArea(store.get().player.position, store.get().player.regionId),
    items: immediatePlayerItems(store.get()),
    sites: siteStreaming.snapshot(playerAssetArea(store.get().player.position, store.get().player.regionId)),
    cameraSources: structureCamera.roots.length, assets: assets.getLoadStats(),
    loadedIds: assets.getManifest()!.assets.filter(entry => assets.isLoaded(entry.id)).map(entry => entry.id).sort(),
  }) };
  setStatus("Loading nearby objects…",4);
  await bootTelemetry.measureAsync(
    BOOT_SPANS.ENTITY_PRELOAD,
    async () => {
      if (worldMapCapture) {
        entityViews.sync(surfaceEntities);
        const residency = entityViews.forceFullResidency(true);
        // `forceFullResidency` queues every source before its first await, so this is the complete
        // batch rather than the moving request count that used to render as 8/8, then 10/10.
        statusAssetTarget = assets.getLoadStats().requested;
        refreshStatus();
        await Promise.all([residency,
          siteStreaming.prepare({ ...playerAssetArea(spawnPosition, loadRegion), viewRadius: 1e6 }, { priority: 'visible-spawn' }),
          structureCameraStreaming.prepare(surfaceEntities, { priority: 'visible-spawn' })]);
        roofVisibility.setSources(structureCamera.meshes);
        return;
      }
      const preparation = preparePlayerArea(playerAssetArea(spawnPosition, loadRegion), false,
        built.entities.filter(entity => !entityStore.get(entity.id)));
      // `prepare` queues the full list synchronously. Freeze its size once so only the completed
      // side advances while the boot screen is visible.
      statusAssetTarget = assets.getLoadStats().requested;
      refreshStatus();
      await Promise.all([preparation,initialTerrainPreparation]);
    },
  );
  await scatterPreparation;
  surfaceEntities = entityStore.all().filter((entity) =>
    worldMapForRegion(entity.regionId) === worldMapForRegion(loadRegion));
  // Harvestable trees are registered by scatter. Their sources already loaded with the tiles.
  await entityViews.prepare(surfaceEntities.filter(entity => distanceXZ(entity.position, spawnPosition) <= ENTITY_ACTIVE_RADIUS));
  statusAssetTarget = null;
  setStatus("Preparing your player…",5);
  try {
    bootTelemetry.measureSync(BOOT_SPANS.FIRST_ENTITY_SYNC, () => entityViews.sync(surfaceEntities));
  } catch (cause) {
    errors.push({ atMs: atMs(), source: "entityViews", message: describeError(cause) });
  }
  for (const missing of entityViews.stats().missingAssets) {
    errors.push({ atMs: atMs(), source: "entityViews", message: `Missing asset "${missing}"` });
  }
  bootTelemetry.milestone(BOOT_MILESTONES.ENTITIES_READY, {
    semanticEntities: entityStore.all().length,
    missingAssets: entityViews.stats().missingAssets.length,
  });

  // The camera pulls in when terrain or a building blocks the view of the player. The probe starts
  // at head height rather than at the feet, so the player's own capsule is never the first hit —
  // otherwise the camera jams at minimum distance permanently.
  camera.setOcclusionProbe((from, to) => {
    const direction: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const length = Math.hypot(direction[0], direction[1], direction[2]);
    if (length < 0.001) return null;
    const unit: Vec3 = [direction[0] / length, direction[1] / length, direction[2] / length];
    return cameraQueries.raycast(from, unit, length);
  });
  // Production follow keeps a fixed frame and lets the cutaway open buildings. Cave and dungeon
  // rock has no cutaway, so the camera consults this narrower probe before seating the lens.
  camera.setHardOcclusionProbe((from, to) => {
    const direction: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const length = Math.hypot(direction[0], direction[1], direction[2]);
    if (length < 0.001) return null;
    const unit: Vec3 = [direction[0] / length, direction[1] / length, direction[2] / length];
    return cameraQueries.raycast(from, unit, length, true);
  });

  // 12. Player.
  const groundY = terrainAt(spawnSpec.x, spawnSpec.z).heightAt(spawnSpec.regionId, spawnSpec.x, spawnSpec.z);
  const spawnNav = nav.closestPoint([spawnSpec.x, groundY + 0.2, spawnSpec.z]);
  const spawn: Vec3 = spawnNav
    ? [spawnNav[0], terrainAt(spawnNav[0], spawnNav[2]).meshHeightAt(spawnNav[0], spawnNav[2]), spawnNav[2]]
    : [spawnSpec.x, groundY, spawnSpec.z];
  // Facing convention matches NpcStandDef and debug/shots.ts: 0 looks toward +z.
  // The camera sits behind the player, so its yaw is the player's facing plus pi.
  const spawnFacing = packFixture ? Math.PI : spawnSpec.facingRad;
  store.get().player.position = spawn;
  store.get().player.regionId = spawnSpec.regionId;
  store.get().player.facingRad = spawnFacing;
  const initialPlayerPosition = store.get().player.position;
  const initialPlayerFacing = store.get().player.facingRad;
  // A real skinned character rather than the round-0 capsule. If the rig fails to build for any
  // reason the capsule stays as the fallback, because a missing player is unrecoverable and an
  // ugly player is not.
  const rigged = await (playerBootstrap ?? buildPlayerRig());
  if (rigged) {
    scene.entityGroup.add(playerRig.root);
    renderer.playerSilhouette.source = playerRig.root;
    playerRig.setPosition(initialPlayerPosition, initialPlayerFacing);
  } else {
    errors.push({ atMs: atMs(), source: "characterRig", message: "Player rig failed to build; using the placeholder" });
    scene.createPlaceholderPlayer();
  }
  scene.syncPlayer(initialPlayerPosition, initialPlayerFacing, true);
  camera.setPose(initialPlayerFacing + Math.PI, CAMERA.defaultPitch, CAMERA.defaultDistance);
  camera.update(initialPlayerPosition[0], initialPlayerPosition[1], initialPlayerPosition[2], true);
  bootTelemetry.milestone(BOOT_MILESTONES.PLAYER_READY);

  if (rigged) {
    await bootTelemetry.measureAsync(
      "boot.player.equipment",
      async () => {
        await Promise.all([playerRig.prepareItems(immediatePlayerItems(store.get())), playerRig.applyEquipment(store.get().equipment)]);
      },
    );
  }
  if (profile.fullWarmup || performanceLab || multiplayerFixture) {
    if (dungeon && !caveFixture) dungeon.group.visible = loadRegion === "gravelmaw";
    scene.setStreamingRadius(fogOpaqueMetres(initialSettings.drawDistance) + CAMERA.maxDistance);
    fairyRealm?.scene.setStreamingRadius(fogOpaqueMetres(initialSettings.drawDistance) + CAMERA.maxDistance);
    scene.updateStreaming(initialPlayerPosition[0], initialPlayerPosition[2]);
    entityViews.update(0, renderer.camera.position, clock.elapsedMs);
    // Compile once below, after the HUD can paint and the scene's lights are final.
  }
  // Region audio is selected after play. Requesting multi-megabyte music while the renderer is
  // still building made audio compete with the first frame even though browsers cannot play it
  // before a gesture unlocks the AudioContext.

  // 14. API and hooks. Everything a human or an agent does goes through here.
  const movement = new Movement(nav, events);
  // Everything that makes a step honest. `Movement` runs without any of these — that is what let it
  // be written while boot was frozen — and running without them is what "no collisions" meant:
  // only the navmesh constrained a step, so direct WASD input walked through the bank chest, the
  // anvil, both market stalls, an NPC, an enemy, a tree and an ore rock. `solids` does the XZ
  // push-out with a wall slide; `heightAt` puts the player's feet on the same ground plane
  // everything else is placed on, instead of 0.147-0.417 m above it on the navmesh; `entities`
  // pushes out of the things that move, which a navmesh carve cannot follow.
  let solids = new Solids(built.solids);
  const importedSurfaceBounds = (meshes: readonly THREE.Mesh[]): THREE.Box3[] => meshes.map((mesh) =>
    new THREE.Box3().setFromObject(mesh).expandByScalar(0.35));
  let structureMovementBounds = importedSurfaceBounds(structureNavigation.meshes);
  const preserveNavigationHeight = (point: Vec3): boolean => structureMovementBounds.some((bounds) =>
    point[0] >= bounds.min.x && point[0] <= bounds.max.x
    && point[1] >= bounds.min.y && point[1] <= bounds.max.y
    && point[2] >= bounds.min.z && point[2] <= bounds.max.z);
  const movementSolids = {
    contains: (position: Vec3) => solids.contains(position) || Boolean(dungeonDoors?.contains(position)),
    resolve: (position: Vec3, from: Vec3, radius: number) => {
      const resolved = solids.resolve(position, from, radius);
      return dungeonDoors?.resolve(resolved, from, radius) ?? resolved;
    },
  };
  const movementHeightAt = (regionId: RegionId, x: number, z: number): number =>
    dungeonSpec && regionId === dungeonSpec.regionId ? dungeonFloorHeight(dungeonSpec, x, z) : heightAt(regionId, x, z);
  const groundIndicatorHeight = (x: number, z: number, referenceY: number): number =>
    preserveNavigationHeight([x, referenceY, z]) ? referenceY
      : movementHeightAt(store.get().player.regionId, x, z);
  movement.setPorts({ solids: movementSolids, heightAt: movementHeightAt, authoritativeGround: true,
    preserveNavigationHeight, entities: entityStore, dynamicObstacles: forestObstacles });
  const api = new CorealmGameApi(store, events, nav, movement, clock, { replica: true });

  const interactions = new InteractionDispatcher({
    get: (id) => entityStore.get(id),
    playerPosition: () => store.get().player.position,
    skillLevels,
  });

  // ---- Read-side view computers. The host runs the rules; these answer the API's reads (a bank or
  // shop listing, quest summaries, contract offers) from the replicated store. Nothing here ticks,
  // and every write they could make is refused by the replica API before it reaches them.

  const now = (): number => clock.elapsedMs;

  /** True when the player is close enough to interact with any entity of a given archetype. */
  const nearArchetype = (archetype: string): boolean => {
    const position = store.get().player.position;
    for (const entity of entityStore.all()) {
      if (entity.archetype !== archetype) continue;
      if (distanceXZ(position, entity.position) <= INTERACT_RANGE * 2.2) return true;
    }
    return false;
  };

  const inventorySystem = new InventorySystem({
    store, events, now,
    beginEating: () => false,
    equip: () => ({ ok: false as const, error: { code: "UNAVAILABLE" as const, message: "Equipment belongs to the world's host" } }),
  });
  const bankSystem = new BankSystem({
    store, events, inventory: inventorySystem, dispatcher: interactions, now,
    inRangeOfBank: () => nearArchetype("bank"),
    persist: () => {},
  });
  const economySystem = new EconomySystem({
    store, events, inventory: inventorySystem, dispatcher: interactions, now,
    resolveShop: (shopId) => {
      const position = store.get().player.position;
      const shops = entityStore.all().filter((entity) => entity.archetype === "shop");
      const chosen = shopId
        ? shops.find((entity) => entity.id === shopId)
        // With no id, the nearest shop is what the player is obviously standing at.
        : shops.sort((a, b) => distanceXZ(position, a.position) - distanceXZ(position, b.position))[0];
      if (!chosen) return undefined;
      return {
        entityId: chosen.id,
        contentShopId: String(chosen.meta?.shopId ?? chosen.id),
        inRange: distanceXZ(position, chosen.position) <= INTERACT_RANGE * 2.2,
      };
    },
  });

  const traversalPresentation = new TraversalPresentation(async () => {
    const player = store.get().player;
    landView(player.position, player.facingRad, player.regionId);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    renderer.render(performance.now());
  });
  let openLootContainer: ((container: LootContainerView) => void) | undefined;

  // ---- Quests. Built for `summaries()`. The ports a quest would write through do nothing here.
  const questEntityPort = { get: (id: EntityId) => entityStore.get(id), setState: (): boolean => false };
  const questXpPort = { award: (): void => {} };

  const questSystem = new QuestSystem({
    store, events, clock,
    entities: questEntityPort,
    inventory: inventorySystem,
    xp: questXpPort,
    dispatcher: interactions,
  });

  /**
   * Which region a world point is in, accounting for the dungeon underneath Karrowmoor.
   *
   * `scene.regionAt` answers from terrain XZ alone, so every point in the Gravelmaw reports
   * "karrowmoor" — the dungeon is directly below it. That made teleporting into the arena leave the
   * player tagged as being on the surface, and the render filter that hides dungeon entities from
   * outside then culled the boss and the whole interior. The tier 10 encounter photographed as
   * empty sky.
   */
  const regionAtPoint = (point: Vec3): RegionId => {
    if (dungeonSpec) {
      const withinCavern = dungeonSpec.chambers.some((chamber) =>
        Math.hypot(point[0] - chamber.centre[0], point[2] - chamber.centre[1]) <= chamber.radius + 1.6);
      const floorGap = Math.abs(point[1] - dungeonFloorHeight(dungeonSpec, point[0], point[2]));
      const surfaceGap = Math.abs(point[1] - scene.meshHeightAt(point[0], point[2]));
      if (withinCavern && floorGap < 0.8 && floorGap + 0.5 < surfaceGap) {
        return dungeonSpec.regionId;
      }
    }
    return terrainAt(point[0], point[2]).regionAt(point[0], point[2]);
  };
  // Region is part of semantic player state, so ordinary movement must update it too. This port
  // uses Y to distinguish Gravelmaw from the Karrowmoor terrain directly above it.
  movement.setPorts({ regionAt: (point, currentRegionId) => currentRegionId === dungeonSpec?.regionId
    ? currentRegionId
    : terrainAt(point[0], point[2]).regionAt(point[0], point[2]) });

  let activeVisualCentre: Vec3 = [...initialPlayerPosition];
  let debugPlacements = 0;
  let activeVisualRegion = loadRegion;
  const entitiesForVisualRegion = (regionId: RegionId): readonly SemanticEntity[] => entityStore.renderSnapshotForMap(regionId);
  const refreshVisualResidency = (position: Vec3, regionId: RegionId, force = false): void => {
    const regionChanged = regionId !== activeVisualRegion;
    const moved = distanceXZ(position, activeVisualCentre) >= ENTITY_ACTIVE_REPOSITION_DISTANCE;
    if (!force && !regionChanged && !moved) return;

    if (debugReady && profile.kind === 'game' && !worldMapCapture) {
      void preparePlayerArea(playerAssetArea(position, regionId, 48), true).catch(cause => {
        errors.push({ atMs: atMs(), source: 'playerAssets.travel', message: describeError(cause) });
      });
    }
    assets.setActiveRegion(regionId);
    scatterForRegion(regionId).setActivePosition(position[0], position[2]);
    fairyRealm?.setVisible(isFairyRegion(regionId));
    // Distance-culls resident scatter shards against the fog wall. Without this the arena and
    // canopy poses drew every in-frustum tile across the whole island; see updateStreaming.
    terrainAt(position[0], position[2]).updateStreaming(position[0], position[2]);
    if (regionChanged || force) entityViews.sync(entitiesForVisualRegion(regionId));
    entityViews.updateActivePosition(position);
    activeVisualCentre = [...position];
    activeVisualRegion = regionId;

    if (worldMapForRegion(regionId) !== "surface") scatterStreaming.suspend();
    if (!isFairyRegion(regionId)) fairyScatter?.suspend();
    if (debugReady && (profile.scatter || fairyLab) && regionId !== "gravelmaw") {
      void scatterForRegion(regionId).streamNearby(position[0], position[2],
        fogOpaqueMetres(clientSettings.get().drawDistance) + CAMERA.maxDistance + 48).then(() => {
        scatterResults = scatterForRegion(regionId).getStats();
      }).catch((cause) => {
        errors.push({ atMs: atMs(), source: "scatterStreaming", message: describeError(cause) });
      });
    }
  };
  /** The view follows a player who arrived somewhere without walking: body, camera (on `focus`),
   * the resident world around them and their region's music. */
  const landView = (position: Vec3, facingRad: number, regionId: RegionId, focus: Vec3 = position): void => {
    scene.syncPlayer(position, facingRad, true);
    camera.update(focus[0], focus[1], focus[2], true);
    refreshVisualResidency(position, regionId, true);
    audioDirector.setRegion(regionId, position);
  };

  const hunts = new HuntContractsSystem({
    state: () => store.get().huntContracts,
    markDirty: () => store.markDirty(), events,
    playerId: () => store.get().player.id,
    targets: () => {
      const player = store.get().player;
      return deriveHuntTargets(entityStore.all(), (id) => content.enemy(id),
        (id) => getRegion(id)?.name ?? "Gravelmaw",
        (entity) => (!huntFixture || entity.meta?.huntFixture === true)
          && entity.regionId === player.regionId
          && nav.pathDistance(player.position, entity.position) !== null);
    },
    eligibility: () => ({ regions: [store.get().player.regionId],
      combatLevel: Math.max(store.get().skills.melee.level, store.get().skills.magic.level) }),
    entity: (id) => entityStore.get(id),
    awardXp: questXpPort.award,
  });
  api.register("hunts", hunts);
  if (huntFixture) (window as Window & { __huntLab?: unknown }).__huntLab = {
    // Reads answer from this page's replicated contracts. The rest are commands to the lab worker's world.
    snapshot: () => hunts.snapshot(), refreshOffers: () => sendGameCommand(api, "hunt", "refresh"),
    accept: (id: string) => sendGameCommand(api, "hunt", "accept", id), claim: () => sendGameCommand(api, "hunt", "claim"), abandon: () => sendGameCommand(api, "hunt", "abandon"),
    attack: (id: string) => sendGameCommand(api, "attack", id),
    spawn: huntFixture.spawn,
  };
  let pausedBeforePortal = false;
  /** Every covered load (the portal curtain, a debug placement) holds a cover until it lifts. While
   * any is held, unprepared meshes stay hidden and graphics and asset work get startup-sized budgets.
   * Frames are suppressed until each holder has released or asked to draw behind its cover. */
  const covers = new Set<{ drawing: boolean }>();
  const applyCovers = (): void => {
    renderer.setDestinationLoading(covers.size > 0);
    renderer.setFramesSuppressed([...covers].some(cover => !cover.drawing));
    if (debugReady) assets.setGameplayActive(!covers.size && runtimePerformanceEnabled);
  };
  const acquireCover = () => {
    const cover = { drawing: false };
    covers.add(cover);
    applyCovers();
    return {
      draw: (): void => { cover.drawing = true; applyCovers(); },
      release: (): void => { if (covers.delete(cover)) applyCovers(); },
    };
  };
  let portalCover: ReturnType<typeof acquireCover> | null = null;
  const portalTransition = new PortalTransition((locked) => {
    portalCover?.release();
    portalCover = locked ? acquireCover() : null;
    if (locked) pausedBeforePortal = clock.paused;
    clock.paused = locked || pausedBeforePortal;
    input.clear();
  });
  /** Everything a covered arrival waits for at one place: models, terrain, scatter and a hidden interior. */
  const prepareDestination = async (position: Vec3, regionId: RegionId, loaded: () => void = () => {}): Promise<void> => {
    // The cave rock, the area's models, its scatter and the destination's hidden interior are
    // independent downloads and preparations; only the dungeon's shaders need its rock first.
    const cave = regionId === "gravelmaw" ? deferredCave?.ensure() : undefined;
    await Promise.all([
      preparePlayerArea(playerAssetArea(position, regionId)).then(loaded),
      (profile.scatter || fairyLab) && regionId !== "gravelmaw"
        ? scatterForRegion(regionId).loadView(position[0], position[2],
          fogOpaqueMetres(clientSettings.get().drawDistance) + CAMERA.maxDistance + ENTITY_ACTIVE_REPOSITION_DISTANCE)
          .then(results => { scatterResults = results; })
        : undefined,
      isFairyRegion(regionId) && fairyRealm ? renderer.prepareInterior(fairyRealm.scene.root) : undefined,
      regionId === dungeonSpec?.regionId && dungeon
        ? Promise.resolve(cave).then(() => renderer.prepareInterior(dungeon.group)) : cave,
    ]);
  };
  /** The host already moved the player across maps or beyond the actor radius: curtain the arrival. */
  const coverArrival = (destination: { position: Vec3; regionId: RegionId; name: string }): Promise<void> => portalTransition.run({
    name: destination.name,
    prepare: async (report) => {
      report(0, "Loading destination…");
      await prepareDestination(destination.position, destination.regionId, () => report(1, "Loading scenery…"));
      report(2, "Preparing destination graphics…");
    },
    commit: () => {
      camera.setFreeTarget(null);
      const player = store.get().player;
      landView(player.position, player.facingRad, player.regionId);
    },
    settled: async () => {
      // The host keeps simulating behind the cover. A player killed while the destination loaded
      // has already respawned somewhere else, and `commit` moved the view there: prepare that
      // place too, or the cover lifts on a town whose buildings and creatures are still loading.
      const player = store.get().player;
      if (worldMapForRegion(player.regionId) !== worldMapForRegion(destination.regionId)
        || distanceXZ(player.position, destination.position) > ENTITY_ACTIVE_RADIUS) {
        await prepareDestination([...player.position] as Vec3, player.regionId);
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (destination.regionId === dungeonSpec?.regionId && dungeon) await renderer.waitForInterior(dungeon.group);
      const ready = await entityViews.retryHydration();
      if (ready.pending || ready.failed || ready.missing) throw new Error('Destination assets are not ready');
      entityViews.update(0, renderer.camera.position, clock.elapsedMs);
      // Hydration creates new creature meshes after the region switches. Keep the curtain up
      // while those programs and textures prepare, instead of forcing their first draw here.
      await renderer.waitForInterior(renderer.scene);
      await renderer.prepareEffects(spellVfx.preparationRoot());
      // Let the loop draw behind the curtain: its frame syncs interiors, the rig and residency.
      const drawn = renderer.getPresentationState().submitted;
      portalCover?.draw();
      await renderer.waitForFrame(drawn);
    },
  });
  /**
   * The view follows the host's player. Within a map the working set follows them. Across maps (a
   * portal, a join that lands in the cave) or beyond the actor radius (a respawn, a join far from
   * the boot spawn) the curtain covers the arrival while the destination loads, because nothing
   * there has views, terrain draw data or prepared shaders yet.
   */
  const followPlayer = (force: boolean): void => {
    const player = store.get().player;
    const jumped = debugPlacements === 0 && distanceXZ(player.position, activeVisualCentre) > ENTITY_ACTIVE_RADIUS;
    const crossed = worldMapForRegion(player.regionId) !== worldMapForRegion(activeVisualRegion) || jumped
      || (player.regionId === "gravelmaw" && deferredCave !== null && !deferredCave.getState().ready);
    if (!crossed) { refreshVisualResidency(player.position, player.regionId, force); return; }
    if (portalTransition.active) return;
    void coverArrival({ position: [...player.position] as Vec3, regionId: player.regionId, name: getRegion(player.regionId)?.name ?? "Gravelmaw" })
      .catch(cause => { errors.push({ atMs: atMs(), source: "portalTransition", message: describeError(cause) }); });
  };
  /**
   * Where a debug pose or teleport puts the player. The host owns the player, so this asks the local
   * world and resolves once the new position has been replicated back; `then` runs after that. A page
   * with no local world (the multiplayer lab, a capture) has nobody to ask, and the pose is refused.
   */
  const localDebug = localLaunch ? (op: import("../worker/localDebugProtocol.js").DebugOp) => localLaunch.provider.debug(op) : null;
  /** Debug placements frame their own camera, so they skip the jump cover and resolve only once
   * the creatures and scenery around the new position are built and drawable. */
  const debugPlace = async <T>(position: Vec3, regionId: RegionId, facingRad: number | undefined, then: () => T): Promise<T> => {
    if (!localDebug) throw new Error("UNAVAILABLE: only a local world lets the debug surface place the player.");
    debugPlacements++;
    try { await localDebug({ op: "place", position, regionId, ...(facingRad === undefined ? {} : { facingRad }) }); }
    finally { debugPlacements--; }
    const result = then();
    await portalTransition.idle();
    const cover = acquireCover();
    try {
      await entityViews.retryHydration();
      await renderer.waitForInterior(renderer.scene);
    } finally { cover.release(); }
    // Resolve on a drawn frame of the new position, not the one the cover left on the canvas.
    const drawn = renderer.getPresentationState().submitted;
    await renderer.waitForFrame(drawn);
    return result;
  };
  api.register("quests", questSystem);
  api.register("bank", {
    op: (op, args) => {
      const result = bankSystem.op(op, args);
      gameAudio.handleBank(op, result.ok);
      return result;
    },
  });
  api.register("shop", {
    op: (op, args) => {
      const result = economySystem.op(op, args);
      gameAudio.handleTrade(op, result.ok);
      return result;
    },
  });
  // The host's clock, mirrored here on every update, is what a progress bar is measured against.
  api.register("activity", { summary: () => activitySummary(store.get().activity, clock.elapsedMs) });

  api.register("entities", {
    get: (id) => entityStore.get(id),
    all: () => entityStore.all(),
    observe: (filter, from) => entityStore.observe(filter, from),
  });
  api.register("interactions", {
    // Interactions are commands to the host. The page keeps the dispatcher for each verb's reach, which route planning reads.
    run: (id) => ({ ok: false as const, error: { code: "UNAVAILABLE" as const, message: "Interactions run on the world's host", entityId: id } }),
    rangeFor: (interaction, entityId) => interactions.rangeFor(interaction, entityId),
  });

  // Assistance overlays, and the guidance layer over them that turns a marker into a destination:
  // a ground route from the player, arrival, and the agent's plan and the pinned quest walking
  // their markers forward. Presentation only: drawing one never changes canonical state, which is
  // what makes it safe to let an agent write here. A dynamic import, like the agent surface and
  // for the same reason: the renderer and the ribbon shader are not the first frame's business.
  const labelRoot = document.getElementById("ui-root") ?? document.body;
  // Phone-sized and touch classes on the UI root. The stylesheet reads them for the layout; the
  // input layer is told through the subscription below once it exists.
  const mobileLayout = new MobileLayout(labelRoot);
  const { createGuidance } = await guidanceModule;
  const { overlays, guidance } = createGuidance({
    groundHeightAt: groundIndicatorHeight,
    scene,
    camera: renderer.camera,
    entityPosition: (entityId) => entityStore.get(entityId)?.position ?? null,
    labelRoot,
  }, {
    now: () => clock.elapsedMs,
    playerPosition: () => store.get().player.position,
    entityPosition: (entityId) => entityStore.get(entityId)?.position ?? null,
    planPath: (target) => api.planPath(target),
    overlay: (op, spec) => api.overlay(op, spec),
    emit: (type, data) => events.emit(type, data as Record<string, unknown>, undefined, clock.elapsedMs),
  });
  api.register("overlays", {
    set: (spec) => guidance.set(spec),
    clear: (id) => guidance.clear(id),
  });
  events.subscribe((event) => guidance.onEvent(event));

  // Combat and activity feedback, driven off the event stream rather than called by systems. That
  // keeps the dependency pointing one way, and it means an agent's action produces exactly the same
  // feedback as a human's because both travel through the same events.
  const vfx = new Vfx({
    camera: renderer.camera,
    root: labelRoot,
    parent: scene.overlayGroup,
    entityPosition: (entityId) => entityStore.get(entityId)?.position ?? null,
    playerPosition: () => store.get().player.position,
  });
  // VFX ages on the render clock in `GameLoop.renderFrame`, so birth stamps must use that same
  // clock. A sim-clock stamp makes every one-second event look several seconds old on arrival after
  // a long boot, and it disappears before its first rendered frame.
  events.subscribe((event) => vfx.handle(event, performance.now()));
  // The bolt starts when the cast is rolled, not when it lands. `systems/combat.ts` now holds the
  // damage back for the flight, so the hit log entry arrives at the far end and cannot be the cue.
  events.subscribe((event) => loop.handleSpellLaunch(event, performance.now()));
  events.subscribe((event) => gameAudio.handleEvent(event));

  // Standing atmosphere, as opposed to the event-driven feedback above. Both are polled from Vfx's
  // own update, so the loop needs no change. One InstancedMesh for the whole world.
  const ambience = new Ambience(scene.overlayGroup, { maxParticles: 640 });
  if (!worldMapCapture) renderer.compileEffects(ambience.preparationRoot());
  const creatureEffects = profile.kind === 'game' || wildernessCreaturesLab
    ? new WildernessCreatureEffects(scene.overlayGroup) : null;
  const emberCreatureFamilies = new Set(['cinderback_crag', 'furnace_grazer', 'basalt_maw',
    'baby_lava_dragon', 'ashseal_warden', 'furnace_regent']);
  if (creatureEffects) (window as any).__wildernessCreatureEffects = creatureEffects;
  vfx.setAmbience(ambience);
  if (profile.scatter) {
    for (const emitter of collectAmbienceEmitters(scene, built)) ambience.addEmitter(emitter);
  }
  const syncCampfireAmbience = (): void => {
    ambience.removeEmitter("player-campfire-flame");
    ambience.removeEmitter("player-campfire-smoke");
    const fire = store.get().world.campfire;
    if (!fire) return;
    ambience.addEmitter({
      id: "player-campfire-flame",
      kind: "flame",
      position: [fire.position[0], fire.position[1] + 0.22, fire.position[2]],
      count: 7,
      cullMetres: 70,
      scale: 0.72,
    });
    ambience.addEmitter({
      id: "player-campfire-smoke",
      kind: "smoke",
      position: [fire.position[0], fire.position[1] + 0.48, fire.position[2]],
      count: 4,
      cullMetres: 70,
      scale: 0.55,
    });
  };
  syncCampfireAmbience();
  events.subscribe((event) => {
    if (event.type === "campfire.built" || event.type === "campfire.replaced"
      || event.type === "campfire.expired") {
      syncCampfireAmbience();
    }
  });
  // A boss wind-up arrives as an event from the host. The ring is drawn from it until the slam event, or until its time is
  // up. Polled rather than pushed, because a telegraph has to keep drawing for the whole wind-up.
  const telegraphs = new Map<string, { centre: Vec3; radius: number; startedAtMs: number; firesAtMs: number }>();
  events.subscribe((event) => {
    if (event.type !== "combat.started") return;
    const data = event.data as Record<string, unknown>;
    const enemyId = String(data["enemyId"] ?? event.entityId ?? "");
    if (data["event"] === "boss.slam") telegraphs.delete(enemyId);
    if (data["event"] !== "boss.telegraph" || !Array.isArray(data["centre"]) || typeof data["radius"] !== "number" || typeof data["firesAtMs"] !== "number") return;
    telegraphs.set(enemyId, { centre: data["centre"] as unknown as Vec3, radius: data["radius"], startedAtMs: event.atMs, firesAtMs: data["firesAtMs"] });
  });
  vfx.setTelegraphSource(() => {
    for (const [id, telegraph] of telegraphs) if (clock.elapsedMs > telegraph.firesAtMs + 500) telegraphs.delete(id);
    return [...telegraphs].map(([id, telegraph]) => ({
      id, centre: telegraph.centre, radius: telegraph.radius,
      progress: telegraph.firesAtMs > telegraph.startedAtMs
        ? Math.min(1, Math.max(0, (clock.elapsedMs - telegraph.startedAtMs) / (telegraph.firesAtMs - telegraph.startedAtMs)))
        : 1,
    }));
  });

  // Documentation is generated from canonical runtime content on first use. Keeping the import and
  // index behind this promise means a player who never searches docs never requests or builds it.
  // Public knowledge only — hidden quest state never reaches this index.
  let docsPromise: Promise<import("../api/docs.js").DocSearch | null> | null = null;
  const loadDocs = (): Promise<import("../api/docs.js").DocSearch | null> => {
    docsPromise ??= import("../api/docs.js")
      .then(({ DocSearch, buildDocs }) => {
        const docs = new DocSearch();
        docs.build(buildDocs());
        return docs;
      })
      .catch((cause) => {
        errors.push({ atMs: atMs(), source: "docs", message: describeError(cause) });
        return null;
      });
    return docsPromise;
  };
  api.register("docs", {
    search: async (query, limit) => (await loadDocs())?.search(query, limit) ?? [],
  });

  // 15. Input.
  const WALK_DESTINATION_HIGHLIGHT_ID = "ui:walk-destination";
  const HOVER_HIGHLIGHT = "#e4bd62";
  const SELECTION_HIGHLIGHT = "#dbe5cf";
  let hoveredActionId: EntityId | null = null;
  let selectedEntityId: EntityId | null = null;

  const repaintEntityHighlight = (entityId: EntityId | null): void => {
    if (!entityId) return;
    entityViews.clearHighlight(entityId);
    if (entityId === selectedEntityId) {
      entityViews.setHighlight(entityId, SELECTION_HIGHLIGHT, false);
    } else if (entityId === hoveredActionId) {
      entityViews.setHighlight(entityId, HOVER_HIGHLIGHT, false);
    }
  };

  const input = new InputController(canvas, renderer, camera, api, movement, {
    // The drawn player, which runs ahead of the replicated one by the prediction.
    movementPosition: () => playerRig.root.position.toArray() as Vec3,
    onHoverChange: (entityId) => {
      const inspected = entityId ? api.inspect(entityId) : null;
      const next = inspected?.ok && inspected.value.interactions.length > 0 ? entityId : null;
      const previous = hoveredActionId;
      if (previous === next) return;

      hoveredActionId = next;
      repaintEntityHighlight(previous);
      repaintEntityHighlight(next);
    },
    onSelectionChange: (entityId) => {
      const previous = selectedEntityId;
      selectedEntityId = entityId;

      repaintEntityHighlight(previous);
      repaintEntityHighlight(entityId);
      if (entityId) {
        // An action target owns the outline. A ground highlight here would imply the click was only
        // movement, even when the API is walking into range before mining, talking, or attacking.
        overlays.clear(WALK_DESTINATION_HIGHLIGHT_ID);
      }
    },
    onWalkDestination: (point) => {
      overlays.setWalkDestination(WALK_DESTINATION_HIGHLIGHT_ID, point, clock.elapsedMs);
    },
    onDirectMoveStart: () => overlays.clear(WALK_DESTINATION_HIGHLIGHT_ID),
    onProduction: (entityId) => ui.openProduction(entityId),
  });
  input.setEntityPickSource((raycaster, context) => {
    let hit = entityViews.pickHit(raycaster, context);
    const mouthHit = raycaster.intersectObjects(portalPickMeshes.filter(object =>
      entityStore.get(object.userData["portalEntityId"])?.regionId === store.get().player.regionId), true)[0];
    if (mouthHit && (!hit || mouthHit.distance < hit.distance)) {
      let owner = mouthHit.object;
      while (!owner.userData["portalEntityId"] && owner.parent) owner = owner.parent;
      hit = { entityId: owner.userData["portalEntityId"] as EntityId, distance: mouthHit.distance };
    }
    if (!hit) return null;
    const { entityId } = hit;
    const position = entityViews.positionOf(entityId);
    if (!position) return null;
    return {
      entityId,
      point: [position.x, position.y, position.z] as Vec3,
      distance: hit.distance,
    };
  });
  input.configurePicking({ pickGround: (raycaster) => {
    const surfaces = dungeon && store.get().player.regionId === dungeonSpec?.regionId
      ? dungeon.walkable : terrainAt(store.get().player.position[0], store.get().player.position[2]).getWalkableMeshes();
    const hit = raycaster.intersectObjects(surfaces, false)[0];
    return hit ? { entityId: null, point: hit.point.toArray() as Vec3, distance: hit.distance, object: hit.object } : null;
  } });

  (window as Window & { __interactionFeedback?: unknown }).__interactionFeedback = {
    project: (point: Vec3) => {
      const p = new THREE.Vector3(...point).project(renderer.camera), rect = canvas.getBoundingClientRect();
      return [rect.left + (p.x + 1) * rect.width / 2, rect.top + (1 - p.y) * rect.height / 2];
    },
    pick: (x: number, y: number) => input.picker.pickAt(x, y),
    snapshot: () => {
      const roots: THREE.Object3D[] = [];
      scene.overlayGroup.traverse(object => {
        if (object.name === 'walk-destination' || object.name.startsWith('highlight-')) roots.push(object);
      });
      return { playerDrawn: playerRig.root.position.toArray(), markers: roots.map(root => {
        root.updateWorldMatrix(true, true);
        let groundError = 0, ringVertices = 0;
        const point = new THREE.Vector3();
        root.traverse(object => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh || (mesh.name !== 'ring' && mesh.name !== 'walk-ring')) return;
          const positions = mesh.geometry.getAttribute('position');
          ringVertices += positions.count;
          for (let i = 0; i < positions.count; i++) {
            point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
            groundError = Math.max(groundError, Math.abs(point.y - groundIndicatorHeight(point.x, point.z, root.position.y) - .025));
          }
        });
        return { name: root.name, visible: root.visible, ready: renderer.isInteriorReady(root),
          position: root.position.toArray(), groundError, ringVertices,
          children: root.children.map(child => child.name) };
      }) };
    },
  };

  let featureLab: FeatureLabApi | undefined;
  let environmentLab: import("../featureLab/environment.js").EnvironmentWorkbench | undefined;
  let creatureGallery: import("../featureLab/creatureGallery.js").CreatureGallery | undefined;
  let forestFixture: Awaited<ReturnType<typeof import("../featureLab/forest.js").createForestFixture>> | undefined;
  /**
   * The lab worker's two hooks. `describeLabWorld` is everything about the lab world that comes from
   * this scene, read once the scene is drawn and posted to the worker before the join. `startFeatureLab`
   * runs after the join: it builds the `__featureLab` runtime over the worker's operations.
   */
  /** Sim setup a lab fixture used to do inline at boot. It runs once the lab worker is joined and the runtime exists. */
  const labAfterJoin: ((lab: FeatureLabApi) => Promise<void>)[] = [];
  /** True once the lab worker's world is joined and its first snapshot is what this page shows. */
  let labJoined = false;
  let describeLabWorld: (() => import("../worker/labProtocol.js").LabWorldData) | null = null;
  let startFeatureLab: (() => Promise<void>) | null = null;
  let labSceneryChanged: (entities: readonly SemanticEntity[]) => void = () => {};
  /** One operation on the lab worker. Rejects until the lab session is joined. */
  const labOp = (op: import("../worker/labProtocol.js").LabOp): Promise<unknown> => {
    if (!localLaunch || !labSpec) return Promise.reject(new Error("UNAVAILABLE: this page has no lab worker"));
    return localLaunch.provider.debug(op);
  };
  if (profile.kind === "feature-lab") {
    // The workbench runtime is never used by the authored game. Keep it out of the critical game
    // bundle and load it only after a lab profile has been selected.
    const [{ createFeatureLabRuntime }, {
      DEFAULT_FEATURE_LAB_STRUCTURE_SELECTION,
      assembleFeatureLabStructure,
    }] = await Promise.all([
      import("../featureLab/runtime.js"),
      import("../featureLab/structures.js"),
    ]);
    const structureOrigin: Vec3 = [-8, scene.meshHeightAt(riverLab ? -21 : -8, 12), 12];
    let activeStructure: FeatureLabStructureAssembly | null = null;
    let activeStructureNavigation: THREE.Mesh[] = [];
    let activeStructureCamera: THREE.Mesh[] = [];
    let structureRevision = 0;
    let labFreeCameraEnabled = false;
    /** Collision as the lab has it now: the yard's own solids and the current structure's. The worker is sent this list. */
    let labSolids: readonly SolidVolume[] = built.solids;
    const labSessionJoined = (): boolean => labJoined;

    /**
     * Camera, input and rig follow the player back to the spawn. Joined, the worker has already put
     * the player there and this page's store shows it. Before the join there is no world yet, and
     * the spawn written here is only where the scene is first drawn from.
     */
    const resetLabPlayer = (): void => {
      const state = store.get();
      const landed: Vec3 = labSessionJoined() ? [...state.player.position] as Vec3 : [spawn[0], scene.meshHeightAt(spawn[0], spawn[2]), spawn[2]];
      if (!labSessionJoined()) {
        state.player.position = [...landed] as Vec3;
        state.player.regionId = spawnSpec.regionId;
        state.player.facingRad = spawnFacing;
      }
      input.clear();
      overlays.clear(WALK_DESTINATION_HIGHLIGHT_ID);
      camera.reset();
      camera.setPose(spawnFacing + Math.PI, CAMERA.defaultPitch, CAMERA.defaultDistance);
      camera.update(landed[0], landed[1], landed[2], true);
      scene.syncPlayer(landed, spawnFacing, true);
      if (rigged) playerRig.setPosition(landed, spawnFacing);
    };

    const replaceLabCollision = (
      structureSolids: readonly SolidVolume[],
      structureMeshes: readonly THREE.Mesh[],
      cameraMeshes: readonly THREE.Mesh[] = activeStructureCamera,
    ): void => {
      const allSolids = [...built.solids, ...structureSolids];
      const previousCarves = navCarves;
      const candidateCarves = solidObstacleMeshes(allSolids.map((solid) => encounterNavSolids.get(solid.id) ?? solid));
      for (const carve of previousCarves) carve.removeFromParent();
      for (const carve of candidateCarves) navCarveGroup.add(carve);
      navCarveGroup.updateMatrixWorld(true);
      if (!nav.build([
          ...navigationTerrain,
          ...(fairyRealm?.getWalkableMeshes() ?? []),
          ...(dungeon?.walkable ?? []),
          ...dungeonNavigationBlockers(dungeon?.blockers ?? []),
          ...structureNavigation.meshes,
        ...structureMeshes,
        ...candidateCarves,
      ])) {
        const reason = nav.snapshot(null, null, 0).error ?? "unknown";
        for (const carve of candidateCarves) disposeCarve(carve);
        for (const carve of previousCarves) navCarveGroup.add(carve);
        navCarveGroup.updateMatrixWorld(true);
        const restored = nav.build([
          ...navigationTerrain,
          ...(fairyRealm?.getWalkableMeshes() ?? []),
          ...(dungeon?.walkable ?? []),
          ...dungeonNavigationBlockers(dungeon?.blockers ?? []),
          ...structureNavigation.meshes,
          ...activeStructureNavigation,
          ...previousCarves,
        ]);
        nav.setRouteGraph(built.routeNodes, built.routeEdges);
        if (!restored) {
          const rollbackReason = nav.snapshot(null, null, 0).error ?? "unknown";
          throw new Error(
            `Feature-lab navigation rebuild failed: ${reason}; rollback failed: ${rollbackReason}`,
          );
        }
        throw new Error(`Feature-lab navigation rebuild failed: ${reason}`);
      }
      for (const carve of previousCarves) disposeCarve(carve);
      navCarves = candidateCarves;
      nav.setRouteGraph(built.routeNodes, built.routeEdges);

      cameraQueries.clearStatic();
      cameraQueries.addHeightfield(scene.heightfieldSamples());
      if (fairyRealm) cameraQueries.addHeightfield(fairyRealm.heightfieldSamples(1));
      for (const solid of allSolids) {
        if (solid.kind === "box") {
          cameraQueries.addStaticBox(
            [solid.position[0], solid.position[1] + solid.size[1] / 2, solid.position[2]],
            [solid.size[0] / 2, solid.size[1] / 2, solid.size[2] / 2],
            solid.rotationY,
            solid.id.includes("#") ? solid.id.split("#", 1)[0] : undefined,
          );
        } else {
          cameraQueries.addStaticCylinder(solid.position, solid.radius, solid.height);
        }
      }
      for (const mesh of [...structureNavigation.meshes, ...structureMeshes, ...(dungeon?.blockers ?? [])]) {
        cameraQueries.addStaticMesh(mesh);
      }
      for (const mesh of [...structureCamera.meshes, ...cameraMeshes]) cameraQueries.addStaticMesh(mesh);
      cameraQueries.setHiddenEntities(roofVisibility.hiddenEntities, roofVisibility.cutHeights);
      solids = new Solids(allSolids);
      labSolids = allSolids;
      structureMovementBounds = importedSurfaceBounds([...structureNavigation.meshes, ...structureMeshes]);
      movement.setPorts({ solids: movementSolids, heightAt: movementHeightAt, authoritativeGround: true, preserveNavigationHeight, entities: entityStore });
    };

    /** The page's navmesh, collision and walk surfaces as plain data. The bytes are a copy, because they are handed over. */
    const labGeometry = (): Pick<import("../worker/labProtocol.js").LabWorldData, "nav" | "solids" | "surfaceBounds"> => {
      const baked = nav.exportNavData();
      return {
        nav: { navData: baked.navData.slice(), strategy: baked.strategy, sourceMeshes: baked.sourceMeshes, sourceTriangles: baked.sourceTriangles, polyCount: baked.polyCount },
        solids: structuredClone([...labSolids]),
        surfaceBounds: structureMovementBounds.map(box => ({ min: box.min.toArray() as Vec3, max: box.max.toArray() as Vec3 })),
      };
    };
    /**
     * A render-side fixture (the environment showcase, the creature gallery) changed what stands in the lab. Before the join
     * that is only the scene the worker will be told about. Joined, the worker's world follows: the entities that are more
     * than scenery, and the collision and navmesh when the fixture rebuilt them.
     */
    const labWorldChanged = async (change: { remove: string[]; add: SemanticEntity[] }, geometry: boolean): Promise<void> => {
      if (!labJoined) return;
      const add = structuredClone(change.add.filter(entity => !isStaticScenery(entity)));
      await labOp(geometry ? { op: "lab.world", patch: { ...labGeometry(), removeEntities: change.remove, addEntities: add } } : { op: "lab.entities", remove: change.remove, add });
      labSceneryChanged(entityStore.all());
    };
    describeLabWorld = () => {
      // The sampler arrays are the scene's live ones, and the message hands its arrays over, so the worker gets copies.
      const sampler = (source: WorldScene): import("../world/terrainSampler.js").TerrainSamplerData => {
        const data = source.terrainSamplerData();
        return { ...data, lattice: { ...data.lattice, heights: data.lattice.heights.slice() }, coastGrid: data.coastGrid ? { ...data.coastGrid, heights: data.coastGrid.heights.slice() } : null };
      };
      const player = store.get().player;
      return {
        ...labGeometry(),
        terrain: sampler(scene), fairyTerrain: fairyRealm ? sampler(fairyRealm.scene) : null,
        dungeon: dungeonSpec ? structuredClone(dungeonSpec) : null,
        routeNodes: structuredClone(nav.listRouteNodes()), routeEdges: structuredClone(nav.listRouteEdges()),
        knownLocations: structuredClone(built.knownLocations), doorBarriers: structuredClone(doorThresholds.map(threshold => threshold.barrier)),
        habitats: structuredClone(worldHabitats),
        // Static scenery stays here: it is drawn, and its collision is already in `solids` and the navmesh.
        entities: structuredClone(entityStore.all().filter(entity => !isStaticScenery(entity))),
        trees: structuredClone(forestFixture?.trees ?? []),
        spawn: { position: [...player.position] as Vec3, regionId: player.regionId, facingRad: player.facingRad },
        assets: assets.measurements(),
        // The course carries a height function for its own assembly. The workbench reads its lanes and entities, which are data.
        fixtureData: agilityFixture ? { agility: JSON.parse(JSON.stringify({ entities: agilityFixture.entities, lanes: agilityFixture.lanes })) as unknown } : {},
      };
    };

    const disposeCarve = (carve: THREE.Mesh): void => {
      carve.removeFromParent();
      carve.geometry.dispose();
      const materials = Array.isArray(carve.material) ? carve.material : [carve.material];
      for (const material of materials) material.dispose();
    };

    const replaceStructure = async (
      selection: FeatureLabStructureSelection,
    ): Promise<FeatureLabStructureView> => {
      const started = performance.now();
      const architecture = new URLSearchParams(location.search).get("architecture");
      const next = assembleFeatureLabStructure(selection, structureOrigin, {
        baseY: (assetId) => assets.baseY(assetId),
        assetSize: (assetId) => assets.assetSize(assetId),
        assetCenterXZ: (assetId) => assets.assetCenterXZ(assetId),
      }, architecture === "gloamgarden" || architecture === "faeholme" ? architecture : undefined);
      const prepared = await entityViews.prepare(next.entities);
      if (prepared.missing.length > 0) {
        throw new Error(`Missing production structure assets: ${prepared.missing.join(", ")}`);
      }
      const nextStructureNavigation = await buildStructureNavigationSources(assets, next.entities);
      const nextStructureCamera = await buildStructureCameraSources(assets, next.entities);

      const previousEntities = activeStructure?.entities ?? [];
      const installEntities = (
        remove: readonly SemanticEntity[],
        add: readonly SemanticEntity[],
      ): void => {
        for (const entity of remove) entityStore.remove(entity.id);
        for (const entity of add) entityStore.add(entity);
        entityViews.sync(entityStore.all());
      };
      try {
        installEntities(previousEntities, next.entities);
      } catch (cause) {
        for (const entity of next.entities) entityStore.remove(entity.id);
        for (const entity of previousEntities) {
          if (!entityStore.get(entity.id)) entityStore.add(entity);
        }
        entityViews.sync(entityStore.all());
        throw cause;
      }
      try {
        replaceLabCollision(next.solids, nextStructureNavigation.meshes, nextStructureCamera.meshes);
      } catch (cause) {
        installEntities(next.entities, previousEntities);
        throw cause;
      }
      activeStructure = next;
      refreshWildernessEffects(next.entities);
      await wildernessEffects?.prepareArea(store.get().player.position[0], store.get().player.position[2],
        structureResidencyRadius(clientSettings.get().drawDistance));
      activeStructureNavigation = nextStructureNavigation.meshes;
      activeStructureCamera = nextStructureCamera.meshes;
      roofVisibility.setSources([...structureCamera.meshes, ...activeStructureCamera]);
      const structureUrl = new URL(window.location.href);
      structureUrl.searchParams.set("kind", next.selection.kind);
      structureUrl.searchParams.set("id", next.selection.id);
      structureUrl.searchParams.set("kit", next.selection.kit);
      structureUrl.searchParams.set("width", String(next.selection.width));
      structureUrl.searchParams.set("depth", String(next.selection.depth));
      structureUrl.searchParams.set("seed", String(next.selection.seed));
      window.history.replaceState(window.history.state, "", structureUrl.href);
      // The page has rebuilt its own navigation and collision for prediction and the camera. The
      // simulation is the worker's, so it gets the same navmesh, solids and walk surfaces, and the
      // structure's entities that are more than scenery (a station, an altar, an ore face).
      if (labSessionJoined()) {
        await labOp({ op: "lab.world", patch: { ...labGeometry(),
          removeEntities: previousEntities.filter(entity => !isStaticScenery(entity)).map(entity => entity.id),
          addEntities: structuredClone(next.entities.filter(entity => !isStaticScenery(entity))) } });
        labSceneryChanged(entityStore.all());
        await labOp({ op: "lab.resetPlayer" });
      }
      resetLabPlayer();

      let min: Vec3 | null = null;
      let max: Vec3 | null = null;
      for (const entity of next.entities) {
        const bounds = entityViews.drawnBounds(entity.id);
        if (!bounds) continue;
        min = min
          ? [Math.min(min[0], bounds.min[0]), Math.min(min[1], bounds.min[1]), Math.min(min[2], bounds.min[2])]
          : [...bounds.min] as Vec3;
        max = max
          ? [Math.max(max[0], bounds.max[0]), Math.max(max[1], bounds.max[1]), Math.max(max[2], bounds.max[2])]
          : [...bounds.max] as Vec3;
      }

      structureRevision += 1;
      return {
        ready: true,
        revision: structureRevision,
        selection: { ...next.selection },
        variant: next.variant,
        partCount: next.entities.length,
        assetCount: next.assetIds.length,
        collisionCount: next.solids.length,
        buildMs: performance.now() - started,
        bounds: min && max ? { min, max } : null,
      };
    };

    const fitStructure = async (view: FeatureLabStructureView): Promise<void> => {
      const current = activeStructure;
      if (!current) return;
      const bounds = view.bounds;
      const centreX = bounds ? (bounds.min[0] + bounds.max[0]) / 2 : structureOrigin[0];
      const centreZ = bounds ? (bounds.min[2] + bounds.max[2]) / 2 : structureOrigin[2];
      const spanX = bounds ? bounds.max[0] - bounds.min[0] : current.selection.width;
      const spanY = bounds ? bounds.max[1] - bounds.min[1] : STOREY_METRES;
      const spanZ = bounds ? bounds.max[2] - bounds.min[2] : current.selection.depth;
      const viewingDistance = Math.max(14, Math.min(40, Math.max(spanX, spanY * 1.4, spanZ) * 1.25));
      const frontZ = (bounds?.min[2] ?? centreZ - spanZ / 2) - Math.max(3, spanZ * 0.2);
      const point: Vec3 = [
        centreX,
        scene.meshHeightAt(centreX, frontZ),
        frontZ,
      ];
      if (labFreeCameraEnabled) {
        const focusY = bounds
          ? Math.max(scene.meshHeightAt(centreX, centreZ), (bounds.min[1] + bounds.max[1]) / 2 - 1.2)
          : scene.meshHeightAt(centreX, centreZ);
        camera.setFreeTarget([centreX, focusY, centreZ]);
        camera.setPose(Math.PI, 0.46, viewingDistance);
        camera.update(centreX, focusY, centreZ, true);
        return;
      }
      await debugPlace(point, spawnSpec.regionId, 0, () => {
        input.clear();
        scene.syncPlayer(point, 0, true);
        if (rigged) playerRig.setPosition(point, 0);
        camera.setPose(Math.PI, 0.46, viewingDistance);
        camera.update(point[0], point[1], point[2], true);
      });
    };

    const initialStructure: FeatureLabStructureView = {
      ready: false,
      revision: 0,
      selection: { ...DEFAULT_FEATURE_LAB_STRUCTURE_SELECTION },
      variant: null,
      partCount: 0,
      assetCount: 0,
      collisionCount: 0,
      buildMs: 0,
      bounds: null,
    };
    const initialWalkingEnabled = profile.labMode !== "building";
    const initialPlayerVisible = true;
    const initialFreeCameraEnabled = false;
    input.setMovementEnabled(initialWalkingEnabled);
    api.setMovementCommandsEnabled(initialWalkingEnabled);

    const params = new URLSearchParams(window.location.search);
    // The music stops are places to stand, and standing somewhere is the worker's to decide. The page follows the replicated position.
    musicLab?.createMusicWorkbench(point => { void debugPlace(nav.closestPoint(point) ?? point, "fallowmarch", undefined, () => {}); });
    if (params.get("atmosphere") === "1") {
      const { createBiomeAtmosphereWorkbench } = await import("../featureLab/biomeAtmosphere.js");
      createBiomeAtmosphereWorkbench(renderer.biomeAtmosphere);
    }
    // These four fixtures only ever wrote the simulation, so the lab worker hosts them (`worker/labDebug.ts`) and the page
    // keeps their window names as remote surfaces: every method is one `lab.call`, and returns a promise.
    const hostedFixture = (fixture: import("../featureLab/labSpec.js").LabRuntimeFixture): unknown => new Proxy({}, {
      get: (_target, method) => typeof method !== "string" || method === "then" ? undefined
        : (...args: unknown[]) => labOp({ op: "lab.call", fixture, method, args }),
    });
    if (labSpec?.runtime.includes("regionalTier")) (window as Window & { __regionalTierFixture?: unknown }).__regionalTierFixture = hostedFixture("regionalTier");
    if (labSpec?.runtime.includes("creatureLoot")) (window as Window & { __creatureLootFixture?: unknown }).__creatureLootFixture = hostedFixture("creatureLoot");
    if (doorLab && doorFixture && dungeonDoors) {
      (window as Window & { __dungeonDoorLab?: unknown }).__dungeonDoorLab = doorLab.createDungeonDoorWorkbench(doorFixture, {
        entities: entityStore, doors: dungeonDoors, playerPosition: () => store.get().player.position,
        setDoorState: (id, state) => labOp({ op: "lab.setEntityState", entityId: id, state }).then(() => true), navigation: nav,
      });
    }
    if (caveFixture) {
      (window as Window & { __caveLab?: unknown }).__caveLab = caveFixture;
      if (denseCavePopulation) (window as any).__denseCaveLab = {
        fixture: caveFixture, packs: denseCavePopulation.packs, spawn: denseCavePopulation.spawn,
      };
    }
    if (shopFixture) {
      (window as Window & { __shopLab?: unknown }).__shopLab = shopFixture;
    }
    if (portalFixture) {
      (window as Window & { __portalLab?: unknown }).__portalLab = portalFixture;
    }
    if (new URLSearchParams(location.search).get('smartLoading') === '1') {
      const { createSmartLoadingLab } = await import('../featureLab/smartLoading.js');
      (window as any).__smartLoadingLab = await createSmartLoadingLab(scene, assets, playerRig);
    }
    if (packFixture) {
      (window as Window & { __packLab?: unknown }).__packLab = {
        packId: packFixture.packId, ids: packFixture.entities.map((entity) => entity.id),
        habitat: packFixture.habitat, spawn: packFixture.spawn,
      };
    }
    if (agilityLabModule && agilityFixture) {
      // The workbench reads and writes the character, the quest log and the random cursor, all of which are the worker's.
      // It runs there, over the course this page assembled and sent along with the lab world.
      const agilityWorkbench = hostedFixture("agility") as import("../featureLab/agilityWorkbench.js").RemoteAgilityWorkbench;
      (window as Window & { __agilityLab?: unknown }).__agilityLab = agilityWorkbench;
      const { mountAgilityWorkbench } = await import("../featureLab/agilityWorkbench.js");
      labAfterJoin.push(async () => {
        await mountAgilityWorkbench(agilityWorkbench, {
          interact: (id, verb) => sendGameCommand(api, "interact", id, verb),
          moveTo: (target) => sendGameCommand(api, "moveTo", target),
          stop: () => sendGameCommand(api, "stop"),
        });
      });
    }
    const frameLabBounds = (bounds: { min: Vec3; max: Vec3 }, detail = false): void => {
          const x = (bounds.min[0] + bounds.max[0]) / 2;
          const z = (bounds.min[2] + bounds.max[2]) / 2;
          const y = (bounds.min[1] + bounds.max[1]) / 2 - 1.2;
          labFreeCameraEnabled = true;
          input.setFreeCameraEnabled(true);
          camera.setFreeTarget([x, y, z]);
          const size = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]);
          camera.setPose(0.35, detail ? 0.52 : 0.38, Math.max(detail ? 1.5 : 5, size * (detail ? 1.25 : 1.65)), detail ? 1.5 : undefined);
          camera.update(x, y, z, true);
    };
    if (params.get("environment") === "1") {
      const [{ createEnvironmentWorkbench }, { EnvironmentLabPanel }] = await Promise.all([
        import("../featureLab/environment.js"), import("../ui/environmentLabPanel.js"),
      ]);
      environmentLab = await createEnvironmentWorkbench({ assets, scene, entityStore, entityViews,
        replaceCollision: (solids) => replaceLabCollision([...(activeStructure?.solids ?? []), ...solids], activeStructureNavigation),
        worldChanged: (change) => labWorldChanged(change, true),
      });
      new EnvironmentLabPanel(environmentLab, { onFrame: frameLabBounds });
    }
    if (labSpec?.runtime.includes("progression")) (window as Window & { __questRecoveryLab?: unknown }).__questRecoveryLab = hostedFixture("progression");
    if (labSpec?.runtime.includes("gameplay")) (window as Window & { __gameplayAcceptance?: unknown }).__gameplayAcceptance = hostedFixture("gameplay");
    if (params.get("creatures") === "1") {
      const [{ createCreatureGallery }, { CreatureGalleryPanel }] = await Promise.all([
        import("../featureLab/creatureGallery.js"), import("../ui/creatureGalleryPanel.js"),
      ]);
      creatureGallery = await createCreatureGallery({ assets, scene, entityStore, entityViews, worldChanged: (change) => labWorldChanged(change, false) });
      new CreatureGalleryPanel(creatureGallery, { onFrame: frameLabBounds });
    }
    if (params.get("forest") === "1") {
      forestFixture = await (await import("../featureLab/forest.js")).createForestFixture({ assets, scene, registerTree: registerForestTree });
      await entityViews.prepare(entityStore.all());
      entityViews.sync(entityStore.all());
      // The hatchet is the worker's to hand out: `character.forestHatchet` of the lab spec.
    }
    const presentation = params.get("presentation") === "1"
      ? await (await import("../featureLab/presentation.js")).createPresentationFixture({
        assets, scene, entityStore, entityViews,
        rebuilt: params.get("environment") === "1",
      })
      : undefined;

    // The initial structure is part of the scene the worker is told about, so it is assembled before the join, page side
    // only. Every later `setStructure` goes through the same function and then to the worker.
    const structurePatch: Partial<FeatureLabStructureSelection> = {};
    const sourceKind = params.get("kind");
    if (sourceKind === "prefab" || sourceKind === "composition" || sourceKind === "wall-run") {
      structurePatch.kind = sourceKind;
    }
    const structureId = params.get("id");
    if (structureId) structurePatch.id = structureId;
    const structureKit = params.get("kit");
    if (structureKit === "plaster" || structureKit === "timber" || structureKit === "stone") {
      structurePatch.kit = structureKit;
    }
    for (const key of ["width", "depth", "seed"] as const) {
      const value = params.get(key);
      if (value !== null) structurePatch[key] = Number(value);
    }
    const openingStructure = await replaceStructure({ ...DEFAULT_FEATURE_LAB_STRUCTURE_SELECTION, ...structurePatch });

    {
      const runtime = createFeatureLabRuntime({
        api,
        store,
        events,
        clock,
        assets,
        entityStore,
        entityViews,
        lab: labOp,
        playerRig,
        playerRigReady: rigged,
        canvas,
        camera: renderer.camera,
        spawn,
        spawnRegionId: spawnSpec.regionId,
        initialMode: profile.labMode ?? "combat",
        initialWalkingEnabled,
        initialPlayerVisible,
        initialFreeCameraEnabled,
        initialStructure: openingStructure,
        ...(presentation ? { presentation } : {}),
        replaceStructure,
        setWalkingEnabled: (enabled) => {
          input.setMovementEnabled(enabled);
          api.setMovementCommandsEnabled(enabled);
        },
        setPlayerVisible: (visible) => {
          playerRig.root.visible = visible;
        },
        setFreeCameraEnabled: (enabled) => {
          labFreeCameraEnabled = enabled;
          input.setFreeCameraEnabled(enabled);
          const player = store.get().player.position;
          camera.setFreeTarget(enabled ? player : null);
          camera.update(player[0], player[1], player[2], true);
        },
        reloadMode: (nextMode) => {
          const url = new URL(window.location.href);
          url.searchParams.set("mode", nextMode);
          window.location.assign(url.href);
        },
        fitStructure,
        presentPlayerReset: resetLabPlayer,
        selectedEntityId: () => selectedEntityId,
        liveSpellParticles: () => spellVfx.liveParticles(),
        engineErrors: () => errors.map((entry) => `${entry.source}: ${entry.message}`),
        groundHeightAt: (x, z) => terrainAt(x, z).meshHeightAt(x, z),
      });
      // The panel and the equipment picker hold this from the moment the interface is built. It answers reads at once and
      // `ready: false` until the lab worker's world is joined and `start` has set the character up.
      featureLab = runtime;
      startFeatureLab = async () => {
      await runtime.start();
      if (profile.labMode !== "building") {
        const creatures = runtime.getCatalog().targets.creature;
        const requestedCreature = params.get("creature");
        const initialTarget = (requestedCreature
          ? creatures.find((entry) => entry.id === requestedCreature || entry.id === `species:${requestedCreature}`)
          : undefined) ?? creatures[0];
        if (!initialTarget) throw new Error("The production content has no creature for the feature lab");
        await runtime.spawnTarget("creature", initialTarget.id);
      }
      for (const task of labAfterJoin) await task(runtime);
      };
    }
  }
  // Published at the final ready boundary below. Test and authoring clients treat the presence of
  // this API as proof that the shared renderer and debug surface are ready too.
  delete window.__featureLab;
  // There is exactly ONE KeyboardController, and `InputController` owns it. A second one used to
  // stand here: both listened on `window`, both dispatched the same keydown through the same
  // shared registry, and every panel key therefore fired twice — open, then closed, in one press.
  // Movement still worked (held keys are a set, so adding twice is adding once), which is why the
  // panels looked unbound rather than double-bound and no screenshot in Phase 1 ever showed one.

  // The agent surface. Always installed at window.corealm.agent, and registered with whichever
  // model-context container the browser provides — none, if the browser has none, and the panel
  // says so. One implementation, three ways in. Installed before the UI because the UI's agent
  // panel is a view onto the session, and before the ready boundary because a browser agent reads
  // the tool list as soon as the page is up. Loaded like the feature lab and the debug surface —
  // a dynamic import off the critical path — because the descriptors alone are a few tens of
  // kilobytes the first frame does not need; the handlers behind them load on the first call.
  //
  // Control handoff locks HUMAN input only. `api.setMovementCommandsEnabled(false)` would also
  // refuse the agent's own `corealm_move_to`, which is the opposite of handing it the keys.
  const version = { build: "phase1-round2", contracts: "5", content: "1" };
  const { installAgentSurface } = await agentModule;
  const agent = installAgentSurface(api, {
    version,
    now: () => clock.elapsedMs,
    emit: (type, data) => events.emit(type, data as Record<string, unknown>, undefined, clock.elapsedMs),
    onControlOwnerChanged: (owner) => {
      input.setMovementEnabled(owner === "player");
      if (owner === "agent") ui.notify("The agent has control. Take control or Stop from the agent panel.", "info");
      else ui.notify("You have control.", "info");
    },
  });
  // The plan the agent proposes is drawn, and walked forward, by the guidance layer.
  guidance.attachSession(agent.session);

  // The human UI. Everything it does goes through GameApi, the same object the agent tools call.
  const uiConstructionSpan = bootTelemetry.startSpan(BOOT_SPANS.UI_CONSTRUCTION);
  const lootProjection = new THREE.Vector3();
  // The ground reticle for placing area invocations. It reads the same walkable-mesh picker
  // click-to-move uses, so "where the ring is" and "where a click would walk" never disagree.
  const aimReticle = new AimReticle(scene.overlayGroup, (x, z) => terrainAt(x, z).meshHeightAt(x, z));
  const spellRangeLab = profile.kind === "feature-lab" && new URLSearchParams(location.search).get("spells") === "1";
  const makeMapSource = (source: WorldScene): import('../ui/panels.js').MapTerrainSource => ({
    bounds: source.getScatterBounds(Infinity), renderMode: 'live',
    sample: (x, z) => ({ height: source.meshHeightAt(x, z), normal: source.normalAt(x, z), regionId: source.regionAt(x, z) }),
    roadPolylines: () => source.getRoadPolylines(),
  });
  const surfaceMapSource: import('../ui/panels.js').MapTerrainSource = {
    ...makeMapSource(scene), renderMode: profile.kind === 'game' ? 'baked' : 'live',
  };
  const fairyMapSource = fairyRealm ? makeMapSource(fairyRealm.scene) : surfaceMapSource;
  const ui = createUi(api, {
    areaAim: {
      pickGround: (clientX, clientY) => input.picker.pickGroundAt(clientX, clientY)?.point ?? null,
      show: (radius, element) => aimReticle.show(radius, element),
      move: (point, inRange) => aimReticle.move(point, inRange),
      hide: () => aimReticle.hide(),
    },
    // The spell range mounts its own bar with range semantics over the same slot.
    actionBars: !spellRangeLab,
    settings: clientSettings,
    mapTerrain: {
      ...surfaceMapSource,
      renderMode: 'live',
      forRegion: (regionId) => isFairyRegion(regionId) ? fairyMapSource : surfaceMapSource,
      bounds: scene.getScatterBounds(Infinity),
      sample: (x, z) => ({
        height: terrainAt(x, z).meshHeightAt(x, z),
        normal: scene.normalAt(x, z),
        regionId: scene.regionAt(x, z),
      }),
      roadPolylines: () => scene.getRoadPolylines(),
    },
    projectWorldToScreen: (position) => {
      lootProjection.set(position[0], position[1], position[2]).project(renderer.camera);
      const bounds = canvas.getBoundingClientRect();
      return {
        x: bounds.left + (lootProjection.x + 1) * bounds.width / 2,
        y: bounds.top + (1 - lootProjection.y) * bounds.height / 2,
        visible: Number.isFinite(lootProjection.x)
          && Number.isFinite(lootProjection.y)
          && lootProjection.x >= -1
          && lootProjection.x <= 1
          && lootProjection.y >= -1
          && lootProjection.y <= 1
          && lootProjection.z >= -1
          && lootProjection.z <= 1,
      };
    },
    // OrbitCamera yaw is measured from +z clockwise; the compass wants a heading in the same frame.
    getHeadingRad: () => camera.yaw,
    // The minimap's destination marker. GameApi does not expose the live path; the store does.
    getDestination: () => store.get().player.movement.destination,
    // A character is its host's. Only the local world can be asked for a new one; a server decides that for its players.
    hasSave: () => localSession(),
    onNewGame: () => { if (localSession() && localDebug) void localDebug({ op: "reset" }).then(presentationReset); },
    ...(featureLab ? { featureLab } : {}),
    agentSession: agent.session,
  });
  openLootContainer = (container) => ui.openLoot(container);
  events.subscribe(event=>{if(event.type==="loot.opened")openLootContainer?.(event.data.container as unknown as LootContainerView);});
  ui.mount(labelRoot);
  // The pinned quest's current objective is a marker in the world; it follows the quest's stages.
  guidance.attachQuests({ pinnedQuestId: () => ui.pinnedQuestId(), quests: () => api.getQuests() });
  api.subscribePendingResult(({ result }) => {
    if (!result.ok) ui.notify(result.error.message, "error");
  });
  uiConstructionSpan.end();
  bootTelemetry.milestone(BOOT_MILESTONES.UI_READY);

  // UI sound follows semantic activation, so pointer clicks and keyboard-generated clicks share
  // one path. Canvas clicks are excluded: world actions have their own material-specific cues.
  labelRoot.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("button, [role='button'], input[type='range'], select")
      : null;
    if (!target || target.matches(":disabled, [aria-disabled='true']")) return;
    gameAudio.playUi("ui.click");
  }, { capture: true });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.repeat) gameAudio.playUi("ui.cancel");
  }, { capture: true });

  // Client preferences. Each one is applied here, and each one changes something on the next frame
  // — see the note in ui/settings.ts about why a setting that does nothing is worse than none.
  let appliedPreferences: UiSettings | null = null;
  ui.settings.subscribe((preferences) => {
    const previous = appliedPreferences;
    if (!previous
      || previous.music !== preferences.music
      || previous.ambient !== preferences.ambient
      || previous.sfx !== preferences.sfx) {
      audioEngine.setVolumes({
        music: preferences.music,
        ambient: preferences.ambient,
        sfx: preferences.sfx,
      });
    }
    if (!previous || previous.renderScale !== preferences.renderScale) {
      renderer.setRenderScale(preferences.renderScale);
    }
    if (!previous || previous.shadowQuality !== preferences.shadowQuality) {
      renderer.setShadowQuality(preferences.shadowQuality);
    }
    if (!previous || previous.drawDistance !== preferences.drawDistance) {
      renderer.setDrawDistance(preferences.drawDistance);
      entityViews.updateStructureRadius(structureResidencyRadius(preferences.drawDistance));
      if (runtimePerformanceEnabled) entityViews.updateActorRadius(structureResidencyRadius(preferences.drawDistance));
      scene.setStreamingRadius(fogOpaqueMetres(preferences.drawDistance) + CAMERA.maxDistance);
      fairyRealm?.scene.setStreamingRadius(fogOpaqueMetres(preferences.drawDistance) + CAMERA.maxDistance);
      if (debugReady) refreshVisualResidency(store.get().player.position, store.get().player.regionId, true);
    }
    if (!previous || previous.autoDrawDistance !== preferences.autoDrawDistance
      || previous.renderScale !== preferences.renderScale || previous.shadowQuality !== preferences.shadowQuality) {
      adaptiveDistance.reset(preferences.drawDistance);
    }
    if (!previous || previous.invertCameraY !== preferences.invertCameraY) {
      camera.invertPitch = preferences.invertCameraY;
    }
    if (!previous || previous.damageNumbers !== preferences.damageNumbers) {
      vfx.damageNumbers = preferences.damageNumbers;
    }
    if (!previous || previous.uiScale !== preferences.uiScale) {
      labelRoot.classList.toggle("is-compact", preferences.uiScale === "compact");
    }
    if (!previous || previous.touchControls !== preferences.touchControls) {
      mobileLayout.setTouchPreference(preferences.touchControls);
    }
    if (!previous || previous.joystickSide !== preferences.joystickSide) {
      // Right-handed by default; the stylesheet reads the class, as it does for compact density.
      labelRoot.classList.toggle("stick-left", preferences.joystickSide === "left");
    }
    appliedPreferences = preferences;
  });
  // Touch play follows the resolved layout, not the raw preference: "auto" can change under a
  // running game when the browser's primary pointer does (a tablet docking, DevTools emulation).
  mobileLayout.subscribe((layout) => {
    input.setTouchControls(layout.touch);
  });
  if (runtimePerformanceEnabled) {
    (window as Window & { __renderDistanceLab?: unknown }).__renderDistanceLab = {
      getState: () => ({ settings: clientSettings.get(), residency: entityViews.residencyStats(), scatter: scatterStreaming.getResidency() }),
      set: (patch: Partial<UiSettings>) => clientSettings.set(patch),
      caveState: () => deferredCave ? { ...deferredCave.getState(),
        drawable: !!dungeon && deferredCave.getState().ready && renderer.isInteriorReady(dungeon.group) } : null,
      loadCave: () => deferredCave?.ensure(),
      shaders: () => renderer.streamingShaderState(),
      ...(performanceLab ? {
        watchCreatureVisibility: async (entityId: string) =>
          (await import("../featureLab/actorVisibilityProbe.js")).watchActorVisibility(renderer.scene, entityId),
        addRefractionFixture: async (useBiomeSky = false, reflective = false) => {
          if (useBiomeSky) renderer.biomeAtmosphere.setPreview("fallowmarch");
          await assets.load("corealm_water_trough");
          const trough = assets.instance("corealm_water_trough");
          if (reflective) trough.traverse(object => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.material = Array.isArray(mesh.material)
              ? mesh.material.map(material => scene.materials.forContainedTrough("corealm_water_trough", material))
              : scene.materials.forContainedTrough("corealm_water_trough", mesh.material);
          });
          trough.position.set(-3, 0, 3);
          scene.root.add(trough);
          trough.visible = false;
          await renderer.warmup({ temporarilyVisible: [trough] });
          return { reveal: () => { trough.visible = true; }, hide: () => { trough.visible = false; } };
        },
      } : {}),
    };
  }

  // A killed enemy stops being something the player has selected.
  //
  // `systems/combat.ts killEnemy` already clears `state.combat.targetId`, but the CURSOR selection
  // is a separate thing owned by the input controller, and nothing was clearing it. The ring stayed
  // lit on the body, the cursor kept offering "Attack" over it, and once the corpse dissolved the
  // ring was left drawn on bare grass.
  events.subscribe((event) => {
    if (event.type !== "combat.ended") return;
    const data = event.data as Record<string, unknown>;
    if (data["reason"] !== "killed") return;
    const enemyId = (data["enemyId"] ?? event.entityId) as EntityId | undefined;
    if (!enemyId) return;
    input.forget(enemyId);
    entityViews.clearHighlight(enemyId);
  });

  // Bank and shop interactions publish an instantaneous activity signal rather than storing a
  // timed activity. Open their panels from that shared signal so every input path behaves alike.
  events.subscribe((event) => {
    if (event.type !== "activity.started" || !event.entityId) return;
    const entity = entityStore.get(event.entityId);
    if (entity?.archetype === "bank") ui.openBank(entity.id);
    else if (entity?.archetype === "shop") ui.openShop(entity.id);
  });

  // Dialogue and death both have real events, so the windows follow the game rather than the click
  // that caused it: a conversation opened by a mouse click, by the context menu, or by an agent
  // calling `corealm_interact` all raise the same window.
  events.subscribe((event) => {
    // An old route's queued completion/cancellation cannot erase newer click or held-move feedback.
    if ((event.type === "navigation.completed" || event.type === "navigation.failed")
      && store.get().player.movement.mode === "idle") {
      overlays.clear(WALK_DESTINATION_HIGHLIGHT_ID);
    }
    if (event.type === "dialogue.opened") ui.openDialogue();
    else if (event.type === "dialogue.closed" && !store.get().dialogue) ui.closeDialogue();
    else if (event.type === "player.died") {
      camera.setFreeTarget(null);
      camera.update(...store.get().player.position, true);
      const data = event.data as Record<string, unknown>;
      ui.showDeath({
        position: (data["position"] ?? [0, 0, 0]) as [number, number, number],
        regionId: String(data["regionId"] ?? ""),
        respawnPosition: (data["respawnPosition"] ?? [0, 0, 0]) as [number, number, number],
        respawnPointId: String(data["respawnPointId"] ?? ""),
        cacheId: typeof data["cacheId"] === "string" ? data["cacheId"] : null,
        itemsLost: Number(data["itemsLost"] ?? 0),
      });
    }
  });

  // The pause menu, on the last Escape.
  //
  // Priority 950 puts it after `input.cancel` at 900. Escape closes the top panel if one is open.
  // Otherwise it cancels the current activity and continues here, so one press always reaches the
  // pause menu from ordinary play.
  keybindings.register({
    id: "ui.menu",
    keys: ["escape"],
    label: "Pause menu",
    group: "General",
    priority: 950,
    onDown: () => {
      ui.openTitle();
      return true;
    },
  });

  if (fairyPortalFixture) createFairyPortalWorkbench(fairyPortalFixture, {
    interact: id => api.interact(id, 'enter'), player: () => store.get().player,
  });
  const loop = new GameLoop({
    store, events, clock, renderer, camera, scene, input,
  });
  // The Gravelmaw chambers are authored a few metres below the surface, right beside the entrance,
  // so rendering every entity unconditionally drew the whole dungeon population on top of the
  // terrace. That single pose measured 803 draw calls against a 400 budget. The dungeon is only
  // visible from inside it.
  if (dungeon) loop.addInterior(dungeon.group, () => store.get().player.regionId === "gravelmaw");
  if (portalFixture || dungeon || fairyRealm) {
    loop.addInterior(scene.scatterGroup, () => worldMapForRegion(store.get().player.regionId) === "surface");
    loop.addInterior(scene.terrainGroup, () => worldMapForRegion(store.get().player.regionId) === "surface");
    for (const object of scene.root.children) {
      if (object.userData["portalInterior"]) loop.addInterior(object, () => store.get().player.regionId === "gravelmaw");
    }
  }
  if (fairyRealm) loop.addInterior(fairyRealm.scene.root, () => isFairyRegion(store.get().player.regionId));
  // What the player is interacting with, so the rig can pick a pose for it: opening a chest is not
  // the same animation as swinging at a rock.
  loop.setArchetypeLookup((id) => entityStore.get(id)?.archetype ?? null);
  loop.setOverlays(guidance);
  loop.setVfx(vfx);
  if (profile.kind === 'game' || riverLab || wildernessEffectsLab || wildernessTorchesLab || wildernessCreaturesLab) loop.setEnvironmentEffects({
    update: (seconds, viewCamera) => {
      wildernessEffects?.setEnabled(worldMapForRegion(store.get().player.regionId) === 'surface');
      wildernessEffects?.update(seconds, viewCamera);
      riverSurface?.update(seconds);
      if (creatureEffects) {
        const emitters: WildernessCreatureEmitter[] = [];
        for (const entity of entityViews.residentActors()) {
          if (entity.state !== 'alive' || entity.tier < 50 || !entity.combat) continue;
          if (!wildernessCreaturesLab && (entity.regionId !== 'wilderness'
            || (entity.tier < 70 && !emberCreatureFamilies.has(String(entity.meta?.family))))) continue;
          const position = entityViews.positionOf(entity.id);
          if (!position) continue;
          const body = entity.combat.bodyRadius ?? 1;
          emitters.push({ id: entity.id, position: { x: position.x, y: position.y, z: position.z },
            scale: Math.max(.7, Math.min(2.4, body / 1.2)), hero: entity.archetype === 'boss',
            palette: entity.tier >= 70 ? 'arcane' : 'ember' });
        }
        creatureEffects.update(seconds, viewCamera, emitters);
      }
    },
    dispose: () => { wildernessEffects?.dispose(); creatureEffects?.dispose(); riverSurface?.dispose(); },
  });
  loop.setSpellVfx(spellVfx);
  if (profile.kind === "feature-lab" && profile.labMode === "combat" && new URLSearchParams(location.search).get("spells") === "1") {
    const { createSpellRange } = await import("../featureLab/spellRange.js");
    const rangeSpawn: Vec3 = [20, scene.meshHeightAt(20, 28), 28];
    // The range is drawn here. Standing the player on it and dressing them is the worker's, so it waits for the join.
    labAfterJoin.push(async (lab) => {
      lab.setWalkingEnabled(true);
      await debugPlace(rangeSpawn, store.get().player.regionId, 0, () => {});
      // Production robe and staff, through the same equipment path as the combat workbench.
      // The lab worker keeps nothing; this fixture never changes a saved character.
      await lab.equipPlayer("offHand", null);
      for (const [slot, item] of [
        ["head", "marchhide_hood"], ["body", "marchhide_robe"],
        ["legs", "marchhide_leggings"], ["feet", "marchhide_boots"],
        ["hands", "marchhide_wraps"], ["mainHand", "basic_wooden_staff"],
      ] as const) await lab.equipPlayer(slot, item);
      if (rigged) await playerRig.applyEquipment(store.get().equipment);
    });
    const range = createSpellRange({
      parent: scene.overlayGroup,
      camera: renderer.camera,
      ground: (x, z) => terrainAt(x, z).meshHeightAt(x, z),
      origin: () => store.get().player.position,
      frame: (aim) => {
        featureLab?.setFreeCameraEnabled(false);
        const at = store.get().player.position;
        const yaw = Math.atan2(aim[0] - at[0], aim[2] - at[2]) + Math.PI;
        camera.setFreeTarget(null);
        camera.setPose(yaw + 0.3, 0.35, CAMERA.maxDistance);
        camera.update(at[0], at[1], at[2], true);
      },
      castPose: (rank, speed) => {
        const at = store.get().player.position;
        // Presentation only: the range casts are drawn by this page and never reach the worker, so the rig is turned on
        // this page's copy of the player. The worker's next word on the player puts its own facing back.
        store.get().player.facingRad = Math.atan2(20 - at[0], 40 - at[2]);
        if (rigged) playerRig.play("cast", true, (rank < 2 ? 1.15 : rank < 4 ? .85 : .65) * speed);
      },
      castingFocus: () => rigged ? playerRig.castingFocus() : undefined,
    });
    loop.setSpellRangeFrame((now) => range.update(now));
  }
  // Health bars over the player and every engaged creature. They read the same two combat fields
  // the API folds into `inCombat`, and anchor to the DRAWN creature, not its sim position, so a
  // bar over a chasing wolf slides with the wolf rather than stepping ten times a second.
  const playerRigBox = new THREE.Box3();
  const healthBars = new HealthBars({
    camera: renderer.camera,
    root: labelRoot,
    entity: (entityId) => entityStore.get(entityId) ?? null,
    drawnPosition: (entityId) => {
      const drawn = entityViews.positionOf(entityId);
      return drawn ? [drawn.x, drawn.y, drawn.z] : null;
    },
    drawnTop: (entityId) => {
      const drawn = entityViews.positionOf(entityId);
      const bounds = entityViews.drawnBounds(entityId);
      return drawn && bounds ? bounds.max[1] - drawn.y : null;
    },
    // The rig's own box, not `PLAYER_HEIGHT`: the drawn head is lower than the configured capsule
    // top, and a bar measured from the constant hung a hand's width above it.
    playerTop: () => {
      if (!rigged || !playerRig.root.visible) return null;
      playerRigBox.setFromObject(playerRig.root);
      return playerRigBox.isEmpty() ? null : playerRigBox.max.y - playerRig.root.position.y;
    },
    player: () => {
      const state = store.get();
      return {
        health: state.player.health, maxHealth: state.player.maxHealth,
        targetId: state.combat.targetId, engagedBy: state.combat.engagedBy,
      };
    },
  });
  loop.setHealthBars(healthBars);
  window.addEventListener("pagehide", (event) => { if (event.isTrusted && !event.persisted) loop.dispose(); });
  loop.setCombatPresentationHandler((hit, phase) => gameAudio.handlePlayerCombatMotion(hit, phase));
  loop.setPlayerMotionHandler((event) => {
    if (event.kind === "footstep") {
      gameAudio.handleFootstep();
    } else if (event.pose === "mine" || event.pose === "chop") {
      gameAudio.handleGatherMotion(event.pose, event.kind);
    }
  });
  loop.setUi(ui);
  loop.setFrameObserver((frameMs) => {
    assets.reportFrame(frameMs);
    const next = adaptiveDistance.sample(frameMs, runtimePerformanceEnabled && debugReady
      && clientSettings.get().autoDrawDistance && !document.hidden && !clock.paused
      && store.get().player.regionId !== "gravelmaw",
      movement.getSpeedMps() > 0.1);
    if (next) clientSettings.set({ drawDistance: next });
  });
  if (rigged) loop.setPlayerRig(playerRig);
  let preparedItemKey = immediatePlayerItems(store.get()).join('\0');
  let itemRetryAt = 0;
  const refreshCarriedAssets = (): void => {
    if (!rigged || performance.now() < itemRetryAt) return;
    const items = immediatePlayerItems(store.get()), key = items.join('\0');
    if (key === preparedItemKey) return;
    preparedItemKey = key;
    void playerRig.prepareItems(items).catch(cause => {
      if (preparedItemKey === key) preparedItemKey = '';
      itemRetryAt = performance.now() + 3000;
      errors.push({ atMs: atMs(), source: 'playerAssets.items', message: describeError(cause) });
    });
  };
  loop.setEntityViews(entityViews, () => {
    return entitiesForVisualRegion(store.get().player.regionId);
  }, () => {
    refreshCarriedAssets();
    // Boot's frames run before it has prepared the joined position; the end of boot follows the
    // player. Moving the working set here first would skip that position's preparation for good.
    if (profile.kind === "feature-lab" || !debugReady) return;
    followPlayer(false);
  }, () => forestPresentation.reconcile((id) => entityViews.hasView(id)));
  ui.setHuntContracts(huntContractsView(hunts, api));

  let capturePreviousPause = false;
  let capturePreviousRunning = false;

  /**
   * Places the camera around a documentation subject without adding a second camera system.
   * The normal orbit camera still owns projection, occlusion, region streaming, and rendering.
   */
  const frameDocumentationTarget = (
    target: Vec3,
    yaw: number,
    pitch: number,
    distance: number,
    reason: string,
    playerTarget: Vec3 = target,
    playerFacingRad = yaw + Math.PI,
  ): void | Promise<void> => {
    const landed = nav.closestPoint(playerTarget) ?? playerTarget;
    const regionId = regionAtPoint(landed);
    return debugPlace(landed, regionId, playerFacingRad, () => {
      movement.stop(store.get(), clock.elapsedMs, reason);
      // Documentation poses may deliberately move inside the player-facing comfort zoom floor so a
      // held item can be inspected. Interactive mouse-wheel zoom still keeps CAMERA.minDistance.
      camera.setPose(yaw, pitch, distance, 2);
      landView(landed, playerFacingRad, regionId, target);
      // A lab shows every entity it placed, whichever map it stands on.
      if (profile.kind === "feature-lab") entityViews.sync(entityStore.all());
      renderer.followShadow(renderer.camera.position.clone().setY(landed[1]));
    });
  };
  const framed = (placed: void | Promise<void>): boolean | Promise<boolean> => placed ? placed.then(() => true) : true;

  const stableCaptureYaw = (id: string): number => {
    let hash = 2166136261;
    for (let index = 0; index < id.length; index += 1) {
      hash ^= id.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) % 6283) / 1000;
  };

  // The debug and acceptance surface is required before `ready` flips, but none of it participates
  // in world construction or the first render. Load it after those critical paths have completed.
  const { installGameDebug } = await debugModule;
  if (profile.kind !== "feature-lab" && new URLSearchParams(location.search).get("packAudit") === "1") {
    const { createRegionalPackWorldProbe } = await import("../world/regionalPackWorldProbe.js");
    (window as Window & { __packWorldAudit?: unknown }).__packWorldAudit = createRegionalPackWorldProbe({
      scene, assets, scatterStreaming, forestInstances,
      playerPosition: () => store.get().player.position,
      findPath: (from, to) => nav.findPath(from, to),
      resolveSolid: (desired, from, radius) => movementSolids.resolve(desired, from, radius),
    });
  }
  // When local play is what this page starts, by `?play=local` or because there was nothing else to choose, "ready"
  // means it is joined and its first snapshot is what the page shows. Otherwise the picker is still the player's to answer.
  /** Camera, input and presentation state that a new character or a loaded one must not inherit. */
  const presentationReset = (): void => {
    const { position, facingRad, regionId } = store.get().player;
    portalTransition.cancel(); traversalPresentation.reset(); input.clear(); loop.resetPresentation(); gameAudio.reset();
    if (rigged) playerRig.setPosition(position, facingRad);
    camera.reset(); camera.setPose(facingRad + Math.PI, CAMERA.defaultPitch, CAMERA.defaultDistance);
    landView(position, facingRad, regionId); ui.update();
  };
  const localSession = (): boolean => localLaunch !== null && worldSelectionResult?.controller.session?.world?.providerId === localLaunch.provider.id;
  installGameDebug({
    store, events, clock, nav, movement, api, renderer, camera, assets, errors,
    isReady: () => debugReady
      && (profile.kind !== "game" || !worldSelectionResult?.configured || worldSelectionResult.controller.session !== null)
      && (!localLaunch || !(worldSelectionResult?.autoLocal || localDefaulted) || localSession()),
    version,
    remote: localLaunch ? {
      joined: localSession,
      debug: op => localLaunch.provider.debug(op),
      parseSave: (json) => { const loaded = loadSerializedSave(json); return loaded.status === "loaded" && loaded.state ? { state: loaded.state } : { reason: loaded.reason ?? "Save import failed" }; },
      presentationReset,
    } : null,
    // Direct evidence that a cast drew something, for `tools/verify-magic.ts`. Reading `drawCalls`
    // instead conflates a spell with anything else that streamed in that frame.
    spellParticles: () => spellVfx.liveParticles(),
    basicSpellState: () => spellVfx.getState(),
    audioState: () => ({
      ...audioEngine.snapshot(),
      regionId: store.get().player.regionId,
      diagnostics: audioDiagnostics.map(({ kind, message, name, url }) => ({ kind, message, name, url })),
    }),
    audioHistory: (limit) => audioEngine.history(limit),
    clearAudioHistory: () => audioEngine.clearHistory(),
    // "scatter placed nothing" and "nobody asked scatter" are different bugs, and the debug surface
    // could not tell them apart while boot threw this array away.
    prepareView: async () => {
      const { position, regionId } = store.get().player;
      await preparePlayerArea(playerAssetArea(position, regionId));
      if ((profile.scatter || fairyLab) && regionId !== 'gravelmaw')
        await scatterForRegion(regionId).loadView(position[0], position[2],
          fogOpaqueMetres(clientSettings.get().drawDistance) + CAMERA.maxDistance + ENTITY_ACTIVE_REPOSITION_DISTANCE);
    },
    scatterStats: () => [...scatterStreaming.getStats(), ...(fairyScatter?.getStats() ?? [])],
    scatterResidency: () => scatterForRegion(store.get().player.regionId).getResidency(),
    scatterVisibility: () => terrainAt(store.get().player.position[0], store.get().player.position[2]).scatterVisibility.getStats(),
    playerMotion: () => playerRig.motionSnapshot(true),
    foliageOcclusion: () => scene.materials.getFoliageOcclusion(),
    roofVisibility: () => roofVisibility.snapshot(),
    playerSilhouette: () => renderer.playerSilhouette.snapshot(),
    setFoliageOcclusionEnabled: (enabled) => scene.materials.setFoliageOcclusionEnabled(enabled),
    setContainedTroughWater: (enabled) => entityViews.setContainedTroughWater(enabled),
    setFoliageOcclusionBoundsOptimization: (enabled) => scene.materials.setFoliageOcclusionBoundsOptimization(enabled),
    entityMotion: (entityId: EntityId) => entityViews.motionSnapshot(entityId),
    waterBodies: () => scene.getWaterBodies(),
    worldSample: (x: number, z: number) => terrainAt(x, z).sampleWorld(x, z),
    setMovementDetourDiagnostics: (enabled) => movement.setDetourDiagnostics(enabled),
    movementDetourDiagnostics: () => movement.getDetourDiagnostics(),
    worldClearance: ({ x, z, y = terrainAt(x, z).meshHeightAt(x, z), radius }) => {
      const position: Vec3 = [x, y, z];
      const resolved = movementSolids.resolve(position, position, radius);
      return { position, resolved, radius, staticShift: Math.hypot(resolved[0] - x, resolved[2] - z),
        forestOverlaps: forestObstacles.overlaps(position, radius), forestCoverage: "resident-only",
        residentTrunks: forestObstacles.size };
    },
    captureWorldMapTile: (options) => {
      const position = store.get().player.position;
      // All terrain, assets and entity batches are resident; only procedural scatter is hidden by
      // region streaming. Reveal it for this synchronous render, then restore the gameplay view.
      scene.updateStreaming(0, 0, Infinity);
      try {
        return renderer.captureTopDownTile({
          ...options,
          centreY: scene.meshHeightAt(options.centreX, options.centreZ),
        });
      } finally {
        if (!worldMapCapture) scene.updateStreaming(position[0], position[2]);
      }
    },
    isIdle: () => store.get().player.movement.mode === "idle" && store.get().activity === null,
    teleport: (to: Vec3) => {
      const navPoint = nav.closestPoint(to) ?? to;
      const regionId = regionAtPoint(navPoint);
      const snapped: Vec3 = regionId === dungeonSpec?.regionId
        ? [navPoint[0], movementHeightAt(regionId, navPoint[0], navPoint[2]), navPoint[2]] : navPoint;
      return debugPlace(snapped, regionId, undefined, () => {
        movement.stop(store.get(), clock.elapsedMs, "teleport");
        landView(snapped, store.get().player.facingRad, regionId);
      });
    },
    // Observation must not update the renderer or repair a missed state transition.
    drawnBounds: (entityId: string) => entityViews.drawnBounds(entityId, true),
    entityViewStats: () => entityViews.stats(),
    selection: () => ({ hovered: input.hoveredEntityId, selected: input.selectedEntityId }),
    select: (entityId) => { input.select(entityId); },
    groundHeight: (x: number, z: number) => terrainAt(x, z).meshHeightAt(x, z),
    roadPolylines: () => scene.getRoadPolylines(),
    listBuildings: () => REGIONS.flatMap((region) => (region.settlement?.buildings ?? []).map((building) => ({
      id: building.id,
      prefab: building.prefab,
      x: building.position[0],
      z: building.position[1],
      width: building.footprint[0],
      depth: building.footprint[1],
      rotationY: building.rotationY,
    }))),

    openBank: (bankId?: string) => {
      ui.openBank(bankId);
      return true;
    },
    openShop: (shopId?: string) => {
      ui.openShop(shopId);
      return true;
    },
    focusCamera: (shotId: string) => {
      const shot = findShot(shotId);
      if (!shot) return false;
      entityViews.setCaptureSubject(null);
      scene.scatterGroup.visible = true;
      scene.terrainGroup.visible = true;
      if (dungeon) dungeon.group.visible = shot.regionId === "gravelmaw";
      const node = nav.routeNode(shot.locationId);
      if (!node) return false;
      const target = shot.position === undefined
        ? node.position
        : [
          shot.position[0],
          scene.heightAt(shot.regionId, shot.position[0], shot.position[1]) + 0.2,
          shot.position[1],
        ] as Vec3;
      return framed(frameDocumentationTarget(
        target,
        shot.yaw,
        shot.pitch,
        shot.distance,
        "focus-camera",
        target,
        shot.yaw + (shot.playerFacingOffsetRad ?? Math.PI),
      ));
    },
    focusPlayer: () => {
      const player = store.get().player;
      const dungeonPlayer = player.regionId === "gravelmaw";
      entityViews.setCaptureSubject(null);
      scene.scatterGroup.visible = !dungeonPlayer;
      scene.terrainGroup.visible = !dungeonPlayer;
      if (dungeon) dungeon.group.visible = dungeonPlayer;
      const target: Vec3 = [player.position[0], player.position[1] + 1.05, player.position[2]];
      return framed(frameDocumentationTarget(
        target,
        player.facingRad + Math.PI + 0.35,
        0.16,
        2.4,
        "focus-player",
        player.position,
      ));
    },
    focusEntity: async (entityId: string) => {
      let entity = entityStore.get(entityId);
      if (!entity && localDebug) {
        // Beyond the replicated interest set the page does not hold the entity. Ask the host where it is, stand there, and it arrives.
        const found = await localDebug({ op: "getEntity", entityId }) as SemanticEntity | null;
        if (found) { const near = nav.closestPoint(found.position) ?? found.position; await debugPlace(near, found.regionId, undefined, () => {}); entity = entityStore.get(entityId); }
      }
      if (!entity) return false;
      const dungeonEntity = entity.regionId === "gravelmaw";
      const settlementEntity = !dungeonEntity
        && ["npc", "station", "bank", "shop"].includes(entity.archetype);
      const switchingRealm = (store.get().player.regionId === "gravelmaw") !== dungeonEntity;
      // Guide photographs must show the actual subject in its authored surroundings. Hiding the
      // rest of EntityViews made a furnace or monster look like a detached catalogue render and
      // also removed the nearby actors that tell a player where the subject really lives.
      entityViews.setCaptureSubject(null);
      scene.scatterGroup.visible = !dungeonEntity;
      scene.terrainGroup.visible = !dungeonEntity;
      if (dungeon) dungeon.group.visible = dungeonEntity;
      // Photograph settlement subjects from the square side of their stand. The opposite side is
      // commonly a forge, stall, or house wall. Wilderness and dungeon subjects keep a stable
      // authored-or-id yaw so their local terrain remains the context.
      const authoredYaw = entity.view?.rotationY ?? stableCaptureYaw(entity.id);
      const settlementRegion = settlementEntity
        ? REGIONS.find((region) => region.id === entity.regionId)
        : undefined;
      const settlementCentre = settlementRegion?.settlement?.centre;
      const centreYaw = settlementCentre
        ? Math.atan2(settlementCentre[0] - entity.position[0], settlementCentre[1] - entity.position[2])
        : authoredYaw;
      const centreDistance = settlementCentre
        ? Math.hypot(entity.position[0] - settlementCentre[0], entity.position[2] - settlementCentre[1])
        : Number.POSITIVE_INFINITY;
      const centreHasLandmark = settlementRegion?.landmarks.some((landmark) =>
        settlementCentre
        && Math.hypot(landmark.position[0] - settlementCentre[0], landmark.position[1] - settlementCentre[1]) < 3
      ) ?? false;
      // Rootfall's square is itself a giant stump. A keeper standing beside that landmark needs a
      // tangent view; a camera on the literal centre line would photograph the inside of the stump.
      const contextualYaw = centreHasLandmark && centreDistance < 6 ? centreYaw + Math.PI / 2 : centreYaw;
      const baseDistance = entity.archetype === "boss"
        ? 11
        : entity.archetype === "enemy"
          ? 9
          : entity.archetype === "npc"
            ? 7
            : settlementEntity
              ? 9
              : 10;
      if (switchingRealm) {
        await frameDocumentationTarget(entity.position, contextualYaw, 0.25, baseDistance, "focus-entity-region");
      }
      const bounds = entityViews.drawnBounds(entityId);
      const width = bounds ? bounds.max[0] - bounds.min[0] : 0;
      const height = bounds ? bounds.max[1] - bounds.min[1] : 0;
      const depth = bounds ? bounds.max[2] - bounds.min[2] : 0;
      const distance = Math.max(baseDistance, width * 2.1, height * 2.1, depth * 2.1);
      const target: Vec3 = bounds
        ? [
          (bounds.min[0] + bounds.max[0]) / 2,
          (bounds.min[1] + bounds.max[1]) / 2 - 1.1,
          (bounds.min[2] + bounds.max[2]) / 2,
        ]
        : entity.position;
      const pitch = entity.archetype === "npc" ? 0.38 : dungeonEntity ? 0.28 : 0.34;
      // Resource photographs are about the node, not an avatar standing through its centre. Put
      // the player on a deterministic tangent offset while the camera stays fixed on the authored
      // resource. Keep a small margin inside interaction range because `nav.closestPoint` can
      // nudge a point on the exact boundary outward; the same framed player must still be able to
      // start the real gather action without a second debug teleport.
      const resourceSubject = entity.archetype === "ore"
        || entity.archetype === "tree"
        || entity.archetype === "fishing_spot";
      const resourceFocusOffset = Math.max(0, INTERACT_RANGE - 0.25);
      const playerTarget: Vec3 = resourceSubject
        ? [
          target[0] + Math.cos(contextualYaw) * resourceFocusOffset,
          target[1],
          target[2] - Math.sin(contextualYaw) * resourceFocusOffset,
        ]
        : target;
      await frameDocumentationTarget(target, contextualYaw, pitch, distance, "focus-entity", playerTarget);
      return true;
    },
    inspectPose: (target: Vec3, yaw: number, pitch: number, distance: number, detached = false) => {
      if (detached) {
        featureLab?.setFreeCameraEnabled(true);
        const focus: Vec3 = [target[0], target[1] - 1.2, target[2]];
        camera.setFreeTarget(focus);
        camera.setPose(yaw, pitch, distance, 1.5);
        camera.update(...focus, true);
        return true;
      }
      const terrain = terrainAt(target[0], target[2]);
      const regionId = terrain.regionAt(target[0], target[2]);
      featureLab?.setFreeCameraEnabled(false);
      camera.setFreeTarget(null);
      input.setFreeCameraEnabled(false);
      entityViews.setCaptureSubject(null);
      scene.scatterGroup.visible = true;
      scene.terrainGroup.visible = true;
      if (dungeon) dungeon.group.visible = regionId === "gravelmaw";
      const stand: Vec3 = [target[0], terrain.meshHeightAt(target[0], target[2]), target[2]];
      return debugPlace(stand, regionId, yaw + Math.PI, () => {
        movement.stop(store.get(), clock.elapsedMs, "inspect-pose");
        camera.setPose(yaw, pitch, distance);
        landView(stand, yaw + Math.PI, regionId);
        renderer.followShadow(renderer.camera.position.clone().setY(stand[1]));
        return true;
      });
    },
    focusLocation: (locationId: string) => {
      entityViews.setCaptureSubject(null);
      const locationRegion = REGIONS.find((region) =>
        region.locations.some((location) => location.id === locationId)
        || region.dungeon?.locations.some((location) => location.id === locationId));
      const location = locationRegion?.locations.find((entry) => entry.id === locationId)
        ?? locationRegion?.dungeon?.locations.find((entry) => entry.id === locationId);
      const dungeonLocation = locationRegion?.dungeon?.locations.some(
        (location) => location.id === locationId,
      ) ?? false;
      scene.scatterGroup.visible = !dungeonLocation;
      scene.terrainGroup.visible = !dungeonLocation;
      if (dungeon) dungeon.group.visible = dungeonLocation;
      const authored = SHOTS.find((shot) => shot.id === locationId || shot.locationId === locationId);
      if (authored) {
        const target = authored.position === undefined
          ? nav.routeNode(authored.locationId)?.position
          : [
            authored.position[0],
            scene.heightAt(authored.regionId, authored.position[0], authored.position[1]) + 0.2,
            authored.position[1],
          ] as Vec3;
        if (!target) return false;
        return framed(frameDocumentationTarget(target, authored.yaw, authored.pitch, authored.distance, "focus-location"));
      }
      const node = nav.routeNode(locationId);
      if (!node) return false;
      const centre = locationRegion?.settlement?.centre;
      const contextX = centre ? node.position[0] - centre[0] : 0;
      const contextZ = centre ? node.position[2] - centre[1] : 0;
      const bankLocation = location?.kind === "bank" && locationRegion;
      const yaw = bankLocation
        ? bankLocation.settlement?.bank.rotationY ?? 0
        : !dungeonLocation && centre && Math.hypot(contextX, contextZ) > 2
          ? Math.atan2(contextX, contextZ)
          : stableCaptureYaw(locationId);
      return framed(frameDocumentationTarget(
        node.position,
        yaw,
        dungeonLocation ? 0.28 : bankLocation ? 0.32 : 0.44,
        dungeonLocation ? 8 : bankLocation ? 6 : 22,
        "focus-location",
      ));
    },
    setCaptureMode: (enabled: boolean) => {
      // The world that must hold still is the host's. The page's clock below only mirrors it.
      const held = localDebug && localSession() ? localDebug({ op: "setPaused", paused: enabled ? true : capturePreviousPause }).then(() => {}) : undefined;
      if (enabled) {
        capturePreviousPause = clock.paused;
        capturePreviousRunning = loop.isRunning();
        clock.paused = true;
        if (capturePreviousRunning) loop.stop();
        renderer.setRenderScale(0.85);
        renderer.setShadowQuality("low");
        playerRig.root.visible = false;
      } else {
        clock.paused = capturePreviousPause;
        renderer.setRenderScale(appliedPreferences?.renderScale ?? 1);
        renderer.setShadowQuality(appliedPreferences?.shadowQuality ?? "high");
        playerRig.root.visible = true;
        scene.scatterGroup.visible = true;
        scene.terrainGroup.visible = true;
        if (dungeon) dungeon.group.visible = store.get().player.regionId === "gravelmaw";
        entityViews.setCaptureSubject(null);
        if (capturePreviousRunning) loop.start();
      }
      return held;
    },
    captureDocumentationFrame: () => renderer.captureFrame(),
    listShots: () => shotIds(),
    // The harness's parity probe. It runs the same handler with the same validation, but skips
    // the collaboration gate: a smoke test proving that a tool call and a click reach the same
    // function is not an agent asking for the keys, and must not flip the panel into play mode.
    callTool: (name: string, args: unknown) => agent.call(name, (args ?? {}) as Record<string, unknown>, { bypassSession: true }),
  });

  if (fishingLab) {
    (window as Window & { __fishingLab?: unknown }).__fishingLab = {
      getState: () => ({
        entityIds: fishingEntities.map((entity) => entity.id),
        bodies: scene.getWaterBodies(),
        accessPositions: Object.fromEntries(fishingEntities.map((entity) => [entity.id, entity.interactionPosition])),
        path: store.get().player.movement.path,
      }),
    };
  }

  const selection = worldMapCapture ? null : await worldSelection;
  let mountWorldSelector = () => {};
  if(labSpec&&selection&&localLaunch&&describeLabWorld){
    // The scene is assembled, so the lab worker can receive its world while final graphics prepare.
    localLaunch.provider.provideLabWorld(bootTelemetry.measureSync("boot.labWorker.describe", describeLabWorld));
    const {installBrowserSession}=await import("../multiplayer/browserSession.js");
    await installBrowserSession({store,loop,clock,entities:entityStore,views:entityViews,assets,api,events,movement,traversal:traversalPresentation,expectedSeed:store.get().meta.seed,
      sceneryChanges:recapture=>{labSceneryChanged=recapture;},
      applied(update){forestApplied(update);gameAudio.tick(0,update.simMs);},
    }, {lab:true,equipment:true}, selection);
  }
  if(profile.kind==="game"&&selection){
    const {installBrowserSession}=await import("../multiplayer/browserSession.js");
    await installBrowserSession({store,loop,clock,entities:entityStore,views:entityViews,assets,api,events,movement,traversal:traversalPresentation,expectedSeed:store.get().meta.seed,
      mountWorlds:panel=>{mountWorldSelector=()=>{
        panel.classList.remove("worlds--boot");panel.hidden=false;ui.setWorlds(panel);
        if(!choseLocalPlay&&selection.configured&&!selection.controller.session)ui.openTitle("worlds");
      };},
      phase(phase){
        if(["reconnecting","unavailable","incompatible","full"].includes(phase))ui.openTitle("worlds");
      },
      applied(update){
        forestApplied(update);
        // The boot path prepares the snapshot's destination before revealing it. Do not start
        // travel prefetch, audio downloads or a second portal curtain while it is doing that.
        if (!debugReady) return;
        gameAudio.tick(0,update.simMs);
        followPlayer(update.snapshot);
      },
      restored(){
        for(const id of forestInstances.keys()){forestPresentation.deactivate(id);forestObstacles.remove(id);}
        // A join after boot's own join window is an arrival from the boot spawn, not a step: it
        // takes the same cover as any jump. During boot, the end of boot follows the player.
        if (debugReady) followPlayer(true);
      },
    }, {crowds:true,equipment:true}, selection);
    // Only when there was something to join. The picker shows on every page now, but a page with
    // no servers behind it has nothing to offer a player who let loading finish without choosing,
    // so their own world starts. It is a world to join, not a game already running behind the picker.
    if(!choseLocalPlay&&!selection.configured&&selection.local&&selection.playLocal()){choseLocalPlay=true;localDefaulted=true;selection.local.provider.prestart();}
  }
  // Effect programs depend on neither the joined world nor its lights (see batchedLighting.ts),
  // so every pool compiles while the world joins. Their PNGs must decode first.
  const effectTextures = worldMapCapture ? undefined : renderer.prepareEffectTextures();
  const effectsReady = effectTextures?.then(() => {
    renderer.compileEffects(overlays.preparationRoot());
    return bootTelemetry.measureAsync("boot.effects.ready", () => renderer.prepareEffects());
  });
  void effectsReady?.catch(() => {}); // The awaited readiness gate below reports failures.
  // Join before preparing the final view: the snapshot defines the real spawn and actors.
  // The picker remains clickable above the cover if authentication or connection fails.
  if (profile.kind === "game" && selection) {
    selection.setReady();
    await bootTelemetry.measureAsync("boot.world.join", async () => {
      const started = performance.now();
      while (selection.panel.dataset.phase === "connecting") {
        if (performance.now() - started > 60_000) throw new Error("The selected world did not answer during startup");
        await new Promise<void>(resolve => setTimeout(resolve, 20));
      }
    });
    if (selection.controller.session) {
      const player = store.get().player;
      if (player.regionId === "gravelmaw") await deferredCave?.ensure();
      if (profile.scatter && player.regionId !== "gravelmaw") {
        scatterResults = await scatterForRegion(player.regionId).loadView(player.position[0], player.position[2],
          fogOpaqueMetres(clientSettings.get().drawDistance) + CAMERA.maxDistance + ENTITY_ACTIVE_REPOSITION_DISTANCE);
      }
      refreshVisualResidency(player.position, player.regionId, true);
      await preparePlayerArea(playerAssetArea(player.position, player.regionId));
      scene.syncPlayer(player.position, player.facingRad, true);
      camera.update(...player.position, true);
    }
  }

  // Settings and lab fixtures may have changed the selected views. Finish their assets and
  // camera-ranked rigs before shader preparation, using the same update path as gameplay.
  setStatus("Preparing your starting area…",5);
  await bootTelemetry.measureAsync("boot.entities.resident", () => entityViews.retryHydration());
  bootTelemetry.measureSync("boot.entities.pose", () => {
    for (let pass = 0; pass < 4; pass++) entityViews.update(0, renderer.camera.position, clock.elapsedMs);
  });
  const readyPosition = store.get().player.position;
  scene.updateStreaming(readyPosition[0], readyPosition[2]);
  await (wildernessEffects as WildernessEffects | null)?.prepareArea(readyPosition[0], readyPosition[2],
    structureResidencyRadius(clientSettings.get().drawDistance));
  fairyRealm?.setVisible(isFairyRegion(store.get().player.regionId));
  if (store.get().player.regionId === "gravelmaw") await deferredCave?.ensure();
  // Match the first gameplay frame before compiling. Hidden cave lights otherwise produce
  // a different cache key, including for Three's internal sky shader on the first water draw.
  if (dungeon && !caveFixture) dungeon.group.visible = store.get().player.regionId === "gravelmaw";
  // A lab may already display an effect in its warmup scene.
  if (profile.kind === "feature-lab") await effectTextures;
  if (profile.fullWarmup || performanceLab || multiplayerFixture) {
    setStatus("Finishing graphics…",5);
    if (!worldMapCapture) {
      const paintSpan = bootTelemetry.startSpan("boot.ui.paint");
      paintSpan.end(await prepareUiFirstPaint(labelRoot));
    }
    await bootTelemetry.measureAsync(BOOT_SPANS.SHADER_COMPILE, () => renderer.warmup());
  }
  if (!worldMapCapture) {
    setStatus("Starting the game…",5);
    // A longer responsive load is preferable to a first cast with missing effects or cold pipelines.
    await effectsReady;
  }
  bootTelemetry.milestone(BOOT_MILESTONES.SHADERS_READY);
  if (runtimePerformanceEnabled) renderer.startStreamingWarmup();
  // Startup was prepared above. Subsequent equipment changes retain their previous appearance
  // until the streaming renderer has prepared the replacement's shaders and textures.
  if (!worldMapCapture) playerRig.setAppearancePreparation(root => renderer.prepareInterior(root));

  if (worldMapCapture) {
    // Build-time capture is deterministic: no animation/motion frame may land between two tiles.
    // Settings subscriptions reconcile the active set during boot. Restore distant buildings
    // after those subscriptions, before capture reports ready.
    await entityViews.forceFullResidency(true);
    scene.updateTime(0);
    scene.updateStreaming(0, 0, Infinity);
    bootTelemetry.measureSync(BOOT_SPANS.BOOT_SCREEN_REMOVAL, () => {
      document.getElementById("boot-screen")?.remove();
    });
    bootTelemetry.milestone(BOOT_MILESTONES.BOOT_SCREEN_REMOVED);
    bootTotalSpan.end();
    bootTelemetry.recordPerformanceResources();
    bootTelemetry.milestone(BOOT_MILESTONES.FIRST_PLAYABLE);
    debugReady = true;
    if (featureLab) window.__featureLab = featureLab;
    if (environmentLab) (window as Window & { __environmentLab?: typeof environmentLab }).__environmentLab = environmentLab;
    if (creatureGallery) (window as Window & { __creatureGallery?: typeof creatureGallery }).__creatureGallery = creatureGallery;
    if (forestFixture) (window as Window & { __forestLab?: unknown }).__forestLab = { getState: () => ({ ...labForestStats(), entityIds: forestFixture!.entityIds, obstacles: forestObstacles.size }), getTrees: () => forestFixture!.trees, getScatterVisibility: () => forestFixture!.getScatterVisibility() };
  } else {
    const firstFrameSpan = bootTelemetry.startSpan(BOOT_SPANS.FIRST_RENDERED_FRAME);
    const beforeGameplay = renderer.getPresentationState().submitted;
    loop.start();
    try { await renderer.waitForFrame(beforeGameplay); }
    catch (error) { loop.stop();firstFrameSpan.fail(error);throw error; }
    {
      firstFrameSpan.end();
      bootTelemetry.milestone(BOOT_MILESTONES.FIRST_RENDERED_FRAME);
      // The GPU has completed the actual gameplay frame, including textures and particles.
      bootTelemetry.measureSync(BOOT_SPANS.BOOT_SCREEN_REMOVAL, () => {
        // Keep the picker on the clickable boot cover until the frame is ready. Moving it earlier
        // puts it behind that cover while the GPU is still busy, blocking login and world choices.
        mountWorldSelector();
        document.getElementById("boot-screen")?.remove();
      });
      bootTelemetry.milestone(BOOT_MILESTONES.BOOT_SCREEN_REMOVED);
      // Lab setup waits for the renderer; game sessions joined before final graphics preparation.
      selection?.setReady();
      if (labSpec && startFeatureLab) {
        // A lab is ready when its worker's world is joined, the character is set up and the first target stands in it.
        await new Promise<void>((resolve, reject) => {
          const started = performance.now();
          const poll = (): void => {
            if (localSession() && store.get().player.id !== "player") { resolve(); return; }
            const phase = selection?.panel.dataset.phase ?? "";
            if (["unavailable", "incompatible", "full"].includes(phase) || performance.now() - started > 60_000) {
              reject(new Error(`The lab worker's world could not be joined (${phase || "no answer"}): ${selection?.panel.querySelector(".worlds__status")?.textContent ?? ""}`)); return;
            }
            window.setTimeout(poll, 20);
          };
          poll();
        });
        labJoined = true;
        await startFeatureLab();
      }
      bootTotalSpan.end();
      bootTelemetry.recordPerformanceResources();
      // Publish readiness last so an attached runner cannot capture the timeline between the
      // playable mark and the final critical span/resource bookkeeping above.
      bootTelemetry.milestone(BOOT_MILESTONES.FIRST_PLAYABLE);
      debugReady = true;
      assets.setGameplayActive(runtimePerformanceEnabled);
      // A world joined after boot prepared its view (the player chose it while loading finished)
      // put the player somewhere boot did not prepare. Arrive there now.
      if (profile.kind === "game") followPlayer(true);
      if (featureLab) window.__featureLab = featureLab;
      if (environmentLab) (window as Window & { __environmentLab?: typeof environmentLab }).__environmentLab = environmentLab;
    if (creatureGallery) (window as Window & { __creatureGallery?: typeof creatureGallery }).__creatureGallery = creatureGallery;
      if (forestFixture) (window as Window & { __forestLab?: unknown }).__forestLab = { getState: () => ({ ...labForestStats(), entityIds: forestFixture!.entityIds, obstacles: forestObstacles.size }), getTrees: () => forestFixture!.trees, getScatterVisibility: () => forestFixture!.getScatterVisibility() };
      window.setTimeout(() => {
        audioDirector.setRegion(store.get().player.regionId, store.get().player.position);
        // The starting view is complete. Travel prefetch follows movement; equipment and newly
        // created items use their normal on-demand loaders instead of flooding the first frames.
      }, 0);
    }
  }
  if (profile.kind === "feature-lab" && new URLSearchParams(location.search).get("multiplayer") === "1") {
    const { installMultiplayerLab } = await import("../featureLab/multiplayer.js");
    await installMultiplayerLab({ store, loop, clock, entities: entityStore, views: entityViews, assets, api, events, movement, traversal:traversalPresentation,
      ...(new URLSearchParams(location.search).has("worldMenu")?{mountWorlds:(panel:HTMLElement)=>{ui.setWorlds(panel);ui.openTitle("worlds");}}:{}) });
  }
  return { loop, api, ...(featureLab ? { featureLab } : {}) };
}

/**
 * Keeps procedural dressing off anything authored. Trees growing through the bank door is the
 * single most obvious way a procedural world reads as unmade.
 */

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function captureErrors(sink: RecordedError[], atMs: () => number): void {
  window.addEventListener("error", (event) => {
    sink.push({ atMs: atMs(), source: "window.error", message: String(event.message), stack: event.error?.stack });
  });
  window.addEventListener("unhandledrejection", (event) => {
    sink.push({ atMs: atMs(), source: "unhandledrejection", message: String(event.reason) });
  });
}

/**
 * Standing atmosphere, placed off the same authored data everything else is placed off.
 *
 * There is no "atmosphere" content type and there should not be one: every emitter here is implied
 * by something the world already contains. A chimney is a cottage's chimney, a forge fire is a
 * smithing station, a ripple is a fishing spot. Deriving them means a settlement that adds a house
 * gets its smoke for free, and a settlement that moves one does not leave a plume behind.
 *
 * All of it lands in ONE InstancedMesh, so the whole world's smoke, sparks and ripples cost a
 * single draw call. Each emitter carries its own cull distance, so a chimney 200 m away contributes
 * nothing at all rather than a sub-pixel sprite.
 */
function collectAmbienceEmitters(scene: WorldScene, built: { entities: readonly SemanticEntity[] }): AmbienceEmitter[] {
  const emitters: AmbienceEmitter[] = [];

  // Chimney smoke, read off the assembled buildings rather than off the building list: `cottage`
  // and `quarry_hut` place their chimney with a seeded offset, so the only thing that knows where
  // the flue actually came out is the emitted part.
  for (const entity of built.entities) {
    if (entity.view?.assetId !== "chimney") continue;
    emitters.push({
      id: `smoke-${entity.id}`,
      kind: "smoke",
      // The part is placed at the chimney's base; the smoke leaves the top of it.
      position: [entity.position[0], entity.position[1] + 3.1, entity.position[2]],
      scale: 1,
    });
  }

  // Forge fire and cooking heat, from the stations themselves.
  for (const region of REGIONS) {
    for (const station of region.settlement?.stations ?? []) {
      const kind: AmbienceKind | null =
        station.kind === "furnace" ? "spark" : station.kind === "range" ? "smoke" : null;
      if (!kind) continue;
      const [x, z] = station.position;
      emitters.push({
        id: `station-${station.id}`,
        kind,
        position: [x, scene.heightAt(region.id, x, z) + (kind === "spark" ? 0.9 : 0.7), z],
        scale: kind === "spark" ? 0.7 : 0.8,
      });
    }

    // Fishing ripples are node state now. EntityViews owns their active/depleted intensity so a
    // worked-out school cannot keep the old always-on cluster marker.
  }

  return emitters;
}
