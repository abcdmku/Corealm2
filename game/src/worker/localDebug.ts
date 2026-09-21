import type { PlayerCharacter, SemanticEntity, WorldStorageRecord } from "../contracts.js";
import { content } from "../content/index.js";
import { rehydrateEnemyRuntimes, rehydrateWorldContainers } from "../persistence/worldContainers.js";
import { addSkillXp, playerSessionState, setSkillLevel, type GameState } from "../state/store.js";
import { HeadlessWorld } from "../multiplayer/headlessWorld.js";
import type { HeadlessPlayer } from "../multiplayer/headlessPlayer.js";
import { applyPlayerOps, type PlayerOp } from "../multiplayer/playerEdits.js";
import type { HostedWorld, WorldHost } from "../multiplayer/worldHost.js";
import { debugOp, type DebugOp, type DebugReply, type EntityFilter } from "./localDebugProtocol.js";
import type { AssetMeasure } from "../multiplayer/worldAssembly.js";
import { createLabDebug } from "./labDebug.js";
import { isLabOp, labOp } from "./labProtocol.js";
import type { LabWorld } from "./labWorld.js";

/**
 * The host end of local play's debug channel: every `window.__gameDebug` mutator and whole-world
 * read, run against the `HeadlessWorld` that owns the state.
 *
 * An operation runs between ticks, so it never lands inside a simulation step, and it goes through
 * the game's own paths where one exists: the inventory system, the admin edit operations of
 * `playerEdits.ts`, the gathering system's depletion and respawn, combat's damage. After it, the host
 * replicates without simulating, and only then is the answer sent. The link posts both on one port,
 * so the page has the effect before the answer.
 *
 * Time is the host's pace: paused, scaled, or stepped by whole 100 ms ticks.
 */
export interface LocalDebugPorts {
  host: WorldHost;
  hosted: HostedWorld;
  playerId: string;
  /** Write the store through now. Answers with what flushing has cost so far, when the store keeps count. */
  flush(): Promise<unknown>;
  /** A feature-lab session. Present, the channel also answers the `lab.*` operations of `labProtocol.ts`. */
  lab?: { world: LabWorld; assets: Record<string, AssetMeasure>; fixtureData: { agility?: unknown } };
}

const READS = new Set<DebugOp["op"]>(["getEntity", "findEntities", "getWorldState", "getSave"]);
const MAGIC_WEAPONS = ["basic_wooden_wand", "basic_wooden_staff", "palewood_wand", "palewood_staff", "duskoak_wand", "duskoak_staff", "cairnpine_wand", "cairnpine_staff",
  "air_wand", "air_staff", "earth_wand", "earth_staff", "water_wand", "water_staff"];
const RELEASED_ORBS = ["air_orb", "earth_orb", "water_orb"], RELEASED_ESSENCE = ["air_essence", "earth_essence", "water_essence"];

function matches(entity: SemanticEntity, filter: EntityFilter | undefined): boolean {
  if (!filter) return true;
  if (filter.archetype !== undefined && entity.archetype !== filter.archetype) return false;
  if (filter.regionId !== undefined && entity.regionId !== filter.regionId) return false;
  if (filter.tier !== undefined && entity.tier !== filter.tier) return false;
  if (filter.ids && !filter.ids.includes(entity.id)) return false;
  if (filter.near && Math.hypot(entity.position[0] - filter.near.position[0], entity.position[2] - filter.near.position[2]) > filter.near.radius) return false;
  return true;
}

