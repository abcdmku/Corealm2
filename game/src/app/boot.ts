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
import { CREATURE_MOTION_TIMING } from "../content/creatureMotionTiming.js";
import { ForestResources, type ForestTreeDescriptor } from "../world/forestResources.js";
import { ForestPresentation } from "../render/forestPresentation.js";
import { ForestObstacles } from "../world/forestObstacles.js";
import { WORLD_SITES, worldSitePoint, type WorldSite } from "../content/worldSites.js";
import { WORLD_HABITATS } from "../content/worldHabitats.js";
import { habitatIdleTargets } from "../world/habitatMovement.js";
import { buildWorldSiteDressing, type ResolvedWorldSiteDressing } from "../render/worldSiteDressing.js";
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
import { Store, addSkillXp, computeMaxHealth } from "../state/store.js";
import { EventBus } from "../core/events.js";
import { SimClock } from "../core/time.js";
import { RngStreams } from "../core/rng.js";
import { drawDistanceMetres, fogOpaqueMetres, Renderer } from "../render/renderer.js";
import { OrbitCamera } from "../render/camera.js";
import { AssetRegistry } from "../render/assets.js";
import { registerProceduralGear } from "../render/proceduralGear.js";
import { WorldScene } from "../render/scene.js";
import { EntityViews } from "../render/entityViews.js";
import { buildStructureNavigationSources } from "../render/structureNavigation.js";
import { RoofVisibility } from "../render/roofVisibility.js";
import { buildStructureCameraSources } from "../render/structureCameraSources.js";
import { STOREY_METRES } from "../render/buildings.js";
import { isStructureEntity } from "../render/entityActiveSet.js";
import { StaticCameraQueries } from "../systems/staticCameraQueries.js";
import { Navigation, solidObstacleMeshes } from "../systems/navigation.js";
import { dryNavigationMeshes } from "../world/waterNavigation.js";
import { Movement } from "../systems/movement.js";
import { Solids } from "../systems/solids.js";
import { CorealmGameApi } from "../api/gameApi.js";
import { SaveService } from "../persistence/storage.js";
import { relocateDungeonSave } from "../persistence/dungeonPlacement.js";
import {
  LOOT_PILE_VIEW,
  RECOVERY_CACHE_VIEW,
  rehydrateEnemyRuntimes,
  rehydrateWorldContainers,
} from "../persistence/worldContainers.js";
import type { RecordedError } from "../debug/gameDebug.js";
import { installBootPlaceholder } from "../debug/bootPlaceholder.js";
import { GameLoop } from "./loop.js";
import { formatBootAssetProgress } from "./bootStatus.js";
import { InputController } from "../input/mouse.js";
import { prepareWorldSurface } from "./worldSurface.js";
import { fishingAccessPositions } from "./fishingAccess.js";
import { miningAccessPositions } from "./miningAccess.js";
import { worldSiteHaulRamp } from "../world/siteTerrain.js";
import { CAMERA } from "./config.js";
import type { BuildingBox } from "../world/regionBuilder.js";
import { EntityStore, straightLineDistance } from "../world/entities.js";
import { InteractionDispatcher } from "../world/interactions.js";
import { InventorySystem } from "../systems/inventory.js";
import { BankSystem } from "../systems/bank.js";
import { EquipmentSystem } from "../systems/equipment.js";
import { EconomySystem } from "../systems/economy.js";
import { ActivitySystem } from "../systems/activity.js";
import { EatingSystem } from "../systems/eating.js";
import { CAMPFIRE_ENTITY_ID, CampfireSystem, campfireFuelLookup } from "../systems/campfire.js";
import { GatheringSystem } from "../systems/gathering.js";
import { EssenceSystem } from "../systems/essence.js";
import { AgilitySystem } from "../systems/agility.js";
import { TraversalPresentation } from "../render/traversalPresentation.js";
import { HuntContractsSystem } from "../systems/huntContracts.js";
import { deriveHuntTargets } from "../content/huntContracts.js";
import { CombatSystem } from "../systems/combat.js";
import { EnemyAiSystem } from "../systems/enemyAI.js";
import { coastalSpawnSites } from "./coastalSpawns.js";
import { HealthSystem } from "../systems/health.js";
import { DeathSystem } from "../systems/death.js";
import { RespawnAnchorSystem, buildSettlementRespawnAnchors } from "../systems/respawnAnchors.js";
import { ProductionSystem } from "../systems/production.js";
import { QuestSystem } from "../systems/quests.js";
import { DiscoverySystem } from "../systems/discovery.js";
import { DeferredDialogueSystem } from "../systems/deferredDialogue.js";
import { TravelSystem } from "../systems/travel.js";
import { PortalTransition } from "../ui/portalTransition.js";
import { INTERACT_RANGE } from "./config.js";
import { distanceXZ } from "../core/math.js";
import {
  ESSENCE_ALTAR_CLEAR_RADIUS,
  REGIONAL_ESSENCE_ALTARS,
  REGIONS,
  getRegion,
} from "../content/regions.js";
import { content } from "../content/index.js";
import { ALL_ITEMS } from "../content/items.js";
import { GATHERING_PRODUCTION_TIERS } from "../content/gatheringProductionTiers.js";
import { RESOURCES } from "../content/resources.js";
import { RECIPES } from "../content/recipes.js";
import { SPELLS } from "../content/spells.js";
import { ENEMIES } from "../content/enemies.js";
import { SHOPS } from "../content/shops.js";
import { QUESTS } from "../content/quests.js";
import { worldExclusions, type ScatterResult } from "../world/scatter.js";
import { ScatterStreamingController } from "../world/scatterStreaming.js";
import { findShot, shotIds, SHOTS } from "../debug/shots.js";
import { createUi } from "../ui/panels.js";
import { preloadFeatureLabPanel } from "../ui/lazyPanelRegistry.js";
import { SettingsStore, type UiSettings } from "../ui/settings.js";
import { keybindings } from "../input/keyboard.js";
import { CharacterRig } from "../render/characterRig.js";
import {
  addChamberLights, buildDungeon, chamberFloorAt, dungeonFloorHeight, type DungeonSpec,
} from "../render/dungeon.js";
import { Ambience, Vfx, type AmbienceEmitter, type AmbienceKind } from "../render/vfx.js";
import { SpellVfx } from "../render/spellVfx.js";
import {
  AudioDirector, AudioEngine, COREALM_AUDIO_CATALOG, CorealmAudioBridge,
  footstepSurfaceAt, type AudioDiagnostic,
} from "../audio/index.js";
import { GAME_BOOT_PROFILE, type BootProfile } from "./bootProfile.js";
import type { FeatureLabStructureAssembly } from "../featureLab/structures.js";
import { BOOT_MILESTONES, BOOT_SPANS, bootTelemetry } from "../perf/bootTelemetry.js";

export interface BootResult {
  loop: GameLoop;
  api: CorealmGameApi;
  featureLab?: FeatureLabApi;
}

// The user camera cannot move more than 11 m from the player. Boot makes that immediate circle
// resident, then expands to the 64 m travel working set after first play.
const ENTITY_BOOT_RADIUS = 12;
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
}

