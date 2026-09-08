import { Box3, Vector3, type Mesh, type Object3D } from "three";
import type { SemanticEntity, SolidVolume, Vec3 } from "../contracts.js";
import { respawnSeconds, yieldRange } from "../content/index.js";
import { getRegion } from "../content/regions.js";
import { resourceDef } from "../content/resources.js";
import { WORLD_SITES, worldSitePoint, type WorldSite, type WorldSiteResourceSlot } from "../content/worldSites.js";
import { tierSilhouetteScale } from "../core/math.js";
import type { AssetRegistry } from "../render/assets.js";
import type { EntityViews } from "../render/entityViews.js";
import type { ScatterPlacement, WorldScene } from "../render/scene.js";
import { buildWorldSiteDressing } from "../render/worldSiteDressing.js";
import { buildMineCutFace } from "../render/mineCutFace.js";
import { buildDungeonMouth } from "../render/dungeonMouth.js";
import { buildComposition, variantSeed } from "../render/buildings.js";
import { applyCorealmSurfaceMaterials, loadCorealmSurfaceTextures } from "../render/corealmSurfaceMaterials.js";
import type { EntityStore } from "../world/entities.js";
import { structureEntitiesFromParts, structureCollisionFromCompositionParts } from "../world/regionBuilder.js";
import { FOLIAGE_RENDER_TILE_METRES, shardByTile } from "../world/scatter.js";
import { miningAccessPositions } from "../app/miningAccess.js";

export interface EnvironmentWorkbenchState {
  ready: boolean;
  mode: "gallery" | "site" | "foliage" | "cut-face" | "portal";
  selection: string;
  entityIds: string[];
  assets: string[];
  foliage?: { layout: "lane" | "grid"; count: number; span: number; woodOnly: boolean };
}

export interface EnvironmentCatalog {
  assets: { id: string; label: string; file: string; source: string; size: Vec3 }[];
  sites: { id: string; label: string; available: boolean; reason?: string }[];
}

export interface EnvironmentWorkbench {
  getState(): EnvironmentWorkbenchState;
  getCatalog(): EnvironmentCatalog;
  getBounds(): { min: Vec3; max: Vec3 } | null;
  showGallery(assetId?: string, options?: EnvironmentGalleryOptions): Promise<void>;
  showFoliage(assetId: string, options?: EnvironmentFoliageOptions): Promise<void>;
  /** Inspect the production wood without hiding flaws behind the leaf canopy. */
  setFoliageWoodOnly(enabled: boolean): void;
  showSite(siteId: string): Promise<void>;
  showCutFace(): Promise<void>;
  showPortal(): Promise<void>;
  setVisibilityOptimization(enabled: boolean): void;
  /** Sample a repeatable animation pose for the next synchronous draw. The live loop resumes it. */
  sampleSurfaceTime(seconds: number): void;
  dispose(): void;
}

export interface EnvironmentGalleryOptions {
  /** Inspect one source at its authored placement size and bearing. Defaults remain native/zero. */
  scale?: number;
  rotationY?: number;
  /** Contact/occlusion fixture offset; the source asset and its scale remain unchanged. */
  verticalOffset?: number;
  /** Native companion for shared-material batch isolation fixtures. */
  companionAssetId?: string;
}

export interface EnvironmentFoliageOptions {
  /** Compare a grove of source silhouettes through production scatter instancing. */
  variants?: readonly string[];
  /** A row for silhouette/distance sweeps, or one production-sized scatter tile for density. */
  layout?: "lane" | "grid";
  count?: number;
  /** World metres across the row or square. Defaults to 70 for a lane, 96 for a grid. */
  span?: number;
  scale?: number;
  /** Trees cast by default; understory matches the world's non-casting ground-cover layers. */
  castShadow?: boolean;
}

interface EnvironmentDeps {
  assets: AssetRegistry;
  scene: WorldScene;
  entityStore: EntityStore;
  entityViews: EntityViews;
  replaceCollision(solids: readonly SolidVolume[]): void;
}