export function createLocalDebug(ports: LocalDebugPorts): (op: unknown) => Promise<DebugReply> {
  const { host, hosted, playerId } = ports;
  const world = (): HeadlessWorld => hosted.runtime;
  const player = (): HeadlessPlayer => {
    const found = world().players.get(playerId);
    if (!found || !world().active.has(playerId)) throw new Error("The local player is not in the world");
    return found;
  };
  /** What this player sees of an entity: quest state overlays the shared row, as replication shows it. */
  const entityOf = (id: string): SemanticEntity | null => world().players.get(playerId)?.questEntities.get(id) ?? world().entities.get(id) ?? null;
  /** The admin edit operations, applied to the live character the way an admin's patch is. */
  const edit = (ops: PlayerOp[]): string[] => {
    const { ownedWorld: _owned, ...character } = playerSessionState(player().store.get());
    const result = applyPlayerOps(character as PlayerCharacter, ops, { world: null, snap: () => null });
    world().adoptCharacter(playerId, result.character, false);
    return result.warnings;
  };

  /** Swap the running world for a fresh one over the same geometry, and put the player in it. Storage follows at the next commit. */
  function replaceWorld(saved: WorldStorageRecord | null, claim: Parameters<HeadlessWorld["join"]>[1], name: string): HeadlessPlayer {
    const previous = hosted.runtime;
    previous.leave(playerId);
    const next = new HeadlessWorld(previous.descriptor, previous.ports, saved);
    next.adoptPersistence(previous);
    hosted.runtime = next; hosted.publicGameplay.clear();
    const joined = next.join(playerId, claim); joined.store.get().player.name = name;
    for (const peer of hosted.peers.values()) peer.replicator.rebase();
    return joined;
  }

  function apply(op: DebugOp): { value: unknown; full?: boolean } {
    switch (op.op) {
      case "place": {
        const actor = player(), state = actor.store.get();
        actor.suspend(); actor.movement.stop(state, world().clock.elapsedMs, "teleport");
        state.player.position = [...op.position]; state.player.regionId = op.regionId as GameState["player"]["regionId"];
        if (op.facingRad !== undefined) state.player.facingRad = op.facingRad;
        state.activity = null; actor.store.markDirty();
        world().spatial.move(playerId, state.player.position);
        return { value: true };
      }
      case "giveItem":
        // Silent on purpose: `item.received` feeds quest gather counters, and debug may set a check up, never satisfy one.
        if (op.to === "inventory") return { value: player().inventory.addItem(op.itemId, op.quantity, { silent: true }) };
        if (!content.item(op.itemId)) return { value: { ok: false, error: { code: "NOT_FOUND", message: `No item with id ${op.itemId}` } } };
        edit([{ op: "bank.add", itemId: op.itemId, quantity: op.quantity }]);
        return { value: { ok: true, value: op.quantity } };
      case "removeItem":
        if (op.from === "inventory") return { value: player().inventory.removeItem(op.itemId, op.quantity, { silent: true }) };
        edit([{ op: "bank.remove", itemId: op.itemId, quantity: op.quantity }]);
        return { value: { ok: true, value: op.quantity } };
      case "clearInventory": { const actor = player(), slots = actor.store.get().inventory.slots; slots.fill(null); actor.store.markDirty(); return { value: null }; }
      case "setEquipment": return { value: { warnings: edit([{ op: "equipment.set", slot: op.slot, itemId: op.itemId }]) } };
      case "setHealth": {
        const actor = player(), state = actor.store.get();
        state.player.health = Math.max(0, Math.min(state.player.maxHealth, Math.floor(op.health))); actor.store.markDirty();
        return { value: state.player.health };
      }
      case "setSkillLevel": { const actor = player(); setSkillLevel(actor.store.get(), op.skill, op.level); actor.store.markDirty(); return { value: actor.store.get().skills[op.skill].level }; }
      case "grantXp": {
        const actor = player(), result = addSkillXp(actor.store.get(), op.skill, op.amount);
        if (result.levelsGained > 0) actor.events.emit("level.gained", { skill: op.skill, level: result.newLevel, levelsGained: result.levelsGained }, undefined, world().clock.elapsedMs);
        actor.store.markDirty(); return { value: result.newLevel };
      }
      case "setCurrency": { const actor = player(); actor.store.get().currency = Math.max(0, Math.floor(op.amount)); actor.store.markDirty(); return { value: actor.store.get().currency }; }
      case "setQuestStage": {
        const actor = player(), quests = actor.store.get().quests;
        const existing = quests[op.questId] ?? { status: "active" as const, stage: 0, counters: {}, flags: {} };
        existing.stage = Math.max(0, Math.floor(op.stage)); existing.status = "active"; quests[op.questId] = existing;
        actor.store.markDirty(); return { value: structuredClone(existing) };
      }
      case "setQuestState": {
        const actor = player(), quests = actor.store.get().quests;
        if (op.state === null) delete quests[op.questId];
        else quests[op.questId] = { status: op.state.status, stage: Math.max(0, Math.floor(op.state.stage)), counters: { ...op.state.counters }, flags: { ...op.state.flags } };
        actor.store.markDirty(); return { value: structuredClone(quests[op.questId] ?? null) };
      }
      case "seedMagic": {
        const actor = player(), state = actor.store.get();
        setSkillLevel(state, "magic", op.magicLevel);
        // A two-handed staff cannot share the off hand. The same unequip path the UI takes.
        if (state.equipment.offHand) actor.api.unequipItem("offHand");
        for (const itemId of [...MAGIC_WEAPONS, ...RELEASED_ORBS]) actor.inventory.addItem(itemId, 1, { silent: true });
        for (const itemId of RELEASED_ESSENCE) actor.inventory.addItem(itemId, Math.max(1, Math.floor(op.essenceQuantity)), { silent: true });
        const level = state.skills.magic.level, weapon = level >= 10 ? "water_staff" : level >= 5 ? "earth_staff" : "air_staff";
        const equipped = actor.api.equipItem(weapon); actor.store.markDirty();
        const book = actor.api.getSpellbook();
        return { value: { magic: level, weapons: MAGIC_WEAPONS, equippedWeapon: equipped.ok ? weapon : null, weaponError: equipped.ok ? null : equipped.error.message,
          weaponCharges: book.equippedWeapon?.charges ?? 0, essence: book.essence, castable: book.spells.filter(row => row.castable).length, activeSpellId: book.activeSpellId } };
      }
      case "depleteNode": {
        // Through the real depletion path, from the player's own systems, so the events and the respawn timer are a player's.
        const actor = player(), entity = world().entities.get(op.entityId);
        if (!entity?.resource) return { value: false };
        const node = actor.gathering.nodeRuntime(actor.store.get(), entity); node.remaining = 1; entity.resource.remaining = 1;
        return { value: actor.gathering.forceDeplete(op.entityId, world().clock.elapsedMs) };
      }
      case "forceRespawn": return { value: player().gathering.forceRespawn(op.entityId, world().clock.elapsedMs) };
      case "killEntity": {
        const entity = world().entities.get(op.entityId);
        if (!entity?.combat) return { value: false };
        return { value: player().combat.damageEnemy(op.entityId, Number.MAX_SAFE_INTEGER, world().clock.elapsedMs) };
      }
      case "spawnEntity": { world().entities.add(structuredClone(op.entity)); world().ai.rescan(); return { value: true }; }
      case "despawnEntity": {
        if (!world().entities.get(op.entityId)) return { value: false };
        world().entities.remove(op.entityId); delete world().shared.enemies[op.entityId]; delete world().shared.nodes[op.entityId]; delete world().shared.lootPiles[op.entityId];
        world().ai.rescan(); return { value: true };
      }
      case "getEntity": return { value: structuredClone(entityOf(op.entityId)) };
      case "findEntities": return { value: world().entities.all().map(entity => entityOf(entity.id)!).filter(entity => matches(entity, op.filter)).map(entity => structuredClone(entity)) };
      case "getWorldState": {
        // Where a tick's time goes, in milliseconds per tick: what a tool that scales time needs to know about how fast time can go.
        const { samples, ...stages } = host.metrics.stages, perTick = Object.fromEntries(Object.entries(stages).map(([stage, total]) => [stage, samples ? Number((total / samples).toFixed(2)) : 0]));
        return { value: structuredClone({ tick: world().clock.tick, simMs: world().clock.elapsedMs, seed: world().descriptor.seed, entityCount: world().entities.all().length, pace: { ...host.pace }, tickCost: perTick, ...world().shared }) };
      }
      case "getSave": return { value: structuredClone(player().store.get()) };
      case "reset": {
        if (op.seed !== undefined && op.seed !== world().descriptor.seed) throw new Error(`Local play runs the seed its world pack holds (${world().descriptor.seed}). Reset cannot change it to ${op.seed}.`);
        const name = player().store.get().player.name;
        replaceWorld(null, undefined, name);
        host.setPace({ paused: false, timeScale: 1 });
        return { value: null, full: true };
      }
      case "loadSave": {
        const running = world(), name = op.state.player.name || player().store.get().player.name;
        const { ownedWorld: owned, ...character } = playerSessionState(op.state), seed = op.state.meta.seed;
        const here = seed === running.descriptor.seed;
        // World rows are keyed by entity id. A save from this world names this world's entities; a row for anything else has nothing to land on.
        const known = new Set(running.ports.entities.map(entity => entity.id));
        const kept = <T>(rows: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(rows ?? {}).filter(([id]) => known.has(id)));
        const saved: WorldStorageRecord | null = here ? {
          schemaVersion: 1, key: { providerId: running.descriptor.providerId, worldId: running.descriptor.worldId }, fixture: running.descriptor.fixture,
          catalogRevision: running.descriptor.catalogRevision ?? null, seed: running.descriptor.seed, tick: Math.max(0, Math.round(op.state.meta.playSeconds * 10)),
          // Forest trees are entities only while a player is near, so their node rows are kept by seed, not by the entity table.
          world: structuredClone({ nodes: op.state.world.nodes ?? {}, enemies: kept(op.state.world.enemies), lootPiles: op.state.world.lootPiles ?? {} }),
          entities: structuredClone(running.ports.entities), receipts: {}, players: {},
        } : null;
        const joined = replaceWorld(saved, { character: { ...character, player: { ...character.player, id: playerId } }, lastWorld: here ? running.descriptor : null,
          world: here ? { ownedWorld: owned, receipts: [] } : null }, name);
        if (here) {
          // Entities say what a player can see and touch; the rows above say what is true. Bring the first in line with the second.
          rehydrateWorldContainers(joined.store.get(), hosted.runtime.entities);
          rehydrateEnemyRuntimes(joined.store.get(), hosted.runtime.entities, hosted.runtime.clock.elapsedMs);
          hosted.runtime.ai.rescan();
        }
        return { value: { seedMatched: here }, full: true };
      }
      default: throw new Error(`Debug operation ${op.op} is not an edit`);
    }
  }

  const done = (value: unknown): DebugReply => ({ ok: true, value, tick: world().clock.tick });
  const lab = ports.lab ? createLabDebug({ world, player, playerId, lab: ports.lab.world, assets: ports.lab.assets, fixtureData: ports.lab.fixtureData }) : null;
  return async (input) => {
    try {
      if (isLabOp(input)) {
        if (!lab) throw new Error("UNAVAILABLE: lab operations need a feature-lab session");
        const op = labOp(input);
        if (op.op === "lab.skipTicks") { await host.skip(op.ticks); return await host.betweenTicks(async () => done({ tick: world().clock.tick, simMs: world().clock.elapsedMs })); }
        return await host.betweenTicks(async () => {
          const { value, full } = await lab.apply(op);
          if (op.op === "lab.view") return done(value);
          for (const joined of world().players.values()) joined.events.flush();
          host.publish(full === true);
          return done(value);
        });
      }
      const op = debugOp(input);
      if (op.op === "flush") return done(await ports.flush());
      if (op.op === "setPaused" || op.op === "setTimeScale") {
        host.setPace(op.op === "setPaused" ? { paused: op.paused } : { timeScale: op.scale });
        return await host.betweenTicks(async () => { host.publish(); return done({ ...host.pace }); });
      }
      if (op.op === "advanceGameTime" || op.op === "advanceTicks") {
        // A jump moves the clock and runs one tick, as the old debug clock did: systems catch up from elapsed time. Stepping runs every tick.
        if (op.op === "advanceGameTime") await host.betweenTicks(async () => { player(); world().clock.skipMs(op.seconds * 1000); });
        // A lab that steps many ticks is skipping time, and watches none of it: one update at the end. A played world replicates every tick it steps.
        if (lab && op.op === "advanceTicks" && op.ticks > 1) await host.skip(op.ticks);
        else for (let ran = 0, ticks = op.op === "advanceTicks" ? op.ticks : 1; ran < ticks; ran++) await host.step();
        return await host.betweenTicks(async () => done({ tick: world().clock.tick, simMs: world().clock.elapsedMs }));
      }
      return await host.betweenTicks(async () => {
        const { value, full } = apply(op);
        // A read changed nothing, and a tool may ask for a thousand entities one at a time.
        if (READS.has(op.op)) return done(value);
        for (const joined of world().players.values()) joined.events.flush();
        host.publish(full === true);
        return done(value);
      });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}
