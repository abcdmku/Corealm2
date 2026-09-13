import * as THREE from "three";
import {
  EQUIP_SLOTS,
  SKILL_IDS,
  type EntityId,
  type EquipSlot,
  type FeatureLabApi,
  type FeatureLabCreatureAi,
  type FeatureLabMode,
  type FeatureLabMotionView,
  type FeatureLabPresentationView,
  type FeatureLabPreset,
  type FeatureLabState,
  type FeatureLabStructureSelection,
  type FeatureLabStructureView,
  type FeatureLabTargetKind,
  type ItemId,
  type RegionId,
  type SemanticEntity,
  type SkillId,
  type SpellId,
  type Vec3,
} from "../contracts.js";
import type { CorealmGameApi } from "../api/gameApi.js";
import type { EventBus } from "../core/events.js";
import type { SimClock } from "../core/time.js";
import type { AssetRegistry } from "../render/assets.js";
import type { CharacterRig } from "../render/characterRig.js";
import type { EntityViews } from "../render/entityViews.js";
import { SPELLS } from "../content/spells.js";
import { enemyBlockFor } from "../content/enemies.js";
import { enemyCombatLevel } from "../content/index.js";
import { distanceXZ } from "../core/math.js";
import type { GameState, Store } from "../state/store.js";
import { BANK_CAPACITY, setSkillLevel } from "../state/store.js";
import type { CombatSystem } from "../systems/combat.js";
import type { EquipmentSystem } from "../systems/equipment.js";
import type { InventorySystem } from "../systems/inventory.js";
import { ESSENCE_BY_ELEMENT, type EssenceSystem } from "../systems/essence.js";
import type { EntityStore } from "../world/entities.js";
import { FEATURE_LAB_CATALOG, createFeatureLabEntity, featureLabTargetOffset, stagedCreaturePreset } from "./catalog.js";

const TARGET_DISTANCE = 10;
/**
 * How far out `spawnTarget` will place an actor.
 *
 * The low end has to be inside melee reach and the high end outside the widest authored aggro
 * radius (22 m, the Rootheart), or the lab could not set up either side of an aggro check.
 */
const MIN_TARGET_DISTANCE = 2;
const MAX_TARGET_DISTANCE = 40;
/** How far `perform("flee")` sends the player. Past the 28 m leash from any sane spawn. */
const FLEE_DISTANCE = 45;
const TARGET_LATERAL_OFFSET = 3;
const LAB_ITEM_QUANTITY = 100_000;
const LAB_BANK_CONTENTS = Object.freeze([
  { itemId: "grithe_ore", quantity: 25 },
  { itemId: "duskoak_log", quantity: 12 },
  { itemId: "seared_trout", quantity: 5 },
] satisfies readonly { itemId: ItemId; quantity: number }[]);
const LAB_BANK_INVENTORY = Object.freeze([
  { itemId: "grithe_ore", quantity: 8 },
  { itemId: "palewood_log", quantity: 6 },
] satisfies readonly { itemId: ItemId; quantity: number }[]);

export interface FeatureLabRuntimeDeps {
  readonly api: CorealmGameApi;
  readonly store: Store;
  readonly events: EventBus;
  readonly clock: SimClock;
  readonly assets: AssetRegistry;
  readonly entityStore: EntityStore;
  readonly entityViews: EntityViews;
  readonly inventory: InventorySystem;
  readonly equipment: EquipmentSystem;
  readonly essence: EssenceSystem;
  readonly combat: CombatSystem;
  readonly playerRig: CharacterRig;
  readonly playerRigReady: boolean;
  readonly canvas: HTMLCanvasElement;
  readonly camera: THREE.Camera;
  readonly spawn: Vec3;
  readonly spawnRegionId: RegionId;
  readonly initialMode: FeatureLabMode;
  readonly initialWalkingEnabled: boolean;
  readonly initialPlayerVisible: boolean;
  readonly initialFreeCameraEnabled: boolean;
  readonly initialStructure: FeatureLabStructureView;
  readonly presentation?: FeatureLabPresentationView;
  readonly replaceStructure: (
    selection: FeatureLabStructureSelection,
  ) => Promise<FeatureLabStructureView>;
  readonly setWalkingEnabled: (enabled: boolean) => void;
  readonly setPlayerVisible: (visible: boolean) => void;
  readonly setFreeCameraEnabled: (enabled: boolean) => void;
  readonly reloadMode: (mode: FeatureLabMode) => void;
  readonly fitStructure: (structure: FeatureLabStructureView) => void;
  readonly resetPlayer: () => void;
  readonly selectedEntityId: () => EntityId | null;
  readonly liveSpellParticles: () => number;
  readonly engineErrors: () => readonly string[];
  readonly groundHeightAt: (x: number, z: number) => number;
}

