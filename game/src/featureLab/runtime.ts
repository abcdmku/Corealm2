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
import type { AssetRegistry } from "../render/assets.js";
import type { CharacterRig } from "../render/characterRig.js";
import type { EntityViews } from "../render/entityViews.js";
import { SPELLS } from "../content/spells.js";
import { sendGameCommand } from "../api/commands.js";
import type { SimClock } from "../core/time.js";
import { enemyBlockFor } from "../content/enemies.js";
import { enemyCombatLevel } from "../content/index.js";
import { distanceXZ } from "../core/math.js";
import type { Store } from "../state/store.js";
import { BANK_CAPACITY } from "../state/store.js";
import type { EntityStore } from "../world/entities.js";
import type { LabOp } from "../worker/labProtocol.js";
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

export interface FeatureLabRuntimeDeps {
  readonly api: CorealmGameApi;
  readonly store: Store;
  readonly events: EventBus;
  /** The page's clock, which follows the worker's: `elapsedMs` is the simulation time of the last update. */
  readonly clock: SimClock;
  readonly assets: AssetRegistry;
  readonly entityStore: EntityStore;
  readonly entityViews: EntityViews;
  /**
   * One `lab.*` operation on the lab worker, which owns the simulation. It resolves after the update that carries the
   * effect has been applied to this page's store and entity set.
   */
  readonly lab: (op: LabOp) => Promise<unknown>;
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
  readonly fitStructure: (structure: FeatureLabStructureView) => void | Promise<void>;
  /** Camera, input and rig follow the player to where the worker has just put it. */
  readonly presentPlayerReset: () => void;

  readonly selectedEntityId: () => EntityId | null;
  readonly liveSpellParticles: () => number;
  readonly engineErrors: () => readonly string[];
  readonly groundHeightAt: (x: number, z: number) => number;
}

/**
 * Transient setup controls around the production runtime.
 *
 * This owns no simulation, and neither does the page: the lab world runs in the lab worker. Every
 * actor is a normal SemanticEntity there, every action is a command over the session, and whatever
 * sets a session up (levels, equipment, the target, the bank fixture) is a `lab.*` operation on the
 * worker's debug channel. A method that changes the simulation therefore returns a promise, which
 * resolves once this page's replicated state shows the change. `getState` reads that replicated
 * state and stays synchronous.
 */
export interface FeatureLabRuntime extends FeatureLabApi {
  /** Run once, after the lab worker's world is joined: the character a lab starts with. `getState().ready` is false until it has. */
  start(): Promise<void>;
  /** Wait until every update the worker has sent so far is applied to this page. */
  refreshView(): Promise<void>;
}

