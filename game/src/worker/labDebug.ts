import type { ItemId, SemanticEntity, Vec3 } from "../contracts.js";
import { enemyBlockFor } from "../content/enemies.js";
import { enemyCombatLevel } from "../content/index.js";
import { distanceXZ } from "../core/math.js";
import type { LabRuntimeFixture } from "../featureLab/labSpec.js";
import type { HeadlessPlayer } from "../multiplayer/headlessPlayer.js";
import type { HeadlessWorld } from "../multiplayer/headlessWorld.js";
import { assetMeasurements, type AssetMeasure } from "../multiplayer/worldAssembly.js";
import { computeMaxHealth, setSkillLevel } from "../state/store.js";
import { SKILL_IDS } from "../contracts.js";
import { ESSENCE_BY_ELEMENT } from "../systems/essence.js";
import type { LabWorld } from "./labWorld.js";
import type { LabOp } from "./labProtocol.js";

/**
 * The host end of the `lab.*` operations: what `window.__featureLab` and the lab fixtures used to do
 * to a main-thread simulation, done to the `HeadlessWorld` that owns the state now.
 *
 * `localDebug.ts` runs each of these between ticks and replicates before it answers, exactly as it
 * does for the `__gameDebug` operations, so the page has the effect before it has the answer.
 */
const LAB_ITEM_QUANTITY = 100_000;
const LAB_BANK_CONTENTS: readonly { itemId: ItemId; quantity: number }[] = [
  { itemId: "grithe_ore", quantity: 25 }, { itemId: "duskoak_log", quantity: 12 }, { itemId: "seared_trout", quantity: 5 }];
const LAB_BANK_INVENTORY: readonly { itemId: ItemId; quantity: number }[] = [{ itemId: "grithe_ore", quantity: 8 }, { itemId: "palewood_log", quantity: 6 }];

/** The target's AI runtime, which lives in the shared world rows and is never replicated. `FeatureLabCreatureAi` on the page. */
export interface LabTargetAi {
  state: string; behaviour: string; aggroRadius: number; level: number; moveSpeedMps: number | null; bodyRadius: number | null;
  spawnPosition: Vec3; distanceFromSpawn: number; distanceFromPlayer: number; respawnInMs: number | null;
}

export interface LabDebugPorts { world(): HeadlessWorld; player(): HeadlessPlayer; playerId: string; lab: LabWorld; assets: Record<string, AssetMeasure>; fixtureData: { agility?: unknown } }
type HostedFixture = Record<string, (...args: never[]) => unknown>;

const requireOk = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }, action: string): T => {
  if (!result.ok) throw new Error(`Could not ${action}: ${result.error.message}`);
  return result.value;
};
const round2 = (value: number): number => Math.round(value * 100) / 100;