/**
 * Transient setup controls around the production runtime.
 *
 * This deliberately owns no simulation. Every actor is a normal SemanticEntity, every action goes
 * through CorealmGameApi, and the normal GameLoop remains the only thing that advances movement,
 * enemy AI, combat, animation, damage, and spell flight.
 */
export function createFeatureLabRuntime(deps: FeatureLabRuntimeDeps): FeatureLabApi {
  let target: { preset: FeatureLabPreset; entityId: EntityId } | null = null;
  let mode = deps.initialMode;
  let walkingEnabled = deps.initialWalkingEnabled;
  let playerVisible = deps.initialPlayerVisible;
  let freeCameraEnabled = deps.initialFreeCameraEnabled;
  let structure = cloneStructureView(deps.initialStructure);
  let requestedStructureSelection = { ...structure.selection };
  let structureQueue: Promise<void> = Promise.resolve();
  let structureRequestSequence = 0;
  let targetQueue: Promise<void> = Promise.resolve();
  let modeRevision = 0;
  let sequence = 0;
  const runtimeErrors: string[] = [];
  const counters = {
    navigationStarted: 0,
    navigationCompleted: 0,
    combatStarted: 0,
    spellLaunched: 0,
  };

  deps.events.subscribe((event) => {
    if (event.type === "navigation.started") counters.navigationStarted += 1;
    else if (event.type === "navigation.completed") counters.navigationCompleted += 1;
    else if (event.type === "combat.started") counters.combatStarted += 1;
    else if (event.type === "spell.launched") counters.spellLaunched += 1;
  });

  // A feature session starts ready to exercise the whole content ladder. These are real state and
  // inventory mutations, but SaveService is disabled by the lab boot profile so none can leak into
  // a player's character.
  deps.store.get().inventory.slots.fill(null);
  for (const skill of SKILL_IDS) setSkillLevel(deps.store.get(), skill, 99);
  deps.store.markDirty();
  resetBankFixture();
  const initialSpellId = FEATURE_LAB_CATALOG.spells[0]?.id ?? null;
  if (initialSpellId) requireOk(deps.api.setPreferredSpell(initialSpellId), `select ${initialSpellId}`);

  const api: FeatureLabApi = {
    getState,
    getCatalog: () => FEATURE_LAB_CATALOG,

    setMode(nextMode) {
      return guard(() => {
        if (nextMode !== "combat" && nextMode !== "building") {
          throw new Error(`Unknown feature-lab mode: ${String(nextMode)}`);
        }
        if (nextMode !== mode) deps.reloadMode(nextMode);
        return getState();
      });
    },

    setWalkingEnabled(enabled) {
      return guard(() => {
        if (typeof enabled !== "boolean") {
          throw new Error("Feature-lab walking state must be a boolean");
        }
        deps.setWalkingEnabled(enabled);
        walkingEnabled = enabled;
        return getState();
      });
    },

    setPlayerVisible(visible) {
      return guard(() => {
        if (typeof visible !== "boolean") throw new Error("Player visibility must be a boolean");
        deps.setPlayerVisible(visible);
        playerVisible = visible;
        return getState();
      });
    },

    previewPlayerReaction(pose) {
      return guard(() => {
        if (pose !== "hit" && pose !== "death") throw new Error("Unsupported player reaction preview");
        if (!deps.playerRigReady) throw new Error("Player rig is not ready");
        deps.playerRig.play(pose, true);
        return getState();
      });
    },

    setFreeCameraEnabled(enabled) {
      return guard(() => {
        if (typeof enabled !== "boolean") throw new Error("Free-camera state must be a boolean");
        deps.setFreeCameraEnabled(enabled);
        freeCameraEnabled = enabled;
        return getState();
      });
    },

    async setStructure(patch) {
      requestedStructureSelection = {
        ...requestedStructureSelection,
        ...patch,
      };
      const selection = { ...requestedStructureSelection };
      const requestSequence = structureRequestSequence + 1;
      structureRequestSequence = requestSequence;
      return guardAsync(async () => {
        const task = structureQueue
          .catch(() => undefined)
          .then(async () => {
            try {
              const next = await deps.replaceStructure(selection);
              deps.essence.hydrateAltars();
              structure = cloneStructureView(next);
              if (requestSequence === structureRequestSequence) {
                requestedStructureSelection = { ...next.selection };
              }
            } catch (cause) {
              if (requestSequence === structureRequestSequence) {
                requestedStructureSelection = { ...structure.selection };
              }
              throw cause;
            }
          });
        structureQueue = task;
        await task;
        return getState();
      });
    },

    fitStructure() {
      return guard(() => {
        deps.fitStructure(structure);
        return getState();
      });
    },

    async spawnTarget(kind, presetId, options) {
      const requestedModeRevision = modeRevision;
      const distance = normalDistance(options?.distance);
      const task = targetQueue
        .catch(() => undefined)
        .then(async () => {
        if (mode !== "combat" || requestedModeRevision !== modeRevision) return;
        const preset = findPreset(kind, presetId);
        const nextSequence = sequence + 1;
        const entityId = `feature-lab:${kind}:${nextSequence}`;
        // Keep the actor off the camera/player centreline so melee contact and spell silhouettes
        // remain readable in the normal production camera instead of stacking into one shape.
        const [x, z] = targetGroundPoint(distance);
        const ground: Vec3 = [x, deps.groundHeightAt(x, z), z];
        const entity = createFeatureLabEntity(preset, {
          entityId,
          groundPosition: ground,
          baseY: (assetId) => deps.assets.baseY(assetId),
          assetSize: (assetId) => deps.assets.assetSize(assetId),
          rotationY: Math.atan2(deps.spawn[0] - x, deps.spawn[2] - z),
        });
        // Authored content decides the actor's appearance and stats. Its original biome does not
        // decide which streamed world this deliberately empty session is standing in.
        entity.regionId = deps.spawnRegionId;

        const prepared = await deps.entityViews.prepare([entity]);
        if (prepared.missing.length > 0) {
          throw new Error(`Missing production actor assets: ${prepared.missing.join(", ")}`);
        }
        if (mode !== "combat" || requestedModeRevision !== modeRevision) return;

        // Asset preparation is the failure-prone step, so finish it before disturbing the live
        // target or combat state. The yard and current structure are ordinary semantic entities
        // and must remain in the store when one actor replaces another.
        deps.api.stop();
        deps.combat.resetOnDeath(deps.clock.elapsedMs);
        deps.combat.resetForNewWorld();
        deps.store.get().world.enemies = {};
        deps.resetPlayer();

        const previousTarget = target;
        const previousEntity = previousTarget
          ? deps.entityStore.get(previousTarget.entityId)
          : undefined;
        if (previousTarget) deps.entityStore.remove(previousTarget.entityId);
        try {
          deps.entityStore.add(entity);
          deps.entityViews.sync(deps.entityStore.all());
          target = { preset, entityId };
          sequence = nextSequence;
        } catch (cause) {
          deps.entityStore.remove(entityId);
          if (previousEntity) deps.entityStore.add(previousEntity);
          deps.entityViews.sync(deps.entityStore.all());
          throw cause;
        }
        });
      targetQueue = task;
      return guardAsync(async () => {
        await task;
        return getState();
      });
    },

    setLevel(skillId, level) {
      return guard(() => {
        if (!SKILL_IDS.includes(skillId)) throw new Error(`Unknown skill: ${skillId}`);
        const normal = Number.isFinite(level) ? Math.max(1, Math.min(99, Math.floor(level))) : 1;
        setSkillLevel(deps.store.get(), skillId, normal);
        deps.store.markDirty();
        return getState();
      });
    },

    async equipPlayer(slot, itemId) {
      return guardAsync(async () => {
        if (!EQUIP_SLOTS.includes(slot)) throw new Error(`Unknown equipment slot: ${String(slot)}`);
        const current = deps.equipment.slots()[slot];
        if (itemId === null) {
          if (current) {
            const result = requireOk(deps.equipment.unequip(slot), `clear ${slot}`);
            discardFromSetupInventory(result.itemId);
          }
          return getState();
        }

        const row = FEATURE_LAB_CATALOG.equipment.find((entry) => entry.slot === slot);
        if (!row?.items.some((item) => item.id === itemId)) {
          throw new Error(`${itemId} is not valid for ${slot}`);
        }
        if (current?.itemId === itemId) return getState();

        discardFromSetupInventory(itemId);
        requireOk(deps.inventory.addItem(itemId, 1, { silent: true }), `stage ${itemId}`);
        const equipped = requireOk(deps.equipment.equip(itemId, slot), `equip ${itemId}`);
        if (equipped.replaced) discardFromSetupInventory(equipped.replaced);
        return getState();
      });
    },

    setSpell(spellId) {
      return guard(() => {
        if (!FEATURE_LAB_CATALOG.spells.some((spell) => spell.id === spellId)) {
          throw new Error(`Unknown spell: ${spellId}`);
        }
        requireOk(deps.api.setPreferredSpell(spellId), `select ${spellId}`);
        return getState();
      });
    },

    async perform(action) {
      return guardAsync(async () => {
        if (action !== "attack" && action !== "cast" && action !== "flee" && action !== "reset-player"
          && action !== "awaken-altar" && action !== "open-bank" && action !== "reset-bank") {
          throw new Error(`Unknown feature-lab action: ${String(action)}`);
        }
        if (action === "reset-player") {
          deps.api.stop();
          deps.combat.resetOnDeath(deps.clock.elapsedMs);
          deps.resetPlayer();
          return getState();
        }
        if (action === "awaken-altar") {
          const altar = deps.entityStore.all().find((entity) => entity.meta?.essenceAltar === true);
          if (!altar) throw new Error("Select the Essence Altar Ruins composition first");
          if (altar.state !== "awakened") {
            requireOk(deps.essence.awaken(altar.id), `awaken ${altar.name}`);
          }
          return getState();
        }
        if (action === "reset-bank") {
          resetBankFixture();
          deps.resetPlayer();
          return getState();
        }
        if (action === "open-bank") {
          const bank = deps.entityStore.all().find((entity) => entity.archetype === "bank");
          if (!bank) throw new Error("The feature-lab bank fixture is missing");
          requireOk(deps.api.interact(bank.id, "bank"), `open ${bank.name}`);
          return getState();
        }
        const live = requireCreatureTarget();
        if (action === "flee") {
          // Straight away from the creature, through the ordinary movement system, so the run is
          // subject to the same speed and the same navmesh a player's would be.
          const entity = deps.entityStore.get(live.entityId);
          if (!entity) throw new Error("The creature target is no longer in the world");
          const player = deps.store.get().player.position;
          const dx = player[0] - entity.position[0];
          const dz = player[2] - entity.position[2];
          const length = Math.hypot(dx, dz);
          // Degenerate only if the two are exactly stacked; any fixed heading is as good as another.
          const [ux, uz] = length < 1e-3 ? [0, 1] : [dx / length, dz / length];
          const x = player[0] + ux * FLEE_DISTANCE;
          const z = player[2] + uz * FLEE_DISTANCE;
          requireOk(
            deps.api.moveTo({ position: [x, deps.groundHeightAt(x, z), z] }),
            `flee from ${live.preset.label}`,
          );
          return getState();
        }
        if (action === "attack") {
          requireOk(deps.api.attack(live.entityId), `attack ${live.preset.label}`);
        } else {
          const spellId = deps.api.getSpellbook().preferredSpellId ?? initialSpellId;
          if (!spellId) throw new Error("No spell is selected");
          requireOk(deps.api.cast(spellId, live.entityId), `cast ${spellId}`);
        }
        return getState();
      });
    },
  };

  return api;

  function getState(): FeatureLabState {
    const player = deps.api.getPlayer();
    const equipment = deps.api.getEquipment();
    const skills = deps.api.getSkills();
    const levels = {} as Record<SkillId, number>;
    for (const skill of SKILL_IDS) levels[skill] = skills[skill].level;
    const worn = {} as Record<EquipSlot, ItemId | null>;
    for (const slot of EQUIP_SLOTS) worn[slot] = equipment.slots[slot]?.itemId ?? null;

    const state = deps.store.get();
    const bankEntity = deps.entityStore.all().find((candidate) => candidate.archetype === "bank");
    const bank: FeatureLabState["bank"] = bankEntity ? {
      entityId: bankEntity.id,
      state: bankEntity.state,
      position: [...bankEntity.position] as Vec3,
      screen: projectEntity(bankEntity.position, bankEntity.view?.labelHeight ?? 1.4),
      contents: {
        slots: state.bank.slots.map((stack) => ({ ...stack })),
        usedSlots: state.bank.slots.length,
        capacity: BANK_CAPACITY,
      },
      inventory: deps.inventory.distinctItemIds().map((itemId) => ({
        itemId,
        quantity: deps.inventory.countOf(itemId),
      })),
    } : null;
    const altarEntity = deps.entityStore.all().find((candidate) => candidate.meta?.essenceAltar === true);
    const altarElement = altarEntity?.meta?.essenceElement;
    const altar: FeatureLabState["altar"] = altarEntity
      && (altarElement === "wind" || altarElement === "earth" || altarElement === "water" || altarElement === "fire")
      && (altarEntity.state === "dormant" || altarEntity.state === "awakened")
      ? {
          entityId: altarEntity.id,
          state: altarEntity.state as "dormant" | "awakened",
          element: altarElement,
          interactions: [...altarEntity.interactions],
          orbItemId: "air_orb",
          orbConsumed: state.magic.consumedOrbs.air_orb === true,
        }
      : null;
    const entity = target ? deps.entityStore.get(target.entityId) : undefined;
    const playerMotion = deps.playerRigReady
      ? toPlayerMotion(deps.playerRig.motionSnapshot())
      : null;
    const entityMotion = entity ? deps.entityViews.motionSnapshot(entity.id) : null;

    return {
      ready: true,
      engine: "corealm-production",
      world: "fallowmarch-yard",
      mode,
      walkingEnabled,
      playerVisible,
      freeCameraEnabled,
      player,
      playerPosition: [...state.player.position] as Vec3,
      playerMotion,
      movement: {
        mode: state.player.movement.mode,
        destination: state.player.movement.destination
          ? [...state.player.movement.destination] as Vec3
          : null,
        destinationEntityId: state.player.movement.destinationEntityId,
      },
      selectedEntityId: deps.selectedEntityId(),
      structure: cloneStructureView(structure),
      bank,
      altar,
      ...(deps.presentation ? {
        presentation: {
          ...deps.presentation,
          resourceEntityIds: [...deps.presentation.resourceEntityIds],
        },
      } : {}),
      target: entity && target ? {
        kind: target.preset.kind,
        presetId: target.preset.id,
        entityId: entity.id,
        name: entity.name,
        state: entity.state,
        position: [...entity.position] as Vec3,
        screen: projectEntity(entity.position, entity.view?.labelHeight ?? 2),
        health: entity.combat?.health ?? null,
        maxHealth: entity.combat?.maxHealth ?? null,
        motion: entityMotion ? {
          motion: entityMotion.motion,
          clip: entityMotion.clip,
          time: entityMotion.time,
          liveRig: entityMotion.liveRig,
        } : null,
        ai: creatureAi(entity, state),
      } : null,
      equipment: worn,
      equipmentTotals: { ...equipment.totals },
      levels,
      spellId: deps.api.getSpellbook().preferredSpellId,
      liveSpellParticles: deps.liveSpellParticles(),
      counters: { ...counters },
      errors: [...deps.engineErrors(), ...runtimeErrors],
    };
  }

  /**
   * The live AI runtime for a spawned creature, as `systems/enemyAI.ts` sees it.
   *
   * Null for anything that is not an enemy, and null before the first tick has registered the
   * creature in `state.world.enemies` — a caller that polls will see it appear rather than get a
   * fabricated "idle" for something the AI has not met yet.
   */
  function creatureAi(entity: SemanticEntity, state: GameState): FeatureLabCreatureAi | null {
    if (entity.archetype !== "enemy" && entity.archetype !== "boss") return null;
    const runtime = state.world.enemies[entity.id];
    if (!runtime) return null;
    const family = typeof entity.meta?.["family"] === "string" ? entity.meta["family"] : "";
    const groupId = typeof entity.meta?.["groupId"] === "string" ? entity.meta["groupId"] : entity.id;
    const block = enemyBlockFor(groupId, family, entity.tier);
    const behaviour = typeof entity.meta?.["behaviour"] === "string"
      ? entity.meta["behaviour"] as FeatureLabCreatureAi["behaviour"]
      : block?.behaviour ?? "passive";
    return {
      state: runtime.state,
      behaviour,
      aggroRadius: entity.combat?.aggroRadius ?? block?.aggroRadius ?? 0,
      level: entity.combat?.level ?? (block ? enemyCombatLevel(block) : 0),
      moveSpeedMps: entity.combat?.moveSpeedMps ?? block?.moveSpeedMps ?? null,
      bodyRadius: entity.combat?.bodyRadius ?? null,
      spawnPosition: [...runtime.spawnPos] as Vec3,
      distanceFromSpawn: round2(distanceXZ(entity.position, runtime.spawnPos)),
      distanceFromPlayer: round2(distanceXZ(entity.position, state.player.position)),
      respawnInMs: runtime.respawnAtMs === null
        ? null
        : Math.max(0, Math.round(runtime.respawnAtMs - deps.clock.elapsedMs)),
    };
  }

  function projectEntity(position: Vec3, labelHeight: number): readonly [number, number] | null {
    const rect = deps.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const point = new THREE.Vector3(position[0], position[1] + labelHeight * 0.45, position[2]);
    point.project(deps.camera);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.z < -1 || point.z > 1) return null;
    const x = rect.left + (point.x + 1) * 0.5 * rect.width;
    const y = rect.top + (1 - point.y) * 0.5 * rect.height;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  }

  function findPreset(kind: FeatureLabTargetKind, presetId: string): FeatureLabPreset {
    const preset = FEATURE_LAB_CATALOG.targets[kind].find((entry) => entry.id === presetId)
      ?? (kind === "creature" ? stagedCreaturePreset(presetId) : undefined);
    if (!preset) throw new Error(`Unknown feature-lab ${kind} preset: ${presetId}`);
    return preset;
  }

  function requireCreatureTarget(): { preset: FeatureLabPreset; entityId: EntityId } {
    if (!target || target.preset.kind !== "creature" || !deps.entityStore.get(target.entityId)) {
      throw new Error("Spawn a creature target first");
    }
    return target;
  }

  function discardFromSetupInventory(itemId: ItemId): void {
    const quantity = deps.inventory.countOf(itemId);
    if (quantity > 0) requireOk(deps.inventory.removeItem(itemId, quantity, { silent: true }), `discard ${itemId}`);
  }

  function resetBankFixture(): void {
    const fixtureItemIds = new Set<ItemId>([
      ...LAB_BANK_CONTENTS.map((stack) => stack.itemId),
      ...LAB_BANK_INVENTORY.map((stack) => stack.itemId),
      ...Object.values(ESSENCE_BY_ELEMENT).filter((itemId): itemId is ItemId => itemId !== null),
      "air_orb",
      ...(deps.presentation?.enabled ? ["grithe_pickaxe", "grithe_hatchet"] : []),
    ]);
    for (const itemId of fixtureItemIds) discardFromSetupInventory(itemId);
    deps.store.get().bank.slots = LAB_BANK_CONTENTS.map((stack) => ({ ...stack }));
    for (const itemId of Object.values(ESSENCE_BY_ELEMENT)) {
      if (!itemId) continue;
      requireOk(deps.inventory.addItem(itemId, LAB_ITEM_QUANTITY), `stock ${itemId}`);
    }
    requireOk(deps.inventory.addItem("air_orb", 1), "stock the Air Orb");
    if (deps.presentation?.enabled) {
      requireOk(deps.inventory.addItem("grithe_pickaxe", 1), "stock the presentation pickaxe");
      requireOk(deps.inventory.addItem("grithe_hatchet", 1), "stock the presentation hatchet");
    }
    for (const stack of LAB_BANK_INVENTORY) {
      requireOk(deps.inventory.addItem(stack.itemId, stack.quantity), `stock ${stack.itemId}`);
    }
    deps.store.markDirty();
  }

  function clearTarget(): void {
    if (!target) return;
    deps.api.stop();
    deps.combat.resetOnDeath(deps.clock.elapsedMs);
    deps.combat.resetForNewWorld();
    deps.store.get().world.enemies = {};
    deps.entityStore.remove(target.entityId);
    deps.entityViews.sync(deps.entityStore.all());
    target = null;
  }

  /**
   * Where to stand the actor, `distance` metres from the player in a straight line.
   *
   * A structure in the way moves the actor sideways to clear it, and the forward leg is then
   * re-solved against the new offset so the distance survives the dodge.
   */
  function targetGroundPoint(distance: number): readonly [number, number] {
    const straight = featureLabTargetOffset(distance, TARGET_LATERAL_OFFSET);
    let x = deps.spawn[0] + straight.lateral;
    let z = deps.spawn[2] + straight.forward;
    const bounds = structure.bounds;
    if (bounds && x >= bounds.min[0] - 1 && x <= bounds.max[0] + 1
      && z >= bounds.min[2] - 1 && z <= bounds.max[2] + 1) {
      const left = bounds.min[0] - 3;
      const right = bounds.max[0] + 3;
      x = Math.abs(left - deps.spawn[0]) < Math.abs(right - deps.spawn[0]) ? left : right;
      z = deps.spawn[2] + featureLabTargetOffset(distance, x - deps.spawn[0]).forward;
    }
    return [x, z];
  }

  function guard<T>(operation: () => T): T {
    try {
      return operation();
    } catch (cause) {
      const message = describe(cause);
      runtimeErrors.push(message);
      if (runtimeErrors.length > 20) runtimeErrors.shift();
      throw cause;
    }
  }

  async function guardAsync<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (cause) {
      const message = describe(cause);
      runtimeErrors.push(message);
      if (runtimeErrors.length > 20) runtimeErrors.shift();
      throw cause;
    }
  }
}

/** Clamps a caller-supplied spawn distance, and falls back to the default when it is not a number. */
function normalDistance(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return TARGET_DISTANCE;
  return Math.max(MIN_TARGET_DISTANCE, Math.min(MAX_TARGET_DISTANCE, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toPlayerMotion(snapshot: ReturnType<CharacterRig["motionSnapshot"]>): FeatureLabMotionView {
  return {
    pose: snapshot.pose,
    clip: snapshot.clip,
    time: snapshot.time,
    liveRig: true,
  };
}

function cloneStructureView(view: FeatureLabStructureView): FeatureLabStructureView {
  return {
    ...view,
    selection: { ...view.selection },
    bounds: view.bounds ? {
      min: [...view.bounds.min] as Vec3,
      max: [...view.bounds.max] as Vec3,
    } : null,
  };
}

function requireOk<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }, action: string): T {
  if (!result.ok) throw new Error(`Could not ${action}: ${result.error.message}`);
  return result.value;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