export function createFeatureLabRuntime(deps: FeatureLabRuntimeDeps): FeatureLabRuntime {
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

  let started = false;
  const initialSpellId = FEATURE_LAB_CATALOG.spells[0]?.id ?? null;

  const api: FeatureLabRuntime = {
    getState,
    refreshView,
    // A feature session starts ready to exercise the whole content ladder. The worker's store keeps
    // nothing, so none of it can leak into a player's character.
    async start() {
      await deps.lab({ op: "lab.init" });
      if (initialSpellId) requireOk(await sendGameCommand(deps.api, "setPreferredSpell", initialSpellId), `select ${initialSpellId}`);
      started = true;
    },
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
      const changedRecipe = (patch.kind !== undefined && patch.kind !== requestedStructureSelection.kind)
        || (patch.id !== undefined && patch.id !== requestedStructureSelection.id);
      requestedStructureSelection = {
        ...requestedStructureSelection,
        ...(changedRecipe && !Object.hasOwn(patch, "model") ? { model: undefined } : {}),
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
              deps.presentPlayerReset();
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

    async fitStructure() {
      return guardAsync(async () => {
        await deps.fitStructure(structure);
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
          assetId: options?.assetId,
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
        // target or combat state. The worker stops the player, clears combat and every enemy
        // runtime, puts the player back on the spawn and swaps the one actor. The yard and the
        // current structure are ordinary semantic entities and stay where they are.
        await deps.lab({ op: "lab.spawnTarget", entity, replaces: target?.entityId ?? null });
        target = { preset, entityId };
        sequence = nextSequence;
        deps.presentPlayerReset();
        await refreshView();
        });
      targetQueue = task;
      return guardAsync(async () => {
        await task;
        return getState();
      });
    },

    async setLevel(skillId, level) {
      return guardAsync(async () => {
        if (!SKILL_IDS.includes(skillId)) throw new Error(`Unknown skill: ${skillId}`);
        await deps.lab({ op: "lab.setLevel", skill: skillId, level: Number.isFinite(level) ? level : 1 });
        return getState();
      });
    },

    async equipPlayer(slot, itemId) {
      return guardAsync(async () => {
        if (!EQUIP_SLOTS.includes(slot)) throw new Error(`Unknown equipment slot: ${String(slot)}`);
        if (itemId !== null) {
          const row = FEATURE_LAB_CATALOG.equipment.find((entry) => entry.slot === slot);
          if (!row?.items.some((item) => item.id === itemId)) throw new Error(`${itemId} is not valid for ${slot}`);
        }
        await deps.lab({ op: "lab.equip", slot, itemId });
        return getState();
      });
    },

    async setSpell(spellId) {
      return guardAsync(async () => {
        if (!FEATURE_LAB_CATALOG.spells.some((spell) => spell.id === spellId)) {
          throw new Error(`Unknown spell: ${spellId}`);
        }
        requireOk(await sendGameCommand(deps.api, "setPreferredSpell", spellId), `select ${spellId}`);
        await refreshView();
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
          await deps.lab({ op: "lab.resetPlayer" });
          deps.presentPlayerReset();
          return getState();
        }
        if (action === "awaken-altar") {
          await deps.lab({ op: "lab.awakenAltar" });
          return getState();
        }
        if (action === "reset-bank") {
          await deps.lab({ op: "lab.resetBank" });
          deps.presentPlayerReset();
          return getState();
        }
        if (action === "open-bank") {
          const bank = deps.entityStore.all().find((entity) => entity.archetype === "bank");
          if (!bank) throw new Error("The feature-lab bank fixture is missing");
          requireOk(await sendGameCommand(deps.api, "interact", bank.id, "bank"), `open ${bank.name}`);
          await refreshView();
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
            await sendGameCommand(deps.api, "moveTo", { position: [x, deps.groundHeightAt(x, z), z] }),
            `flee from ${live.preset.label}`,
          );
          await refreshView();
          return getState();
        }
        if (action === "attack") {
          requireOk(await sendGameCommand(deps.api, "attack", live.entityId), `attack ${live.preset.label}`);
        } else {
          const spellId = deps.api.getSpellbook().preferredSpellId ?? initialSpellId;
          if (!spellId) throw new Error("No spell is selected");
          requireOk(await sendGameCommand(deps.api, "cast", spellId, live.entityId), `cast ${spellId}`);
        }
        // The acknowledgement comes ahead of the update that carries the effect. One more round trip puts this after it.
        await refreshView();
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
      inventory: carried(state.inventory.slots),
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
      ready: started,
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
        screen: projectTargetPoint(entity),
        health: entity.combat?.health ?? null,
        maxHealth: entity.combat?.maxHealth ?? null,
        motion: entityMotion ? {
          motion: entityMotion.motion,
          clip: entityMotion.clip,
          time: entityMotion.time,
          liveRig: entityMotion.liveRig,
        } : null,
        ai: creatureAi(entity),
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
   * The live AI runtime of the spawned creature, as `systems/enemyAI.ts` sees it in the worker.
   *
   * The runtime lives in the worker's shared world rows, which are never replicated. After each
   * tick the lab worker writes the target's onto the entity as `meta.labAi`, so it arrives in the
   * same update as the health and position that tick produced. Null for anything that is not an
   * enemy, and null before the first tick has registered the creature, so a caller that polls
   * sees it appear rather than a fabricated "idle".
   */
  function creatureAi(entity: SemanticEntity): FeatureLabCreatureAi | null {
    if (entity.archetype !== "enemy" && entity.archetype !== "boss") return null;
    const stamped = entity.meta?.["labAi"];
    if (typeof stamped !== "string") return null;
    const runtime = JSON.parse(stamped) as { state: FeatureLabCreatureAi["state"]; spawnPos: Vec3; respawnAtMs: number | null };
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
      distanceFromPlayer: round2(distanceXZ(entity.position, deps.store.get().player.position)),
      respawnInMs: runtime.respawnAtMs === null
        ? null
        : Math.max(0, Math.round(runtime.respawnAtMs - deps.clock.elapsedMs)),
    };
  }

  /**
   * One round trip to the worker that changes nothing. A command's acknowledgement comes ahead of the
   * update that carries its effect, and the answer to this comes after it, so awaiting it puts the
   * caller behind the effect.
   */
  async function refreshView(): Promise<void> {
    await deps.lab({ op: "lab.view", targetId: target?.entityId ?? null });
  }

  function projectEntity(position: Vec3, labelHeight: number): readonly [number, number] | null {
    return projectWorldPoint(position[0], position[1] + labelHeight * 0.45, position[2]);
  }

  /**
   * Where a pointer has to land to hit this entity, which is NOT the label anchor.
   *
   * `labelHeight` is a constant per preset family — 2.2 m for every non-boss creature — so for a
   * frog 0.3 m tall the anchor floats a metre above its head. A click there misses the body, the
   * ray carries on to the terrain three metres beyond, and the game correctly reads that as a walk
   * order. Aim at the middle of what the render layer actually draws instead; `preciseSampled`
   * follows the current pose rather than the padded culling envelope.
   */
  function projectTargetPoint(entity: SemanticEntity): readonly [number, number] | null {
    const drawn = deps.entityViews.drawnBounds(entity.id, true);
    if (!drawn) return projectEntity(entity.position, entity.view?.labelHeight ?? 2);
    return projectWorldPoint(
      (drawn.min[0] + drawn.max[0]) * 0.5,
      (drawn.min[1] + drawn.max[1]) * 0.5,
      (drawn.min[2] + drawn.max[2]) * 0.5,
    );
  }

  function projectWorldPoint(x0: number, y0: number, z0: number): readonly [number, number] | null {
    const rect = deps.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const point = new THREE.Vector3(x0, y0, z0);
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

/** The carried stacks, one row per item in first-slot order: what `InventorySystem.distinctItemIds` and `countOf` answered. */
function carried(slots: readonly ({ itemId: ItemId; quantity: number } | null)[]): { itemId: ItemId; quantity: number }[] {
  const totals = new Map<ItemId, number>();
  for (const slot of slots) if (slot) totals.set(slot.itemId, (totals.get(slot.itemId) ?? 0) + slot.quantity);
  return [...totals].map(([itemId, quantity]) => ({ itemId, quantity }));
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