export function createLabDebug(ports: LabDebugPorts): { apply(op: LabOp): Promise<{ value: unknown; full?: boolean }>; targetAi(targetId: string | null): LabTargetAi | null } {
  const { lab } = ports, spec = lab.spec;
  const measurements = assetMeasurements(id => Object.hasOwn(ports.assets, id) ? ports.assets[id] : undefined);
  const fixtures = new Map<LabRuntimeFixture, Promise<HostedFixture>>();

  const discard = (actor: HeadlessPlayer, itemId: ItemId): void => {
    const quantity = actor.inventory.countOf(itemId);
    if (quantity > 0) requireOk(actor.inventory.removeItem(itemId, quantity, { silent: true }), `discard ${itemId}`);
  };

  function resetBankFixture(actor: HeadlessPlayer): void {
    const tools: ItemId[] = spec.character.presentationTools ? ["grithe_pickaxe", "grithe_hatchet"] : [];
    const essence = Object.values(ESSENCE_BY_ELEMENT).filter((itemId): itemId is ItemId => Boolean(itemId));
    for (const itemId of new Set<ItemId>([...LAB_BANK_CONTENTS.map(stack => stack.itemId), ...LAB_BANK_INVENTORY.map(stack => stack.itemId), ...essence, "air_orb", ...tools])) discard(actor, itemId);
    actor.store.get().bank.slots = LAB_BANK_CONTENTS.map(stack => ({ ...stack }));
    for (const itemId of essence) requireOk(actor.inventory.addItem(itemId, LAB_ITEM_QUANTITY), `stock ${itemId}`);
    requireOk(actor.inventory.addItem("air_orb", 1), "stock the Air Orb");
    for (const itemId of tools) requireOk(actor.inventory.addItem(itemId, 1), `stock ${itemId}`);
    for (const stack of LAB_BANK_INVENTORY) requireOk(actor.inventory.addItem(stack.itemId, stack.quantity), `stock ${stack.itemId}`);
    actor.store.markDirty();
  }

  function resetPlayer(actor: HeadlessPlayer, position?: Vec3, facingRad?: number): void {
    const world = ports.world(), state = actor.store.get();
    const at = position ?? [lab.ports.spawn[0], lab.groundHeightAt(lab.ports.spawn[0], lab.ports.spawn[2]), lab.ports.spawn[2]] as Vec3;
    actor.suspend(); actor.movement.stop(state, world.clock.elapsedMs, "feature-lab-reset");
    state.player.position = [...at] as Vec3; state.player.regionId = spec.spawn.regionId;
    state.player.facingRad = facingRad ?? spec.spawn.facingRad;
    state.player.maxHealth = computeMaxHealth(state, actor.equipment.totals().health);
    state.player.health = state.player.maxHealth;
    actor.store.markDirty(); world.spatial.move(ports.playerId, state.player.position);
  }

  function clearCombat(actor: HeadlessPlayer): void {
    const world = ports.world();
    actor.api.stop();
    actor.combat.resetOnDeath(world.clock.elapsedMs); actor.combat.resetForNewWorld();
    for (const id of Object.keys(world.shared.enemies)) delete world.shared.enemies[id];
    world.ai.rescan();
  }

  /** Altars are private entities of each player, cloned when the player was built. One that arrived since has to be adopted. */
  function adoptAltars(actor: HeadlessPlayer, added: readonly SemanticEntity[], removed: readonly string[]): void {
    for (const id of removed) actor.questEntities.delete(id);
    for (const entity of added) if (entity.meta?.essenceAltar || entity.meta?.essenceAltarRuins) actor.questEntities.set(entity.id, structuredClone(entity));
    actor.essence.hydrateAltars();
  }

  /** `scene`: the entities are part of the lab scene, so a `reset` rebuilds the world with them. A target actor is not. */
  function replaceEntities(remove: readonly string[], add: readonly SemanticEntity[], scene = false): void {
    const world = ports.world();
    if (scene) {
      const gone = new Set([...remove, ...add.map(entity => entity.id)]), kept = lab.ports.entities.filter(entity => !gone.has(entity.id));
      lab.ports.entities.splice(0, lab.ports.entities.length, ...kept, ...structuredClone(add) as SemanticEntity[]);
    }
    for (const id of remove) { world.entities.remove(id); delete world.shared.enemies[id]; delete world.shared.nodes[id]; delete world.shared.lootPiles[id]; }
    for (const entity of add) { if (world.entities.get(entity.id)) world.entities.remove(entity.id); world.entities.add(structuredClone(entity)); }
    adoptAltars(ports.player(), add, remove);
    world.ai.rescan();
  }

  async function hosted(fixture: LabRuntimeFixture): Promise<HostedFixture> {
    if (!spec.runtime.includes(fixture)) throw new Error(`This lab session did not ask for the ${fixture} fixture`);
    let loading = fixtures.get(fixture);
    if (!loading) {
      const world = ports.world(), actor = ports.player();
      const common = { store: actor.store, entities: world.entities, prepareEntities: async () => {}, groundHeightAt: lab.groundHeightAt, baseY: measurements.baseY };
      loading = (async (): Promise<HostedFixture> => {
        switch (fixture) {
          case "creatureLoot": return (await import("../featureLab/creatureLootFixture.js")).createCreatureLootFixture(common) as unknown as HostedFixture;
          case "regionalTier": return (await import("../featureLab/regionalTierFixture.js")).createRegionalTierFixture(common) as unknown as HostedFixture;
          case "progression": return (await import("../featureLab/questRecovery.js")).createQuestRecoveryFixture({ ...common, quests: actor.quests }) as unknown as HostedFixture;
          case "gameplay": return (await import("../featureLab/gameplayAcceptance.js")).createGameplayAcceptanceFixture({ ...common, assetSize: measurements.assetSize }) as unknown as HostedFixture;
          case "agility": {
            if (!ports.fixtureData.agility) throw new Error("The page sent no agility course with its lab world");
            const { createAgilityWorkbench } = await import("../featureLab/agility.js");
            return createAgilityWorkbench(ports.fixtureData.agility as import("../featureLab/agility.js").AgilityFixture, { store: actor.store, quests: actor.quests,
              navigation: lab.ports.nav, movement: actor.movement, rng: actor.random.get("misc"), elapsedMs: () => ports.world().clock.elapsedMs,
              getEntity: id => ports.world().entities.get(id) }) as unknown as HostedFixture;
          }
          default: throw new Error(`The ${fixture} fixture is not hosted by the lab worker`);
        }
      })();
      fixtures.set(fixture, loading);
    }
    return loading;
  }

  function targetAi(targetId: string | null): LabTargetAi | null {
    const world = ports.world(), entity = targetId ? world.entities.get(targetId) : undefined;
    if (!entity || (entity.archetype !== "enemy" && entity.archetype !== "boss")) return null;
    const runtime = world.shared.enemies[entity.id];
    if (!runtime) return null;
    const family = typeof entity.meta?.["family"] === "string" ? entity.meta["family"] : "";
    const groupId = typeof entity.meta?.["groupId"] === "string" ? entity.meta["groupId"] : entity.id;
    const block = enemyBlockFor(groupId, family, entity.tier);
    const position = world.players.get(ports.playerId)?.store.get().player.position ?? entity.position;
    return {
      state: runtime.state, behaviour: typeof entity.meta?.["behaviour"] === "string" ? entity.meta["behaviour"] : block?.behaviour ?? "passive",
      aggroRadius: entity.combat?.aggroRadius ?? block?.aggroRadius ?? 0, level: entity.combat?.level ?? (block ? enemyCombatLevel(block) : 0),
      moveSpeedMps: entity.combat?.moveSpeedMps ?? block?.moveSpeedMps ?? null, bodyRadius: entity.combat?.bodyRadius ?? null,
      spawnPosition: [...runtime.spawnPos] as Vec3, distanceFromSpawn: round2(distanceXZ(entity.position, runtime.spawnPos)),
      distanceFromPlayer: round2(distanceXZ(entity.position, position)),
      respawnInMs: runtime.respawnAtMs === null ? null : Math.max(0, Math.round(runtime.respawnAtMs - world.clock.elapsedMs)),
    };
  }

  return {
    targetAi,
    async apply(op) {
      const world = ports.world(), actor = ports.player();
      switch (op.op) {
        case "lab.init": {
          const state = actor.store.get();
          state.inventory.slots.fill(null);
          for (const skill of SKILL_IDS) setSkillLevel(state, skill, 99);
          actor.store.markDirty(); resetBankFixture(actor);
          if (spec.character.forestHatchet) requireOk(actor.inventory.addItem("grithe_hatchet", 1), "stock the forest hatchet");
          return { value: null };
        }
        case "lab.world": {
          lab.patch(op.patch);
          actor.movement.stop(actor.store.get(), world.clock.elapsedMs, "feature-lab-structure");
          replaceEntities(op.patch.removeEntities ?? [], op.patch.addEntities ?? [], true);
          return { value: null };
        }
        case "lab.spawnTarget": {
          clearCombat(actor); resetPlayer(actor);
          replaceEntities(op.replaces ? [op.replaces] : [], [op.entity]);
          lab.targetId = op.entity.id;
          return { value: op.entity.id };
        }
        case "lab.setLevel": { setSkillLevel(actor.store.get(), op.skill, op.level); actor.store.markDirty(); return { value: actor.store.get().skills[op.skill].level }; }
        case "lab.equip": {
          const current = actor.equipment.slots()[op.slot];
          if (op.itemId === null) { if (current) discard(actor, requireOk(actor.equipment.unequip(op.slot), `clear ${op.slot}`).itemId); return { value: null }; }
          if (current?.itemId === op.itemId) return { value: op.itemId };
          discard(actor, op.itemId);
          requireOk(actor.inventory.addItem(op.itemId, 1, { silent: true }), `stage ${op.itemId}`);
          const equipped = requireOk(actor.equipment.equip(op.itemId, op.slot), `equip ${op.itemId}`);
          if (equipped.replaced) discard(actor, equipped.replaced);
          return { value: op.itemId };
        }
        case "lab.resetPlayer": { actor.api.stop(); actor.combat.resetOnDeath(world.clock.elapsedMs); resetPlayer(actor, op.position, op.facingRad); return { value: null }; }
        case "lab.resetBank": { resetBankFixture(actor); resetPlayer(actor); return { value: null }; }
        case "lab.awakenAltar": {
          const altar = [...actor.questEntities.values(), ...world.entities.all()].find(entity => entity.meta?.essenceAltar === true);
          if (!altar) throw new Error("Select the Essence Altar Ruins composition first");
          if (altar.state !== "awakened") requireOk(actor.essence.awaken(altar.id), `awaken ${altar.name}`);
          return { value: altar.id };
        }
        case "lab.entities": { replaceEntities(op.remove, op.add, true); return { value: null }; }
        case "lab.moveEntity": {
          const entity = world.entities.get(op.entityId);
          if (!entity) throw new Error(`No entity with id ${op.entityId}`);
          world.entities.setPosition(op.entityId, [...op.position] as Vec3);
          if (op.rotationY !== undefined && entity.view) entity.view.rotationY = op.rotationY;
          return { value: null };
        }
        case "lab.setEntityState": {
          const entity = world.entities.get(op.entityId);
          if (!entity) throw new Error(`No entity with id ${op.entityId}`);
          entity.state = op.state;
          const own = actor.questEntities.get(op.entityId); if (own) own.state = op.state;
          return { value: op.state };
        }
        case "lab.call": {
          const fixture = await hosted(op.fixture);
          if (!Object.hasOwn(fixture, op.method) || typeof fixture[op.method] !== "function") throw new Error(`The ${op.fixture} fixture has no method ${op.method}`);
          const value = await (fixture[op.method] as (...args: unknown[]) => unknown)(...op.args);
          for (const entity of world.entities.all()) if ((entity.meta?.essenceAltar || entity.meta?.essenceAltarRuins) && !actor.questEntities.has(entity.id)) adoptAltars(actor, [entity], []);
          actor.store.markDirty(); world.spatial.move(ports.playerId, actor.store.get().player.position); world.ai.rescan();
          return { value: value === undefined ? null : structuredClone(value) };
        }
        case "lab.view": return { value: { targetAi: targetAi(op.targetId) } };
        default: throw new Error(`Lab operation ${op.op} is not an edit`);
      }
    },
  };
}
