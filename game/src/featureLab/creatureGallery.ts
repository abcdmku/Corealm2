import { Box3, Vector3 } from "three";
import type { FeatureLabPreset, Vec3 } from "../contracts.js";
import type { AssetRegistry } from "../render/assets.js";
import type { EntityViews } from "../render/entityViews.js";
import type { WorldScene } from "../render/scene.js";
import type { EntityStore } from "../world/entities.js";
import { createFeatureLabEntity, FEATURE_LAB_CATALOG, stagedCreaturePreset } from "./catalog.js";

export type GalleryMotion = "idle" | "walk" | "run" | "attack" | "hit";

export interface CreatureGalleryState {
  ready: boolean;
  presetId: string;
  assetId: string;
  count: number;
  motion: GalleryMotion;
  entityIds: string[];
}

export interface CreatureGallery {
  getState(): CreatureGalleryState;
  getCatalog(): FeatureLabPreset[];
  show(presetId: string, count?: number): Promise<void>;
  play(motion: GalleryMotion): void;
  place(x: number, z: number, yaw?: number): void;
  getBounds(): { min: Vec3; max: Vec3 } | null;
  dispose(): void;
}

interface CreatureGalleryDeps {
  assets: AssetRegistry;
  scene: WorldScene;
  entityStore: EntityStore;
  entityViews: EntityViews;
}

/** A stationary acceptance grid of production actors, shared rigs and real skeletal LOD paths. */
export async function createCreatureGallery({ assets, scene, entityStore, entityViews }: CreatureGalleryDeps): Promise<CreatureGallery> {
  const catalog = FEATURE_LAB_CATALOG.targets.creature;
  let state: CreatureGalleryState = { ready: false, presetId: "", assetId: "", count: 0, motion: "idle", entityIds: [] };
  let queue = Promise.resolve();
  let disposed = false;

  function clear(): void {
    for (const id of state.entityIds) {
      entityViews.clearLocomotion(id);
      entityStore.remove(id);
    }
    state.entityIds = [];
    state.count = 0;
    entityViews.sync(entityStore.all());
  }

  const gallery: CreatureGallery = {
    getState: () => ({ ...state, entityIds: [...state.entityIds] }),
    getCatalog: () => structuredClone(catalog),
    show(presetId, count = 1) {
      const next = queue.catch(() => {}).then(async () => {
        if (disposed) throw new Error("Creature gallery has been disposed");
        const preset = catalog.find((candidate) => candidate.id === presetId) ?? stagedCreaturePreset(presetId);
        if (!preset) throw new Error(`Unknown production creature preset: ${presetId}`);
        if (!Number.isInteger(count) || count < 1 || count > 64) throw new Error("Creature count must be a whole number from 1 to 64");
        state.ready = false;
        try {
          const template = createFeatureLabEntity(preset, {
            entityId: `lab:creatures:${presetId}:0`, groundPosition: [0, scene.meshHeightAt(0, 70), 70],
            baseY: (id) => assets.baseY(id), assetSize: (id) => assets.assetSize(id), rotationY: 0,
          });
          const spacing = Math.max(3.2, (template.combat?.bodyRadius ?? 1) * 2 + 1.4);
          const columns = Math.ceil(Math.sqrt(count));
          const rows = Math.ceil(count / columns);
          const entities = Array.from({ length: count }, (_, index) => {
            const x = (index % columns - (columns - 1) / 2) * spacing;
            const z = 70 + (Math.floor(index / columns) - (rows - 1) / 2) * spacing;
            const entity = createFeatureLabEntity(preset, {
              entityId: `lab:creatures:${presetId}:${index + 1}`,
              groundPosition: [x, scene.meshHeightAt(x, z), z],
              baseY: (id) => assets.baseY(id), assetSize: (id) => assets.assetSize(id), rotationY: 0,
            });
            entity.regionId = "fallowmarch";
            entity.meta = { ...entity.meta, featureLab: true, galleryMotion: true, creatureGallery: true };
            return entity;
          });
          const prepared = await entityViews.prepare(entities);
          if (prepared.missing.length) throw new Error(`Missing creature gallery models: ${prepared.missing.join(", ")}`);
          if (disposed) return;
          clear();
          for (const entity of entities) entityStore.add(entity);
          state = {
            ready: false, presetId, assetId: template.view!.assetId, count, motion: "idle",
            entityIds: entities.map((entity) => entity.id),
          };
          entityViews.sync(entityStore.all());
        } finally {
          state.ready = !disposed;
        }
      });
      queue = next;
      return next;
    },
    play(motion) {
      if (!["idle", "walk", "run", "attack", "hit"].includes(motion)) throw new Error(`Unknown gallery motion: ${motion}`);
      if (disposed || !state.ready || !state.entityIds.length) throw new Error("Load a creature gallery before playing motion");
      const failed: string[] = [];
      for (const id of state.entityIds) {
        const played = motion === "attack" || motion === "hit"
          ? entityViews.playAction(id, motion)
          : entityViews.setLocomotion(id, motion);
        if (!played) failed.push(id);
      }
      state.motion = motion;
      if (failed.length) throw new Error(`Production motion ${motion} was unavailable for ${failed.join(", ")}`);
    },
    place(x, z, yaw = 0) {
      if (![x, z, yaw].every(Number.isFinite) || Math.abs(x) > 115 || Math.abs(z) > 115) throw new Error("Gallery placement must stay within the terrain yard");
      for (const [index, id] of state.entityIds.entries()) {
        const entity = entityStore.get(id);
        if (!entity) continue;
        const px = x + index * 4;
        entity.position = [px, scene.meshHeightAt(px, z), z];
        if (entity.view) entity.view.rotationY = yaw;
      }
      entityViews.sync(entityStore.all());
    },
    getBounds() {
      const box = new Box3();
      for (const id of state.entityIds) {
        const bounds = entityViews.drawnBounds(id);
        if (!bounds) continue;
        box.expandByPoint(new Vector3(...bounds.min));
        box.expandByPoint(new Vector3(...bounds.max));
      }
      return box.isEmpty() ? null : { min: box.min.toArray() as Vec3, max: box.max.toArray() as Vec3 };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
      state.ready = false;
    },
  };
  await gallery.show(catalog.find((preset) => preset.id === "redsill_cattle")?.id ?? catalog[0]!.id);
  return gallery;
}