export async function boot(canvas: HTMLCanvasElement, options: BootOptions = {}): Promise<BootResult> {
  const profile = options.profile ?? GAME_BOOT_PROFILE;
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
  bootTelemetry.milestone(BOOT_MILESTONES.JS_EVALUATED);

  const errors: RecordedError[] = [];
  const worldMapCapture = new URLSearchParams(window.location.search).get("world-map-capture") === "1";
  const startedAt = performance.now();
  const atMs = (): number => performance.now() - startedAt;

  // 1. Placeholder debug surface, before anything can fail.
  installBootPlaceholder();
  captureErrors(errors, atMs);

  let statusPhase = "waking the frontier…";
  let statusAssets: AssetRegistry | null = null;
  let statusAssetTarget: number | null = null;
  const refreshStatus = (): void => {
    const node = document.querySelector(".boot-status");
    if (!node) return;
    const stats = statusAssets?.getLoadStats();
    const assetProgress = stats ? formatBootAssetProgress(stats, statusAssetTarget) : "";
    node.textContent = `${statusPhase}${assetProgress}`;
  };
  const setStatus = (message: string): void => {
    statusPhase = message;
    refreshStatus();
  };
  const refreshStatusFrame = (): void => {
    if (!document.getElementById("boot-screen")) return;
    refreshStatus();
    requestAnimationFrame(refreshStatusFrame);
  };
  requestAnimationFrame(refreshStatusFrame);

  // 2. Core services and save. The save must win before any seeded world work starts. Loading it
  // after buildWorld meant a custom-seed save resumed inside a world built from seed 1337.
  const store = new Store(1337, Date.now());
  const saves = new SaveService(profile.persistent);
  const loadedSave = saves.load();
  const resumedFromSave = loadedSave.status === "loaded" && loadedSave.state !== undefined;
  if (resumedFromSave) {
    store.replace(loadedSave.state!);
  } else if (loadedSave.status === "failed") {
    errors.push({
      atMs: atMs(),
      source: "persistence",
      message: `Save could not be loaded: ${loadedSave.reason ?? "unknown"}`,
    });
  }
  const events = new EventBus();
  const clock = new SimClock();
  const rng = new RngStreams(store.get().meta.seed);
  const clientSettings = new SettingsStore();
  const initialSettings = clientSettings.get();
  const audioDiagnostics: AudioDiagnostic[] = [];
  const audioEngine = new AudioEngine(COREALM_AUDIO_CATALOG, {
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
  const audioDirector = new AudioDirector(audioEngine, COREALM_AUDIO_CATALOG, {
    regionFadeMs: 1400,
  });

  // Canonical content is registered before anything can ask for it. Systems and the docs index all
  // read through `content`, so this has to happen before the first tick and before buildDocs().
  const packId = profile.kind === "feature-lab" ? new URLSearchParams(location.search).get("pack") : null;
  const packContent = packId ? await import("../content/regionalPacks.js") : null;
  content.register({
    items: ALL_ITEMS,
    resources: RESOURCES,
    recipes: RECIPES,
    spells: SPELLS,
    enemies: packContent ? [...ENEMIES, ...packContent.REGIONAL_PACK_VARIANTS.map((variant) => variant.stats)] : ENEMIES,
    shops: SHOPS,
  });
  if (profile.kind === "feature-lab") {
    const { RPG_BESTIARY_STAGED } = await import("../content/rpgBestiary.js");
    content.register({ enemies: [...content.allEnemies(), ...RPG_BESTIARY_STAGED.map((entry) => entry.stats)] });
  }

  // 3 + 4. Start the manifest beside navigation initialization. These requests are independent; making
  // them serial put an entire network round trip on the critical path before any world work began.
  const assets = new AssetRegistry();
  statusAssets = assets;
  registerProceduralGear(assets);
  const assetBootstrap = bootTelemetry.measureAsync(BOOT_SPANS.MANIFEST_LOAD, () => assets.loadManifest())
    .then(async () => {
      bootTelemetry.milestone(BOOT_MILESTONES.MANIFEST_READY);
      await bootTelemetry.measureAsync(BOOT_SPANS.ANIMATION_LOAD, () => assets.loadAnimationLibraries());
      bootTelemetry.milestone(BOOT_MILESTONES.ANIMATIONS_READY);
    })
    .catch((cause: unknown) => {
      errors.push({ atMs: atMs(), source: "assets", message: describeError(cause) });
    });

  setStatus("starting the simulation…");
  await Promise.all([
    bootTelemetry.measureAsync(BOOT_SPANS.NAVIGATION_WASM_INIT, () => Navigation.initLibrary()),
    assetBootstrap,
  ]);
  bootTelemetry.milestone(BOOT_MILESTONES.WASM_READY);
  const cameraQueries = new StaticCameraQueries();
  const nav = new Navigation();

  // 5. Renderer.
  setStatus("lighting the frontier…");
  const renderer = new Renderer(canvas);
  const camera = new OrbitCamera(renderer.camera);
  camera.fixedFollow = true;
  const scene = new WorldScene(renderer.scene);
  renderer.prepareScene = (viewCamera) => scene.scatterVisibility.prepare(
    viewCamera, renderer.scene.fog instanceof THREE.Fog ? renderer.scene.fog.far : undefined,
  );
  scene.materials.setFoliageOcclusionEnabled(false);
  if (profile.kind === "game") {
    renderer.biomeAtmosphere.sky.enabled = true;
    renderer.biomeWeightsSource = () => {
      const player = store.get().player;
      if (player.regionId === "gravelmaw") return { gravelmaw: 1 };
      return Object.fromEntries(scene.biomeWeightsAt(player.position[0], player.position[2])
        .map(({ id, weight }) => [id, weight]));
    };
  }

  // 6. Assets. Animation libraries load once as a shared clip library; every rig plays from it.
  setStatus("loading assets…");
  // The staff meshes, built rather than loaded. There is no staff anywhere in the 213-asset library,
  // so without this line all four staffs resolve to an asset id that `AssetRegistry.load` rejects,
  // `characterRig.attachBoneSlot` swallows the rejection, and a mage holds empty air — which is
  // exactly the state this wave set out to fix. Registered BEFORE the manifest loads and before the
  // player rig is built, because `CharacterRig` warms gear through the same `load()` path.
  // Manifest and startup clips were already requested beside the WASM libraries above.

  // 7. Terrain, derived from canonical region data so there is one source of truth for where the
  //    world is. See app/worldSpec.ts for why this is derived rather than authored twice.
  setStatus("raising the ground…");
  // Flat pads are registered before the terrain mesh is generated, or the ground under a
  // settlement stays as noisy as the moor around it — Coldbrace square measured a metre of tilt
  // across 33 m before this. worldSpec derives the pads from the authored settlement data.
  const fishingLab = profile.kind === "feature-lab" && new URLSearchParams(location.search).get("fishing") === "1"
    ? await import("../featureLab/fishing.js") : undefined;
  const pavingLab = profile.kind === "feature-lab" && new URLSearchParams(location.search).get("paving") === "1"
    ? await import("../featureLab/paving.js") : undefined;
  const { loadCorealmSurfaceTextures } = await import("../render/corealmSurfaceMaterials.js");
  const surfaceTextures = await loadCorealmSurfaceTextures();
  scene.materials.setGroundStoneSurface(surfaceTextures);
  const terrainSpec = profile.terrain();
  if (fishingLab) terrainSpec.basins = [fishingLab.FISHING_LAB_BASIN];
  await bootTelemetry.measureAsync(BOOT_SPANS.TERRAIN_BUILD, async () => {
    await scene.buildWorldYielding(terrainSpec, profile.worldSurface
      ? (preparedScene) => {
          // The telemetry name stays stable for baseline comparison, but this is now preparation
          // before the first chunk vertex is shaded.
          bootTelemetry.measureSync(
            BOOT_SPANS.TERRAIN_RESTAMP,
            () => prepareWorldSurface(preparedScene, store.get().meta.seed),
          );
        }
      : pavingLab?.preparePavingLabSurface ?? fishingLab?.prepareFishingLabSurface);
    // One heightfield collider rather than 28 terrain trimeshes: same ground answers, 24 ms instead
    // of a per-chunk trimesh build, and a single collider for the ray queries to walk.
    cameraQueries.addHeightfield(scene.heightfieldSamples());
  });

  const heightAt = (regionId: RegionId, x: number, z: number): number => scene.heightAt(regionId, x, z);
  const authoredDungeonSpec = profile.dungeon ? buildDungeonSpec(scene) : null;
  const doorLab = profile.kind === "feature-lab" && new URLSearchParams(window.location.search).get("doors") === "1"
    ? await import("../featureLab/dungeonDoors.js") : null;
  const doorFixture = doorLab?.assembleDungeonDoorFixture((x, z) => scene.meshHeightAt(x, z));
  const agilityLabModule = profile.kind === "feature-lab" && new URLSearchParams(window.location.search).get("agility") === "1"
    ? await import("../featureLab/agility.js") : null;
  const agilityFixture = agilityLabModule?.assembleAgilityFixture((x, z) => scene.meshHeightAt(x, z),
    (id) => assets.baseY(id), (id) => assets.assetSize(id), (id) => assets.assetCenterXZ(id));
  const dungeonRegion = profile.dungeon ? REGIONS.find((region) => region.dungeon) : undefined;
  const doorLogic = doorFixture || dungeonRegion ? await import("../world/dungeonDoors.js") : null;
  const worldDoorThresholds = dungeonRegion?.dungeon ? doorLogic!.authoredThresholds(
    dungeonRegion.dungeon, heightAt(dungeonRegion.id, ...dungeonRegion.dungeon.entrance),
  ) : [];
  const doorThresholds = doorFixture?.thresholds ?? worldDoorThresholds;
  const gates = doorThresholds.length || agilityFixture ? await import("../render/dungeonGate.js") : null;
  let gateMaterials: import("../render/dungeonGate.js").DungeonGateMaterials | null = null;
  if (gates) {
    gateMaterials = gates.createDungeonGateMaterials(surfaceTextures, scene.materials.metal(1));
    await gates.registerDungeonGateAssets(assets, gateMaterials);
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
    const { registerTraversalContactAssets } = await import("../render/traversalContactAssets.js");
    registerTraversalContactAssets(assets, gateMaterials);
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

  // 7c. Water. Fishing spots were authored as interaction markers with a note that the water itself
  //     is the render layer's job — and nothing was building it, so every fishing spot sat on dry
  //     grass. Each `kind: "water"` location gets a surface sunk just below the local ground.

  // 8. Semantic world. Data in, entities out, deterministic from the seed.
  setStatus("populating the frontier…");
  //
  // The ports are what stop the world being placed by accident. `baseY` is the measured bbox
  // minimum of each GLB, so an entity is placed by its FEET rather than by its origin: without it
  // the visible gap is exactly `glbMinY * scale * tierSilhouetteScale(tier)`, which is why the
  // Fallen Duskoak hovered 5.77 m and the Coldbrace fletching bench 1.41 m, and why 74 of 151
  // measured entities sat more than 5 cm off the ground. `assetSize` sizes the collision volumes
  // that make the world solid at all.
  const roadPolylines = scene.getRoadPolylines();
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
  const worldPorts = {
    heightAt,
    dungeonGates: worldDoorThresholds.length > 0,
    ...(profile.kind === "game" ? { accessPositions: new Map([
      ...fishingAccessPositions(WORLD_SITES, scene.getWaterBodies(), (x, z) => scene.meshHeightAt(x, z)),
      ...miningAccessPositions(WORLD_SITES, (x, z) => scene.meshHeightAt(x, z), {
        assetSize: (id) => assets.assetSize(id), assetCenterXZ: (id) => assets.assetCenterXZ(id),
      }),
    ]) } : {}),
    baseY: (assetId: string): number => assets.baseY(assetId),
    assetSize: (assetId: string): { x: number; y: number; z: number } | null => assets.assetSize(assetId),
    assetCenterXZ: (assetId: string): { x: number; z: number } | null => assets.assetCenterXZ(assetId),
    roadDistance,
    coastalSpawns: profile.worldSurface ? coastalSpawnSites(scene, store.get().meta.seed) : [],
  };
  const shopLab = profile.kind === "feature-lab" && new URLSearchParams(window.location.search).get("shop") === "1"
    ? await import("../featureLab/shop.js") : null;
  const shopFixture = shopLab?.assembleShopFixture((x, z) => scene.meshHeightAt(x, z), worldPorts);
  const portalLab = profile.kind === "feature-lab" && new URLSearchParams(location.search).get("portal") === "1"
    ? await import("../featureLab/portal.js") : null;
  const portalFixture = portalLab?.assemblePortalFixture((x, z) => scene.meshHeightAt(x, z), (id) => assets.baseY(id));
  const packLab = packId ? await import("../featureLab/regionalPacks.js") : null;
  const rpgPackCatalogue = packId && new URLSearchParams(location.search).get("rpg") === "1"
    ? (await import("../content/rpgRegionalPacks.js")).createRpgRegionalPackCatalogue((id) => {
      const entry = assets.entry(id);
      return entry?.base ? { size: entry.size, base: entry.base } : null;
    }, [packId]) : undefined;
  if (rpgPackCatalogue) content.register({ enemies: [...content.allEnemies(), ...rpgPackCatalogue.variants.map((variant) => variant.stats)] });
  const packFixture = packLab && packId ? packLab.assembleRegionalPackFixture(packId, {
    heightAt: (x, z) => scene.meshHeightAt(x, z), baseY: worldPorts.baseY, assetSize: worldPorts.assetSize,
  }, rpgPackCatalogue) : null;
  const built = profile.buildSemanticWorld(store.get().meta.seed, heightAt, worldPorts);
  const huntLab = profile.kind === "feature-lab" && new URLSearchParams(location.search).get("hunt") === "1"
    ? await import("../featureLab/huntContracts.js") : null;
  const huntFixture = huntLab?.assembleHuntContractsFixture((x, z) => scene.meshHeightAt(x, z), worldPorts.baseY, worldPorts.assetSize);
  const motionCohort = new URLSearchParams(location.search).get("motion");
  const groundMotionLab = profile.kind === "feature-lab" && (motionCohort === "1" || motionCohort === "legacy")
    ? await import("../featureLab/groundMotion.js") : null;
  const motionActors = new URLSearchParams(location.search).get("motionActors");
  const groundMotionFixture = groundMotionLab?.createGroundMotionFixture({ heightAt: (x, z) => scene.meshHeightAt(x, z), baseY: worldPorts.baseY, assetSize: worldPorts.assetSize,
    ...(motionCohort === "legacy" ? { cohort: "legacy" as const } : {}),
    ...(motionActors === null ? {} : { assetIds: motionActors.split(",").map((id) => id.trim()) }),
  });
  if (groundMotionFixture) {
    built.entities.push(...structuredClone(groundMotionFixture.entities));
    (window as Window & { __groundMotionLab?: unknown }).__groundMotionLab = { actors: groundMotionFixture.actors, habitats: groundMotionFixture.habitats, spawn: groundMotionFixture.spawn };
  }
  if (huntFixture) built.entities.push(...structuredClone(huntFixture.entities));
  if (packFixture) built.entities.push(...structuredClone(packFixture.entities));
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
  const sitePlacements: ResolvedWorldSiteDressing[] = [];
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
    const settings: WorldSite[] = [...WORLD_SITES, ...WORLD_HABITATS.map((habitat): WorldSite => ({
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
      const result = await buildWorldSiteDressing(scene, assets, setting);
      sitePlacements.push(...result.placements);
      built.solids.push(...result.solids);
      if (setting.cutFace) {
        const cut = await buildMineCutFace(scene, assets, setting, built.entities);
        scene.scatterGroup.add(...cut.objects);
        built.solids.push(...cut.solids);
      }
    }
  }


  // The fitted stone recess gives the existing portal visible depth beyond its masonry arch.
  const portalMouths = portalFixture?.entities ?? built.entities.filter((entity) => entity.id === "gravelmaw_mouth_portal" || entity.id === "gravelmaw_exit_portal");
  for (const portal of portalMouths) {
    const { buildDungeonMouth } = await import("../render/dungeonMouth.js");
    const { applyCorealmSurfaceMaterials } = await import("../render/corealmSurfaceMaterials.js");
    const mouth = buildDungeonMouth(portal);
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
  let discoverySystem: DiscoverySystem | null = null;
  const entityStore = new EntityStore({
    skillLevels,
    discoveredLocationIds: () => discoverySystem?.discovered() ?? null,
  });
  entityStore.load(built.entities);
  if (authoredDungeonSpec) relocateDungeonSave(store.get(), authoredDungeonSpec, {
    surfaceHeightAt: (x, z) => scene.meshHeightAt(x, z),
    entityRegion: (id) => entityStore.get(id)?.regionId,
  });
  const dungeonDoors = doorLogic && doorThresholds.length
    ? new doorLogic.DungeonDoors(doorThresholds.map((entry) => entry.barrier), (id) => entityStore.get(id))
    : null;
  if (dungeonDoors) nav.setPathConstraint((path) => dungeonDoors.clipPath(path));
  entityStore.registerLocations(built.knownLocations);
  const forestObstacles = new ForestObstacles();
  const forestInstances = new Map<string, { descriptor: ForestTreeDescriptor; setVisible: (visible: boolean) => void }>();
  const forestPresentation = new ForestPresentation();
  const forest = new ForestResources({
    entities: entityStore,
    getNodeState: (id) => store.get().world.nodes[id],
    onActivate: (tree) => {
      forestPresentation.activate(tree.id, store.get().world.nodes[tree.id]?.state === "depleted");
      if (store.get().world.nodes[tree.id]?.state !== "depleted") forestObstacles.upsert(tree);
    },
    onDeactivate: (tree) => {
      forestPresentation.deactivate(tree.id);
      forestObstacles.remove(tree.id);
    },
  });
  const registerForestTree = (descriptor: ForestTreeDescriptor, setVisible: (visible: boolean) => void): void => {
    forestInstances.set(descriptor.id, { descriptor, setVisible });
    forestPresentation.register(descriptor.id, setVisible);
    forest.register(descriptor);
  };
  const updateForest = (): void => {
    const state = store.get();
    const pins = new Set<string>();
    if (state.player.movement.destinationEntityId) pins.add(state.player.movement.destinationEntityId);
    if (state.activity?.kind === "gathering") pins.add(state.activity.entityId);
    forest.update(state.player.position, pins);
    forest.forEachResident((entity, tree) => {
      forestPresentation.activate(tree.id, entity.state === "depleted");
      if (entity.state === "depleted") forestObstacles.remove(tree.id);
      else forestObstacles.upsert(tree);
    });
  };
  rehydrateWorldContainers(store.get(), entityStore, {
    regionAt: (position) => scene.regionAt(position[0], position[2]),
  });
  // The other half of the same restore: dead or damaged enemy runtimes reapplied onto the freshly
  // rebuilt entities, or a monster killed just before a refresh comes back as an unattackable
  // ghost for the rest of its respawn timer.
  rehydrateEnemyRuntimes(store.get(), entityStore, clock.elapsedMs);
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
  const caveRockSource = caveLabModule && new URLSearchParams(location.search).get("caveSource") === "1"
    ? await (await import("../render/dungeon.js")).loadCaveRockSource("/assets/models/cave/rock-face-01.glb")
    : undefined;
  const caveFixture = caveLabModule?.createCaveLabFixture({ scene, surfaceTextures, rockSource: caveRockSource }) ?? null;
  const dungeonSpec = caveFixture?.spec ?? authoredDungeonSpec;
  const dungeon = caveFixture ?? (dungeonSpec ? buildDungeon(dungeonSpec, scene.materials, { surfaceTextures }) : null);
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
    // volumes to navigation and deleting the walkable chamber underneath them.
    for (const mesh of dungeon.blockers) cameraQueries.addStaticMesh(mesh);
  }

  // Imported altar ruins are not one solid box. Their authored triangles preserve the walkable
  // circular platform and every arch opening while keeping columns, walls, and the central stone
  // monument solid. Loading here also warms the same cached GLB EntityViews uses below.
  let structureNavigation = { roots: [] as THREE.Group[], meshes: [] as THREE.Mesh[] };
  try {
    structureNavigation = await buildStructureNavigationSources(assets, built.entities);
  } catch (cause) {
    errors.push({ atMs: atMs(), source: "structure.navigation", message: describeError(cause) });
  }

  // 8b. Buildings become solid before the navmesh is generated, so paths route around them
  //     instead of through a wall. Gatehouses emit two pier boxes with the gate gap left open.
  for (const box of built.buildings) {
    cameraQueries.addStaticBox(box.position, box.halfExtents as unknown as Vec3, box.rotationY, box.buildingId);
  }
  for (const mesh of structureNavigation.meshes) cameraQueries.addStaticMesh(mesh);
  const structureCamera = await buildStructureCameraSources(assets, built.entities);
  const roofVisibility = new RoofVisibility();
  roofVisibility.setSources(structureCamera.meshes);
  for (const mesh of structureCamera.meshes) cameraQueries.addStaticMesh(mesh);
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
  let navCarves = solidObstacleMeshes(built.solids.map((solid) => encounterNavSolids.get(solid.id) ?? solid));
  const navCarveGroup = new THREE.Group();
  navCarveGroup.name = "nav-obstacles";
  navCarveGroup.visible = false;
  for (const mesh of navCarves) navCarveGroup.add(mesh);
  navCarveGroup.updateMatrixWorld(true);
  renderer.scene.add(navCarveGroup);

  // 9. Navmesh over the walkable terrain, then the route graph above it.
  setStatus("mapping walkable ground…");
  const navigationTerrain = fishingLab || profile.kind === "game"
    ? dryNavigationMeshes(scene.getWalkableMeshes(), scene.getWaterBodies()).meshes
    : scene.getWalkableMeshes();
  const navigationInput = [
    ...navigationTerrain,
    ...(dungeon?.walkable ?? []),
    ...(dungeon?.blockers ?? []),
    ...structureNavigation.meshes,
    ...navCarves,
  ];
  const navigationBuilt = await bootTelemetry.measureAsync(
    BOOT_SPANS.NAVIGATION_BUILD,
    () => nav.buildOrImport(navigationInput, { worldSeed: store.get().meta.seed }),
  );
  if (!navigationBuilt) {
    const failure = nav.snapshot(null, null, 0).error ?? "unknown";
    errors.push({ atMs: atMs(), source: "navigation", message: `Navmesh build failed: ${failure}` });
  } else {
    bootTelemetry.milestone(BOOT_MILESTONES.NAVIGATION_READY);
  }
  nav.setRouteGraph(built.routeNodes, built.routeEdges);

  // Path distance, not straight line: `ObservedEntity.distance` is documented as walking distance,
  // and across Karrowmoor's terraces the difference is large enough to change an agent's choice.
  entityStore.setDistanceFunction((from, to) => nav.pathDistance(from, to) ?? straightLineDistance(from, to));

  // 10. Procedural dressing, kept clear of anything authored.
  setStatus("dressing the world…");
  const fixtureSpawn = groundMotionFixture?.spawn ?? packFixture?.spawn;
  const spawnSpec = fixtureSpawn ? { ...profile.spawn, x: fixtureSpawn[0], z: fixtureSpawn[2], regionId: "fallowmarch" as const } : profile.spawn;
  assets.setActiveRegion(spawnSpec.regionId);
  const scatterStreaming = new ScatterStreamingController(scene, assets, store.get().meta.seed, { onTree: registerForestTree });
  let scatterResults: ScatterResult[] = [];
  if (profile.scatter) {
    await assets.load("corealm_grass_1", { priority: "visible-spawn", primary: true });
    scene.setGrassSource(assets.instance("corealm_grass_1"));
    registerExclusions(scene, built.solids, sitePlacements);
    for (const habitat of WORLD_HABITATS) {
      const bounds = getRegion(habitat.regionId)?.bounds;
      if (!bounds) continue;
      const inside = (point: Vec3) => point[0] >= bounds.min[0] && point[0] <= bounds.max[0]
        && point[2] >= bounds.min[1] && point[2] <= bounds.max[1]
        && Math.hypot(point[0] - habitat.centre[0], point[2] - habitat.centre[1]) <= habitat.radius;
      for (const entity of built.entities.filter((entry) => entry.meta?.groupId === habitat.groupId)) {
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
    try {
      scatterResults = await bootTelemetry.measureAsync(
        "boot.scatter.total",
        () => worldMapCapture
          ? scatterStreaming.forceFullResidency()
          : scatterStreaming.loadSpawn(spawnSpec.x, spawnSpec.z),
      );
      bootTelemetry.milestone(BOOT_MILESTONES.SCATTER_SPAWN_READY, {
        regions: scatterResults.length,
        layers: scatterResults.reduce((total, result) => total + Object.keys(result.byLayer).length, 0),
      });
    } catch (cause) {
      errors.push({ atMs: atMs(), source: "scatter", message: describeError(cause) });
    }
  }

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
    maxUniqueDrawCalls: 96,
    maxUniqueViews: 16,
    // Equal to `maxUniqueViews`, because a mixer budget UNDER the rig ceiling is where the herd
    // jitter lived: at the default 10, a field with all 16 rigs alive handed the far eleven a
    // rotating five slots, so every walking cow in the group advanced its cycle in uneven 33-50 ms
    // steps instead of one per frame. Sixteen small quadruped mixers are well under a millisecond;
    // the rotation in `orderAnimationBudget` stays as the safety net rather than the steady state.
    maxAnimatedViews: 16,
  });
  renderer.transmissionCandidates = () => entityViews.transmissiveMeshes();
  renderer.transmissionOpaqueOccluders = () => entityViews.staticOccluderMeshes();
  const spawnPosition: Vec3 = [spawnSpec.x, 0, spawnSpec.z];
  forest.update(spawnPosition, new Set());
  const surfaceEntities = entityStore.all().filter((entity) => entity.regionId !== "gravelmaw");
  entityViews.updateActiveArea(
    spawnPosition,
    profile.kind === "feature-lab" ? 220 : ENTITY_BOOT_RADIUS,
    structureResidencyRadius(initialSettings.drawDistance),
  );
  setStatus("preloading structures…");
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
        await residency;
        return;
      }
      const activeRadius = entityViews.residencyStats().radius;
      const spawnVisible = surfaceEntities.filter(
        (entity) => distanceXZ(entity.position, spawnPosition) <= activeRadius,
      );
      // Structural sources are shared across the island. Load them once behind the boot screen so
      // moving the residency ring only allocates already-decoded meshes and never builds a town a
      // few walls at a time. Actors and resources keep the smaller working set above.
      const structures = entityStore.all().filter(isStructureEntity);
      const preparation = entityViews.prepare([...structures, ...spawnVisible]);
      // `prepare` queues the full list synchronously. Freeze its size once so only the completed
      // side advances while the boot screen is visible.
      statusAssetTarget = assets.getLoadStats().requested;
      refreshStatus();
      const prepared = await preparation;
      for (const missing of prepared.missing) {
        errors.push({ atMs: atMs(), source: "entityViews", message: `Missing asset "${missing}"` });
      }
    },
  );
  statusAssetTarget = null;
  setStatus("preparing the player…");
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

  // 12. Player.
  const groundY = scene.heightAt(spawnSpec.regionId, spawnSpec.x, spawnSpec.z);
  const spawn: Vec3 = nav.closestPoint([spawnSpec.x, groundY + 0.2, spawnSpec.z]) ?? [spawnSpec.x, groundY, spawnSpec.z];
  // Facing convention matches NpcStandDef and debug/shots.ts: 0 looks toward +z.
  // The camera sits behind the player, so its yaw is the player's facing plus pi.
  const spawnFacing = packFixture ? Math.PI : spawnSpec.facingRad;
  if (!resumedFromSave) {
    store.get().player.position = spawn;
    store.get().player.regionId = spawnSpec.regionId;
    store.get().player.facingRad = spawnFacing;
  }
  const initialPlayerPosition = store.get().player.position;
  const initialPlayerFacing = store.get().player.facingRad;
  // A real skinned character rather than the round-0 capsule. If the rig fails to build for any
  // reason the capsule stays as the fallback, because a missing player is unrecoverable and an
  // ugly player is not.
  const playerRig = new CharacterRig(assets);
  const playerBody = profile.kind === "feature-lab" && new URLSearchParams(location.search).get("body") === "female" ? "female" : "male";
  const rigged = await bootTelemetry.measureAsync(
    BOOT_SPANS.PLAYER_CONSTRUCTION,
    () => playerRig.build({
      bodyAssetId: `base_${playerBody}`,
      outfitAssetIds: [`outfit_${playerBody}_peasant_chest`, `outfit_${playerBody}_peasant_legs`, `outfit_${playerBody}_peasant_boots`],
      preloadGear: false,
      playerLocomotion: true,
    }),
  );
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
      () => playerRig.applyEquipment(store.get().equipment),
    );
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
  movement.setPorts({ solids: movementSolids, heightAt, preserveNavigationHeight, entities: entityStore, dynamicObstacles: forestObstacles });
  const api = new CorealmGameApi(store, events, nav, movement, clock);

  const interactions = new InteractionDispatcher({
    get: (id) => entityStore.get(id),
    playerPosition: () => store.get().player.position,
    skillLevels,
  });

  // ---- Round 2 systems. Construction order follows the dependency chain: inventory first, then
  // the systems that move items, then the activity spine, then the activities themselves.

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

  // `use()` on a wearable should equip it, which is what clicking a sword means. Equipment does not
  // exist yet at this point, so the dep is a late-bound closure rather than a direct reference.
  let equipmentSystem: EquipmentSystem | undefined;
  let eatingSystem: EatingSystem | undefined;
  const inventorySystem = new InventorySystem({
    store, events, now,
    beginEating: (itemId, durationMs, atMs) =>
      eatingSystem?.beginEating(itemId, durationMs, atMs) ?? false,
    equip: (itemId) => equipmentSystem
      ? equipmentSystem.equip(itemId)
      : { ok: false as const, error: { code: "UNAVAILABLE" as const, message: "Equipment is not ready" } },
  });
  equipmentSystem = new EquipmentSystem({
    store,
    events,
    inventory: inventorySystem,
    now,
    ...(profile.kind === "feature-lab" ? { skillLevel: () => 99 } : {}),
  });
  const bankSystem = new BankSystem({
    store, events, inventory: inventorySystem, dispatcher: interactions, now,
    inRangeOfBank: () => nearArchetype("bank"),
    persist: () => { saves.save(store.get(), Date.now()); },
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

  const activitySystem = new ActivitySystem(store, events);
  eatingSystem = new EatingSystem({ store, activity: activitySystem, inventory: inventorySystem });
  const campfireSystem = new CampfireSystem({
    store,
    events,
    activity: activitySystem,
    inventory: {
      countItem: (itemId) => inventorySystem.countItem(itemId),
      removeItem: (itemId, quantity) => inventorySystem.removeItem(itemId, quantity),
    },
    entities: entityStore,
    fuelFor: campfireFuelLookup(GATHERING_PRODUCTION_TIERS),
    now,
    placement: {
      groundAt: (regionId, x, z) => {
        if (dungeonSpec && regionId === dungeonSpec.regionId) {
          const y = chamberFloorAt(dungeonSpec, [x, 0, z]);
          if (y === null) return null;
          const step = 0.35;
          const dx = (dungeonFloorHeight(dungeonSpec, x + step, z)
            - dungeonFloorHeight(dungeonSpec, x - step, z)) / (step * 2);
          const dz = (dungeonFloorHeight(dungeonSpec, x, z + step)
            - dungeonFloorHeight(dungeonSpec, x, z - step)) / (step * 2);
          const length = Math.hypot(dx, 1, dz);
          return { y, normal: [-dx / length, 1 / length, -dz / length] as Vec3 };
        }
        const sample = scene.sampleWorld(x, z);
        if (!sample.playable || sample.semanticRegion !== regionId || sample.waterBodyId) return null;
        return { y: scene.meshHeightAt(x, z), normal: scene.normalAt(x, z) };
      },
      withinPlayableBounds: (regionId, position) => {
        if (dungeonSpec && regionId === dungeonSpec.regionId) {
          return chamberFloorAt(dungeonSpec, position) !== null;
        }
        const sample = scene.sampleWorld(position[0], position[2]);
        return sample.playable && sample.semanticRegion === regionId;
      },
      distanceToWater: (regionId, position) => {
        if (dungeonSpec && regionId === dungeonSpec.regionId) return Number.POSITIVE_INFINITY;
        // The placement rule only needs to distinguish "closer than one metre". Dense, concentric
        // probes against the solved water contours also catch the authored ocean just outside the
        // playable rectangle without introducing a second water calculation.
        const radii = [0, 0.2, 0.4, 0.6, 0.8, 1] as const;
        for (const radius of radii) {
          const samples = radius === 0 ? 1 : 32;
          for (let index = 0; index < samples; index += 1) {
            const angle = (index / samples) * Math.PI * 2;
            const sample = scene.sampleWorld(
              position[0] + Math.sin(angle) * radius,
              position[2] + Math.cos(angle) * radius,
            );
            if (!sample.playable || sample.waterBodyId) return radius;
          }
        }
        return 1.001;
      },
      clearAt: (regionId, position, radius) => {
        // `Solids.resolve` already answers circle-vs-building/resource collision for movement. A
        // zero-length move with the campfire clearance radius reuses that exact canonical shape.
        const resolved = solids.resolve(position, position, radius);
        if (distanceXZ(position, resolved) > 0.001) return false;
        for (const entity of entityStore.all()) {
          if (!entity.resource || entity.id === CAMPFIRE_ENTITY_ID || entity.regionId !== regionId) continue;
          if (distanceXZ(position, entity.position) < radius) return false;
        }
        return true;
      },
    },
  });
  const gatheringSystem = new GatheringSystem({
    store, events, clock, rng, entities: { get: (id) => entityStore.get(id) ?? forest.resolve(id) },
    inventory: inventorySystem, activity: activitySystem, dispatcher: interactions,
  });
  // The first render happened before the save was loaded. Gathering construction hydrates saved
  // node semantics, and this second sync makes depleted rocks, stumps, and fishing recovery marks
  // visible before the loading screen is dismissed.
  entityViews.sync(profile.kind === "feature-lab" ? entityStore.all() : surfaceEntities);
  const essenceSystem = new EssenceSystem({
    store,
    events,
    inventory: inventorySystem,
    dispatcher: interactions,
    entities: entityStore,
    syncViews: () => entityViews.sync(entityStore.all()),
    now,
  });
  const traversalPresentation = new TraversalPresentation(async () => {
    const player = store.get().player;
    scene.syncPlayer(player.position, player.facingRad, true);
    camera.update(...player.position, true);
    refreshVisualResidency(player.position, player.regionId, true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    renderer.render(performance.now());
  });
  const agilitySystem = new AgilitySystem({
    store, events, clock, rng, entities: entityStore,
    activity: activitySystem, dispatcher: interactions, nav,
    presentation: traversalPresentation,
    isLandingSafe: (position) => distanceXZ(position, solids.resolve(position, position, 0.35)) < 0.01,
  });
  movement.setPorts({ shortcuts: {
    begin: (id, entry, exit) => agilitySystem.beginRoute(id, entry, exit),
    cancel: (atMs, reason) => agilitySystem.cancelTraversal(atMs, reason),
  } });

  // ---- Combat and production. Combat is not an activity: it owns an independent state slice.
  // Food still rejects an active attack target, and an eating activity pauses the attack cadence.
  const combatSystem = new CombatSystem({
    store, events, rng,
    entities: entityStore,
    equipment: equipmentSystem,
    inventory: inventorySystem,
    dispatcher: interactions,
    movement,
    activity: activitySystem,
    lootView: LOOT_PILE_VIEW,
    meleeTiming: (attacker, sourceId) => {
      if (attacker === "player") return playerRig.meleeTiming();
      const assetId = entityStore.get(sourceId)?.view?.assetId;
      const clip = assetId ? assets.clipOf(assetId, "Attack") : undefined;
      const timing = assetId ? CREATURE_MOTION_TIMING[assetId] : undefined;
      const recoveryMs = (timing?.seconds ?? clip?.duration ?? 0.9) * 1000;
      const reviewingRhinoContact = profile.kind === "feature-lab"
        && new URLSearchParams(location.search).get("rhinoTiming") === "1"
        && assetId?.startsWith("boss_rhino_");
      return { contactMs: recoveryMs * (reviewingRhinoContact ? 0.33229264631653577 : timing?.contactNormalized ?? 0.45), recoveryMs };
    },
  });
  const enemyAiSystem = new EnemyAiSystem({
    store, events, entities: entityStore, combat: combatSystem, nav,
    ...((packFixture || groundMotionFixture) ? { habitatForEntity: (entity: SemanticEntity) => groundMotionFixture?.habitatForEntity(entity) ?? (packFixture && entity.meta?.groupId === packFixture.habitat.groupId ? packFixture.habitat : null) } : {}),
    // `meshHeightAt`, not `heightAt`: the drawn lattice needs no region id, and a creature's feet
    // should land on the same surface the SpellVfx impact rings chose it for. Without this port,
    // every step kept the navmesh's Y — 0.147-0.417 m above the drawn ground — so any animal that
    // had ever moved hovered in the air. The player's movement has carried the equivalent
    // `heightAt` port since that float was measured; this is the same fix for everything else.
    groundHeightAt: (x, z) => scene.meshHeightAt(x, z),
  });
  const healthSystem = new HealthSystem({ store, events, equipment: equipmentSystem });
  let openLootContainer: ((container: LootContainerView) => void) | undefined;
  const respawnAnchors = new RespawnAnchorSystem({
    store, anchors: () => buildSettlementRespawnAnchors((id) => nav.routeNode(id)),
  });
  respawnAnchors.update();
  const deathSystem = new DeathSystem({
    store, events,
    entities: entityStore,
    inventory: inventorySystem,
    dispatcher: interactions,
    onLootOpened: (container) => openLootContainer?.(container),
    // Respawn points are authored per region; fall back to the region's own spawn.
    respawn: {
      resolve: (respawnPointId: string, regionId: RegionId) => {
        const anchor = respawnAnchors.resolve(respawnPointId);
        if (anchor) return anchor;
        const node = nav.routeNode(respawnPointId);
        if (node) return { position: node.position, regionId: node.regionId as RegionId };
        const region = getRegion(regionId) ?? getRegion("fallowmarch");
        const fallbackId: RegionId = region?.id ?? "fallowmarch";
        const spot = region?.spawnPoint ?? [spawnSpec.x, spawnSpec.z];
        const y = scene.heightAt(fallbackId, spot[0], spot[1]);
        return { position: [spot[0], y, spot[1]] as Vec3, regionId: fallbackId };
      },
    },
    health: healthSystem,
    combat: combatSystem,
    enemyAi: enemyAiSystem,
    activity: activitySystem,
    movement,
    snapToGround: (point) => nav.closestPoint(point),
    // Without this the recovery cache has no `view`, and `entityViews.sync` skips any entity that
    // has none — so everything the player was carrying sat on a patch of grass with nothing drawn
    // over it and nothing to right-click. The agent path never noticed, because an agent finds it
    // through `observe` and loots it by id; a human had no way to see that it was there at all.
    // That asymmetry is the exact thing this project's parity rule exists to catch.
    cacheView: RECOVERY_CACHE_VIEW,
  });
  const productionSystem = new ProductionSystem({
    store, events, rng,
    entities: entityStore,
    inventory: inventorySystem,
    activity: activitySystem,
    dispatcher: interactions,
  });
  activitySystem.register(productionSystem.driver);

  // ---- Quests and dialogue.
  //
  // Quests are the only system that writes world state (two doors), so the entity port is narrowed
  // to exactly that: read, and set a state with an optional locked reason.
  const questEntityPort = {
    get: (id: EntityId) => entityStore.get(id),
    setState: (id: EntityId, state: string, lockedReason?: string): boolean => {
      const entity = entityStore.get(id);
      if (!entity) return false;
      entity.state = state;
      if (entity.view && entity.meta?.["dungeonDoor"] === true) {
        const assetId = entity.meta[state === "open" || state === "unbarred" ? "openAssetId" : "closedAssetId"];
        if (typeof assetId === "string") entity.view.assetId = assetId;
      }
      if (lockedReason !== undefined) {
        entity.meta = { ...(entity.meta ?? {}), lockedReason };
      }
      return true;
    },
  };

  // XP must travel the real level-up path, or `level.gained` never fires and quests that reward XP
  // silently skip the level a player just earned.
  const questXpPort = {
    award: (skill: SkillId, amount: number): void => {
      const result = addSkillXp(store.get(), skill, amount);
      if (result.levelsGained > 0) {
        events.emit(
          "level.gained",
          { skill, level: result.newLevel, levelsGained: result.levelsGained },
          undefined,
          clock.elapsedMs,
        );
      }
      store.markDirty();
    },
  };

  discoverySystem = new DiscoverySystem({
    store,
    events,
    locations: () => built.knownLocations,
  });
  // Once, before the first frame: a loaded save or a fresh spawn knows where it is standing rather
  // than finding out 700 ms in.
  discoverySystem.sweep(clock.elapsedMs);

  const questSystem = new QuestSystem({
    store, events, clock,
    entities: questEntityPort,
    inventory: inventorySystem,
    xp: questXpPort,
    dispatcher: interactions,
  });
  questSystem.rehydrateWorldState();
  const dialogueSystem = new DeferredDialogueSystem({
    store, events, clock,
    entities: entityStore,
    inventory: inventorySystem,
    xp: questXpPort,
    quests: questSystem,
    dispatcher: interactions,
  });

  // Portals. Registered AFTER agility so this handler wins the `enter` verb; it hands genuine
  // obstacles back rather than teleporting past a climb the player has not earned.
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
    return scene.regionAt(point[0], point[2]);
  };
  // Region is part of semantic player state, so ordinary movement must update it too. This port
  // uses Y to distinguish Gravelmaw from the Karrowmoor terrain directly above it.
  movement.setPorts({ regionAt: (point, currentRegionId) => currentRegionId === dungeonSpec?.regionId
    ? currentRegionId
    : scene.regionAt(point[0], point[2]) });

  let activeVisualCentre: Vec3 = [...spawn];
  let activeVisualRegion = spawnSpec.regionId;
  const entitiesForVisualRegion = (regionId: RegionId): SemanticEntity[] => {
    const insideDungeon = regionId === "gravelmaw";
    return entityStore.all().filter((entity) => (entity.regionId === "gravelmaw") === insideDungeon);
  };
  const refreshVisualResidency = (position: Vec3, regionId: RegionId, force = false): void => {
    const regionChanged = regionId !== activeVisualRegion;
    const moved = distanceXZ(position, activeVisualCentre) >= ENTITY_ACTIVE_REPOSITION_DISTANCE;
    if (!force && !regionChanged && !moved) return;

    assets.setActiveRegion(regionId);
    scatterStreaming.setActivePosition(position[0], position[2]);
    // Distance-culls resident scatter shards against the fog wall. Without this the arena and
    // canopy poses drew every in-frustum tile across the whole island; see updateStreaming.
    scene.updateStreaming(position[0], position[2]);
    if (regionChanged || force) entityViews.sync(entitiesForVisualRegion(regionId));
    entityViews.updateActivePosition(position);
    activeVisualCentre = [...position];
    activeVisualRegion = regionId;

    if (regionChanged || force) {
      void entityViews.preloadRegion(regionId).catch((cause) => {
        errors.push({ atMs: atMs(), source: "entityStreaming", message: describeError(cause) });
      });
      if (profile.scatter) {
        void scatterStreaming.loadSpawn(position[0], position[2]).then((results) => {
          scatterResults = results;
        }).catch((cause) => {
          errors.push({ atMs: atMs(), source: "scatterStreaming", message: describeError(cause) });
        });
      }
    }
  };

  const teleportPlayer = (position: Vec3, regionId: RegionId): void => {
    const snapped = nav.closestPoint(position) ?? position;
    store.get().player.position = snapped;
    store.get().player.regionId = regionId;
    audioDirector.setRegion(regionId);
    movement.stop(store.get(), clock.elapsedMs, "portal");
    scene.syncPlayer(snapped, store.get().player.facingRad, true);
    camera.update(snapped[0], snapped[1], snapped[2], true);
    refreshVisualResidency(snapped, regionId, true);
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
  if (store.get().huntContracts.offerSerial === 0) hunts.refreshOffers();
  if (huntFixture) (window as Window & { __huntLab?: unknown }).__huntLab = {
    snapshot: () => hunts.snapshot(), refreshOffers: () => hunts.refreshOffers(),
    accept: (id: string) => hunts.accept(id), claim: () => hunts.claim(), abandon: () => hunts.abandon(),
    attack: (id: string) => api.attack(id),
    spawn: huntFixture.spawn,
  };
  let pausedBeforePortal = false;
  const portalTransition = new PortalTransition((locked) => {
    if (locked) pausedBeforePortal = clock.paused;
    clock.paused = locked || pausedBeforePortal;
    input.clear();
  });
  const transitionThroughPortal = (destination: { position: Vec3; regionId: RegionId; name: string }, commit: () => void): Promise<void> => portalTransition.run({
    name: destination.name,
    prepare: async () => {
      const destinationEntities = entitiesForVisualRegion(destination.regionId).filter((entity) =>
        distanceXZ(entity.position, destination.position) <= (profile.kind === "feature-lab" ? 220 : ENTITY_ACTIVE_RADIUS + STRUCTURE_RESIDENCY_MARGIN));
      const prepared = await entityViews.prepare(destinationEntities);
      if (prepared.missing.length) throw new Error(`Could not load the passage: ${prepared.missing.join(", ")}`);
      if (profile.scatter && destination.regionId !== "gravelmaw") {
        scatterResults = await scatterStreaming.loadSpawn(destination.position[0], destination.position[2]);
      }
    },
    commit: () => {
      camera.setFreeTarget(null);
      commit();
      const player = store.get().player;
      audioDirector.setRegion(player.regionId);
      scene.syncPlayer(player.position, player.facingRad, true);
      camera.update(...player.position, true);
      refreshVisualResidency(player.position, player.regionId, true);
      discoverySystem?.sweep(clock.elapsedMs);
    },
    settled: async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      renderer.render(performance.now());
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    },
  });
  const travelSystem = new TravelSystem({
    store, events, clock,
    entities: entityStore,
    nav,
    dispatcher: interactions,
    traverseObstacle: (context) => agilitySystem.begin(context),
    activity: activitySystem,
    place: teleportPlayer,
    transition: transitionThroughPortal,
  });
  movement.setPorts({ portals: {
    transition: (position, regionId, commit) => transitionThroughPortal({ position, regionId, name: regionId === "gravelmaw" ? "Gravelmaw" : "Surface" }, commit),
  } });
  void travelSystem;

  api.register("quests", questSystem);
  api.register("dialogue", dialogueSystem);
  api.register("combat", combatSystem.hook());
  api.register("production", productionSystem.hook());
  api.register("campfire", campfireSystem.hook());
  api.register("inventory", {
    slots: () => inventorySystem.slots(),
    freeSlots: () => inventorySystem.freeSlots(),
    use: (itemId, target) => {
      const result = inventorySystem.use(itemId, target);
      gameAudio.handleInventoryUse(result);
      return result;
    },
  });
  api.register("equipment", equipmentSystem);
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
  api.register("activity", activitySystem.hook());
  api.register("loot", {
    take: (entityId, stackIndex) => deathSystem.take(entityId, stackIndex),
  });

  api.register("entities", {
    get: (id) => entityStore.get(id),
    all: () => entityStore.all(),
    observe: (filter, from) => entityStore.observe(filter, from),
  });
  api.register("interactions", {
    run: (id, interaction) => {
      const result = interactions.run(id, interaction);
      gameAudio.handleInteraction(interaction, result);
      return result;
    },
    // Lets `GameApi.interact` walk to the VERB's reach instead of one constant for all of them,
    // which is what makes a staff attack open fire at nine metres instead of closing to 2.4 first.
    rangeFor: (interaction, entityId) => interactions.rangeFor(interaction, entityId),
  });

  // Assistance overlays, and the guidance layer over them that turns a marker into a destination:
  // a ground route from the player, arrival, and the agent's plan and the pinned quest walking
  // their markers forward. Presentation only: drawing one never changes canonical state, which is
  // what makes it safe to let an agent write here. A dynamic import, like the agent surface and
  // for the same reason: the renderer and the ribbon shader are not the first frame's business.
  const labelRoot = document.getElementById("ui-root") ?? document.body;
  const { createGuidance } = await import("./guidance.js");
  const { overlays, guidance } = createGuidance({
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

  // An altar payment is small but irreversible. Persist its charge and essence changes as soon as
  // the event publishes, and also on pagehide so a reload between the click and the next sim flush
  // cannot roll the transaction back. The regular ten-second autosave remains the general path.
  const persistCurrentState = (): void => { saves.save(store.get(), Date.now()); };
  events.subscribe((event) => {
    if (event.type === "essence.recharged" || event.type === "essence.altarAwakened") {
      persistCurrentState();
    }
  });
  window.addEventListener("pagehide", persistCurrentState);

  // Spell cast, flight and impact. A separate layer from `Vfx` and from `Ambience` because it is the
  // only one that is off entirely most of the time: one InstancedMesh drawing zero instances, which
  // costs no draw call until the player actually casts. `heightAt` is passed so an impact ring lies
  // on the ground the player is standing on rather than on a plane through the target's origin.
  const spellVfx = new SpellVfx({
    parent: scene.overlayGroup,
    camera: renderer.camera,
    // `meshHeightAt`, not `heightAt`: the latter needs a region id, and the only one to hand here is
    // the PLAYER's — which is the wrong answer for a target standing over a region boundary, and the
    // impact ring would sink into or float over the ground exactly where a region seam runs.
    // `meshHeightAt` samples the drawn lattice and needs no region at all.
    groundHeightAt: (x, z) => scene.meshHeightAt(x, z),
  });

  // Standing atmosphere, as opposed to the event-driven feedback above. Both are polled from Vfx's
  // own update, so the loop needs no change. One InstancedMesh for the whole world.
  const ambience = new Ambience(scene.overlayGroup, { maxParticles: 640 });
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
  // Polled rather than pushed: a telegraph has to keep drawing for the whole wind-up, and a dropped
  // frame on an `onTelegraph` listener would leave a ring on the ground after the slam landed.
  vfx.setTelegraphSource(() => enemyAiSystem.telegraphs().map((telegraph) => ({
    id: telegraph.enemyId,
    centre: telegraph.centre,
    radius: telegraph.radius,
    progress: telegraph.firesAtMs > telegraph.startedAtMs
      ? Math.min(1, Math.max(0, (clock.elapsedMs - telegraph.startedAtMs) / (telegraph.firesAtMs - telegraph.startedAtMs)))
      : 1,
  })));

  // "Click a distant ore" must walk there AND THEN mine it. The API remembers the intent; this is
  // what fires it on arrival. Both a human click and an agent tool call route through here.
  events.subscribe((event) => {
    // Events are flushed after input. A finished or cancelled old route must not consume the
    // interaction queued by a replacement route that is already moving.
    if (store.get().player.movement.mode !== "idle") return;
    if (event.type === "navigation.completed") api.resumePending();
    else if (event.type === "navigation.failed") api.clearPending();
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
      entityViews.setHighlight(entityId, SELECTION_HIGHLIGHT, true);
    } else if (entityId === hoveredActionId) {
      entityViews.setHighlight(entityId, HOVER_HIGHLIGHT, false);
    }
  };

  const input = new InputController(canvas, renderer, camera, api, movement, {
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
    onProduction: (entityId) => ui.openProduction(entityId),
  });
  input.setEntityPickSource((raycaster) => {
    const hit = entityViews.pickHit(raycaster);
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

  let featureLab: FeatureLabApi | undefined;
  let environmentLab: import("../featureLab/environment.js").EnvironmentWorkbench | undefined;
  let creatureGallery: import("../featureLab/creatureGallery.js").CreatureGallery | undefined;
  let forestFixture: Awaited<ReturnType<typeof import("../featureLab/forest.js").createForestFixture>> | undefined;
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
    const structureOrigin: Vec3 = [-8, scene.meshHeightAt(-8, 12), 12];
    let activeStructure: FeatureLabStructureAssembly | null = null;
    let activeStructureNavigation: THREE.Mesh[] = [];
    let activeStructureCamera: THREE.Mesh[] = [];
    let structureRevision = 0;
    let labFreeCameraEnabled = false;

    const resetLabPlayer = (): void => {
      const state = store.get();
      const landed = nav.closestPoint(spawn) ?? [...spawn] as Vec3;
      state.player.position = [...landed] as Vec3;
      state.player.regionId = spawnSpec.regionId;
      state.player.facingRad = spawnFacing;
      state.player.maxHealth = computeMaxHealth(state, equipmentSystem!.totals().vitality);
      state.player.health = state.player.maxHealth;
      movement.stop(state, clock.elapsedMs, "feature-lab-reset");
      input.clear();
      overlays.clear(WALK_DESTINATION_HIGHLIGHT_ID);
      camera.reset();
      camera.setPose(spawnFacing + Math.PI, CAMERA.defaultPitch, CAMERA.defaultDistance);
      camera.update(landed[0], landed[1], landed[2], true);
      scene.syncPlayer(landed, spawnFacing, true);
      if (rigged) playerRig.setPosition(landed, spawnFacing);
      store.markDirty();
    };

    const replaceLabCollision = (
      structureSolids: readonly SolidVolume[],
      structureMeshes: readonly THREE.Mesh[],
      cameraMeshes: readonly THREE.Mesh[] = activeStructureCamera,
    ): void => {
      movement.stop(store.get(), clock.elapsedMs, "feature-lab-structure");

      const allSolids = [...built.solids, ...structureSolids];
      const previousCarves = navCarves;
      const candidateCarves = solidObstacleMeshes(allSolids.map((solid) => encounterNavSolids.get(solid.id) ?? solid));
      for (const carve of previousCarves) carve.removeFromParent();
      for (const carve of candidateCarves) navCarveGroup.add(carve);
      navCarveGroup.updateMatrixWorld(true);
      if (!nav.build([
          ...navigationTerrain,
          ...(dungeon?.walkable ?? []),
          ...(dungeon?.blockers ?? []),
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
          ...(dungeon?.walkable ?? []),
          ...(dungeon?.blockers ?? []),
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
      structureMovementBounds = importedSurfaceBounds([...structureNavigation.meshes, ...structureMeshes]);
      movement.setPorts({ solids: movementSolids, heightAt, preserveNavigationHeight, entities: entityStore });
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
      const next = assembleFeatureLabStructure(selection, structureOrigin, {
        baseY: (assetId) => assets.baseY(assetId),
        assetSize: (assetId) => assets.assetSize(assetId),
        assetCenterXZ: (assetId) => assets.assetCenterXZ(assetId),
      });
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

    const fitStructure = (view: FeatureLabStructureView): void => {
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
      const state = store.get();
      state.player.position = [...point] as Vec3;
      state.player.regionId = spawnSpec.regionId;
      state.player.facingRad = 0;
      movement.stop(state, clock.elapsedMs, "feature-lab-fit-structure");
      input.clear();
      scene.syncPlayer(point, 0, true);
      if (rigged) playerRig.setPosition(point, 0);
      camera.setPose(Math.PI, 0.46, viewingDistance);
      camera.update(point[0], point[1], point[2], true);
      store.markDirty();
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
    if (params.get("atmosphere") === "1") {
      const { createBiomeAtmosphereWorkbench } = await import("../featureLab/biomeAtmosphere.js");
      createBiomeAtmosphereWorkbench(renderer.biomeAtmosphere);
    }
    if (profile.labMode === "combat" && params.get("creatureLoot") === "1") {
      const { createCreatureLootFixture } = await import("../featureLab/creatureLootFixture.js");
      (window as Window & { __creatureLootFixture?: unknown }).__creatureLootFixture = createCreatureLootFixture({
        store, entities: entityStore,
        prepareEntities: async (entities) => {
          const result = await entityViews.prepare([...entities]);
          if (result.missing.length) throw new Error(`Missing creature loot fixture assets: ${result.missing.join(", ")}`);
        },
        groundHeightAt: (x, z) => scene.meshHeightAt(x, z),
        baseY: (assetId) => assets.baseY(assetId),
      });
    }
    if (doorLab && doorFixture && dungeonDoors) {
      (window as Window & { __dungeonDoorLab?: unknown }).__dungeonDoorLab = doorLab.createDungeonDoorWorkbench(doorFixture, {
        entities: entityStore, doors: dungeonDoors, playerPosition: () => store.get().player.position,
        setDoorState: questEntityPort.setState, navigation: nav,
      });
    }
    if (caveFixture) {
      (window as Window & { __caveLab?: unknown }).__caveLab = caveFixture;
    }
    if (shopFixture) {
      (window as Window & { __shopLab?: unknown }).__shopLab = shopFixture;
    }
    if (portalFixture) {
      (window as Window & { __portalLab?: unknown }).__portalLab = portalFixture;
    }
    if (packFixture) {
      (window as Window & { __packLab?: unknown }).__packLab = {
        packId: packFixture.packId, ids: packFixture.entities.map((entity) => entity.id),
        habitat: packFixture.habitat, spawn: packFixture.spawn,
      };
    }
    if (agilityLabModule && agilityFixture) {
      const agilityWorkbench = agilityLabModule.createAgilityWorkbench(agilityFixture, {
        store, quests: questSystem, navigation: nav, movement, rng: rng.get("misc"),
        elapsedMs: () => clock.elapsedMs,
        getEntity: (id) => entityStore.get(id),
      });
      (window as Window & { __agilityLab?: unknown }).__agilityLab = agilityWorkbench;
      const { mountAgilityWorkbench } = await import("../featureLab/agilityWorkbench.js");
      mountAgilityWorkbench(agilityWorkbench, {
        interact: (id, verb) => api.interact(id, verb),
        moveTo: (target) => api.moveTo(target),
        stop: () => api.stop(),
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
      });
      new EnvironmentLabPanel(environmentLab, { onFrame: frameLabBounds });
    }
    if (params.get("progression") === "1") {
      const { createQuestRecoveryFixture } = await import("../featureLab/questRecovery.js");
      (window as Window & { __questRecoveryLab?: unknown }).__questRecoveryLab = createQuestRecoveryFixture({
        store, quests: questSystem, entities: entityStore,
        prepareEntities: async (entities) => {
          const result = await entityViews.prepare([...entities]);
          if (result.missing.length) throw new Error(`Missing quest fixture assets: ${result.missing.join(", ")}`);
        },
        groundHeightAt: (x, z) => scene.meshHeightAt(x, z),
        baseY: (assetId) => assets.baseY(assetId),
      });
    }
    if (params.get("gameplay") === "1") {
      const { createGameplayAcceptanceFixture } = await import("../featureLab/gameplayAcceptance.js");
      (window as Window & { __gameplayAcceptance?: unknown }).__gameplayAcceptance = createGameplayAcceptanceFixture({
        store, entities: entityStore,
        prepareEntities: async (entities) => {
          const result = await entityViews.prepare([...entities]);
          if (result.missing.length) throw new Error(`Missing gameplay fixture assets: ${result.missing.join(", ")}`);
        },
        groundHeightAt: (x, z) => scene.meshHeightAt(x, z),
        baseY: (assetId) => assets.baseY(assetId),
        assetSize: (assetId) => assets.assetSize(assetId),
      });
    }
    if (params.get("creatures") === "1") {
      const [{ createCreatureGallery }, { CreatureGalleryPanel }] = await Promise.all([
        import("../featureLab/creatureGallery.js"), import("../ui/creatureGalleryPanel.js"),
      ]);
      creatureGallery = await createCreatureGallery({ assets, scene, entityStore, entityViews });
      new CreatureGalleryPanel(creatureGallery, { onFrame: frameLabBounds });
    }
    if (params.get("forest") === "1") {
      forestFixture = await (await import("../featureLab/forest.js")).createForestFixture({ assets, scene, registerTree: registerForestTree });
      updateForest();
      await entityViews.prepare(entityStore.all());
      entityViews.sync(entityStore.all());
      inventorySystem.addItem("grithe_hatchet", 1);
    }
    const presentation = params.get("presentation") === "1"
      ? await (await import("../featureLab/presentation.js")).createPresentationFixture({
        assets, scene, entityStore, entityViews,
        rebuilt: params.get("environment") === "1",
      })
      : undefined;

    featureLab = createFeatureLabRuntime({
      api,
      store,
      events,
      clock,
      assets,
      entityStore,
      entityViews,
      inventory: inventorySystem,
      equipment: equipmentSystem!,
      essence: essenceSystem,
      combat: combatSystem,
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
      initialStructure,
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
      resetPlayer: resetLabPlayer,
      selectedEntityId: () => selectedEntityId,
      liveSpellParticles: () => spellVfx.liveParticles(),
      engineErrors: () => errors.map((entry) => `${entry.source}: ${entry.message}`),
      groundHeightAt: (x, z) => scene.meshHeightAt(x, z),
    });
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
    await featureLab.setStructure(structurePatch);
    if (profile.labMode !== "building") {
      const creatures = featureLab.getCatalog().targets.creature;
      const requestedCreature = params.get("creature");
      const initialTarget = (requestedCreature
        ? creatures.find((entry) => entry.id === requestedCreature || entry.id === `species:${requestedCreature}`)
        : undefined) ?? creatures[0];
      if (!initialTarget) throw new Error("The production content has no creature for the feature lab");
      await featureLab.spawnTarget("creature", initialTarget.id);
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
  const { installAgentSurface } = await import("../agent/index.js");
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
  const ui = createUi(api, {
    saveRecovery: {
      getRecovery: () => saves.getRecovery(),
      recoverSave: (json) => {
        const result = saves.recoverSerialized(json);
        if (result.status !== "loaded" || !result.state) return { ok: false, reason: result.reason ?? "Save recovery failed" };
        replaceWorldFromSave(result.state);
        ui.update();
        return { ok: true };
      },
    },
    settings: clientSettings,
    mapTerrain: {
      bounds: scene.getScatterBounds(Infinity),
      sample: (x, z) => ({
        height: scene.meshHeightAt(x, z),
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
    hasSave: () => resumedFromSave,
    // Declared below. Referenced from inside a closure, so the temporal dead zone never applies:
    // nothing can press "New game" before boot has finished running.
    onNewGame: () => resetWorld(undefined, false),
    ...(featureLab ? { featureLab } : {}),
    agentSession: agent.session,
  });
  openLootContainer = (container) => ui.openLoot(container);
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
    appliedPreferences = preferences;
  });

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
    if (event.type === "navigation.completed" || event.type === "navigation.failed") {
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
        expiresAtMs: typeof data["expiresAtMs"] === "number" ? data["expiresAtMs"] : null,
        expiresAtWallMs: typeof data["expiresAtWallMs"] === "number" ? data["expiresAtWallMs"] : null,
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

  const loop = new GameLoop({
    store, events, clock, rng, renderer, camera, scene, nav, movement, api, saves, input,

  });
  // The Gravelmaw chambers are authored a few metres below the surface, right beside the entrance,
  // so rendering every entity unconditionally drew the whole dungeon population on top of the
  // terrace. That single pose measured 803 draw calls against a 400 budget. The dungeon is only
  // visible from inside it.
  const playerInDungeon = (): boolean => store.get().player.regionId === "gravelmaw";
  // Tick order is each system's own `order` field, following the PRD's documented update order.
  loop.addSystem(campfireSystem);
  loop.addSystem(activitySystem);
  loop.addSystem(agilitySystem);
  loop.addSystem(gatheringSystem);
  loop.addSystem({ name: "forest-residency", order: 5, tick: updateForest });
  loop.addSystem(enemyAiSystem);
  loop.addSystem(combatSystem);
  loop.addSystem(healthSystem);
  loop.addSystem(deathSystem);
  loop.addSystem(respawnAnchors);
  loop.addSystem(productionSystem);
  loop.addSystem(questSystem);
  loop.addSystem(discoverySystem);
  loop.addSystem(gameAudio);

  if (dungeon) loop.addInterior(dungeon.group, () => store.get().player.regionId === "gravelmaw");
  if (portalFixture || dungeon) {
    loop.addInterior(scene.scatterGroup, () => store.get().player.regionId !== "gravelmaw");
    loop.addInterior(scene.terrainGroup, () => store.get().player.regionId !== "gravelmaw");
    for (const object of scene.root.children) {
      if (object.userData["portalInterior"]) loop.addInterior(object, () => store.get().player.regionId === "gravelmaw");
    }
  }
  // What the player is interacting with, so the rig can pick a pose for it: opening a chest is not
  // the same animation as swinging at a rock.
  loop.setArchetypeLookup((id) => entityStore.get(id)?.archetype ?? null);
  loop.setOverlays(guidance);
  loop.setVfx(vfx);
  loop.setSpellVfx(spellVfx);
  loop.setCombatHits(() => combatSystem.consumeHits());
  loop.setCombatAttackStarts(() => combatSystem.consumeAttackStarts(),
    (id) => combatSystem.isAttackCommitted(id) && entityStore.get(id)?.regionId === store.get().player.regionId);
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
  if (rigged) loop.setPlayerRig(playerRig);
  loop.setEntityViews(entityViews, () => {
    if (profile.kind === "feature-lab") return entityStore.all();
    return entitiesForVisualRegion(store.get().player.regionId);
  }, () => {
    if (profile.kind === "feature-lab") return;
    const player = store.get().player;
    refreshVisualResidency(player.position, player.regionId);
  }, () => forestPresentation.reconcile((id) => entityViews.hasView(id)));
  ui.setHuntContracts(hunts);
  loop.setTraversalPresentation(() => traversalPresentation.current());

  const rebuildSemanticWorld = (): void => {
    forest.reset();
    forestObstacles.clear();
    const rebuilt = profile.buildSemanticWorld(store.get().meta.seed, heightAt, worldPorts);
    if (huntFixture) rebuilt.entities.push(...structuredClone(huntFixture.entities));
    if (groundMotionFixture) rebuilt.entities.push(...structuredClone(groundMotionFixture.entities));
    if (packFixture) rebuilt.entities.push(...structuredClone(packFixture.entities));
    if (portalFixture) {
      rebuilt.entities.push(...structuredClone(portalFixture.entities));
      rebuilt.routeNodes.push(...portalFixture.routeNodes);
      rebuilt.routeEdges.push(...portalFixture.routeEdges);
    }
    if (shopFixture) rebuilt.entities.push(...structuredClone(shopFixture.entities));
    if (doorFixture) {
      rebuilt.entities.push(...structuredClone(doorFixture.entities));
      rebuilt.routeNodes.push(...doorFixture.routeNodes);
      rebuilt.routeEdges.push(...doorFixture.routeEdges);
    }
    if (agilityFixture) {
      rebuilt.entities.push(...structuredClone(agilityFixture.entities));
      rebuilt.routeNodes.push(...agilityFixture.routeNodes);
      rebuilt.routeEdges.push(...agilityFixture.routeEdges);
    }
    rebuilt.entities.push(...(fishingLab?.createFishingLabEntities(scene, assets) ?? []));
    entityStore.load(rebuilt.entities);
    if (authoredDungeonSpec) relocateDungeonSave(store.get(), authoredDungeonSpec, {
      surfaceHeightAt: (x, z) => scene.meshHeightAt(x, z),
      entityRegion: (id) => entityStore.get(id)?.regionId,
      navClosest: (point) => nav.closestPoint(point),
    });
    questSystem.rehydrateWorldState();
    entityStore.registerLocations(rebuilt.knownLocations);
    for (const { descriptor } of forestInstances.values()) forest.register(descriptor);
    updateForest();
    nav.setRouteGraph(rebuilt.routeNodes, rebuilt.routeEdges);
    rehydrateWorldContainers(store.get(), entityStore, { regionAt: regionAtPoint });
    rehydrateEnemyRuntimes(store.get(), entityStore, clock.elapsedMs);
    campfireSystem.reconstruct();
    syncCampfireAmbience();
    if (profile.kind === "feature-lab") entityViews.sync(entityStore.all());
    else refreshVisualResidency(store.get().player.position, store.get().player.regionId, true);
    if (store.get().huntContracts.offerSerial === 0) hunts.refreshOffers();
  };

  const resetWorld = (seed?: number, keepSave = false): void => {
    portalTransition.cancel();
    travelSystem.cancel();
    agilitySystem.cancelTraversal(clock.elapsedMs, "replaced");
    traversalPresentation.reset();
    if (!keepSave) saves.clear();
    store.reset(seed ?? store.get().meta.seed, Date.now());
    store.get().player.position = spawn;
    store.get().player.regionId = spawnSpec.regionId;
    store.get().player.facingRad = spawnFacing;
    rng.reseed(store.get().meta.seed);
    events.reset();
    clock.reset();
    productionSystem.reset(0);
    movement.stop(store.get(), 0, "reset");
    movement.setDirectInput({ forward: 0, strafe: 0, cameraYaw: 0 });
    input.clear();
    camera.reset();
    camera.setPose(spawnFacing + Math.PI, CAMERA.defaultPitch, CAMERA.defaultDistance);
    camera.update(spawn[0], spawn[1], spawn[2], true);
    scene.syncPlayer(spawn, spawnFacing, true);
    loop.resetPresentation();
    // Combat holds two things outside `GameState` - the hit log and any spell still in the air -
    // and a world swap has to drop both. Without this a bolt rolled against the old world lands in
    // the new one, on an entity id that now belongs to something else.
    combatSystem.resetForNewWorld();
    gameAudio.reset();

    // Node yields and enemy health are seeded world state, so a reset rebuilds them rather than
    // leaving a half-mined world behind a nominally fresh character.
    rebuildSemanticWorld();
    errors.length = 0;
  };

  /** Applies a migrated save to every runtime owner, not just to the JSON store. */
  const replaceWorldFromSave = (next: NonNullable<ReturnType<SaveService["deserialize"]>["state"]>): void => {
    portalTransition.cancel();
    travelSystem.cancel();
    agilitySystem.cancelTraversal(clock.elapsedMs, "replaced");
    traversalPresentation.reset();
    movement.stop(store.get(), clock.elapsedMs, "load");
    movement.setDirectInput({ forward: 0, strafe: 0, cameraYaw: 0 });
    store.replace(next);
    rng.reseed(next.meta.seed);
    events.reset();
    input.clear();
    loop.resetPresentation();
    combatSystem.resetForNewWorld();
    gameAudio.reset();
    rebuildSemanticWorld();
    productionSystem.reset(clock.elapsedMs);
    gatheringSystem.tick(0, clock.elapsedMs);

    const position = store.get().player.position;
    const facing = store.get().player.facingRad;
    if (rigged) playerRig.setPosition(position, facing);
    scene.syncPlayer(position, facing, true);
    camera.reset();
    camera.setPose(facing + Math.PI, CAMERA.defaultPitch, CAMERA.defaultDistance);
    camera.update(position[0], position[1], position[2], true);
    audioDirector.setRegion(store.get().player.regionId);
    discoverySystem.sweep(clock.elapsedMs);
  };

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
  ): void => {
    const landed = nav.closestPoint(playerTarget) ?? playerTarget;
    const regionId = regionAtPoint(landed);
    store.get().player.position = landed;
    store.get().player.regionId = regionId;
    store.get().player.facingRad = playerFacingRad;
    if (profile.kind === "feature-lab") entityViews.sync(entityStore.all());
    else refreshVisualResidency(landed, regionId, true);
    audioDirector.setRegion(regionId);
    movement.stop(store.get(), clock.elapsedMs, reason);
    scene.syncPlayer(landed, playerFacingRad, true);
    // Documentation poses may deliberately move inside the player-facing comfort zoom floor so a
    // held item can be inspected. Interactive mouse-wheel zoom still keeps CAMERA.minDistance.
    camera.setPose(yaw, pitch, distance, 2);
    camera.update(target[0], target[1], target[2], true);
    renderer.followShadow(renderer.camera.position.clone().setY(landed[1]));
  };

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
  const { installGameDebug } = await import("../debug/gameDebug.js");
  if (profile.kind !== "feature-lab" && new URLSearchParams(location.search).get("packAudit") === "1") {
    const { createRegionalPackWorldProbe } = await import("../world/regionalPackWorldProbe.js");
    (window as Window & { __packWorldAudit?: unknown }).__packWorldAudit = createRegionalPackWorldProbe({
      scene, assets, scatterStreaming, forestInstances,
      playerPosition: () => store.get().player.position,
      findPath: (from, to) => nav.findPath(from, to),
      resolveSolid: (desired, from, radius) => movementSolids.resolve(desired, from, radius),
    });
  }
  installGameDebug({
    store, events, clock, nav, movement, api, renderer, camera, assets, errors,
    isReady: () => debugReady,
    version,
    // Direct evidence that a cast drew something, for `tools/verify-magic.ts`. Reading `drawCalls`
    // instead conflates a spell with anything else that streamed in that frame.
    spellParticles: () => spellVfx.liveParticles(),
    audioState: () => ({
      ...audioEngine.snapshot(),
      regionId: store.get().player.regionId,
      diagnostics: audioDiagnostics.map(({ kind, message, name, url }) => ({ kind, message, name, url })),
    }),
    audioHistory: (limit) => audioEngine.history(limit),
    clearAudioHistory: () => audioEngine.clearHistory(),
    // "scatter placed nothing" and "nobody asked scatter" are different bugs, and the debug surface
    // could not tell them apart while boot threw this array away.
    scatterStats: () => scatterStreaming.getStats(),
    scatterResidency: () => scatterStreaming.getResidency(),
    scatterVisibility: () => scene.scatterVisibility.getStats(),
    playerMotion: () => playerRig.motionSnapshot(true),
    foliageOcclusion: () => scene.materials.getFoliageOcclusion(),
    roofVisibility: () => roofVisibility.snapshot(),
    playerSilhouette: () => renderer.playerSilhouette.snapshot(),
    setFoliageOcclusionEnabled: (enabled) => scene.materials.setFoliageOcclusionEnabled(enabled),
    setContainedTroughWater: (enabled) => entityViews.setContainedTroughWater(enabled),
    setFoliageOcclusionBoundsOptimization: (enabled) => scene.materials.setFoliageOcclusionBoundsOptimization(enabled),
    entityMotion: (entityId: EntityId) => entityViews.motionSnapshot(entityId),
    waterBodies: () => scene.getWaterBodies(),
    worldSample: (x: number, z: number) => scene.sampleWorld(x, z),
    setMovementDetourDiagnostics: (enabled) => movement.setDetourDiagnostics(enabled),
    movementDetourDiagnostics: () => movement.getDetourDiagnostics(),
    worldClearance: ({ x, z, y = scene.meshHeightAt(x, z), radius }) => {
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
    resetWorld,
    isIdle: () => store.get().player.movement.mode === "idle" && store.get().activity === null,
    teleport: (to: Vec3) => {
      const snapped = nav.closestPoint(to) ?? to;
      const regionId = regionAtPoint(snapped);
      store.get().player.position = snapped;
      store.get().player.regionId = regionId;
      audioDirector.setRegion(regionId);
      movement.stop(store.get(), clock.elapsedMs, "teleport");
      scene.syncPlayer(snapped, store.get().player.facingRad, true);
      camera.update(snapped[0], snapped[1], snapped[2], true);
      refreshVisualResidency(snapped, regionId, true);
    },
    saveNow: () => { saves.save(store.get(), Date.now()); },
    getSaveBlob: () => saves.serialize(store.get()),
    loadSaveBlob: (json: string) => {
      const loadedBlob = saves.loadSerialized(json);
      if (loadedBlob.status !== "loaded" || !loadedBlob.state) {
        errors.push({
          atMs: clock.elapsedMs,
          source: "debug.loadSaveBlob",
          message: loadedBlob.reason ?? "Save import failed",
        });
        return;
      }
      replaceWorldFromSave(loadedBlob.state);
      ui.update();
    },
    advanceWorldTime: (seconds) => gatheringSystem.fastForwardRespawns(seconds),
    /**
     * Moves the camera to a named repeatable pose. Screenshots and the perf budget both use these,
     * so a shot points at the thing it is named after rather than at a fixed compass bearing.
     */
    /**
     * Empties a node through the REAL depletion path rather than by writing `remaining = 0`, so a
     * test sees the same events, the same state transition, and the same respawn timer a player
     * would. A shortcut that bypasses the system proves nothing about the system.
     */
    depleteNode: (entityId: string) => {
      const entity = entityStore.get(entityId);
      if (!entity?.resource) return false;
      const node = store.get().world.nodes[entityId];
      if (node) node.remaining = 1;
      entity.resource.remaining = 1;
      // One more successful gather now empties it, and the system does the rest.
      return gatheringSystem.forceDeplete(entityId, clock.elapsedMs);
    },

    forceRespawn: (entityId: string) => gatheringSystem.forceRespawn(entityId, clock.elapsedMs),
    // Observation must not update the renderer or repair a missed state transition.
    drawnBounds: (entityId: string) => entityViews.drawnBounds(entityId),
    entityViewStats: () => entityViews.stats(),
    selection: () => ({ hovered: input.hoveredEntityId, selected: input.selectedEntityId }),
    select: (entityId) => { input.select(entityId); },
    groundHeight: (x: number, z: number) => scene.meshHeightAt(x, z),
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

    // Silent on purpose. `addItem` emits `item.received`, which the quest system counts into
    // `gather:<itemId>` — so an unsilenced debug grant could complete a gather stage on its own,
    // which is exactly the hole the gate check's "debug may set a check up, never satisfy one" rule
    // exists to close. Cold Iron stage 1 and the whole of Dorn's Tally were satisfiable by
    // `giveItem` alone.
    giveItem: (itemId: string, quantity: number, to: string) => (
      to === "bank"
        ? bankSystem.op("deposit", { itemId, quantity })
        : inventorySystem.addItem(itemId, quantity, { silent: true })
    ),
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
      frameDocumentationTarget(
        target,
        shot.yaw,
        shot.pitch,
        shot.distance,
        "focus-camera",
        target,
        shot.yaw + (shot.playerFacingOffsetRad ?? Math.PI),
      );
      return true;
    },
    focusPlayer: () => {
      const player = store.get().player;
      const dungeonPlayer = player.regionId === "gravelmaw";
      entityViews.setCaptureSubject(null);
      scene.scatterGroup.visible = !dungeonPlayer;
      scene.terrainGroup.visible = !dungeonPlayer;
      if (dungeon) dungeon.group.visible = dungeonPlayer;
      const target: Vec3 = [player.position[0], player.position[1] + 1.05, player.position[2]];
      frameDocumentationTarget(
        target,
        player.facingRad + Math.PI + 0.35,
        0.16,
        2.4,
        "focus-player",
        player.position,
      );
      return true;
    },
    focusEntity: (entityId: string) => {
      const entity = entityStore.get(entityId);
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
      const settlementCentre = settlementRegion?.settlement.centre;
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
        frameDocumentationTarget(entity.position, contextualYaw, 0.25, baseDistance, "focus-entity-region");
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
      frameDocumentationTarget(target, contextualYaw, pitch, distance, "focus-entity", playerTarget);
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
      const regionId = scene.regionAt(target[0], target[2]);
      featureLab?.setFreeCameraEnabled(false);
      camera.setFreeTarget(null);
      input.setFreeCameraEnabled(false);
      entityViews.setCaptureSubject(null);
      scene.scatterGroup.visible = true;
      scene.terrainGroup.visible = true;
      if (dungeon) dungeon.group.visible = regionId === "gravelmaw";
      const stand: Vec3 = [target[0], scene.heightAt(regionId, target[0], target[2]), target[2]];
      store.get().player.position = stand;
      store.get().player.regionId = regionId;
      store.get().player.facingRad = yaw + Math.PI;
      refreshVisualResidency(stand, regionId, true);
      audioDirector.setRegion(regionId);
      movement.stop(store.get(), clock.elapsedMs, "inspect-pose");
      scene.syncPlayer(stand, yaw + Math.PI, true);
      camera.setPose(yaw, pitch, distance);
      camera.update(target[0], target[1], target[2], true);
      renderer.followShadow(renderer.camera.position.clone().setY(stand[1]));
      return true;
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
        frameDocumentationTarget(target, authored.yaw, authored.pitch, authored.distance, "focus-location");
        return true;
      }
      const node = nav.routeNode(locationId);
      if (!node) return false;
      const centre = locationRegion?.settlement.centre;
      const contextX = centre ? node.position[0] - centre[0] : 0;
      const contextZ = centre ? node.position[2] - centre[1] : 0;
      const bankLocation = location?.kind === "bank" && locationRegion;
      const yaw = bankLocation
        ? bankLocation.settlement.bank.rotationY
        : !dungeonLocation && centre && Math.hypot(contextX, contextZ) > 2
          ? Math.atan2(contextX, contextZ)
          : stableCaptureYaw(locationId);
      frameDocumentationTarget(
        node.position,
        yaw,
        dungeonLocation ? 0.28 : bankLocation ? 0.32 : 0.44,
        dungeonLocation ? 8 : bankLocation ? 6 : 22,
        "focus-location",
      );
      return true;
    },
    setCaptureMode: (enabled: boolean) => {
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

  // Compile spawn-visible variants now. Transparent and hidden-dungeon variants remain necessary,
  // but are warmed in an idle window below so they do not delay the first playable frame.
  // Measured before this existed: the program count climbed 19 -> 20 mid-session and the frames
  // that paid for it were 1130 ms, 994 ms and 346 ms. The two extra passes are for variants three
  // skips by default — a material only compiles its transparent form when something is actually
  // transparent, and three skips everything under an invisible ancestor, which is the whole dungeon
  // and the +3-point-light variant of every material in it.
  if (profile.fullWarmup) {
    setStatus("warming the shaders…");
    bootTelemetry.measureSync(BOOT_SPANS.SHADER_COMPILE, () => renderer.warmup());
  }
  bootTelemetry.milestone(BOOT_MILESTONES.SHADERS_READY);

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
    if (forestFixture) (window as Window & { __forestLab?: unknown }).__forestLab = { getState: () => ({ ...forest.stats(), entityIds: forestFixture!.entityIds, obstacles: forestObstacles.size }), getTrees: () => forestFixture!.trees, getScatterVisibility: () => forestFixture!.getScatterVisibility() };
  } else {
    const firstFrameSpan = bootTelemetry.startSpan(BOOT_SPANS.FIRST_RENDERED_FRAME);
    loop.start();
    requestAnimationFrame(() => {
      firstFrameSpan.end();
      bootTelemetry.milestone(BOOT_MILESTONES.FIRST_RENDERED_FRAME);
      // Keep the overlay over the canvas until the frame loop has actually painted once. Removing
      // it before loop.start() exposed shader compilation and an empty canvas as apparent gameplay.
      bootTelemetry.measureSync(BOOT_SPANS.BOOT_SCREEN_REMOVAL, () => {
        document.getElementById("boot-screen")?.remove();
      });
      bootTelemetry.milestone(BOOT_MILESTONES.BOOT_SCREEN_REMOVED);
      bootTotalSpan.end();
      bootTelemetry.recordPerformanceResources();
      // Publish readiness last so an attached runner cannot capture the timeline between the
      // playable mark and the final critical span/resource bookkeeping above.
      bootTelemetry.milestone(BOOT_MILESTONES.FIRST_PLAYABLE);
      debugReady = true;
      if (saves.getRecovery()) ui.openTitle();
      if (featureLab) window.__featureLab = featureLab;
      if (environmentLab) (window as Window & { __environmentLab?: typeof environmentLab }).__environmentLab = environmentLab;
    if (creatureGallery) (window as Window & { __creatureGallery?: typeof creatureGallery }).__creatureGallery = creatureGallery;
      if (forestFixture) (window as Window & { __forestLab?: unknown }).__forestLab = { getState: () => ({ ...forest.stats(), entityIds: forestFixture!.entityIds, obstacles: forestObstacles.size }), getTrees: () => forestFixture!.trees, getScatterVisibility: () => forestFixture!.getScatterVisibility() };
      window.setTimeout(() => {
        audioDirector.setRegion(store.get().player.regionId);
        const expandEntityResidency = (): void => {
          entityViews.updateActiveRadius(profile.kind === "feature-lab" ? 220 : ENTITY_ACTIVE_RADIUS);
        };
        window.requestIdleCallback(expandEntityResidency, { timeout: 1_000 });
        if (profile.kind === "game") {
          window.requestIdleCallback(() => playerRig.preloadGear(), { timeout: 1_000 });
          if (profile.fullWarmup) {
            window.requestIdleCallback(() => {
              bootTelemetry.measureSync("boot.shaders.deferred", () => {
                renderer.warmup({
                  transparentVariants: [scene.root],
                  temporarilyVisible: dungeon ? [dungeon.group] : [],
                });
              });
            }, { timeout: 2_000 });
          }
          if (profile.scatter) {
            void scatterStreaming.streamRemaining().then(() => {
              scatterResults = scatterStreaming.getStats();
            }).catch((cause) => {
              errors.push({ atMs: atMs(), source: "scatterStreaming", message: describeError(cause) });
            });
          }
          void preloadDeferredEntityAssets(assets, errors, atMs);
        }
      }, 0);
    });
  }
  return { loop, api, ...(featureLab ? { featureLab } : {}) };
}

/**
 * Turns the authored dungeon data into a geometry spec.
 *
 * Chamber floors are absolute heights here: the content stores an offset from the terrain at the
 * mouth, which is the one point the surface and the interior agree on. Corridors are derived from
 * the chamber order rather than authored, because the chambers descend in a line and an authored
 * corridor list would be a second thing to keep in step.
 */
function buildDungeonSpec(scene: WorldScene): DungeonSpec | null {
  for (const region of REGIONS) {
    const dungeon = region.dungeon;
    if (!dungeon) continue;

    const base = scene.heightAt(region.id, dungeon.entrance[0], dungeon.entrance[1]);
    const chambers = dungeon.chambers.map((chamber) => ({
      id: chamber.id,
      name: chamber.name,
      centre: [chamber.centre[0], chamber.centre[1]] as [number, number],
      radius: chamber.radius,
      floorY: base + chamber.floorOffset,
      lit: chamber.lit,
    }));

    const corridors = chambers.slice(0, -1).map((chamber, index) => {
      const next = chambers[index + 1]!;
      return {
        from: chamber.centre,
        to: next.centre,
        fromY: chamber.floorY,
        toY: next.floorY,
        width: 6,
      };
    });

        // Tall enough to reach the terrain above. At 7 m the chamber wall stopped 5 m short of
    // Karrowmoor's surface and the elevated camera looked straight over it into daylight.
    return { regionId: dungeon.id, chambers, corridors, wallHeight: 13 };
  }
  return null;
}


/**
 * Keeps procedural dressing off anything authored. Trees growing through the bank door is the
 * single most obvious way a procedural world reads as unmade.
 */
function registerExclusions(
  scene: WorldScene,
  solids: readonly SolidVolume[],
  dressing: readonly ResolvedWorldSiteDressing[],
): void {
  worldExclusions.clear();
  const authoredLocations = new Set(WORLD_SITES.map((site) => site.locationId));
  const authoredClusters = new Set(WORLD_SITES.flatMap((site) => site.resourceSlots.map((slot) => slot.clusterId)));
  for (const region of REGIONS) {
    for (const location of region.locations) {
      if (!authoredLocations.has(location.id)) {
        worldExclusions.addCircle(location.position[0], location.position[1], 5, "cluster", location.id);
      }
    }
    for (const cluster of region.clusters) {
      if (!authoredClusters.has(cluster.id)) {
        worldExclusions.addCircle(cluster.centre[0], cluster.centre[1], cluster.radius + 2, "cluster", cluster.id);
      }
    }
  }
  for (const solid of solids) {
    // Underground walls must not clear visible vegetation on the terrain above them.
    const top = solid.position[1] + (solid.kind === "box" ? solid.size[1] : solid.height);
    const probes: [number, number][] = [[solid.position[0], solid.position[2]]];
    if (solid.kind === "box") {
      const cos = Math.cos(solid.rotationY), sin = Math.sin(solid.rotationY);
      for (const x of [-solid.size[0] / 2, 0, solid.size[0] / 2]) {
        for (const z of [-solid.size[2] / 2, 0, solid.size[2] / 2]) {
          probes.push([solid.position[0] + x * cos + z * sin, solid.position[2] - x * sin + z * cos]);
        }
      }
    } else {
      for (let i = 0; i < 8; i++) probes.push([
        solid.position[0] + Math.cos(i * Math.PI / 4) * solid.radius,
        solid.position[2] + Math.sin(i * Math.PI / 4) * solid.radius,
      ]);
    }
    if (probes.every(([x, z]) => scene.meshHeightAt(x, z) > top + 0.5)) continue;
    if (solid.kind === "box") {
      worldExclusions.addOrientedRect(solid.position[0], solid.position[2], solid.size[0], solid.size[2], solid.rotationY, 0.4, "building", solid.id);
    } else {
      worldExclusions.addCircle(solid.position[0], solid.position[2], solid.radius + 0.5, "custom", solid.id);
    }
  }
  for (const piece of dressing) {
    if (piece.size[1] < 0.35 || /^corealm_(fern|shrub|flower)_/.test(piece.assetId)) continue;
    worldExclusions.addOrientedRect(
      piece.position[0] + piece.centreOffset[0], piece.position[2] + piece.centreOffset[1],
      piece.size[0], piece.size[2], piece.rotationY, 0.15, "custom", piece.id,
    );
  }
  for (const site of WORLD_SITES) {
    if (site.kind === "mine") {
      const ramp = worldSiteHaulRamp(site);
      const approach = ramp.worldEnd;
      worldExclusions.addCircle(site.centre[0], site.centre[1], site.workRadius, "worksite", site.id);
      worldExclusions.addCorridor([[site.centre[0], 0, site.centre[1]], [approach[0], 0, approach[1]]], 4.5, "worksite", site.id);
      const aisle: Vec3[] = site.resourceSlots.map((slot) => {
        const point = worldSitePoint(site, slot.x + Math.sin(slot.yaw) * 2.1, slot.z + Math.cos(slot.yaw) * 2.1);
        return [point[0], 0, point[1]];
      });
      worldExclusions.addCorridor(aisle, 2.4, "worksite", `${site.id}:working-aisle`);
    }
    for (const slot of site.resourceSlots) {
      const point = worldSitePoint(site, slot.x, slot.z);
      worldExclusions.addCircle(point[0], point[1], site.kind === "grove" ? 1.8 : 1.6, "cluster", `${slot.clusterId}_${slot.index}`);
    }
  }
  for (const altar of Object.values(REGIONAL_ESSENCE_ALTARS)) {
    worldExclusions.addCircle(altar.position[0], altar.position[1], ESSENCE_ALTAR_CLEAR_RADIUS, "ritual", altar.id);
  }
  for (const [index, points] of scene.getRoadPolylines().entries()) {
    worldExclusions.addCorridor(points, 5, "road", `resolved-road-${index}`);
  }
}

/**
 * Assets for entities the world creates while it is running rather than at build time.
 *
 * Recovery caches and player campfires can appear after the initial entity preload. These are not
 * first-play dependencies: queue them only after the first rendered frame, and let EntityViews
 * retry hydration if a player creates one before this low-priority request finishes.
 */
const SPAWNED_LATER_ASSET_IDS: readonly string[] = [
  "crate_wood",
  ...GATHERING_PRODUCTION_TIERS.map((definition) => definition.campfire.visualLogAssetId),
];

async function preloadDeferredEntityAssets(
  assets: AssetRegistry,
  errors: RecordedError[],
  atMs: () => number,
): Promise<void> {
  const ordered = [...new Set(SPAWNED_LATER_ASSET_IDS)];
  const results = await Promise.allSettled(ordered.map((id) => assets.load(id, { priority: "background" })));
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      errors.push({
        atMs: atMs(),
        source: "assets",
        message: `Failed to load "${ordered[index]}": ${describeError(result.reason)}`,
      });
    }
  }
}

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
