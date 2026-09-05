import type { RegionId, SemanticEntity, Vec3 } from "../contracts.js";
import { respawnSeconds, yieldRange } from "../content/index.js";
import { resourceDef } from "../content/resources.js";
import { tierSilhouetteScale } from "../core/math.js";
import type { ResourceNodeState } from "../state/store.js";
import type { EntityStore } from "./entities.js";
import { SpatialIndex } from "./spatial.js";

export interface ForestTreeDescriptor {
  id: string;
  resourceId: string;
  regionId: RegionId;
  position: Vec3;
  assetId: string;
  /** Final drawn scale, including the renderer's tier silhouette multiplier. */
  scale: number;
  rotationY: number;
  trunkRadius: number;
}

interface ForestResourcesOptions {
  entities: EntityStore;
  getNodeState: (id: string) => ResourceNodeState | undefined;
  onActivate?: (descriptor: ForestTreeDescriptor) => void;
  onDeactivate?: (descriptor: ForestTreeDescriptor) => void;
}

/** Keeps distant forest trees instanced while nearby trees join the normal gathering systems. */
export class ForestResources {
  private readonly trees = new Map<string, ForestTreeDescriptor>();
  private readonly spatial = new SpatialIndex();
  private readonly resident = new Map<string, SemanticEntity>();
  private populationChanged = false;

  constructor(private readonly options: ForestResourcesOptions) {}

  register(descriptor: ForestTreeDescriptor): void {
    const existing = this.trees.get(descriptor.id);
    if (existing) {
      // A streamed tile can recreate its meshes while its semantic tree remains resident.
      if (this.resident.has(descriptor.id)) this.options.onActivate?.(existing);
      return;
    }
    if (resourceDef(descriptor.resourceId).archetype !== "tree") {
      throw new Error(`Forest tree ${descriptor.id} uses non-tree resource ${descriptor.resourceId}.`);
    }
    this.trees.set(descriptor.id, descriptor);
    this.spatial.insert(descriptor.id, descriptor.position);
    // Suppress the original before its first render, even when a saved stump is far away.
    if (this.options.getNodeState(descriptor.id)?.state === "depleted") this.activate(descriptor);
  }

  update(player: Vec3, pinnedIds: ReadonlySet<string>): boolean {
    this.spatial.forEachInRadius(player, 35, (id) => {
      if (!this.resident.has(id)) this.activate(this.trees.get(id)!);
    });
    // A navigation target can sit outside the activation radius.
    for (const id of pinnedIds) {
      const tree = this.trees.get(id);
      if (tree && !this.resident.has(id)) this.activate(tree);
    }
    // This visits only promoted trees and saved stumps, never the entire forest registry.
    for (const [id, entity] of this.resident) {
      const saved = this.options.getNodeState(id);
      if (saved && entity.resource) {
        entity.state = saved.state;
        entity.resource.remaining = saved.remaining;
        entity.resource.maxYields = saved.maxYields;
      }
      if (entity.state === "depleted" || pinnedIds.has(id)) continue;
      const dx = entity.position[0] - player[0];
      const dy = entity.position[1] - player[1];
      const dz = entity.position[2] - player[2];
      if (dx * dx + dy * dy + dz * dz <= 50 * 50) continue;
      this.options.entities.remove(id);
      this.resident.delete(id);
      this.options.onDeactivate?.(this.trees.get(id)!);
      this.populationChanged = true;
    }
    const changed = this.populationChanged;
    this.populationChanged = false;
    return changed;
  }

  /** Resolve saved-node timers without populating the entity store with offscreen trees. */
  resolve(id: string): SemanticEntity | undefined {
    const resident = this.resident.get(id);
    if (resident) return resident;
    const tree = this.trees.get(id);
    return tree ? this.createEntity(tree) : undefined;
  }

  forEachResident(visit: (entity: SemanticEntity, descriptor: ForestTreeDescriptor) => void): void {
    for (const [id, entity] of this.resident) visit(entity, this.trees.get(id)!);
  }

  stats(): { registered: number; resident: number; depleted: number } {
    let depleted = 0;
    for (const entity of this.resident.values()) if (entity.state === "depleted") depleted += 1;
    return { registered: this.trees.size, resident: this.resident.size, depleted };
  }

  reset(): void {
    for (const id of this.resident.keys()) {
      this.options.entities.remove(id);
      this.options.onDeactivate?.(this.trees.get(id)!);
    }
    this.populationChanged = this.resident.size > 0;
    this.resident.clear();
    this.trees.clear();
    this.spatial.clear();
  }

  private activate(tree: ForestTreeDescriptor): void {
    const entity = this.createEntity(tree);
    this.resident.set(tree.id, entity);
    this.options.entities.add(entity);
    this.options.onActivate?.(tree);
    this.populationChanged = true;
  }

  private createEntity(tree: ForestTreeDescriptor): SemanticEntity {
    const definition = resourceDef(tree.resourceId);
    const saved = this.options.getNodeState(tree.id);
    const [min, max] = definition.yieldRange ?? yieldRange(definition.tier);
    let hash = 2166136261;
    for (let i = 0; i < tree.id.length; i += 1) {
      hash = Math.imul(hash ^ tree.id.charCodeAt(i), 16777619);
    }
    const forestYieldFactor = Math.min(1.5, Math.max(0.65, tree.scale));
    const initialYields = Math.max(1, Math.round((min + ((hash >>> 0) % (max - min + 1))) * forestYieldFactor));
    return {
      id: tree.id,
      archetype: "tree",
      name: definition.name,
      tier: definition.tier,
      regionId: tree.regionId,
      position: tree.position,
      state: saved?.state ?? "available",
      requirements: { [definition.skill]: definition.reqLevel },
      interactions: ["inspect", "chop"],
      resource: {
        remaining: saved?.remaining ?? initialYields,
        maxYields: saved?.maxYields ?? initialYields,
        respawnSeconds: definition.respawnSeconds ?? respawnSeconds(definition.tier),
        itemId: definition.itemId,
      },
      view: {
        assetId: tree.assetId,
        scale: tree.scale / tierSilhouetteScale(definition.tier),
        rotationY: tree.rotationY,
        depletedAssetId: tree.assetId.startsWith("corealm_pine_") ? "corealm_stump_pine"
          : tree.assetId.startsWith("corealm_oak_") ? "corealm_stump_oak"
            : definition.presentation.depletedAssetId,
        materialTier: definition.presentation.materialTier,
        labelHeight: 2.4,
      },
      meta: {
        forestTree: true,
        forestYieldFactor,
        resourceId: definition.id,
        skill: definition.skill,
        trunkRadius: tree.trunkRadius,
      },
    };
  }
}