/** Original models and authored settings, using the same semantic views and scatter as the game. */
export async function createEnvironmentWorkbench({ assets, scene, entityStore, entityViews, replaceCollision }: EnvironmentDeps): Promise<EnvironmentWorkbench> {
  const manifest = assets.getManifest();
  if (!manifest) throw new Error("Environment workbench requires the production asset manifest");
  const catalog: EnvironmentCatalog = {
    assets: manifest.assets.filter((entry) => entry.category !== "animation" && entry.category !== "character").map((entry) => ({
      id: entry.id,
      label: title(entry.id.replace(/^corealm_/, "")),
      file: entry.file,
      source: manifest.packs.find((pack) => pack.id === entry.pack)?.source ?? entry.pack,
      size: [entry.size.x, entry.size.y, entry.size.z],
    })),
    sites: WORLD_SITES.map((site) => ({
      id: site.id, label: `${title(site.id)} · ${title(site.regionId)}`,
      available: site.kind === "mine" || site.kind === "grove",
      ...(site.kind === "mine" || site.kind === "grove" ? {} : { reason: "Requires the production water and basin scene; unavailable in the dry yard." }),
    })),
  };
  if (!catalog.assets.length) throw new Error("No original environment models are registered");
  let state: EnvironmentWorkbenchState = { ready: false, mode: "gallery", selection: "all", entityIds: [], assets: [] };
  let objects: Object3D[] = [];
  let collisionInstalled = false;
  let disposed = false;
  let queue = Promise.resolve();

  function releaseObjects(owned: Object3D[]): void {
    for (const object of owned) {
      scene.unregisterScatter(object);
      object.traverse((part) => {
        if (part.userData.ownedGeometry && (part as Mesh).isMesh) (part as Mesh).geometry.dispose();
        if (part.userData.ownedMaterial && (part as Mesh).isMesh) {
          const material = (part as Mesh).material;
          for (const entry of Array.isArray(material) ? material : [material]) entry.dispose();
        }
      });
    }
  }

  function clear(): void {
    for (const id of state.entityIds) entityStore.remove(id);
    releaseObjects(objects);
    objects = [];
    if (collisionInstalled) { replaceCollision([]); collisionInstalled = false; }
    state.entityIds = [];
    state.assets = [];
    entityViews.sync(entityStore.all());
  }

  function enqueue(build: () => Promise<void>): Promise<void> {
    const next = queue.catch(() => {}).then(async () => {
      if (disposed) throw new Error("Environment workbench has been disposed");
      state.ready = false;
      try { await build(); }
      finally { state.ready = !disposed; }
    });
    queue = next;
    return next;
  }

  function grounded(assetId: string, centreX: number, centreZ: number, scale: number, yaw: number): Vec3 {
    const centre = assets.assetCenterXZ(assetId) ?? { x: 0, z: 0 };
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    return [
      centreX - scale * (centre.x * cos + centre.z * sin),
      scene.meshHeightAt(centreX, centreZ) - assets.baseY(assetId) * scale,
      centreZ - scale * (-centre.x * sin + centre.z * cos),
    ];
  }

  async function prepare(entities: SemanticEntity[]): Promise<void> {
    const prepared = await entityViews.prepare(entities);
    if (prepared.missing.length) throw new Error(`Missing environment models: ${prepared.missing.join(", ")}`);
  }

  function resource(site: WorldSite, slot: WorldSiteResourceSlot): SemanticEntity {
    const cluster = getRegion(site.regionId)?.clusters.find((candidate) => candidate.id === slot.clusterId);
    if (!cluster) throw new Error(`Site ${site.id} refers to unknown cluster ${slot.clusterId}`);
    const definition = resourceDef(cluster.resourceId);
    const id = `${slot.clusterId}_${slot.index}`;
    const pine = definition.id === "tree_cairnpine" || definition.id === "tree_cinderpine";
    const assetId = definition.archetype === "tree"
      ? `corealm_${pine ? "pine" : "oak"}_${(slot.index - 1) % 3 + 1}`
      : definition.presentation.availableAssetIds[variantSeed(id) % definition.presentation.availableAssetIds.length];
    if (!assetId) throw new Error(`No environment model for resource ${definition.id}`);
    const size = assets.assetSize(assetId);
    if (!size) throw new Error(`Missing measurements for ${assetId}`);
    let scale = definition.presentation.targetWorldSize / Math.max(size.x, size.y, size.z) * slot.scale;
    if (definition.archetype === "ore") {
      const [minimum, maximum] = definition.presentation.variantScale ?? [1, 1];
      const unit = ((variantSeed(`${id}:scale`) >>> 8) & 0xffff) / 0xffff;
      const silhouette = tierSilhouetteScale(definition.tier);
      const target = definition.presentation.targetWorldSize / Math.max(size.x, size.y, size.z);
      scale = Math.round(target * (minimum + (maximum - minimum) * unit) / silhouette * 10_000)
        / 10_000 * slot.scale * silhouette;
    }
    const [x, z] = worldSitePoint(site, slot.x, slot.z);
    const yaw = site.rotationY + slot.yaw;
    const yields = (definition.yieldRange ?? yieldRange(definition.tier))[0];
    return {
      id,
      name: definition.name, archetype: definition.archetype, tier: definition.tier,
      regionId: "fallowmarch", position: grounded(assetId, x, z, scale, yaw), state: "available",
      requirements: { [definition.skill]: definition.reqLevel },
      interactions: ["inspect", definition.archetype === "tree" ? "chop" : "mine"],
      resource: { remaining: yields, maxYields: yields, respawnSeconds: definition.respawnSeconds ?? respawnSeconds(definition.tier), itemId: definition.itemId },
      view: {
        assetId,
        depletedAssetId: definition.archetype === "tree" ? `corealm_stump_${pine ? "pine" : "oak"}` : `${assetId}_spent`,
        scale: scale / tierSilhouetteScale(definition.presentation.materialTier),
        materialTier: definition.presentation.materialTier, rotationY: yaw,
        ...(definition.archetype === "ore" ? { groundNormal: scene.normalAt(x, z), tiltStrength: 0.85 } : {}),
        labelHeight: size.y * scale + 0.3,
      },
      meta: { resourceId: definition.id, skill: definition.skill, featureLab: true, environmentSite: site.id, sourceRegion: site.regionId },
    };
  }

  function applyMiningAccess(site: WorldSite, entities: SemanticEntity[]): void {
    const access = miningAccessPositions([site], (x, z) => scene.meshHeightAt(x, z), {
      assetSize: (id) => assets.assetSize(id), assetCenterXZ: (id) => assets.assetCenterXZ(id),
    });
    for (const entity of entities) {
      const stance = access.get(entity.id);
      if (stance) entity.interactionPosition = stance;
    }
  }

  const workbench: EnvironmentWorkbench = {
    setVisibilityOptimization: (enabled) => scene.scatterVisibility.setEnabled(enabled),
    sampleSurfaceTime(seconds) {
      if (!Number.isFinite(seconds)) throw new Error("Surface sample time must be finite");
      scene.updateTime(seconds);
    },
    getState: () => ({ ...state, entityIds: [...state.entityIds], assets: [...state.assets] }),
    getCatalog: () => structuredClone(catalog),
    getBounds() {
      const box = new Box3();
      for (const id of state.entityIds) {
        const bounds = entityViews.drawnBounds(id);
        if (bounds) {
          box.expandByPoint(new Vector3(...bounds.min));
          box.expandByPoint(new Vector3(...bounds.max));
        }
      }
      for (const object of objects) box.expandByObject(object);
      return box.isEmpty() ? null : { min: box.min.toArray() as Vec3, max: box.max.toArray() as Vec3 };
    },
    showGallery(assetId, options = {}) {
      return enqueue(async () => {
        if (assetId && !catalog.assets.some((entry) => entry.id === assetId)) throw new Error(`Unknown environment asset: ${assetId}`);
        const scale = options.scale ?? 1;
        const rotationY = options.rotationY ?? 0;
        const verticalOffset = options.verticalOffset ?? 0;
        if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(rotationY) || !Number.isFinite(verticalOffset)) {
          throw new Error("Environment gallery scale must be positive and its bearing finite");
        }
        // Small ground plants occupy the front rows; trees and cliff sections have their own space.
        const selected = assetId ? catalog.assets.filter((entry) => entry.id === assetId) : catalog.assets.filter((entry) => entry.id.startsWith("corealm_")).sort((a, b) => a.size[1] - b.size[1]);
        if (options.companionAssetId) {
          const companion = catalog.assets.find(entry => entry.id === options.companionAssetId);
          if (!assetId || !companion || companion.id === assetId) throw new Error("Gallery companion requires a distinct native catalog asset");
          selected.push(companion);
        }
        const columns = Math.min(6, selected.length);
        const entities: SemanticEntity[] = selected.map((entry, index) => {
          const companion = assetId && entry.id === options.companionAssetId;
          const x = assetId ? companion ? 3 : 0 : (index % columns - (columns - 1) / 2) * 15;
          const z = assetId ? 25 : 7 + Math.floor(index / columns) * 13;
          const origin = grounded(entry.id, x, z, scale, rotationY);
          const position: Vec3 = [origin[0], origin[1] + (companion ? 0 : verticalOffset), origin[2]];
          return {
            id: `lab:environment:gallery:${entry.id}`, name: entry.label,
            archetype: "landmark", tier: 1, regionId: "fallowmarch", state: "available",
            position, interactions: ["inspect"],
            view: { assetId: entry.id, scale, rotationY, materialTier: 1, labelHeight: entry.size[1] * scale + 0.3 },
            meta: { featureLab: true, environmentGallery: true, source: entry.source, file: entry.file },
          };
        });
        await prepare(entities);
        if (disposed) return;
        clear();
        for (const entity of entities) entityStore.add(entity);
        state = { ready: false, mode: "gallery", selection: assetId ?? "all", entityIds: entities.map((entity) => entity.id), assets: selected.map((entry) => entry.id) };
        entityViews.sync(entityStore.all());
      });
    },
    showFoliage(assetId, options = {}) {
      return enqueue(async () => {
        const tree = /^corealm_(?:oak|pine|ash|walnut|willow|maple|teak|yew|magic)_\d+$/.test(assetId);
        const understory = /^corealm_(?:fern|shrub)_\d+$/.test(assetId);
        if (!tree && !understory) throw new Error(`No production foliage family for ${assetId}`);
        if (!assets.entry(assetId)) throw new Error(`Foliage fixture requires ${assetId}`);
        const layout = options.layout ?? "grid";
        const count = options.count ?? (layout === "lane" ? 12 : tree ? 64 : 1024);
        const span = options.span ?? (layout === "lane" ? 70 : 96);
        const scale = options.scale ?? 1;
        if (layout !== "lane" && layout !== "grid") throw new Error("Foliage layout must be lane or grid");
        if (!Number.isInteger(count) || count < 1 || count > 16384) throw new Error("Foliage count must be an integer from 1 to 16384");
        if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(scale) || scale <= 0) {
          throw new Error("Foliage span and scale must be finite and positive");
        }
        const variants = [...new Set(options.variants?.length ? options.variants : [assetId])];
        if (variants.some(id => !assets.entry(id) || !/^corealm_(?:oak|pine|ash|walnut|willow|maple|teak|yew|magic|fern|shrub)_\d+$/.test(id))) {
          throw new Error("Every grove variant must be a production foliage asset");
        }
        await assets.loadMany(variants, { priority: "visible-spawn", regionId: "fallowmarch" });
        if (disposed) return;
        const columns = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / columns);
        const byVariant = new Map<string, ScatterPlacement[]>();
        for (let index = 0; index < count; index++) {
          const sourceId = variants[index % variants.length]!;
          const x = layout === "lane"
            ? count === 1 ? 0 : -span * 0.5 + index * span / (count - 1)
            : -span * 0.5 + ((index % columns) + 0.5) * span / columns;
          const z = layout === "lane" ? 25 : 25 - span * 0.5 + (Math.floor(index / columns) + 0.5) * span / rows;
          const rotationY = (index * 2.399963229728653) % (Math.PI * 2);
          const nativeScale = variants.length > 1 ? scale * (.85 + ((index * 37) % 101) * .003) : scale;
          const placements = byVariant.get(sourceId) ?? [];
          placements.push({ position: grounded(sourceId, x, z, nativeScale, rotationY), rotationY, scale: nativeScale });
          byVariant.set(sourceId, placements);
        }
        const castShadow = options.castShadow ?? tree;
        const foliage = [...byVariant].flatMap(([sourceId, placements]) => {
          const source = assets.instance(sourceId);
          return shardByTile({ castShadow, placements }, tree ? FOLIAGE_RENDER_TILE_METRES.trees : FOLIAGE_RENDER_TILE_METRES.understory)
          .flatMap((shard) => scene.scatterInstanced(source, shard.placements, `lab-foliage-${sourceId}-${layout}-t${shard.tile >>> 0}`, {
            regionId: "fallowmarch", castShadow, windStrength: tree ? 0.035 : 0.075,
            compactVisibility: !castShadow && /^corealm_(fern|shrub)_\d+$/.test(assetId),
          }));
        });
        clear();
        objects = foliage;
        state = { ready: false, mode: "foliage", selection: assetId, entityIds: [], assets: [...byVariant.keys()], foliage: { layout, count, span, woodOnly: false } };
      });
    },
    setFoliageWoodOnly(enabled) {
      if (state.mode !== "foliage" || !state.foliage) throw new Error("Load foliage before inspecting its wood");
      for (const object of objects) object.traverse(child => {
        const mesh = child as Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        if (materials.some(material => material.name.startsWith("Leaves_Corealm"))) mesh.visible = !enabled;
      });
      state.foliage.woodOnly = enabled;
    },
    showSite(siteId) {
      return enqueue(async () => {
        const source = WORLD_SITES.find((candidate) => candidate.id === siteId);
        if (!source) throw new Error(`Unknown environment site: ${siteId}`);
        if (source.kind !== "mine" && source.kind !== "grove") throw new Error("This site needs the production water and basin scene. It cannot be previewed on the dry yard.");
        const site: WorldSite = { ...source, centre: [0, 25], rotationY: 0 };
        const entities = site.resourceSlots.map((slot) => resource(site, slot));
        applyMiningAccess(site, entities);
        await prepare(entities);
        if (disposed) return;
        const dressing = await buildWorldSiteDressing(scene, assets, site);
        if (disposed) { releaseObjects(dressing.objects); return; }
        let cut: Awaited<ReturnType<typeof buildMineCutFace>>;
        try { cut = await buildMineCutFace(scene, assets, site, entities); }
        catch (error) { releaseObjects(dressing.objects); throw error; }
        if (disposed) { releaseObjects([...dressing.objects, ...cut.objects]); return; }
        clear();
        objects = [...dressing.objects, ...cut.objects];
        scene.scatterGroup.add(...cut.objects);
        const solids = [...dressing.solids, ...cut.solids];
        if (solids.length) { replaceCollision(solids); collisionInstalled = true; }
        for (const entity of entities) entityStore.add(entity);
        state = {
          ready: false, mode: "site", selection: source.id, entityIds: entities.map((entity) => entity.id),
          assets: [...new Set([...dressing.assetIds, ...entities.flatMap((entity) => [entity.view!.assetId, entity.view!.depletedAssetId!])])],
        };
        entityViews.sync(entityStore.all());
      });
    },
    showCutFace() {
      return enqueue(async () => {
        const source = WORLD_SITES.find((site) => site.id === "bracken_workings")!;
        const slots = source.resourceSlots.slice(0, 2).map((slot, index) => ({
          ...slot, x: index ? 2.6 : -2.6, z: index ? -0.8 : 0,
          yaw: index ? 0.18 : -0.12, scale: index ? 1.1 : 0.95,
        }));
        const site: WorldSite = {
          ...source, id: "lab-cut-face", centre: [70, 25], rotationY: 0,
          resourceSlots: slots,
          cutFace: { backDepth: 3, buryDepth: 0.7,
            stations: slots.map((slot) => ({ clusterId: slot.clusterId, index: slot.index, crestHeight: 3.5 })) },
        };
        const entities = slots.map((slot) => resource(site, slot));
        applyMiningAccess(site, entities);
        await prepare(entities);
        const cut = await buildMineCutFace(scene, assets, site, entities);
        if (disposed) { releaseObjects(cut.objects); return; }
        clear();
        objects = cut.objects;
        scene.scatterGroup.add(...objects);
        replaceCollision(cut.solids);
        collisionInstalled = true;
        for (const entity of entities) entityStore.add(entity);
        state = { ready: false, mode: "cut-face", selection: "two-seam-slope",
          entityIds: entities.map((entity) => entity.id),
          assets: [...new Set(entities.flatMap((entity) => [entity.view!.assetId, entity.view!.depletedAssetId!]))] };
        entityViews.sync(entityStore.all());
      });
    },
    showPortal() {
      return enqueue(async () => {
        const region = getRegion("karrowmoor");
        const dungeon = region?.dungeon;
        if (!region || dungeon?.id !== "gravelmaw" || dungeon.entranceComposition !== "gravelmaw_mouth") {
          throw new Error("Portal workbench requires the authored Gravelmaw entrance composition");
        }
        const sourceOwnerId = "gravelmaw_mouth_portal";
        const ownerId = "lab:environment:portal";
        const origin: Vec3 = [0, scene.meshHeightAt(0, 25), 25];
        const rotationY = dungeon.entranceRotationY ?? 0;
        const scale = dungeon.entranceScale ?? 4;
        const parts = buildComposition(dungeon.entranceComposition, variantSeed(sourceOwnerId), region.settlement.kit);
        // Match regionBuilder's separate origins: the hero rests on its measured source base;
        // composition parts retain the authored ground origin. Region/tier preserve world materials.
        const entity: SemanticEntity = {
          id: ownerId, name: dungeon.name, archetype: "portal", tier: dungeon.tier,
          regionId: region.id, state: "open", interactions: ["inspect"],
          position: [origin[0], Math.round((origin[1] - assets.baseY(dungeon.entranceAssetId) * scale) * 100) / 100, origin[2]],
          view: { assetId: dungeon.entranceAssetId, scale, rotationY, labelHeight: 6 },
          meta: { featureLab: true, environmentPortal: true, sourceEntityId: sourceOwnerId },
        };
        const entities = [entity, ...structureEntitiesFromParts(parts, {
          origin, rotationY, regionId: region.id, tier: region.tier, ownerId, name: dungeon.name,
          meta: { scenery: true, dungeonId: dungeon.id, featureLab: true, environmentPortal: true, sourceEntityId: sourceOwnerId },
        })];
        const solids = structureCollisionFromCompositionParts(dungeon.entranceComposition, parts,
          { origin, rotationY, ownerId }, {
            assetSize: (id) => assets.assetSize(id), assetCenterXZ: (id) => assets.assetCenterXZ(id),
          });
        const [, textures] = await Promise.all([prepare(entities), loadCorealmSurfaceTextures()]);
        if (disposed) return;
        const mouth = buildDungeonMouth(entity);
        try { applyCorealmSurfaceMaterials(mouth, textures); }
        catch (error) { releaseObjects([mouth]); throw error; }
        clear();
        objects = [mouth];
        scene.scatterGroup.add(mouth);
        replaceCollision(solids);
        collisionInstalled = true;
        for (const part of entities) entityStore.add(part);
        state = { ready: false, mode: "portal", selection: "gravelmaw",
          entityIds: entities.map((part) => part.id), assets: [...new Set(entities.map((part) => part.view!.assetId))] };
        entityViews.sync(entityStore.all());
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
      state.ready = false;
    },
  };
  await workbench.showGallery("corealm_oak_1");
  return workbench;
}

function title(value: string): string {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
